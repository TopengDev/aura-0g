// SERVER-ONLY. The create-agent pipeline, ported from the proven demo/run-aura.ts phaseAgent
// (lines ~260-296). Validates input, stores the reference image -> canonicalBaseRoot, builds the
// PUBLIC style + the PRIVATE brain, computes styleFingerprint via RFC 8785 (JCS) canonicalization,
// AES-256-GCM encrypts the brain -> encBrainRoot, derives modelAttestation from the LIVE TEE image
// service, stages the AES key server-side, and returns the computed mintAgent args for the USER to
// submit (mintAgent is permissionless + user-signed).
import canonicalizeDefault from "canonicalize";
import { ethers } from "ethers";
import { imageDimensions } from "./image-dims.js";
import { sponsorSigner } from "./wallet.js";
import { getBroker, imageService } from "./compute.js";
import { store } from "./storage.js";
import { cacheImageByRoot, cachedImageByRoot } from "./image-cache.js";
import { encryptBrain, type BrainPlain } from "./brain.js";
import { stageBrain } from "./store.js";
import { CONTRACTS, GALILEO } from "./config.js";
import type { CreateAgentResponse } from "./types.js";

// canonicalize ships a CJS module.exports = fn; under NodeNext the callable may sit on .default.
const canonicalize: (v: unknown) => string | undefined =
  typeof canonicalizeDefault === "function"
    ? (canonicalizeDefault as unknown as (v: unknown) => string | undefined)
    : ((canonicalizeDefault as any).default as (v: unknown) => string | undefined);

export interface CreateAgentInput {
  owner: string; // jwt.address (recipient + original creator)
  name: string;
  royaltyBps: number;
  creatorResaleBps: number;
  styleDescriptor: string; // public-ish aesthetic description
  identityLock?: string; // "keep the EXACT same subject ..." (defaulted if absent)
  negative?: string;
  signatureCharacter?: string | null;
  imageBytes: Buffer; // the reference image (multipart upload)
  imageMime?: string;
}

export interface CreateAgentValidationError {
  ok: false;
  status: number;
  error: string;
}

const MIN_PX = 384;
const MAX_PX = 3072;
const MODEL = "qwen/qwen-image-edit-2511";

function validate(input: CreateAgentInput): CreateAgentValidationError | null {
  if (!input.name || input.name.trim().length < 2 || input.name.length > 48) {
    return { ok: false, status: 400, error: "name must be 2-48 chars" };
  }
  if (!Number.isInteger(input.royaltyBps) || input.royaltyBps < 0 || input.royaltyBps > 2000) {
    return { ok: false, status: 400, error: "royaltyBps must be an integer 0..2000 (<=20%)" };
  }
  if (!Number.isInteger(input.creatorResaleBps) || input.creatorResaleBps < 0 || input.creatorResaleBps > 2000) {
    return { ok: false, status: 400, error: "creatorResaleBps must be an integer 0..2000 (<=20%)" };
  }
  if (!input.styleDescriptor || input.styleDescriptor.trim().length < 8) {
    return { ok: false, status: 400, error: "styleDescriptor required (>=8 chars)" };
  }
  if (!input.imageBytes || input.imageBytes.length < 100) {
    return { ok: false, status: 400, error: "reference image required" };
  }
  const dims = imageDimensions(input.imageBytes);
  if (!dims) return { ok: false, status: 400, error: "unsupported image (need PNG/JPEG)" };
  const { width, height } = dims;
  if (width < MIN_PX || height < MIN_PX || width > MAX_PX || height > MAX_PX) {
    return { ok: false, status: 400, error: `image must be ${MIN_PX}-${MAX_PX}px on each side (got ${width}x${height})` };
  }
  return null;
}

