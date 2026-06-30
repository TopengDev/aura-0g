// SERVER-ONLY. Orchestrates one async generation job: resolve gen config (brain OR catalog fallback)
// -> TEE generate on 0G Compute (SPONSOR pays) -> persist PNG -> store on 0G Storage -> assemble the
// provenance record the mint-args step will sign over. Releases the gen guard always.
//
// GENERALIZED vs v1: replaces baseForAgent()/buildPrompt() with resolveGenConfig(agent, userPrompt):
//   - brain-backed agent: download() the encBrainRoot -> decrypt -> download() the canonicalBaseRoot ->
//     reconstruct { baseBytes, prompt } = identityLock + "change only X" + styleDescriptor + negative.
//   - brain-less SEEDED agent (the 4 on-chain seeds, no stored key): FALL BACK to the catalog base +
//     prompt (zero regression). Smoke-proven that arbitrary reference images hold style + identity.
import { readFileSync } from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { sponsorSigner } from "./wallet.js";
import { getBroker, imageService, generate } from "./compute.js";
import { store, download } from "./storage.js";
import { cacheImageByRoot, cachedImageByRoot } from "./image-cache.js";
import { baseForSeededAgent, fallbackPrompt } from "./catalog.js";
import { rawAgent } from "./agents.js";
import { brainByRoot, brainByAgentId } from "./store.js";
import { decryptBrain } from "./brain.js";
import { setStatus, setResult, setError, saveGeneratedImage } from "./jobs.js";
import { genGuardRelease } from "./ratelimit.js";
import { REPO_ROOT, ENFORCE_TEE_VERIFICATION } from "./config.js";
import type { JobStatus } from "./types.js";

export interface ResolvedGenConfig {
  baseBytes: Buffer;
  prompt: string;
  usedBrain: boolean;
  agentName: string;
}

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Thrown when an agent that HAS a brain cannot generate via that brain (enforced, no silent fallback). */
export class BrainUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrainUnavailableError";
  }
}

/**
 * B-5: thrown when the TEE attestation did NOT verify (verified !== true: false / "n/a" / "err:...") and
 * enforcement is on (the secure default). A generation that throws this is NEVER made mintable and NEVER
 * produces a signing attestation, so on-chain "TEE-verified provenance" cannot be claimed for an output
 * whose TEE proof did not actually pass. The real verdict is still surfaced in the message + provenance.
 */
export class TeeVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeeVerificationError";
  }
}

/** A TEE verification "passes" ONLY when processResponse returned boolean true (matches the verify-e2e bar
 *  `teeVerified === true`). Anything else - false, the "n/a" sentinel, an "err:..." string - is a failure. */
export function teeVerifyPassed(verified: boolean | string): boolean {
  return verified === true;
}

/**
 * Load bytes for a 0G content root, durable-source FIRST. 0G Storage testnet evicts image-sized blobs
 * (verified), so we read the local content-addressed cache first, then fall back to a 0G download (and
 * backfill the cache on a successful 0G hit). Returns null if neither source has the bytes.
 */
async function loadBytesByRoot(root: string, source: string): Promise<Buffer | null> {
  const cached = cachedImageByRoot(root);
  if (cached) return cached.bytes;
  try {
    const bytes = await download(root);
    if (bytes && bytes.length > 0) {
      cacheImageByRoot(root, bytes, { source }); // backfill so the next read is local + durable
      return bytes;
    }
  } catch {
    /* 0G miss (likely evicted on testnet) */
  }
  return null;
}

/**
 * Reconstruct { baseBytes, prompt } for an agent + user prompt.
 *   - Agent WITH a brain (encBrainRoot + server-custody key): MUST generate via the brain. The base
 *     image is loaded from the durable local cache first, 0G second. If the brain genuinely cannot be
 *     loaded, we THROW (BrainUnavailableError) rather than silently degrade to a generic style -- Toper's
 *     explicit requirement ("harus di enforce"). Silent fallback is what hid the real bug.
 *   - Brain-less SEEDED agent (the 4 on-chain catalog seeds, no stored key): catalog base + prompt
 *     (intended, zero-regression path).
 */
