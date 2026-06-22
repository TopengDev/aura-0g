// Character smoke-test generator. Reuses the proven /images/edits pipeline (qwen-image-edit-2511, EDIT-only).
// Ledger + provider already funded by 03-compute.ts - this script does NOT re-fund (just generates).
// RESUME-SAFE: skips any manifest entry whose `out` file already exists. Re-run freely.
//
// usage: tsx src/char.ts <manifest.json>
//   manifest = [{ label, base, out, prompt }]   (paths relative to repo root)
import { ethers } from "ethers";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createZGComputeNetworkBroker } from "./zg-compute.js";
import { GALILEO, privateKey } from "./config.js";

const LOG = "images/characters/char-log.json";
const manifestPath = process.argv[2];
if (!manifestPath) { console.error("usage: tsx src/char.ts <manifest.json>"); process.exit(1); }
const manifest: { label: string; base: string; out: string; prompt: string }[] =
  JSON.parse(readFileSync(manifestPath, "utf8"));

const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const wallet = new ethers.Wallet(privateKey(), provider);
const broker = await createZGComputeNetworkBroker(wallet);

const services = await broker.inference.listService();
const img = services.find((s: any) => s.serviceType === "image-editing" || s.serviceType === "text-to-image");
if (!img) throw new Error("No image service on testnet right now.");
const PROVIDER = img.provider;
const meta = await broker.inference.getServiceMetadata(PROVIDER);
console.log("endpoint:", meta.endpoint, "model:", meta.model);
console.log("TEE:", img.verifiability, "signer:", img.teeSignerAddress, "\n");

const log: any[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : [];

async function edit(label: string, basePath: string, outPath: string, prompt: string) {
  if (existsSync(outPath)) { console.log(`  [${label}] SKIP (exists) ${outPath}`); return { label, ok: true, skipped: true, out: outPath }; }
  const baseBytes = readFileSync(basePath);
  const headers = await broker.inference.getRequestHeaders(PROVIDER, prompt);
  delete (headers as any)["Content-Type"]; delete (headers as any)["content-type"];
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
    console.log(`  [${label}] HTTP ${res.status}: ${raw.slice(0, 240)}`);
    return { label, ok: false, status: res.status, error: raw.slice(0, 400), base: basePath, out: outPath };
  }
  const ms = Date.now() - t0;
  let json: any; try { json = JSON.parse(raw); } catch { json = null; }
  const b64 = json?.data?.[0]?.b64_json;
  const url = json?.data?.[0]?.url;
  let bytes = 0;
  if (b64) { const buf = Buffer.from(b64, "base64"); writeFileSync(outPath, buf); bytes = buf.length; }
  else if (url) { const buf = Buffer.from(await (await fetch(url)).arrayBuffer()); writeFileSync(outPath, buf); bytes = buf.length; }

  const chatId = respHeaders["zg-res-key"] || json?.id;
  let verified: any = "n/a";
  try { verified = await broker.inference.processResponse(PROVIDER, chatId, prompt); } catch (e: any) { verified = `err:${e?.message?.slice(0,80)}`; }
  console.log(`  [${label}] OK ${ms}ms out=${outPath} bytes=${bytes} verified=${JSON.stringify(verified)}`);
  return { label, ok: true, ms, base: basePath, out: outPath, bytes, verified, chatId: chatId ?? null,
           model: meta.model, prompt, ts: new Date().toISOString() };
}

console.log(`=== char gen: ${manifest.length} entries from ${manifestPath} ===`);
for (const m of manifest) {
  const r = await edit(m.label, m.base, m.out, m.prompt);
  if (!(r as any).skipped) { log.push(r); writeFileSync(LOG, JSON.stringify(log, null, 2)); }
}
console.log("\nbalance after:", ethers.formatEther(await provider.getBalance(wallet.address)), "0G");
await provider.destroy?.();
process.exit(0);
