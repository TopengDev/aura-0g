// CP2 (#1 make-or-break) - full broker lifecycle + ACTUALLY GENERATE images on 0G Compute.
// Economical: creates ledger via depositFund (bypasses 3 0G addLedger floor), funds provider,
// does ONE probe gen first, then the 4 agent styles. Saves PNGs + a generation log + TEE shape.
import { ethers } from "ethers";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { createZGComputeNetworkBroker } from "./zg-compute.js";
import { GALILEO, privateKey } from "./config.js";

const OUT = "images";
const LOG = "images/generation-log.json";
mkdirSync(OUT, { recursive: true });

const DEPOSIT_OG = 2.0;             // top up ledger (0G units, number)
const PROVIDER_FUND_NEURON = 1500000000000000000n; // 1.5 0G in neuron - clears the provider's 1.0 0G locked reserve
const SIZE = "512x512";

// 4 maximally-contrasting agent styles on one subject (build-plan §4.2).
const SUBJECT = "a small coffee shop at night";
const AGENTS = [
  { id: "NOKTURNE", prompt: `${SUBJECT}, chiaroscuro noir, single candle flame in near-total darkness, wet cobblestone reflections, drifting smoke, oil painting, deep shadows, muted gold highlights` },
  { id: "MIRAI", prompt: `${SUBJECT}, neon cyberpunk, electric magenta and cyan glow, rain-slick neon signs, holographic reflections, blade-runner atmosphere, high contrast` },
  { id: "RISO", prompt: `${SUBJECT}, risograph print, fluorescent pink and blue duotone, visible halftone grain, misregistration, flat bold shapes, indie zine aesthetic` },
  { id: "SCRIPTORIUM", prompt: `${SUBJECT}, ornate illuminated manuscript, gold leaf, intricate marginalia, medieval miniature painting, jewel tones, decorative border` },
];

const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const wallet = new ethers.Wallet(privateKey(), provider);
console.log("wallet:", wallet.address, "balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "0G\n");

const broker = await createZGComputeNetworkBroker(wallet);
console.log("broker created.\n");

// 1. Find the image service.
const services = await broker.inference.listService();
const img = services.find((s: any) => s.serviceType === "image-editing" || s.serviceType === "text-to-image");
if (!img) throw new Error("No image service on testnet right now.");
const PROVIDER = img.provider;
console.log(`image service: model=${img.model} type=${img.serviceType} provider=${PROVIDER}`);
console.log(`verifiability=${img.verifiability} teeSigner=${img.teeSignerAddress}\n`);

// 2. Ledger: create via depositFund if missing.
//    SMOKE-TEST BYPASS: the SDK's 3 0G floor is a CLIENT guard only (probed: the contract
//    allows sub-3-0G). We patch the static so the SDK's own creation path runs with 0.25 0G.
//    The BUILD should use the normal 3 0G path.
let ledgerExists = false;
try { await broker.ledger.getLedger(); ledgerExists = true; } catch { ledgerExists = false; }
const lp: any = (broker.ledger as any).ledger;
if (lp?.constructor && "MIN_LEDGER_BALANCE_OG" in lp.constructor) lp.constructor.MIN_LEDGER_BALANCE_OG = 0;
console.log(`${ledgerExists ? "ledger exists - topping up" : "creating ledger"} via depositFund(${DEPOSIT_OG})…`);
await broker.ledger.depositFund(DEPOSIT_OG);
console.log("ledger funded.");

// 3. Acknowledge provider (idempotent).
try { await broker.inference.acknowledgeProviderSigner(PROVIDER); console.log("provider acknowledged."); }
catch (e: any) { console.log("acknowledge note:", e?.message?.slice(0, 120)); }

// 4. Fund the provider sub-account (warn-only below 1 0G; fine for our cheap calls).
try { await broker.ledger.transferFund(PROVIDER, "inference", PROVIDER_FUND_NEURON); console.log("provider funded.\n"); }
catch (e: any) { console.log("transferFund note:", e?.message?.slice(0, 160), "\n"); }

// 5. Service metadata (endpoint + model).
const meta = await broker.inference.getServiceMetadata(PROVIDER);
console.log("endpoint:", meta.endpoint, "model:", meta.model, "\n");

const log: any[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : [];

async function generate(agentId: string, prompt: string) {
  const body: any = { model: meta.model, prompt, size: SIZE, n: 1, response_format: "b64_json" };
  const headers = await broker.inference.getRequestHeaders(PROVIDER, JSON.stringify(body));
  const t0 = Date.now();

  // Try sync text-to-image first.
  let res = await fetch(`${meta.endpoint}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let raw = await res.text();
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => (respHeaders[k] = v));

  if (!res.ok) {
    console.log(`  [${agentId}] /images/generations → HTTP ${res.status}: ${raw.slice(0, 200)}`);
    return { agentId, ok: false, status: res.status, error: raw.slice(0, 300), endpoint: "images/generations" };
  }
  const ms = Date.now() - t0;
  let json: any; try { json = JSON.parse(raw); } catch { json = null; }
  const b64 = json?.data?.[0]?.b64_json;
  const url = json?.data?.[0]?.url;
  let savedPath: string | null = null;
  if (b64) {
    savedPath = `${OUT}/${agentId}.png`;
    writeFileSync(savedPath, Buffer.from(b64, "base64"));
  } else if (url) {
    const ib = Buffer.from(await (await fetch(url)).arrayBuffer());
    savedPath = `${OUT}/${agentId}.png`;
    writeFileSync(savedPath, ib);
  }

  // TEE verify + settle. chatID priority: ZG-Res-Key header, else json.id.
  const chatId = respHeaders["zg-res-key"] || json?.id;
  let verified: any = "unknown";
  try { verified = await broker.inference.processResponse(PROVIDER, chatId, JSON.stringify(body)); }
  catch (e: any) { verified = `processResponse err: ${e?.message?.slice(0, 120)}`; }

  const bytes = savedPath ? Buffer.from(b64 ?? "", "base64").length : 0;
  console.log(`  [${agentId}] OK ${ms}ms saved=${savedPath} bytes=${bytes} verified=${JSON.stringify(verified)} chatId=${chatId ?? "n/a"}`);
  return { agentId, ok: true, ms, savedPath, bytes, verified, chatId: chatId ?? null,
           teeResponseHeaders: respHeaders, model: meta.model, size: SIZE,
           verifiability: img.verifiability, teeSigner: img.teeSignerAddress };
}

// Probe with NOKTURNE first (fail fast / save funds), then the rest.
console.log("=== PROBE generation (NOKTURNE) ===");
const probe = await generate(AGENTS[0].id, AGENTS[0].prompt);
log.push({ ...probe, ts: new Date().toISOString() });
writeFileSync(LOG, JSON.stringify(log, null, 2));

if (probe.ok) {
  console.log("\n=== remaining styles ===");
  for (const a of AGENTS.slice(1)) {
    const r = await generate(a.id, a.prompt);
    log.push({ ...r, ts: new Date().toISOString() });
    writeFileSync(LOG, JSON.stringify(log, null, 2));
  }
} else {
  console.log("\nProbe failed on /images/generations - see error. Will try /images/edits fallback in 03b.");
}

console.log("\nbalance after:", ethers.formatEther(await provider.getBalance(wallet.address)), "0G");
console.log("log:", LOG);