export async function resolveGenConfig(agentId: number, agentName: string, encBrainRoot: string, userPrompt: string): Promise<ResolvedGenConfig> {
  const clean = userPrompt.trim();

  // does this agent have a brain we are expected to use? (on-chain root + a server-custody AES key)
  const hasBrainRoot = !!encBrainRoot && encBrainRoot.length > 0 && encBrainRoot !== ZERO32;
  const rec = hasBrainRoot ? (brainByAgentId(agentId) ?? brainByRoot(encBrainRoot)) : null;

  if (hasBrainRoot && rec) {
    // ENFORCED brain path. Any failure here throws (no silent catalog fallback for a brain-backed agent).
    const envelopeBytes = await loadBytesByRoot(rec.encBrainRoot, "brain");
    if (!envelopeBytes) {
      throw new BrainUnavailableError(
        `agent #${agentId} (${agentName}) brain envelope unavailable (root ${rec.encBrainRoot.slice(0, 14)}... not in local cache or 0G)`,
      );
    }
    let brain;
    try {
      brain = decryptBrain(Buffer.from(envelopeBytes), rec.brainKeyHex);
    } catch (e: any) {
      throw new BrainUnavailableError(`agent #${agentId} (${agentName}) brain decrypt failed: ${String(e?.message).slice(0, 100)}`);
    }
    const baseBytes = await loadBytesByRoot(brain.canonicalBaseRoot, "reference");
    if (!baseBytes) {
      throw new BrainUnavailableError(
        `agent #${agentId} (${agentName}) reference image unavailable (root ${brain.canonicalBaseRoot.slice(0, 14)}... not in local cache or 0G). Re-create the agent to re-persist its reference image.`,
      );
    }
    const prompt = `${brain.identityLock} Change only this: ${clean}. ${brain.styleDescriptor}. Avoid: ${brain.negative}.`;
    return { baseBytes, prompt, usedBrain: true, agentName };
  }

  // brain-less SEEDED agent (the 4 catalog seeds, no stored key): intended catalog base + prompt.
  if (hasBrainRoot && !rec) {
    // On-chain root present but NO server-custody key (e.g. a seed, or a key lost/created elsewhere). This
    // is the only "has a rootish value but cannot use a brain" case we allow to fall back, because there
    // is no key to decrypt with. Catalog path keeps the seeded agents working (zero regression).
  }
  const baseRel = baseForSeededAgent(agentName);
  const basePath = path.join(REPO_ROOT, baseRel);
  const baseBytes = readFileSync(basePath);
  const prompt = fallbackPrompt(agentName, clean);
  return { baseBytes, prompt, usedBrain: false, agentName };
}

// ── shared generation core (used by BOTH the HTTP /generate job AND the Summon watcher) ──
// The provenance construction (provenanceHash + teeAttestation) is committed on-chain at mint, so it
// MUST live in exactly ONE place: the watcher's fulfill mint and the route's user mint hash IDENTICALLY.

/** The full proof of one TEE generation: the image + the on-chain-committed provenance fields. */
export interface GenProof {
  imageRoot: string;
  provenanceHash: string; // keccak of the provenance record (committed on-chain)
  teeAttestation: string; // keccak of the TeeML|... attestation string (committed on-chain)
  seed: number;
  model: string;
  teeSigner: string;
  verified: boolean | string;
  verifiability: string;
  chatId: string | null;
  latencyMs: number;
  bytes: Buffer;
  prompt: string;
  usedBrain: boolean;
  provenanceRecord: unknown;
}

export interface GenerateCoreInput {
  agentId: number;
  agentName: string;
  encBrainRoot: string;
  userPrompt: string;
  label?: string; // 0G-storage object name (default `gen-<seed>`)
}

export interface GenerateHooks {
  onStage?: (status: JobStatus, detail: string) => void;
  onImageReady?: (bytes: Buffer) => void; // fired after generate(), BEFORE the 0G store (preview-early)
}

/**
 * Resolve config -> TEE generate on 0G Compute (SPONSOR pays) -> store on 0G -> assemble the EXACT
 * provenance record + hashes. No job-store / no gen-guard coupling (the caller owns those). Throws on
 * any failure (BrainUnavailableError, compute, storage).
 */
