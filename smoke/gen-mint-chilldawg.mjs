// FULL e2e for CHILLDAWG (agentId 6) against LIVE: SIWE (deployer) -> generate -> mint-args ->
// OutputNFT.mintOutput (deployer pays gas, mints to deployer) -> parse new tokenId. Confirms a
// user-agent output becomes a real on-chain Output NFT the indexer + galleries surface.
// Key read from ../.env, NEVER printed. API pinned to the VPS IP (real edge, no local resolver dep).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createWalletClient, createPublicClient, http, decodeEventLog, defineChain } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VPS_IP = "31.97.110.176";
const API_HOST = "api-aura.topengdev.com";
const DOMAIN = "aura.topengdev.com";
const URI = "https://aura.topengdev.com";
const CHAIN_ID = 16602;
const RPC = "https://evmrpc-testnet.0g.ai";
const AGENT_ID = 6;

const galileo = defineChain({
  id: CHAIN_ID, name: "0G Galileo", nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const outputNftAbi = [{
  type: "function", name: "mintOutput", stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" }, { name: "creatorAgentId", type: "uint256" },
    { name: "imageRoot", type: "string" }, { name: "provenanceHash", type: "bytes32" },
    { name: "teeAttestation", type: "bytes32" }, { name: "seed", type: "uint256" },
    { name: "nonce", type: "bytes32" }, { name: "attestationSig", type: "bytes" },
  ], outputs: [{ name: "", type: "uint256" }],
}];
const outputMintedEvent = {
  type: "event", name: "OutputMinted",
  inputs: [
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "creatorAgentId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "imageRoot", type: "string", indexed: false },
    { name: "provenanceHash", type: "bytes32", indexed: false },
    { name: "teeAttestation", type: "bytes32", indexed: false },
    { name: "seed", type: "uint256", indexed: false },
  ],
};

const env = readFileSync(path.join(__dirname, "..", ".env"), "utf8");
let pk = env.split("\n").find((l) => l.startsWith("PRIVATE_KEY=")).slice("PRIVATE_KEY=".length).trim();
if (!pk.startsWith("0x")) pk = "0x" + pk;
const account = privateKeyToAccount(pk);
console.log("signer (deployer):", account.address);

function req(p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const r = https.request({ host: VPS_IP, servername: API_HOST, path: p, method,
      headers: { Host: API_HOST, ...headers, ...(data ? { "content-length": data.length } : {}) } },
      (res) => { let c = ""; res.on("data", (x) => (c += x)); res.on("end", () => {
        let j; try { j = JSON.parse(c); } catch { j = { _raw: c.slice(0, 300) }; } resolve({ status: res.statusCode, json: j }); }); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // SIWE
  const nonce = (await req("/auth/nonce")).json.nonce;
  const message = createSiweMessage({ address: account.address, chainId: CHAIN_ID, domain: DOMAIN, nonce, uri: URI, version: "1",
    statement: "Sign in to AURA to generate, mint, and create. Generation stays sponsored and free." });
  const signature = await account.signMessage({ message });
  const token = (await req("/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) })).json.token;
  if (!token) throw new Error("no JWT");
  console.log("SIWE ok");

  // generate
  const g = await req("/generate", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ agentId: AGENT_ID, prompt: "a calm husky dj in a neon booth, lofi night, headphones" }) });
  const jobId = g.json.jobId; if (!jobId) throw new Error("gen kickoff failed: " + JSON.stringify(g.json));
  console.log("job", jobId);
  let job;
  for (let i = 0; i < 60; i++) { await sleep(3000); job = (await req(`/generate/${jobId}`, { headers: { authorization: `Bearer ${token}` } })).json;
    process.stdout.write(`  gen t+${(i + 1) * 3}s ${job.status}\n`); if (["done", "failed", "error"].includes(job.status)) break; }
  if (job.status !== "done") throw new Error("gen not done: " + job.status);
  console.log("generated imageRoot:", job.result.imageRoot, "teeVerified:", job.result.teeVerified, "usedBrain:", job.result.usedBrain);

  // mint-args (mint to deployer)
  const ma = await req("/mint-args", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId, to: account.address }) });
  if (ma.status !== 200) throw new Error("mint-args failed: " + JSON.stringify(ma.json));
  const a = ma.json;
  console.log("mint-args ok, contract", a.contract, "nonce", a.nonce.slice(0, 14) + "...");

  // send mintOutput
  const wallet = createWalletClient({ account, chain: galileo, transport: http(RPC) });
  const pub = createPublicClient({ chain: galileo, transport: http(RPC) });
  const hash = await wallet.writeContract({
    address: a.contract, abi: outputNftAbi, functionName: "mintOutput",
    args: [a.to, BigInt(a.creatorAgentId), a.imageRoot, a.provenanceHash, a.teeAttestation, BigInt(a.seed), a.nonce, a.attestationSig],
    // Galileo min tip
    gas: 600000n,
  });
  console.log("mint tx:", hash);

  // manual receipt poll (never waitForTransactionReceipt on 0G RPC)
  let receipt;
  for (let i = 0; i < 60; i++) { await sleep(2500); try { receipt = await pub.getTransactionReceipt({ hash }); } catch {} if (receipt) break; }
  if (!receipt) throw new Error("no receipt (timeout)");
  console.log("receipt status:", receipt.status);
  if (receipt.status !== "success") throw new Error("mint reverted");

  let tokenId = null;
  for (const log of receipt.logs) { try { const p = decodeEventLog({ abi: [outputMintedEvent], data: log.data, topics: log.topics });
    if (p.eventName === "OutputMinted") { tokenId = Number(p.args.tokenId); break; } } catch {} }
  console.log("MINTED tokenId:", tokenId, "| imageRoot:", job.result.imageRoot);
  console.log("RESULT_JSON", JSON.stringify({ tokenId, imageRoot: job.result.imageRoot, agentId: AGENT_ID, usedBrain: job.result.usedBrain, teeVerified: job.result.teeVerified }));
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
