// SHOWPIECE: mint each Aura's signature RELIC as a REAL, provenance-backed output on the NEW OutputNFT.
// Per Aura: SIWE(deployer) -> POST /generate {agentId, defaultCreationPrompt} -> poll the TEE gen to done
// (usedBrain:true via the Aura's brain) -> POST /mint-args (the attestor signs THAT gen's provenance) ->
// OutputNFT.mintOutput (the contract address comes from mint-args = the live 0xEecE). GENUINE provenance:
// the on-chain teeAttestation is for a gen that actually happened (verifiable on /verify). No fabrication.
//
// RESUMABLE: a progress file maps name -> {tokenId, imageRoot, jobId}; already-minted Auras are skipped so
// a mid-run death never double-mints. The Aura agentIds come from the re-seed progress file.
//
// Env: AURAS_JSON, RESEED_PROGRESS (name->agentId from reseed-auras), PROGRESS_FILE, DRY_RUN=1. Key from ../.env.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createWalletClient, createPublicClient, http, decodeEventLog, defineChain } from "viem";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const AURAS_JSON = process.env.AURAS_JSON || path.join(HOME, "claude/notes/aura-starter-auras-2026-06-30/auras.json");
const RESEED_PROGRESS = process.env.RESEED_PROGRESS || path.join(HOME, "claude/notes/aura-redeploy-2026-06-30/reseed-progress.json");
const PROGRESS_FILE = process.env.PROGRESS_FILE || path.join(HOME, "claude/notes/aura-redeploy-2026-06-30/showpiece-progress.json");
const DRY_RUN = process.env.DRY_RUN === "1";

const VPS_IP = "31.97.110.176";
const API_HOST = "api-aura.topengdev.com";
const DOMAIN = "aura.topengdev.com";
const URI = "https://aura.topengdev.com";
const CHAIN_ID = 16602;
const RPC = "https://evmrpc-testnet.0g.ai";
const galileo = defineChain({ id: CHAIN_ID, name: "0G Galileo", nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });

const outputNftAbi = [
  { type: "function", name: "mintOutput", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "creatorAgentId", type: "uint256" }, { name: "imageRoot", type: "string" }, { name: "provenanceHash", type: "bytes32" }, { name: "teeAttestation", type: "bytes32" }, { name: "seed", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "attestationSig", type: "bytes" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "event", name: "OutputMinted", inputs: [{ name: "tokenId", type: "uint256", indexed: true }, { name: "creatorAgentId", type: "uint256", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "imageRoot", type: "string", indexed: false }, { name: "provenanceHash", type: "bytes32", indexed: false }, { name: "teeAttestation", type: "bytes32", indexed: false }, { name: "seed", type: "uint256", indexed: false }] },
];

let pk = readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n").find((l) => l.startsWith("PRIVATE_KEY=")).slice("PRIVATE_KEY=".length).trim();
if (!pk.startsWith("0x")) pk = "0x" + pk;
const account = privateKeyToAccount(pk);

function req(p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const r = https.request({ host: VPS_IP, servername: API_HOST, path: p, method, headers: { Host: API_HOST, ...headers, ...(data ? { "content-length": data.length } : {}) } },
      (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => { const buf = Buffer.concat(c); let j; try { j = JSON.parse(buf.toString()); } catch { j = { _raw: buf.toString().slice(0, 300) }; } resolve({ status: res.statusCode, json: j }); }); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d);
const saveProgress = (p) => writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));

