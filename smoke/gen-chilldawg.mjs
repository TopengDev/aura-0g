// E2E generate test for CHILLDAWG (agentId 6) against the LIVE api-aura origin.
// Flow: read deployer key from ../.env (NEVER printed) -> SIWE nonce -> sign -> /auth/verify -> JWT ->
// POST /generate {agentId:6} -> poll /generate/:jobId until done -> report result root + style + whether
// it came from the agent brain (not a catalog fallback).
//
// NOTE: requests go to the public origin but are pinned to the VPS IP via a custom https Agent (lookup
// override) so we exercise the REAL edge path without depending on the local lagging resolver.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VPS_IP = "31.97.110.176";
const API_HOST = "api-aura.topengdev.com";
const BASE = `https://${API_HOST}`;
const DOMAIN = "aura.topengdev.com";
const URI = "https://aura.topengdev.com";
const CHAIN_ID = 16602;
const AGENT_ID = 6;

// Read the deployer key from the repo-root .env (do not log it).
const env = readFileSync(path.join(__dirname, "..", ".env"), "utf8");
const pkLine = env.split("\n").find((l) => l.startsWith("PRIVATE_KEY="));
if (!pkLine) throw new Error("PRIVATE_KEY missing from .env");
let pk = pkLine.slice("PRIVATE_KEY=".length).trim();
if (!pk.startsWith("0x")) pk = "0x" + pk;
const account = privateKeyToAccount(pk);
console.log("signer (deployer):", account.address);

// Pin DNS to the VPS IP so we hit the real edge regardless of local resolver lag.
const agent = new https.Agent({
  lookup: (hostname, opts, cb) => cb(null, VPS_IP, 4),
});

async function api(p, init = {}) {
  const res = await fetch(`${BASE}${p}`, { ...init, agent });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}
// node fetch doesn't accept `agent`; use undici dispatcher fallback via a manual https request instead.
// Simpler: use the global fetch with a custom resolver is not supported, so do raw https.
function httpsReq(p, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(body) : null;
    const req = https.request(
      {
        host: VPS_IP,
        servername: API_HOST, // TLS SNI -> correct cert
        path: p,
        method,
        headers: { Host: API_HOST, ...headers, ...(data ? { "content-length": data.length } : {}) },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          let json;
          try { json = JSON.parse(chunks); } catch { json = { _raw: chunks.slice(0, 300) }; }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. nonce
  const n = await httpsReq("/auth/nonce");
  if (n.status !== 200 || !n.json.nonce) throw new Error(`nonce failed: ${n.status} ${JSON.stringify(n.json)}`);
  const nonce = n.json.nonce;
  console.log("nonce ok");

  // 2. build + sign SIWE (must match server: domain DOMAIN, chainId 16602, this nonce)
  const message = createSiweMessage({
    address: account.address,
    chainId: CHAIN_ID,
    domain: DOMAIN,
    nonce,
    uri: URI,
    version: "1",
    statement: "Sign in to AURA to generate, mint, and create. Generation stays sponsored and free.",
  });
  const signature = await account.signMessage({ message });
  console.log("signed SIWE for domain", DOMAIN);

  // 3. verify -> JWT
  const v = await httpsReq("/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (v.status !== 200 || !v.json.token) throw new Error(`verify failed: ${v.status} ${JSON.stringify(v.json)}`);
  const token = v.json.token;
  console.log("JWT ok, address:", v.json.address);

  // 4. POST /generate
  const g = await httpsReq("/generate", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ agentId: AGENT_ID, prompt: "a calm husky dj wearing headphones, lofi night" }),
  });
  console.log("POST /generate ->", g.status, JSON.stringify(g.json));
  if (g.status !== 202 || !g.json.jobId) throw new Error(`generate kickoff failed: ${g.status}`);
  const jobId = g.json.jobId;

  // 5. poll
  let last;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const j = await httpsReq(`/generate/${jobId}`, { headers: { authorization: `Bearer ${token}` } });
    last = j.json;
    const st = j.json.status;
    process.stdout.write(`  t+${(i + 1) * 3}s status=${st}${j.json.error ? " err=" + j.json.error : ""}\n`);
    if (st === "done" || st === "completed" || st === "failed" || st === "error") break;
  }
  console.log("FINAL JOB:", JSON.stringify(last, null, 2));
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