export async function createAgent(input: CreateAgentInput): Promise<CreateAgentResponse | CreateAgentValidationError> {
  const v = validate(input);
  if (v) return v;

  const name = input.name.trim();
  const signer = sponsorSigner();

  // 1. store the reference image -> canonicalBaseRoot (the brain's base-image pointer).
  const baseStore = await store(signer, input.imageBytes, `agent-base-${name}`);
  const canonicalBaseRoot = baseStore.rootHash;
  // ALSO persist the reference image in the local content-addressed cache, keyed by its root. 0G Storage
  // testnet evicts image-sized blobs within ~minutes-to-an-hour, so the gen-time download() of this base
  // would later fail (the verified root cause of usedBrain:false). The local copy is the durable source
  // for BOTH the agent-portrait image endpoint and the gen base reconstruction. (see image-cache.ts)
  cacheImageByRoot(canonicalBaseRoot, input.imageBytes, { contentType: input.imageMime ?? "image/png", source: "reference" });

  // 2. PUBLIC style - the keccak(JCS(publicStyle)) is the on-chain styleFingerprint (provable identity).
  //    Bind refImageRoot = canonicalBaseRoot so the fingerprint commits to the exact base image.
  const publicStyle = {
    agent: name,
    aesthetic: input.styleDescriptor.trim(),
    signatureCharacter: input.signatureCharacter?.trim() || null,
    model: MODEL,
    refImageRoot: canonicalBaseRoot,
  };
  const canon = canonicalize(publicStyle); // RFC 8785 JSON Canonicalization Scheme
  if (!canon) throw new Error("canonicalize(publicStyle) returned empty");
  const styleFingerprint = ethers.keccak256(ethers.toUtf8Bytes(canon));

  // 3. PRIVATE brain - encrypt + seal on 0G Storage. Only server custody holds the key (for now).
  const brain: BrainPlain = {
    agent: name,
    model: MODEL,
    canonicalBaseRoot,
    styleDescriptor: input.styleDescriptor.trim(),
    identityLock:
      input.identityLock?.trim() ||
      "Keep the EXACT same subject (same shape, features, composition, proportions) as the reference.",
    negative: input.negative?.trim() || "no photorealism if stylized, no unwanted artifacts, no watermark",
    basePolicy: "feed the canonical reference back as the edit base; the base image is the determinism anchor",
    createdAt: new Date().toISOString(),
  };
  const { envelope, keyHex } = encryptBrain(brain);
  const brainStore = await store(signer, envelope, `agent-brain-${name}`);
  const encBrainRoot = brainStore.rootHash;
  // Persist the brain envelope in the durable local cache too (same reason as the reference image: 0G
  // testnet can evict it). Gen reads it cache-first.
  cacheImageByRoot(encBrainRoot, envelope, { contentType: "application/octet-stream", source: "brain" });

  // 4. modelAttestation = keccak(model | teeSigner | verifiability) from the LIVE TEE image service.
  const broker = await getBroker(signer);
  const svc = await imageService(broker);
  const modelAttestation = ethers.keccak256(
    ethers.toUtf8Bytes(`${svc.meta.model}|${svc.teeSigner}|${svc.verifiability}`),
  );

  // 5. stage the AES key server-side, keyed to this brain (promoted to agentId after the user mints).
  stageBrain({
    owner: input.owner,
    name,
    encBrainRoot,
    brainKeyHex: keyHex,
    canonicalBaseRoot,
    styleFingerprint,
    modelAttestation,
  });

  // 5b. VERIFY PERSISTENCE before returning. A create must NEVER hand back a root the gen flow can't
  // later load -- that was the silent failure (0G "succeeds" returning a local merkle root, but the bytes
  // get evicted, and a brain-backed agent then silently degrades). We assert BOTH blobs are readable from
  // the DURABLE local cache now; if not, fail the create so the user never mints an unretrievable agent.
  const baseCheck = cachedImageByRoot(canonicalBaseRoot);
  if (!baseCheck || baseCheck.bytes.length !== input.imageBytes.length) {
    throw new Error("create-agent: reference image failed local-cache persistence verification (refusing to mint an unretrievable agent)");
  }
  const brainCheck = cachedImageByRoot(encBrainRoot);
  if (!brainCheck || brainCheck.bytes.length !== envelope.length) {
    throw new Error("create-agent: brain envelope failed local-cache persistence verification (refusing to mint an unretrievable agent)");
  }

  // 6. return the computed mintAgent args for the USER to submit (permissionless, user-signed).
  return {
    contract: CONTRACTS.agentRegistry,
    chainId: GALILEO.chainId,
    to: input.owner,
    name,
    styleFingerprint,
    encBrainRoot,
    modelAttestation,
    royaltyBps: input.royaltyBps,
    creatorResaleBps: input.creatorResaleBps,
    canonicalBaseRoot,
    publicStyle,
    styleVersionHint: 1,
  };
}
