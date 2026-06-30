// RE-SEED the 20-Aura starter roster onto the LIVE backend (IP-pinned) + the EXISTING registry 0xb596.
// Per Aura: SIWE(deployer) -> POST /agents/create (multipart: the avatar refImage + fields) -> mintAgent
// on 0xb596 -> confirm-mint. After all are minted: setSummonPrice(agentId, 0.01 0G) on the NEW SummonEscrow
// so every Aura is summonable (income-follows native). Showpiece Relic gen is a SEPARATE, non-blocking pass.
//
// RESUMABLE + idempotent-guarded (minting is NON-idempotent): a progress file maps name -> {agentId, tx}.
// On (re)start, Auras already in the progress file are SKIPPED so a mid-run death never double-mints.
//
// Env (defaults are the live prod stack as of the 2026-06-30 integrated deploy):
//   AURAS_JSON     roster (default ~/claude/notes/aura-starter-auras-2026-06-30/auras.json)
//   AVATARS_DIR    avatar PNGs + manifest.json (default ~/claude/notes/aura-starter-images-2026-06-30/avatars)
//   PROGRESS_FILE  resumable progress (default <task-notes>/reseed-progress.json)
//   SUMMON_ESCROW  the new escrow (default 0xa5CeFBc097d84beE09b12fc1569B6CcA56992838)
//   REG            the existing registry (default 0xb596...)
//   DRY_RUN=1      parse + assemble + report, but DO NOT auth/create/mint (structure check)
//   PRICE_ONLY=1   skip creation; just (re)price every agentId in the progress file
// Key read from ../.env PRIVATE_KEY (never printed).
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
const AVATARS_DIR = process.env.AVATARS_DIR || path.join(HOME, "claude/notes/aura-starter-images-2026-06-30/avatars");
const PROGRESS_FILE = process.env.PROGRESS_FILE || path.join(HOME, "claude/notes/aura-redeploy-2026-06-30/reseed-progress.json");
const DRY_RUN = process.env.DRY_RUN === "1";
const PRICE_ONLY = process.env.PRICE_ONLY === "1";

const VPS_IP = "31.97.110.176";
const API_HOST = "api-aura.topengdev.com";
const DOMAIN = "aura.topengdev.com";
const URI = "https://aura.topengdev.com";
const CHAIN_ID = 16602;
const RPC = "https://evmrpc-testnet.0g.ai";
const REG = process.env.REG || "0xb5960cc08caa5195095cfb8aa270f122be09ba0a";
const SUMMON_ESCROW = process.env.SUMMON_ESCROW || "0xa5CeFBc097d84beE09b12fc1569B6CcA56992838";
const SUMMON_PRICE_WEI = 10000000000000000n; // 0.01 0G

const galileo = defineChain({ id: CHAIN_ID, name: "0G Galileo", nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });

const regAbi = [
  { type: "function", name: "mintAgent", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "name", type: "string" }, { name: "styleFingerprint", type: "bytes32" }, { name: "encBrainRoot", type: "string" }, { name: "modelAttestation", type: "bytes32" }, { name: "royaltyBps", type: "uint16" }, { name: "creatorResaleBps", type: "uint16" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "event", name: "AgentMinted", inputs: [{ name: "agentId", type: "uint256", indexed: true }, { name: "owner", type: "address", indexed: true }, { name: "name", type: "string", indexed: false }, { name: "styleFingerprint", type: "bytes32", indexed: false }, { name: "royaltyBps", type: "uint16", indexed: false }, { name: "modelAttestation", type: "bytes32", indexed: false }] },
];
const escrowAbi = [
  { type: "function", name: "setSummonPrice", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }, { name: "price", type: "uint256" }], outputs: [] },
  { type: "function", name: "summonPrice", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
];

let pk = readFileSync(path.join(__dirname, "..", ".env"), "utf8").split("\n").find((l) => l.startsWith("PRIVATE_KEY=")).slice("PRIVATE_KEY=".length).trim();
if (!pk.startsWith("0x")) pk = "0x" + pk;
const account = privateKeyToAccount(pk);

