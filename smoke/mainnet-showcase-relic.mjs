// MAINNET showcase Relic minter (0G Aristotle 16661). Real flow:
//   SIWE(0x8a3b) -> POST /generate {agentId, prompt} -> poll TEE gen to done -> POST /mint-args
//   -> if teeText/teeSig present: OutputNFT.mintOutputVerified (on-chain 0G-TEE verify), else mintOutput.
// Key read from ~/.claude/aura-mainnet.env (AURA_MAINNET_SPONSOR_KEY), NEVER printed.
// Usage: AGENT_IDS="1,2,3" PROMPTS_OK=1 [DRY=1] node smoke/mainnet-showcase-relic.mjs
import { readFileSync } from "node:fs";
import os from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createWalletClient, createPublicClient, http, decodeEventLog, defineChain } from "viem";

const API = "https://api-aura.topengdev.com";
const DOMAIN = "aura.topengdev.com";
const URI = "https://aura.topengdev.com";
const CHAIN_ID = 16661;
const RPC = "https://evmrpc.0g.ai";
const DRY = process.env.DRY === "1";
const AGENT_IDS = (process.env.AGENT_IDS || "1").split(",").map((s) => Number(s.trim())).filter(Boolean);

const chain = defineChain({ id: CHAIN_ID, name: "0G Aristotle", nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });

const commonInputs = [
  { name: "to", type: "address" }, { name: "creatorAgentId", type: "uint256" },
  { name: "imageRoot", type: "string" }, { name: "provenanceHash", type: "bytes32" },
  { name: "teeAttestation", type: "bytes32" }, { name: "seed", type: "uint256" },
  { name: "nonce", type: "bytes32" }, { name: "attestationSig", type: "bytes" },
];
const outputNftAbi = [
  { type: "function", name: "mintOutput", stateMutability: "nonpayable", inputs: commonInputs, outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "mintOutputVerified", stateMutability: "nonpayable",
    inputs: [...commonInputs, { name: "teeText", type: "string" }, { name: "teeSig", type: "bytes" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "event", name: "OutputMinted", inputs: [
    { name: "tokenId", type: "uint256", indexed: true }, { name: "creatorAgentId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true }, { name: "imageRoot", type: "string", indexed: false },
    { name: "provenanceHash", type: "bytes32", indexed: false }, { name: "teeAttestation", type: "bytes32", indexed: false },
    { name: "seed", type: "uint256", indexed: false } ] },
];

const envTxt = readFileSync(os.homedir() + "/.claude/aura-mainnet.env", "utf8");
let pk = envTxt.match(/AURA_MAINNET_SPONSOR_KEY=\s*"?([^"\n\r]+)"?/)[1].trim();
if (!pk.startsWith("0x")) pk = "0x" + pk;
const account = privateKeyToAccount(pk);
console.log("signer:", account.address, "| chain", CHAIN_ID, "| agents", AGENT_IDS.join(","), DRY ? "| DRY" : "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(p, { method = "GET", token, body } = {}) {
  const res = await fetch(API + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data; try { data = await res.json(); } catch { data = { _raw: (await res.text()).slice(0, 300) }; }
  return { status: res.status, json: data };
}
async function siwe() {
  const nonce = (await j("/auth/nonce")).json.nonce;
  const message = createSiweMessage({ address: account.address, chainId: CHAIN_ID, domain: DOMAIN, nonce, uri: URI, version: "1", statement: "Sign in to AURA to generate, mint, and create. Generation stays sponsored and free." });
  const signature = await account.signMessage({ message });
  const r = await j("/auth/verify", { method: "POST", body: { message, signature } });
  if (!r.json.token) throw new Error("SIWE failed: " + JSON.stringify(r.json));
  return r.json.token;
}

const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const pub = createPublicClient({ chain, transport: http(RPC) });
const results = [];

(async () => {
  const token = await siwe();
  console.log("SIWE ok");
  for (const agentId of AGENT_IDS) {
    console.log(`\n[agent ${agentId}] generate...`);
    const g = await j("/generate", { method: "POST", token, body: { agentId, prompt: `signature showcase relic for agent ${agentId}, museum-grade, its canonical aesthetic` } });
    const jobId = g.json.jobId; if (!jobId) { console.log("  gen kickoff FAILED:", JSON.stringify(g.json)); results.push({ agentId, error: "kickoff:" + JSON.stringify(g.json) }); continue; }
    let job;
    for (let i = 0; i < 90; i++) { await sleep(3000); job = (await j(`/generate/${jobId}`, { token })).json; process.stdout.write(`  t+${(i + 1) * 3}s ${job.status}\r`); if (["done", "failed", "error"].includes(job.status)) break; }
    console.log("");
    if (job.status !== "done") { console.log("  gen NOT done:", job.status, job.error || ""); results.push({ agentId, jobId, error: "gen:" + job.status + ":" + (job.error || "") }); continue; }
    console.log("  gen done: imageRoot", job.result.imageRoot?.slice(0, 16), "teeVerified", job.result.teeVerified, "usedBrain", job.result.usedBrain);
    const ma = await j("/mint-args", { method: "POST", token, body: { jobId, to: account.address } });
    if (ma.status !== 200) { console.log("  mint-args FAILED:", ma.status, JSON.stringify(ma.json)); results.push({ agentId, jobId, error: "mintargs:" + JSON.stringify(ma.json) }); continue; }
    const x = ma.json;
    const verified = Boolean(x.teeText && x.teeSig);
    console.log("  mint-args ok | contract", x.contract, "| verifiedPath", verified, "| teeSigner", x.teeSigner || "(none)", "| dataHash", (x.dataHash || "").slice(0, 12));
    if (DRY) { results.push({ agentId, jobId, imageRoot: x.imageRoot, verified, teeSigner: x.teeSigner, DRY: true }); continue; }
    if (process.env.REQUIRE_VERIFIED === "1" && !verified) { console.log("  SKIP mint: REQUIRE_VERIFIED=1 but gen produced no 0G envelope (teeText/teeSig). Diagnose the mainnet image path."); results.push({ agentId, jobId, imageRoot: x.imageRoot, verified: false, skipped: "no-envelope" }); continue; }
    let hash;
    if (verified) {
      hash = await wallet.writeContract({ address: x.contract, abi: outputNftAbi, functionName: "mintOutputVerified",
        args: [x.to, BigInt(x.creatorAgentId), x.imageRoot, x.provenanceHash, x.teeAttestation, BigInt(x.seed), x.nonce, x.attestationSig, x.teeText, x.teeSig], gas: 900000n });
    } else {
      hash = await wallet.writeContract({ address: x.contract, abi: outputNftAbi, functionName: "mintOutput",
        args: [x.to, BigInt(x.creatorAgentId), x.imageRoot, x.provenanceHash, x.teeAttestation, BigInt(x.seed), x.nonce, x.attestationSig], gas: 800000n });
    }
    console.log("  mint tx:", hash, verified ? "(mintOutputVerified)" : "(mintOutput)");
    let receipt; for (let i = 0; i < 60; i++) { await sleep(2500); try { receipt = await pub.getTransactionReceipt({ hash }); } catch {} if (receipt) break; }
    if (!receipt) { console.log("  no receipt (timeout)"); results.push({ agentId, jobId, tx: hash, error: "no-receipt" }); continue; }
    if (receipt.status !== "success") { console.log("  mint REVERTED"); results.push({ agentId, jobId, tx: hash, error: "reverted" }); continue; }
    let tokenId = null;
    for (const log of receipt.logs) { try { const p = decodeEventLog({ abi: outputNftAbi, data: log.data, topics: log.topics }); if (p.eventName === "OutputMinted") { tokenId = Number(p.args.tokenId); break; } } catch {} }
    console.log("  MINTED tokenId", tokenId, "| tx", hash);
    results.push({ agentId, jobId, tokenId, tx: hash, imageRoot: x.imageRoot, verified, teeVerified: job.result.teeVerified });
  }
  console.log("\nRESULTS_JSON", JSON.stringify(results));
})().catch((e) => { console.error("FATAL:", e.message); console.log("RESULTS_JSON", JSON.stringify(results)); process.exit(1); });
