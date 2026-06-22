// CP2 (#1) - generate via /images/edits (qwen-image-edit-2511 is EDIT-only; /generations is disabled).
// One base scene → 4 agent styles. Ledger+provider already funded by 03-compute.ts. Saves PNGs + log + TEE.
import { ethers } from "ethers";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createZGComputeNetworkBroker } from "./zg-compute.js";
import { GALILEO, privateKey } from "./config.js";

const BASE = "images/_base-scene.png";
const LOG = "images/generation-log.json";
const SUBJECT = "a cozy small coffee shop interior at night, warm window light, a coffee cup on the counter";
const AGENTS = [
  { id: "NOKTURNE", prompt: `Transform into ${SUBJECT}. Style: chiaroscuro noir, single candle flame in near-total darkness, wet reflections, drifting smoke, oil painting, deep shadows, muted gold.` },
  { id: "MIRAI", prompt: `Transform into ${SUBJECT}. Style: neon cyberpunk, electric magenta and cyan glow, rain-slick neon signs, holographic reflections, blade-runner mood, high contrast.` },
  { id: "RISO", prompt: `Transform into ${SUBJECT}. Style: risograph print, fluorescent pink and blue duotone, visible halftone grain, misregistration, flat bold shapes, indie zine.` },
  { id: "SCRIPTORIUM", prompt: `Transform into ${SUBJECT}. Style: ornate illuminated medieval manuscript, gold leaf, intricate marginalia, miniature painting, jewel tones, decorative border.` },
];

const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const wallet = new ethers.Wallet(privateKey(), provider);
const broker = await createZGComputeNetworkBroker(wallet);

const services = await broker.inference.listService();
const img = services.find((s: any) => s.serviceType === "image-editing" || s.serviceType === "text-to-image");
const PROVIDER = img.provider;
const meta = await broker.inference.getServiceMetadata(PROVIDER);
console.log("endpoint:", meta.endpoint, "model:", meta.model);
console.log("TEE:", img.verifiability, "signer:", img.teeSignerAddress, "\n");

const baseBytes = readFileSync(BASE);
const log: any[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : [];

async function edit(agentId: string, prompt: string) {
  const headers = await broker.inference.getRequestHeaders(PROVIDER, prompt);
  delete (headers as any)["Content-Type"]; delete (headers as any)["content-type"]; // let FormData set the boundary
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("response_format", "b64_json");
  form.append("model", meta.model);
  form.append("image", new Blob([baseBytes], { type: "image/png" }), "image.png");

  const t0 = Date.now();
  const res = await fetch(`${meta.endpoint}/images/edits`, { method: "POST", headers: headers as any, body: form });
  const raw = await res.text();
  const respHeaders: Record<string, string> = {}; res.headers.forEach((v, k) => (respHeaders[k] = v));
  if (!res.ok) {
    console.log(`  [${agentId}] HTTP ${res.status}: ${raw.slice(0, 220)}`);
    return { agentId, ok: false, status: res.status, error: raw.slice(0, 400) };
  }
  const ms = Date.now() - t0;
  let json: any; try { json = JSON.parse(raw); } catch { json = null; }
  const b64 = json?.data?.[0]?.b64_json;
  const url = json?.data?.[0]?.url;
  let saved: string | null = null, bytes = 0;
  if (b64) { saved = `images/${agentId}.png`; const buf = Buffer.from(b64, "base64"); writeFileSync(saved, buf); bytes = buf.length; }
  else if (url) { const buf = Buffer.from(await (await fetch(url)).arrayBuffer()); saved = `images/${agentId}.png`; writeFileSync(saved, buf); bytes = buf.length; }

  const chatId = respHeaders["zg-res-key"] || json?.id;
  let verified: any = "n/a";
  try { verified = await broker.inference.processResponse(PROVIDER, chatId, prompt); } catch (e: any) { verified = `err:${e?.message?.slice(0,80)}`; }
  console.log(`  [${agentId}] OK ${ms}ms saved=${saved} bytes=${bytes} verified=${JSON.stringify(verified)} chatId=${chatId ?? "n/a"}`);
  return { agentId, ok: true, ms, saved, bytes, verified, chatId: chatId ?? null, model: meta.model,
           verifiability: img.verifiability, teeSigner: img.teeSignerAddress, teeResponseHeaders: respHeaders };
}

console.log("=== /images/edits - 4 agent styles on one base scene ===");
for (const a of AGENTS) {
  const r = await edit(a.id, a.prompt);
  log.push({ ...r, mode: "images/edits", ts: new Date().toISOString() });
  writeFileSync(LOG, JSON.stringify(log, null, 2));
}
console.log("\nbalance after:", ethers.formatEther(await provider.getBalance(wallet.address)), "0G");
await provider.destroy?.();
process.exit(0);
