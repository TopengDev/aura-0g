// SERVER-ONLY. 0G Compute - TEE-verified image generation. Ported VERBATIM from lib/aura/compute.ts.
// TESTNET: model qwen-image-edit-2511 is EDIT-only => /images/edits (multipart, base image required).
// MAINNET (opt-in, AURA_IMAGE_MAINNET=1): z-image-turbo is text-to-image => /images/generations (JSON,
// prompt-only). BOTH go through 0G's in-enclave TeeML signImageResponse, so processResponse() returns the
// hardware-signed TEE pass AND the RAW {text, signature} envelope is now CAPTURED (not discarded) so the
// on-chain OutputNFT.mintOutputVerified can ecrecover 0G's enclave signature. The SPONSOR wallet pays the
// testnet compute ledger; a DEDICATED mainnet key pays the mainnet z-image ledger (isolated, like chat).
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker, type ZgBroker, type ZgService } from "./zg-compute.js";
import { sponsorSigner } from "./wallet.js";
import {
  IMAGE_MAINNET_RPC,
  IMAGE_MAINNET_CHAIN_ID,
  IMAGE_MAINNET_PROVIDER,
  imageMainnetKey,
} from "./config.js";

export type ImageNetwork = "testnet" | "mainnet";

export interface ImageService {
  provider: string;
  meta: { endpoint: string; model: string };
  serviceType: string; // "image-editing" (testnet) | "text-to-image" (mainnet z-image)
  verifiability: string;
  teeSigner: string; // 0G's on-chain-published enclave signer for this provider
  network: ImageNetwork;
}

export interface GenerationResult {
  bytes: Buffer;
  chatId: string | null;
  verified: boolean | string;
  latencyMs: number;
  model: string;
  teeSigner: string;
  verifiability: string;
  // NEW (feat/onchain-verify-mint): the RAW 0G-TeeML envelope, captured + off-chain-verified so the contract
  // can ecrecover it on-chain. NULL unless a genuine, image-bound envelope was captured (fail-safe: the mint
  // then falls back to mintOutput). teeText = 0G's signed "<sha256(req)>:<sha256(img)>"; teeSig = its 65-byte
  // signature; dataHash = 0x + sha256(imageBytes) (== the 2nd half of teeText, verified here off-chain).
  teeText: string | null;
  teeSig: string | null;
  dataHash: string | null;
}

/** The active image-gen network: mainnet when AURA_IMAGE_MAINNET=1, else testnet (today's EXACT behavior).
 *  Read LIVE from env so it is unit-observable + flippable. Default (unset) => testnet, zero regression. */
export function imageNetwork(): ImageNetwork {
  return (process.env.AURA_IMAGE_MAINNET ?? "0") === "1" ? "mainnet" : "testnet";
}

/** The signer whose provider pins the image broker's network. testnet: the SPONSOR signer (unchanged);
 *  mainnet: a DEDICATED wallet (AURA_IMAGE_MAINNET_KEY) on the mainnet RPC/chainId, ISOLATED from the sponsor
 *  (like chat-compute.ts chatSigner). Explicit chainId => fail-closed on a wrong-network RPC answer. */
function imageSigner(network: ImageNetwork): ethers.Wallet {
  if (network === "mainnet") {
    const provider = new ethers.JsonRpcProvider(IMAGE_MAINNET_RPC, IMAGE_MAINNET_CHAIN_ID);
    return new ethers.Wallet(imageMainnetKey(), provider);
  }
  return sponsorSigner();
}

/** Construct the compute broker for a signer (the SPONSOR wallet pays for generation). */
export async function getBroker(signer: ethers.Wallet): Promise<ZgBroker> {
  return await createZGComputeNetworkBroker(signer);
}

/** Build the image broker for a network. testnet: sponsor signer (unchanged); mainnet: dedicated isolated key.
 *  Default network = the active one, so a no-arg call is testnet when AURA_IMAGE_MAINNET is unset (today's path). */
export async function imageBroker(network: ImageNetwork = imageNetwork()): Promise<ZgBroker> {
  return await getBroker(imageSigner(network));
}