async function siwe() {
  const nonce = (await req("/auth/nonce")).json.nonce;
  const message = createSiweMessage({ address: account.address, chainId: CHAIN_ID, domain: DOMAIN, nonce, uri: URI, version: "1", statement: "Sign in to AURA to generate, mint, and create. Generation stays sponsored and free." });
  const signature = await account.signMessage({ message });
  const token = (await req("/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) })).json.token;
  if (!token) throw new Error("SIWE failed");
  return token;
}

async function main() {
  const roster = JSON.parse(readFileSync(AURAS_JSON, "utf8")).auras;
  const reseed = loadJson(RESEED_PROGRESS, {});
  const progress = loadJson(PROGRESS_FILE, {});
  const wallet = createWalletClient({ account, chain: galileo, transport: http(RPC) });
  const pub = createPublicClient({ chain: galileo, transport: http(RPC) });
  console.log(`signer ${account.address} | ${roster.length} Relics | ${Object.keys(progress).length} done | DRY_RUN=${DRY_RUN}`);
  let token = DRY_RUN ? "dry" : await siwe();

  for (const a of roster) {
    if (progress[a.name]?.tokenId) { console.log(`SKIP ${a.name} -> token ${progress[a.name].tokenId}`); continue; }
    const agentId = reseed[a.name]?.agentId;
    if (!agentId) { console.log(`WARN ${a.name}: no agentId in reseed progress - skipping`); continue; }
    console.log(`\n[${a.name}] agentId ${agentId} -> gen signature Relic`);
    if (DRY_RUN) { console.log(`  DRY: /generate {agentId:${agentId}, prompt:"${a.defaultCreationPrompt.slice(0, 50)}..."} -> mint-args -> mintOutput`); continue; }

    // 1) real TEE gen of the Aura's signature Relic
    const g = await req("/generate", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ agentId, prompt: a.defaultCreationPrompt }) });
    if (g.status === 401) { token = await siwe(); continue; }
    const jobId = g.json.jobId; if (!jobId) throw new Error(`${a.name} gen kickoff failed: ${JSON.stringify(g.json)}`);
    let job;
    for (let i = 0; i < 90; i++) { await sleep(3000); job = (await req(`/generate/${jobId}`, { headers: { authorization: `Bearer ${token}` } })).json; if (["done", "failed", "error"].includes(job.status)) break; }
    if (job.status !== "done") throw new Error(`${a.name} gen ${job.status}: ${job.error ?? ""}`);
    console.log(`  gen done: imageRoot ${job.result.imageRoot?.slice(0, 14)} usedBrain=${job.result.usedBrain} teeVerified=${job.result.teeVerified}`);

    // 2) attestor-signed mint args for THIS gen
    const ma = await req("/mint-args", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ jobId, to: account.address }) });
    if (ma.status !== 200) throw new Error(`${a.name} mint-args failed: ${ma.status} ${JSON.stringify(ma.json)}`);
    const x = ma.json;

    // 3) mintOutput on the live OutputNFT (x.contract = 0xEecE)
    const hash = await wallet.writeContract({ address: x.contract, abi: outputNftAbi, functionName: "mintOutput",
      args: [x.to, BigInt(x.creatorAgentId), x.imageRoot, x.provenanceHash, x.teeAttestation, BigInt(x.seed), x.nonce, x.attestationSig], gas: 800000n });
    let receipt; for (let i = 0; i < 60; i++) { await sleep(2500); try { receipt = await pub.getTransactionReceipt({ hash }); } catch {} if (receipt) break; }
    if (!receipt || receipt.status !== "success") throw new Error(`${a.name} mintOutput failed/timeout (tx ${hash})`);
    let tokenId = null;
    for (const log of receipt.logs) { try { const p = decodeEventLog({ abi: outputNftAbi, data: log.data, topics: log.topics }); if (p.eventName === "OutputMinted") { tokenId = Number(p.args.tokenId); break; } } catch {} }
    progress[a.name] = { tokenId, imageRoot: job.result.imageRoot, jobId, agentId, tx: hash, teeVerified: job.result.teeVerified };
    saveProgress(progress);
    console.log(`  MINTED Relic ${a.name} -> tokenId ${tokenId} (tx ${hash})`);
  }

  const done = Object.entries(progress).filter(([, r]) => r.tokenId);
  console.log(`\n=== SHOWPIECE ${DRY_RUN ? "DRY-RUN" : "DONE"}: ${done.length}/${roster.length} Relics minted ===`);
  console.log("TOKENS", JSON.stringify(Object.fromEntries(done.map(([n, r]) => [n, r.tokenId]))));
}

main().catch((e) => { console.error("SHOWPIECE ERROR:", e.message); process.exit(1); });
