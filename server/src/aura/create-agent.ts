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
import { createHash } from "node:crypto";
import { encryptBrain, type BrainPlain } from "./brain.js";
import { stageBrain } from "./store.js";
import { sealKeyToPubkey, sealedToHex } from "./sealing.js";
import { pubkeyOf } from "./pubkey.js";
import { CONTRACTS, GALILEO } from "./config.js";
import { auraInftConfigured } from "./contracts.js";
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

  // ERC-7857 (AuraINFT) mint REQUIRES a per-owner sealed key, which needs the owner's recovered secp256k1
  // pubkey (from their SIWE login). Fail FAST here - BEFORE any sponsor-paid 0G upload - if it is missing,
  // so a user never pays for an agent that would revert at mint (AuraINFT.mintAgent requires sealedKey > 0).
  if (auraInftConfigured() && !pubkeyOf(input.owner)) {
    return {
      ok: false,
      status: 409,
      error: "sign in first: ERC-7857 mint seals the brain to your wallet pubkey (recovered at SIWE login). Log in, then create.",
    };
  }

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

  // 5. ERC-7857 PER-OWNER SEALING (de-mock part 1): ECIES-seal the AES data-key to the OWNER's
  //    secp256k1 pubkey (recovered from their SIWE login). This is the on-chain sealedKey - it proves
  //    the key is bound to THIS owner, not just held in server custody. If the owner has never signed in
  //    (no recovered pubkey), we fall back to server-custody-only sealing (legacy) and flag it; the agent
  //    still mints, it just isn't owner-sealed until the owner logs in + re-seals.
  const aesKey = Buffer.from(keyHex.replace(/^0x/, ""), "hex");
  const dataHash = "0x" + createHash("sha256").update(envelope).digest("hex");
  const ownerPubkey = pubkeyOf(input.owner);
  let sealedKeyHex: string | null = null;
  if (ownerPubkey) {
    sealedKeyHex = sealedToHex(sealKeyToPubkey(ownerPubkey, aesKey));
  } else {
    console.warn(`[create-agent] owner ${input.owner} has no recovered pubkey yet - minting without per-owner seal (server custody only). Owner should sign in to enable sealing.`);
  }

  // 6. stage the AES key + the per-owner sealed key server-side (promoted to agentId after mint).
  stageBrain({
    owner: input.owner,
    name,
    encBrainRoot,
    brainKeyHex: keyHex,
    canonicalBaseRoot,
    styleFingerprint,
    modelAttestation,
    sealedKey: sealedKeyHex,
    dataHash,
  });

  // 6b. VERIFY PERSISTENCE before returning. A create must NEVER hand back a root the gen flow can't
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

  // 7. return the computed mintAgent args for the USER to submit (permissionless, user-signed). Target
  //    AuraINFT (ERC-7857, 9-arg mint with dataHash + per-owner sealedKey) when it is wired; otherwise the
  //    legacy AgentRegistry (7-arg, server-custody only). Both are user-signed + non-custodial.
  const useInft = auraInftConfigured();
  return {
    contract: useInft ? CONTRACTS.auraINFT : CONTRACTS.agentRegistry,
    standard: useInft ? "erc7857" : "erc721",
    chainId: GALILEO.chainId,
    to: input.owner,
    name,
    styleFingerprint,
    encBrainRoot,
    modelAttestation,
    royaltyBps: input.royaltyBps,
    creatorResaleBps: input.creatorResaleBps,
    dataHash,
    sealedKey: sealedKeyHex,
    canonicalBaseRoot,
    publicStyle,
    styleVersionHint: 1,
  };
}