/** Page the full inference registry including unacknowledged services (a cold mainnet wallet has acked nothing). */
async function pageServices(broker: ZgBroker): Promise<ZgService[]> {
  const out: ZgService[] = [];
  for (let off = 0; off < 500; off += 50) {
    const page = await broker.inference.listService(off, 50, true);
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    if (page.length < 50) break;
  }
  return out;
}

/**
 * Find the TEE image service for a network.
 *   - testnet (default, UNCHANGED): the first image-editing / text-to-image service from the acknowledged list.
 *   - mainnet: the PINNED z-image-turbo provider (IMAGE_MAINNET_PROVIDER, verified in-enclave TeeML), else the
 *     first text-to-image TeeML service. Includes unacknowledged (a cold mainnet wallet acks on first fund).
 */
export async function imageService(broker: ZgBroker, network: ImageNetwork = "testnet"): Promise<ImageService> {
  let img: ZgService | undefined;
  if (network === "mainnet") {
    const services = await pageServices(broker);
    img =
      services.find((s: ZgService) => String(s.provider).toLowerCase() === IMAGE_MAINNET_PROVIDER.toLowerCase()) ??
      services.find(
        (s: ZgService) => s.serviceType === "text-to-image" && /teeml/i.test(String(s.verifiability || "")),
      );
    if (!img) throw new Error("no TeeML text-to-image provider served on 0G mainnet right now");
  } else {
    const services = await broker.inference.listService();
    img = services.find((s: ZgService) => s.serviceType === "image-editing" || s.serviceType === "text-to-image");
    if (!img) throw new Error("no image service served on 0G Compute testnet right now");
  }
  const meta = await broker.inference.getServiceMetadata(img.provider);
  return {
    provider: img.provider,
    meta,
    serviceType: img.serviceType ?? "",
    verifiability: img.verifiability ?? "",
    teeSigner: img.teeSignerAddress ?? "",
    network,
  };
}

/** Fund the compute ledger + provider sub-account (idempotent). Ported from run-aura.ts fundCompute. */
export async function fundCompute(broker: ZgBroker, provider: string): Promise<void> {
  // SDK-internal min-balance hack: poke the nested ledger object's constructor static. Untyped by design.
  const lp: any = broker.ledger.ledger;
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
 * Capture 0G's RAW per-response TeeML envelope for a chatId + off-chain-verify it BEFORE offering an on-chain
 * verified mint. Fetches {text, signature} the same way the SDK's processResponse does, then requires:
 *   (1) recover(hashMessage(text), signature) == this provider's on-chain teeSigner (genuine enclave sig), AND
 *   (2) text has the bare decentralized shape "<64hex>:<64hex>", AND
 *   (3) sha256(imageBytes) == the 2nd half of text (the art IS bound; not the JSON-fallback envelope).
 * Returns null on ANY miss (unreachable, relay/fallback envelope, mismatch) so the mint safely falls back to
 * mintOutput. Fully best-effort: NEVER throws into the gen flow. This is a RELAY of 0G's signature, no new key.
 */
async function captureTeeEnvelope(
  svc: ImageService,
  chatId: string | null,
  bytes: Buffer,
): Promise<{ teeText: string; teeSig: string; dataHash: string } | null> {
  try {
    if (!chatId || !svc.teeSigner) return null;
    const url = `${svc.meta.endpoint}/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(svc.meta.model)}`;
    const res = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } });
    if (!res.ok) return null;
    const env: any = await res.json();
    const text: unknown = env?.text;
    const sig: unknown = env?.signature;
    if (typeof text !== "string" || typeof sig !== "string") return null;
    if (!(text.length === 129 && text[64] === ":")) return null; // bare "<64hex>:<64hex>" only
    // (1) genuine 0G enclave signature over this exact text
    let recovered: string;
    try {
      recovered = ethers.recoverAddress(ethers.hashMessage(text), sig);
    } catch {
      return null;
    }
    if (recovered.toLowerCase() !== svc.teeSigner.toLowerCase()) return null;
    // (3) the art is bound: sha256(the decoded image bytes) == the 2nd hash segment
    const imgSha = createHash("sha256").update(bytes).digest("hex");
    if (imgSha !== text.slice(65)) return null;
    return { teeText: text, teeSig: sig, dataHash: `0x${imgSha}` };
  } catch {
    return null; // never let capture break a successful generation
  }
}

