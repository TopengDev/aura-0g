// Mint ONE showcase character end to end and record it. Resume-safe via a ledger file.
// usage: node smoke/showcase/mint-one.mjs <agentId> <label> "<prompt>"
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { decodeEventLog } from "viem";
import {
  siweLogin, generate, fetchMintArgs, fetchJobImage,
  walletClient, publicClient, account, CONTRACTS, OUT_ABI, pollReceipt,
} from "./lib.mjs";

const LEDGER = "smoke/showcase/ledger.json";
const PUBOUT = "web/public/outputs";

const [, , agentIdRaw, label, prompt] = process.argv;
if (!agentIdRaw || !label || !prompt) {
  console.error('usage: node mint-one.mjs <agentId> <label> "<prompt>"');
  process.exit(1);
}
const agentId = Number(agentIdRaw);

function loadLedger() {
  if (existsSync(LEDGER)) return JSON.parse(readFileSync(LEDGER, "utf8"));
  return { pieces: [] };
}
function saveLedger(l) { writeFileSync(LEDGER, JSON.stringify(l, null, 2)); }

const ledger = loadLedger();
if (ledger.pieces.find((p) => p.label === label && p.tokenId)) {
  console.log(`[${label}] already minted (tokenId ${ledger.pieces.find((p) => p.label === label).tokenId}) - SKIP`);
  process.exit(0);
}
mkdirSync(PUBOUT, { recursive: true });

console.log(`=== ${label} | agent ${agentId} ===`);
console.log(`prompt: ${prompt.slice(0, 90)}...`);

const token = await siweLogin();
console.log("auth ok");

const g = await generate(token, agentId, prompt);
if (g.error) {
  console.log(`GEN FAILED: ${g.error}`);
  const l = loadLedger();
  l.pieces.push({ label, agentId, prompt, status: "gen_failed", error: g.error, ts: new Date().toISOString() });
  saveLedger(l);
  process.exit(2);
}
const r = g.result;
console.log(`gen done: root=${r.imageRoot.slice(0, 18)} tee=${r.teeVerified} latency=${r.latencyMs}ms seed=${r.seed}`);

// fetch + save the PNG locally so /images/<root> can serve real bytes
const png = await fetchJobImage(token, g.jobId);
const short = createHash("sha256").update(r.imageRoot).digest("hex").slice(0, 8);
const file = `gen_${short}.png`;
writeFileSync(`${PUBOUT}/${file}`, png);
console.log(`image saved: ${PUBOUT}/${file} (${png.length} bytes)`);

// mint-args
const ma = await fetchMintArgs(token, g.jobId);
console.log(`mint-args ok: creatorAgentId=${ma.creatorAgentId} nonce=${ma.nonce.slice(0, 12)}`);

// send mintOutput (deployer == to)
const hash = await walletClient.writeContract({
  address: CONTRACTS.outputNFT,
  abi: OUT_ABI,
  functionName: "mintOutput",
  args: [
    account.address,
    BigInt(ma.creatorAgentId),
    ma.imageRoot,
    ma.provenanceHash,
    ma.teeAttestation,
    BigInt(ma.seed),
    ma.nonce,
    ma.attestationSig,
  ],
});
console.log(`mint tx: ${hash}`);
const rcpt = await pollReceipt(hash);
console.log(`mined block ${rcpt.blockNumber} status=${rcpt.status} gasUsed=${rcpt.gasUsed}`);
if (rcpt.status !== "success") {
  const l = loadLedger();
  l.pieces.push({ label, agentId, prompt, status: "mint_reverted", txHash: hash, imageRoot: r.imageRoot, file, ts: new Date().toISOString() });
  saveLedger(l);
  process.exit(3);
}

// derive tokenId from the OutputMinted event (decoded by name, not positional topics)
let tokenId = null;
for (const log of rcpt.logs) {
  if (log.address.toLowerCase() !== CONTRACTS.outputNFT.toLowerCase()) continue;
  try {
    const d = decodeEventLog({ abi: OUT_ABI, data: log.data, topics: log.topics });
    if (d.eventName === "OutputMinted") { tokenId = Number(d.args.tokenId); break; }
  } catch (_) { /* not our event */ }
}
if (tokenId == null) {
  const next = await publicClient.readContract({ address: CONTRACTS.outputNFT, abi: OUT_ABI, functionName: "nextTokenId" });
  tokenId = Number(next) - 1;
}
console.log(`>>> tokenId ${tokenId} | root ${r.imageRoot}`);

const l = loadLedger();
l.pieces.push({
  label, agentId, prompt, status: "minted", tokenId,
  imageRoot: r.imageRoot, provenanceHash: r.provenanceHash, teeAttestation: r.teeAttestation,
  seed: String(r.seed), teeVerified: r.teeVerified, latencyMs: r.latencyMs,
  file, txHash: hash, block: Number(rcpt.blockNumber), ts: new Date().toISOString(),
});
saveLedger(l);
console.log(`ledger updated. DONE ${label} -> tokenId ${tokenId}`);
process.exit(0);
