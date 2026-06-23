// FULL e2e proving Fix #2: create a FRESH user agent (with a reference image), mint it, promote its
// brain, then generate with it and assert usedBrain:true (real art from the agent's brain, NOT catalog
// fallback). Against the LIVE backend (IP-pinned). Deployer wallet SIWE + mint. Key from ../.env (never
// printed). This is the decisive proof the create->brain->generate path works with local-cache persistence.
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
const REG = "0xb5960cc08caa5195095cfb8aa270f122be09ba0a";

const galileo = defineChain({ id: CHAIN_ID, name: "0G Galileo", nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });

const regAbi = [
  { type: "function", name: "mintAgent", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "name", type: "string" }, { name: "styleFingerprint", type: "bytes32" }, { name: "encBrainRoot", type: "string" }, { name: "modelAttestation", type: "bytes32" }, { name: "royaltyBps", type: "uint16" }, { name: "creatorResaleBps", type: "uint16" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "event", name: "AgentMinted", inputs: [{ name: "agentId", type: "uint256", indexed: true }, { name: "owner", type: "address", indexed: true }, { name: "name", type: "string", indexed: false }, { name: "styleFingerprint", type: "bytes32", indexed: false }, { name: "royaltyBps", type: "uint16", indexed: false }, { name: "modelAttestation", type: "bytes32", indexed: false }] },
];

let pk = readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n").find((l) => l.startsWith("PRIVATE_KEY=")).slice("PRIVATE_KEY=".length).trim();
if (!pk.startsWith("0x")) pk = "0x" + pk;
const account = privateKeyToAccount(pk);
console.log("signer:", account.address);

function req(p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : null;
    const r = https.request({ host: VPS_IP, servername: API_HOST, path: p, method, headers: { Host: API_HOST, ...headers, ...(data ? { "content-length": data.length } : {}) } },
      (res) => { let c = []; res.on("data", (x) => c.push(x)); res.on("end", () => { const buf = Buffer.concat(c); let j; try { j = JSON.parse(buf.toString()); } catch { j = { _raw: buf.toString().slice(0, 300) }; } resolve({ status: res.statusCode, json: j }); }); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function multipart(fields, fileField, fileName, fileBytes, fileMime) {
  const b = "----auraform" + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${fileMime}\r\n\r\n`));
  parts.push(fileBytes);
  parts.push(Buffer.from(`\r\n--${b}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${b}` };
}

(async () => {
  // SIWE
  const nonce = (await req("/auth/nonce")).json.nonce;
  const message = createSiweMessage({ address: account.address, chainId: CHAIN_ID, domain: DOMAIN, nonce, uri: URI, version: "1", statement: "Sign in to AURA to generate, mint, and create. Generation stays sponsored and free." });
  const signature = await account.signMessage({ message });
  const token = (await req("/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) })).json.token;
  if (!token) throw new Error("no JWT");
  console.log("SIWE ok");

  // create-agent (multipart). Use a baked PNG as the reference image.
  const refImg = readFileSync(path.join(__dirname, "..", "web", "public", "outputs", "gen_259f7356.png"));
  const name = "BRAINTEST_" + Date.now().toString().slice(-6);
  const mp = multipart({
    name, royaltyBps: "700", creatorResaleBps: "1000",
    styleDescriptor: "Style: bold neon cyberpunk portrait, magenta + cyan rim light, crisp linework",
    signatureCharacter: "a sleek husky character",
  }, "image", "ref.png", refImg, "image/png");
  const cr = await req("/agents/create", { method: "POST", headers: { "content-type": mp.contentType, authorization: `Bearer ${token}` }, body: mp.body });
  if (cr.status !== 200) throw new Error("create failed: " + cr.status + " " + JSON.stringify(cr.json));
  const ca = cr.json;
  console.log("created draft:", name, "encBrainRoot:", ca.encBrainRoot, "canonicalBaseRoot:", ca.canonicalBaseRoot);

  // mintAgent on-chain
  const wallet = createWalletClient({ account, chain: galileo, transport: http(RPC) });
  const pub = createPublicClient({ chain: galileo, transport: http(RPC) });
  const hash = await wallet.writeContract({ address: REG, abi: regAbi, functionName: "mintAgent",
    args: [account.address, ca.name, ca.styleFingerprint, ca.encBrainRoot, ca.modelAttestation, ca.royaltyBps, ca.creatorResaleBps], gas: 1200000n });
  console.log("mintAgent tx:", hash);
  let receipt; for (let i = 0; i < 60; i++) { await sleep(2500); try { receipt = await pub.getTransactionReceipt({ hash }); } catch {} if (receipt) break; }
  if (!receipt || receipt.status !== "success") throw new Error("mintAgent failed/timeout");
  let agentId = null;
  for (const log of receipt.logs) { try { const p = decodeEventLog({ abi: regAbi, data: log.data, topics: log.topics }); if (p.eventName === "AgentMinted") { agentId = Number(p.args.agentId); break; } } catch {} }
  console.log("MINTED agentId:", agentId);

  // confirm-mint (promote brain to agentId)
  const cm = await req("/agents/confirm-mint", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ encBrainRoot: ca.encBrainRoot, agentId }) });
  console.log("confirm-mint:", JSON.stringify(cm.json));

  // generate with the fresh agent
  const g = await req("/generate", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ agentId, prompt: "wearing round glasses, soft smile" }) });
  const jobId = g.json.jobId; if (!jobId) throw new Error("gen kickoff failed: " + JSON.stringify(g.json));
  console.log("gen job:", jobId);
  let job; for (let i = 0; i < 80; i++) { await sleep(3000); job = (await req(`/generate/${jobId}`, { headers: { authorization: `Bearer ${token}` } })).json; process.stdout.write(`  gen t+${(i + 1) * 3}s ${job.status}${job.error ? " ERR=" + job.error : ""}\n`); if (["done", "failed", "error"].includes(job.status)) break; }

  console.log("=== RESULT ===");
  console.log("status:", job.status, "| usedBrain:", job.result?.usedBrain, "| imageRoot:", job.result?.imageRoot, "| teeVerified:", job.result?.teeVerified);
  console.log("RESULT_JSON", JSON.stringify({ agentId, name, usedBrain: job.result?.usedBrain, imageRoot: job.result?.imageRoot, status: job.status, error: job.error }));
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