export async function generateAndProve(input: GenerateCoreInput, hooks: GenerateHooks = {}): Promise<GenProof> {
  const { agentId, agentName, encBrainRoot, userPrompt } = input;
  hooks.onStage?.("generating", "resolving gen config + connecting to 0G Compute");
  const cfg = await resolveGenConfig(agentId, agentName, encBrainRoot, userPrompt);

  hooks.onStage?.("generating", `generating inside the TEE (~45s) [${cfg.usedBrain ? "brain" : "catalog"}]`);
  const signer = sponsorSigner();
  const broker = await getBroker(signer);
  const svc = await imageService(broker);

  const g = await generate(broker, svc, cfg.baseBytes, cfg.prompt);

  // B-5 (TEE enforced, not best-effort): if the hardware TEE attestation did not verify, REFUSE here -
  // before any preview/store/attestation - so an unverified (or provider-faked) generation can never be
  // made mintable nor get a signing attestation. Throws BEFORE onImageReady so it never even previews.
  // The secure default is enforce-on; AURA_ENFORCE_TEE=0 is a deliberate, logged testnet-only escape hatch.
  if (ENFORCE_TEE_VERIFICATION && !teeVerifyPassed(g.verified)) {
    throw new TeeVerificationError(
      `TEE verification did not pass (verified=${JSON.stringify(g.verified)}) - refusing to attest/mint an unverified generation`,
    );
  }

  hooks.onStage?.("verifying", "TEE attestation processed");
  hooks.onImageReady?.(g.bytes);

  hooks.onStage?.("storing", "uploading the image to 0G Storage");
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const img = await store(signer, g.bytes, input.label ?? `gen-${seed}`);
  // Persist the output bytes in the durable local cache keyed by its 0G root, so the image-by-root
  // endpoint can serve REAL art even after 0G Storage testnet evicts the blob (verified to happen).
  cacheImageByRoot(img.rootHash, g.bytes, { source: "output" });

  // the exact provenance record (its keccak is committed on-chain at mint).
  const provenanceRecord = {
    agentId,
    agentName,
    model: g.model,
    prompt: cfg.prompt,
    seed,
    teeSigner: g.teeSigner,
    teeVerifiability: g.verifiability,
    teeVerified: g.verified,
    chatId: g.chatId,
    imageRoot: img.rootHash,
    usedBrain: cfg.usedBrain,
  };
  const provBytes = Buffer.from(JSON.stringify(provenanceRecord, null, 2), "utf8");
  const provenanceHash = ethers.keccak256(provBytes);
  const teeAttestation = ethers.keccak256(
    ethers.toUtf8Bytes(`TeeML|dstack|${g.model}|${g.teeSigner}|${g.chatId}|${img.rootHash}`),
  );

  return {
    imageRoot: img.rootHash,
    provenanceHash,
    teeAttestation,
    seed,
    model: g.model,
    teeSigner: g.teeSigner,
    verified: g.verified,
    verifiability: g.verifiability,
    chatId: g.chatId,
    latencyMs: g.latencyMs,
    bytes: g.bytes,
    prompt: cfg.prompt,
    usedBrain: cfg.usedBrain,
    provenanceRecord,
  };
}

export interface GenerateInput {
  jobId: string;
  agentId: number;
  agentName: string;
  encBrainRoot: string;
  userPrompt: string;
}

/**
 * Runs in the background (the route does NOT await this). Drives the job to done|error.
 * Cost-bounded by the caller's gen guard (released here in finally). Thin wrapper over generateAndProve.
 */
export async function runGeneration(input: GenerateInput): Promise<void> {
  const { jobId, agentId, agentName, encBrainRoot, userPrompt } = input;
  try {
    const proof = await generateAndProve(
      { agentId, agentName, encBrainRoot, userPrompt, label: `gen-${jobId}` },
      {
        onStage: (status, detail) => setStatus(jobId, status, detail),
        onImageReady: (bytes) => saveGeneratedImage(jobId, bytes),
      },
    );

    setResult(
      jobId,
      {
        imageRoot: proof.imageRoot,
        imageUrl: `/generate/${jobId}/image`,
        provenanceHash: proof.provenanceHash,
        teeAttestation: proof.teeAttestation,
        teeVerified: proof.verified,
        teeSigner: proof.teeSigner,
        model: proof.model,
        verifiability: proof.verifiability,
        chatId: proof.chatId,
        latencyMs: proof.latencyMs,
        seed: proof.seed,
        mintable: true,
        usedBrain: proof.usedBrain,
      },
      proof.provenanceRecord,
    );
  } catch (e: any) {
    setError(jobId, String(e?.message ?? e).slice(0, 300));
  } finally {
    genGuardRelease();
  }
}
