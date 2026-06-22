// SERVER-ONLY. 0G Compute - TEE-verified image generation. Ported VERBATIM from lib/aura/compute.ts.
// Model qwen-image-edit-2511 is EDIT-only => /images/edits (multipart, base image required).
// processResponse() returns the hardware-signed TEE pass that makes provenance unforgeable.
// The SPONSOR wallet pays for generation (compute ledger). No change to the proven 0G integration.
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "./zg-compute.js";

export interface ImageService {
  provider: string;
  meta: { endpoint: string; model: string };
  verifiability: string;
  teeSigner: string;
}

export interface GenerationResult {
  bytes: Buffer;
  chatId: string | null;
  verified: boolean | string;
  latencyMs: number;
  model: string;
  teeSigner: string;
  verifiability: string;
}

/** Construct the compute broker for a signer (the SPONSOR wallet pays for generation). */
export async function getBroker(signer: ethers.Wallet): Promise<any> {
  return await createZGComputeNetworkBroker(signer);
}

/** Find the TEE image service on testnet. */
export async function imageService(broker: any): Promise<ImageService> {
  const services = await broker.inference.listService();
  const img = services.find(
    (s: any) => s.serviceType === "image-editing" || s.serviceType === "text-to-image",
  );
  if (!img) throw new Error("no image service served on 0G Compute testnet right now");
  const meta = await broker.inference.getServiceMetadata(img.provider);
  return { provider: img.provider, meta, verifiability: img.verifiability, teeSigner: img.teeSignerAddress };
}

/** Fund the compute ledger + provider sub-account (idempotent). Ported from run-aura.ts fundCompute. */
export async function fundCompute(broker: any, provider: string): Promise<void> {
  const lp: any = (broker.ledger as any).ledger;
  if (lp?.constructor && "MIN_LEDGER_BALANCE_OG" in lp.constructor) lp.constructor.MIN_LEDGER_BALANCE_OG = 0;
  try {
    await broker.ledger.depositFund(1.0);
  } catch {
    /* ledger may already be funded */
  }
  try {
    await broker.inference.acknowledgeProviderSigner(provider);
  } catch {
    /* idempotent */
  }
  try {
    await broker.ledger.transferFund(provider, "inference", 1_000_000_000_000_000_000n);
  } catch {
    /* already funded */
  }
}

/**
 * Generate ONE image on 0G Compute inside a TEE. On a funding-related failure it runs the funding
 * ritual once and retries (matches run-aura.ts). Returns image bytes + the TEE proof.
 */
export async function generate(
  broker: any,
  svc: ImageService,
  baseBytes: Buffer,
  prompt: string,
): Promise<GenerationResult> {
  const attempt = async (): Promise<GenerationResult> => {
    const headers = await broker.inference.getRequestHeaders(svc.provider, prompt);
    delete (headers as any)["Content-Type"];
    delete (headers as any)["content-type"]; // let FormData set the multipart boundary
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("response_format", "b64_json");
    form.append("model", svc.meta.model);
    // Node 22 Blob accepts a Buffer/Uint8Array directly; cast to Uint8Array to satisfy tsc (no DOM lib).
    form.append("image", new Blob([new Uint8Array(baseBytes)], { type: "image/png" }), "image.png");

    const t0 = Date.now();
    const res = await fetch(`${svc.meta.endpoint}/images/edits`, { method: "POST", headers: headers as any, body: form });
    const raw = await res.text();
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (respHeaders[k] = v));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
    const json = JSON.parse(raw);
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("no b64 image in 0G Compute response");
    const bytes = Buffer.from(b64, "base64");
    const chatId = respHeaders["zg-res-key"] || json?.id || null;

    // TEE verification + settlement - processResponse must receive the chatId.
    let verified: boolean | string = "n/a";
    try {
      verified = await broker.inference.processResponse(svc.provider, chatId, prompt);
    } catch (e: any) {
      verified = `err:${String(e?.message).slice(0, 60)}`;
    }
    return {
      bytes,
      chatId,
      verified,
      latencyMs: Date.now() - t0,
      model: svc.meta.model,
      teeSigner: svc.teeSigner,
      verifiability: svc.verifiability,
    };
  };

  try {
    return await attempt();
  } catch {
    await fundCompute(broker, svc.provider);
    return await attempt();
  }
}