/**
 * Generate ONE image on 0G Compute inside a TEE. On a funding-related failure it runs the funding ritual once
 * and retries (matches run-aura.ts). Returns image bytes + the TEE proof + (when available) 0G's raw signed
 * envelope for the on-chain verified mint. Branches by serviceType: image-editing (testnet, multipart + base
 * image) vs text-to-image (mainnet z-image, JSON, prompt-only).
 */
export async function generate(
  broker: ZgBroker,
  svc: ImageService,
  baseBytes: Buffer,
  prompt: string,
): Promise<GenerationResult> {
  const attempt = async (): Promise<GenerationResult> => {
    const headers = await broker.inference.getRequestHeaders(svc.provider, prompt);
    const t0 = Date.now();

    let bytes: Buffer;
    let chatId: string | null;
    if (svc.serviceType === "text-to-image") {
      // MAINNET z-image path: JSON /images/generations, prompt-only (no base image).
      const reqBody = JSON.stringify({ model: svc.meta.model, prompt, n: 1, response_format: "b64_json" });
      const res = await fetch(`${svc.meta.endpoint}/images/generations`, {
        method: "POST",
        headers: { ...(headers as any), "Content-Type": "application/json" },
        body: reqBody,
      });
      const raw = await res.text();
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (respHeaders[k] = v));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
      const json = JSON.parse(raw);
      const b64 = json?.data?.[0]?.b64_json;
      if (!b64) throw new Error("no b64 image in 0G Compute text-to-image response");
      bytes = Buffer.from(b64, "base64");
      chatId = respHeaders["zg-res-key"] || json?.id || null;
    } else {
      // TESTNET image-editing path (UNCHANGED): multipart /images/edits, base image required.
      delete (headers as any)["Content-Type"];
      delete (headers as any)["content-type"]; // let FormData set the multipart boundary
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("response_format", "b64_json");
      form.append("model", svc.meta.model);
      // Node 22 Blob accepts a Buffer/Uint8Array directly; cast to Uint8Array to satisfy tsc (no DOM lib).
      form.append("image", new Blob([new Uint8Array(baseBytes)], { type: "image/png" }), "image.png");
      const res = await fetch(`${svc.meta.endpoint}/images/edits`, { method: "POST", headers: headers as any, body: form });
      const raw = await res.text();
      const respHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (respHeaders[k] = v));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
      const json = JSON.parse(raw);
      const b64 = json?.data?.[0]?.b64_json;
      if (!b64) throw new Error("no b64 image in 0G Compute response");
      bytes = Buffer.from(b64, "base64");
      chatId = respHeaders["zg-res-key"] || json?.id || null;
    }

    // TEE verification + settlement - processResponse must receive the chatId.
    let verified: boolean | string = "n/a";
    try {
      verified = await broker.inference.processResponse(svc.provider, chatId, prompt);
    } catch (e: any) {
      verified = `err:${String(e?.message).slice(0, 60)}`;
    }

    // NEW: capture 0G's raw signed envelope for the on-chain verified mint (best-effort, off-chain-verified).
    const env = await captureTeeEnvelope(svc, chatId, bytes);

    return {
      bytes,
      chatId,
      verified,
      latencyMs: Date.now() - t0,
      model: svc.meta.model,
      teeSigner: svc.teeSigner,
      verifiability: svc.verifiability,
      teeText: env?.teeText ?? null,
      teeSig: env?.teeSig ?? null,
      dataHash: env?.dataHash ?? null,
    };
  };

  try {
    return await attempt();
  } catch {
    await fundCompute(broker, svc.provider);
    return await attempt();
  }
}