function req(p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : null;
    const r = https.request({ host: VPS_IP, servername: API_HOST, path: p, method, headers: { Host: API_HOST, ...headers, ...(data ? { "content-length": data.length } : {}) } },
      (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => { const buf = Buffer.concat(c); let j; try { j = JSON.parse(buf.toString()); } catch { j = { _raw: buf.toString().slice(0, 300) }; } resolve({ status: res.statusCode, json: j }); }); });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function multipart(fields, fileField, fileName, fileBytes, fileMime) {
  const b = "----auraform" + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\nContent-Type: ${fileMime}\r\n\r\n`));
  parts.push(fileBytes);
  parts.push(Buffer.from(`\r\n--${b}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${b}` };
}

function loadProgress() { return existsSync(PROGRESS_FILE) ? JSON.parse(readFileSync(PROGRESS_FILE, "utf8")) : {}; }
function saveProgress(p) { writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2)); }

async function siwe() {
  const nonce = (await req("/auth/nonce")).json.nonce;
  const message = createSiweMessage({ address: account.address, chainId: CHAIN_ID, domain: DOMAIN, nonce, uri: URI, version: "1", statement: "Sign in to AURA to generate, mint, and create. Generation stays sponsored and free." });
  const signature = await account.signMessage({ message });
  const token = (await req("/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) })).json.token;
  if (!token) throw new Error("SIWE failed (no JWT)");
  return token;
}

async function main() {
  const roster = JSON.parse(readFileSync(AURAS_JSON, "utf8")).auras;
  const manifest = JSON.parse(readFileSync(path.join(AVATARS_DIR, "manifest.json"), "utf8"));
  const fileForName = new Map(Object.entries(manifest).map(([file, name]) => [name, file]));
  const progress = loadProgress();
  console.log(`signer ${account.address} | ${roster.length} Auras | ${Object.keys(progress).length} already done | DRY_RUN=${DRY_RUN} PRICE_ONLY=${PRICE_ONLY}`);

  const wallet = createWalletClient({ account, chain: galileo, transport: http(RPC) });
  const pub = createPublicClient({ chain: galileo, transport: http(RPC) });

  if (!PRICE_ONLY) {
    let token = DRY_RUN ? "dry" : await siwe();
    for (const a of roster) {
      if (progress[a.name]?.agentId) { console.log(`SKIP ${a.name} -> agentId ${progress[a.name].agentId} (already minted)`); continue; }
      const file = fileForName.get(a.name);
      if (!file) throw new Error(`no avatar file for "${a.name}" in manifest`);
      const avatarPath = path.join(AVATARS_DIR, file);
      const fields = {
        name: a.name, royaltyBps: String(a.royaltyBps), creatorResaleBps: String(a.creatorResaleBps),
        styleDescriptor: a.aesthetic, identityLock: a.identityLock, negative: a.negative, signatureCharacter: a.signatureCharacter,
      };
      console.log(`\n[${a.name}] rarity=${a.rarity} royalty=${a.royaltyBps} avatar=${file}`);
      if (DRY_RUN) { console.log(`  DRY: would create + mint + confirm "${a.name}"`); continue; }
      const refImg = readFileSync(avatarPath);
      const mp = multipart(fields, "image", file, refImg, "image/png");
      const cr = await req("/agents/create", { method: "POST", headers: { "content-type": mp.contentType, authorization: `Bearer ${token}` }, body: mp.body });
      if (cr.status === 401) { token = await siwe(); continue; } // JWT expired -> re-auth, retry this Aura
      if (cr.status !== 200) throw new Error(`create ${a.name} failed: ${cr.status} ${JSON.stringify(cr.json)}`);
      const ca = cr.json;
      const hash = await wallet.writeContract({ address: REG, abi: regAbi, functionName: "mintAgent",
        args: [account.address, ca.name, ca.styleFingerprint, ca.encBrainRoot, ca.modelAttestation, ca.royaltyBps, ca.creatorResaleBps], gas: 1200000n });
      let receipt; for (let i = 0; i < 60; i++) { await sleep(2500); try { receipt = await pub.getTransactionReceipt({ hash }); } catch {} if (receipt) break; }
      if (!receipt || receipt.status !== "success") throw new Error(`mintAgent ${a.name} failed/timeout (tx ${hash})`);
      let agentId = null;
      for (const log of receipt.logs) { try { const p = decodeEventLog({ abi: regAbi, data: log.data, topics: log.topics }); if (p.eventName === "AgentMinted") { agentId = Number(p.args.agentId); break; } } catch {} }
      if (!agentId) throw new Error(`${a.name}: no AgentMinted event`);
      await req("/agents/confirm-mint", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ encBrainRoot: ca.encBrainRoot, agentId }) });
      progress[a.name] = { agentId, tx: hash, encBrainRoot: ca.encBrainRoot };
      saveProgress(progress); // checkpoint AFTER each mint so a death never double-mints
      console.log(`  MINTED ${a.name} -> agentId ${agentId} (tx ${hash})`);
    }
  }

  // ── price every minted Aura for Summon (idempotent: re-setting the same price is harmless) ──
  console.log(`\n=== setSummonPrice (0.01 0G) on ${SUMMON_ESCROW} ===`);
  for (const [name, rec] of Object.entries(progress)) {
    if (!rec.agentId) continue;
    const cur = DRY_RUN ? 0n : await pub.readContract({ address: SUMMON_ESCROW, abi: escrowAbi, functionName: "summonPrice", args: [BigInt(rec.agentId)] });
    if (!DRY_RUN && cur === SUMMON_PRICE_WEI) { console.log(`  ${name} (#${rec.agentId}) already priced`); continue; }
    if (DRY_RUN) { console.log(`  DRY: would setSummonPrice(${rec.agentId}, 0.01)`); continue; }
    const tx = await wallet.writeContract({ address: SUMMON_ESCROW, abi: escrowAbi, functionName: "setSummonPrice", args: [BigInt(rec.agentId), SUMMON_PRICE_WEI], gas: 200000n });
    for (let i = 0; i < 40; i++) { await sleep(2500); try { const r = await pub.getTransactionReceipt({ hash: tx }); if (r) break; } catch {} }
    console.log(`  priced ${name} (#${rec.agentId}) tx ${tx}`);
  }

  const done = Object.entries(progress).filter(([, r]) => r.agentId);
  console.log(`\n=== RE-SEED ${DRY_RUN ? "DRY-RUN" : "DONE"}: ${done.length}/${roster.length} Auras minted + priced ===`);
  console.log("AGENTIDS", JSON.stringify(Object.fromEntries(done.map(([n, r]) => [n, r.agentId]))));
}

main().catch((e) => { console.error("RE-SEED ERROR:", e.message); process.exit(1); });
