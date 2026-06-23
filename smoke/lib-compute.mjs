// Shared compute harness for probes 2/3/4 + the unbundled-Node load test (probe 7).
// Mirrors lib/aura/compute.ts + lib/aura/zg-compute.ts (createRequire for the broker) and
// lib/aura/storage.ts (dynamic import for the storage SDK) — NO bundler, plain Node ESM.
import { createRequire } from "node:module";
import { ethers } from "ethers";
import "dotenv/config";

const require = createRequire(import.meta.url);

export const GALILEO = {
  chainId: 16602,
  rpc: "https://evmrpc-testnet.0g.ai",
  storageIndexerTurbo: "https://indexer-storage-testnet-turbo.0g.ai",
};
export const GAS = { gasPrice: 5_000_000_000n };

export function demoWallet() {
  const pk = process.env.DEMO_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error("no key");
  const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
  return new ethers.Wallet(pk, provider);
}

// --- COMPUTE broker via createRequire (proves the CJS broker loads outside any bundler) ---
export function loadBroker() {
  const broker = require("@0glabs/0g-serving-broker");
  return broker.createZGComputeNetworkBroker;
}

export async function getBroker(signer) {
  const create = loadBroker();
  return await create(signer);
}

export async function imageService(broker) {
  const services = await broker.inference.listService();
  const img = services.find((s) => s.serviceType === "image-editing" || s.serviceType === "text-to-image");
  if (!img) throw new Error("no image service served right now");
  const meta = await broker.inference.getServiceMetadata(img.provider);
  return { provider: img.provider, meta, verifiability: img.verifiability, teeSigner: img.teeSignerAddress };
}

export async function fundCompute(broker, provider) {
  const lp = broker.ledger?.ledger;
  if (lp?.constructor && "MIN_LEDGER_BALANCE_OG" in lp.constructor) lp.constructor.MIN_LEDGER_BALANCE_OG = 0;
  try { await broker.ledger.depositFund(1.0); } catch {}
  try { await broker.inference.acknowledgeProviderSigner(provider); } catch {}
  try { await broker.ledger.transferFund(provider, "inference", 1_000_000_000_000_000_000n); } catch {}
}

// One generation. Returns bytes + TEE proof. Exact pattern from compute.ts.
export async function generate(broker, svc, baseBytes, prompt) {
  const attempt = async () => {
    const headers = await broker.inference.getRequestHeaders(svc.provider, prompt);
    delete headers["Content-Type"];
    delete headers["content-type"];
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("response_format", "b64_json");
    form.append("model", svc.meta.model);
    form.append("image", new Blob([baseBytes], { type: "image/png" }), "image.png");
    const t0 = Date.now();
    const res = await fetch(`${svc.meta.endpoint}/images/edits`, { method: "POST", headers, body: form });
    const raw = await res.text();
    const respHeaders = {};
    res.headers.forEach((v, k) => (respHeaders[k] = v));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
    const json = JSON.parse(raw);
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("no b64 image in response");
    const bytes = Buffer.from(b64, "base64");
    const chatId = respHeaders["zg-res-key"] || json?.id || null;
    let verified = "n/a";
    try { verified = await broker.inference.processResponse(svc.provider, chatId, prompt); }
    catch (e) { verified = `err:${String(e?.message).slice(0, 60)}`; }
    return { bytes, chatId, verified, latencyMs: Date.now() - t0, model: svc.meta.model, teeSigner: svc.teeSigner, verifiability: svc.verifiability };
  };
  try { return await attempt(); }
  catch (e) { console.log("  [generate retry after fund:", String(e?.message).slice(0,80), "]"); await fundCompute(broker, svc.provider); return await attempt(); }
}

// --- STORAGE via dynamic import (proves the maintained SDK loads + uploads/downloads outside a bundler) ---
let _sdk = null;
export async function sdk() {
  if (!_sdk) _sdk = await import("@0gfoundation/0g-ts-sdk");
  return _sdk;
}
let _indexer = null;
export async function indexer() {
  if (!_indexer) {
    const { Indexer } = await sdk();
    _indexer = new Indexer(GALILEO.storageIndexerTurbo);
  }
  return _indexer;
}

export async function store(signer, bytes, label) {
  const { MemData, defaultUploadOption } = await sdk();
  const idx = await indexer();
  const mem = new MemData(bytes);
  const [tree, mErr] = await mem.merkleTree();
  if (mErr) throw mErr;
  const root = tree.rootHash();
  try {
    const [res, upErr] = await idx.upload(mem, GALILEO.rpc, signer, { ...defaultUploadOption, finalityRequired: false });
    if (upErr) {
      const es = String(upErr);
      if (/already|exist|Data root/i.test(es)) return { rootHash: root, txHash: null, dedup: true };
      throw new Error(`upload ${label}: ${es.slice(0, 200)}`);
    }
    return { rootHash: res.rootHash ?? root, txHash: res.txHash ?? null, dedup: false };
  } catch (e) {
    const es = String(e?.message ?? e);
    if (/already|exist|Data root/i.test(es)) return { rootHash: root, txHash: null, dedup: true };
    throw e;
  }
}

// download by root → write to outPath, return bytes. (Proven pattern: indexer.download from src/04-storage.ts)
export async function download(root, outPath) {
  const idx = await indexer();
  const { readFileSync } = await import("node:fs");
  const dErr = await idx.download(root, outPath, true); // withProof=true
  if (dErr) throw new Error(`download ${root}: ${String(dErr).slice(0, 200)}`);
  return readFileSync(outPath);
}
