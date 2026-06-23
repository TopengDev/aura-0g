// Batch-mint the showcase roster. Resume-safe (skips labels already minted in the ledger).
// Reuses ONE SIWE token across pieces. Sequential to respect the gen concurrency cap.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeEventLog } from "viem";
import {
  siweLogin, generate, fetchMintArgs, fetchJobImage,
  walletClient, publicClient, account, CONTRACTS, OUT_ABI, pollReceipt,
} from "./lib.mjs";

const LEDGER = "smoke/showcase/ledger.json";
const PUBOUT = "web/public/outputs";
const ROSTER = JSON.parse(readFileSync(process.argv[2] || "smoke/showcase/roster.json", "utf8"));

const load = () => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { pieces: [] });
const save = (l) => writeFileSync(LEDGER, JSON.stringify(l, null, 2));
mkdirSync(PUBOUT, { recursive: true });

const isDone = (label) => load().pieces.find((p) => p.label === label && p.status === "minted");

console.log(`=== batch: ${ROSTER.length} pieces ===`);
let token = await siweLogin();
console.log("auth ok\n");

for (const item of ROSTER) {
  const { agentId, label, prompt } = item;
  if (isDone(label)) { console.log(`[${label}] SKIP (already minted tokenId ${isDone(label).tokenId})\n`); continue; }
  console.log(`--- ${label} | agent ${agentId} ---`);
  try {
    // token may expire (~1h); refresh defensively each piece is cheap and avoids mid-run 401s
    token = await siweLogin();
    const g = await generate(token, agentId, prompt);
    if (g.error) {
      console.log(`  GEN FAILED: ${g.error}`);
      const l = load(); l.pieces.push({ label, agentId, prompt, status: "gen_failed", error: g.error, ts: new Date().toISOString() }); save(l);
      console.log("");
      continue;
    }
    const r = g.result;
    console.log(`  gen done root=${r.imageRoot.slice(0, 18)} tee=${r.teeVerified} ${r.latencyMs}ms`);

    const png = await fetchJobImage(token, g.jobId);
    const short = createHash("sha256").update(r.imageRoot).digest("hex").slice(0, 8);
    const file = `gen_${short}.png`;
    writeFileSync(`${PUBOUT}/${file}`, png);
    console.log(`  image ${file} (${png.length} b)`);

    const ma = await fetchMintArgs(token, g.jobId);
    const hash = await walletClient.writeContract({
      address: CONTRACTS.outputNFT, abi: OUT_ABI, functionName: "mintOutput",
      args: [account.address, BigInt(ma.creatorAgentId), ma.imageRoot, ma.provenanceHash, ma.teeAttestation, BigInt(ma.seed), ma.nonce, ma.attestationSig],
    });
    console.log(`  mint ${hash.slice(0, 18)}`);
    const rcpt = await pollReceipt(hash);
    if (rcpt.status !== "success") {
      console.log(`  MINT REVERTED`);
      const l = load(); l.pieces.push({ label, agentId, prompt, status: "mint_reverted", txHash: hash, imageRoot: r.imageRoot, file, ts: new Date().toISOString() }); save(l);
      console.log("");
      continue;
    }
    let tokenId = null;
    for (const log of rcpt.logs) {
      if (log.address.toLowerCase() !== CONTRACTS.outputNFT.toLowerCase()) continue;
      try { const d = decodeEventLog({ abi: OUT_ABI, data: log.data, topics: log.topics }); if (d.eventName === "OutputMinted") { tokenId = Number(d.args.tokenId); break; } } catch (_) {}
    }
    if (tokenId == null) { const next = await publicClient.readContract({ address: CONTRACTS.outputNFT, abi: OUT_ABI, functionName: "nextTokenId" }); tokenId = Number(next) - 1; }
    console.log(`  >>> tokenId ${tokenId} (block ${rcpt.blockNumber})`);

    const l = load();
    l.pieces.push({
      label, agentId, prompt, status: "minted", tokenId,
      imageRoot: r.imageRoot, provenanceHash: r.provenanceHash, teeAttestation: r.teeAttestation,
      seed: String(r.seed), teeVerified: r.teeVerified, latencyMs: r.latencyMs,
      file, txHash: hash, block: Number(rcpt.blockNumber), ts: new Date().toISOString(),
    });
    save(l);
    console.log("");
  } catch (e) {
    console.log(`  ERROR: ${String(e?.message || e).slice(0, 200)}`);
    const l = load(); l.pieces.push({ label, agentId, prompt, status: "errored", error: String(e?.message || e).slice(0, 300), ts: new Date().toISOString() }); save(l);
    console.log("");
  }
}

const final = load().pieces.filter((p) => p.status === "minted");
console.log(`=== batch complete: ${final.length} minted total ===`);
for (const p of final) console.log(`  tokenId ${p.tokenId} ${p.label} (agent ${p.agentId})`);
process.exit(0);
