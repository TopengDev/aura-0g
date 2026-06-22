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
import { baseForSeededAgent, fallbackPrompt } from "./catalog.js";
import { rawAgent } from "./agents.js";
import { brainByRoot, brainByAgentId } from "./store.js";
import { decryptBrain } from "./brain.js";
import { setStatus, setResult, setError, saveGeneratedImage } from "./jobs.js";
import { genGuardRelease } from "./ratelimit.js";
import { REPO_ROOT } from "./config.js";

export interface ResolvedGenConfig {
  baseBytes: Buffer;
  prompt: string;
  usedBrain: boolean;
  agentName: string;
}

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Reconstruct { baseBytes, prompt } for an agent + user prompt. Brain first, catalog fallback. */
export async function resolveGenConfig(agentId: number, agentName: string, encBrainRoot: string, userPrompt: string): Promise<ResolvedGenConfig> {
  const clean = userPrompt.trim();

  // 1. brain path - only if we have a server-custody AES key for this agent's encBrainRoot.
  const hasBrainRoot = encBrainRoot && encBrainRoot.length > 0 && encBrainRoot !== ZERO32;
  if (hasBrainRoot) {
    const rec = brainByAgentId(agentId) ?? brainByRoot(encBrainRoot);
    if (rec) {
      try {
        const envelope = await download(rec.encBrainRoot);
        const brain = decryptBrain(envelope, rec.brainKeyHex);
        const baseBytes = await download(brain.canonicalBaseRoot);
        // generalized prompt: identity lock + "change only X" + style + negative
        const prompt = `${brain.identityLock} Change only this: ${clean}. ${brain.styleDescriptor}. Avoid: ${brain.negative}.`;
        return { baseBytes, prompt, usedBrain: true, agentName };
      } catch (e: any) {
        // brain decryption / download failed -> fall through to catalog (logged by caller via status)
      }
    }
  }

  // 2. catalog fallback (the 4 brain-less seeded agents, or any failure above).
  const baseRel = baseForSeededAgent(agentName);
  const basePath = path.join(REPO_ROOT, baseRel);
  const baseBytes = readFileSync(basePath);
  const prompt = fallbackPrompt(agentName, clean);
  return { baseBytes, prompt, usedBrain: false, agentName };
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
 * Cost-bounded by the caller's gen guard (released here in finally).
 */
export async function runGeneration(input: GenerateInput): Promise<void> {
  const { jobId, agentId, agentName, encBrainRoot, userPrompt } = input;
  try {
    setStatus(jobId, "generating", "resolving gen config + connecting to 0G Compute");
    const cfg = await resolveGenConfig(agentId, agentName, encBrainRoot, userPrompt);

    setStatus(jobId, "generating", `generating inside the TEE (~45s) [${cfg.usedBrain ? "brain" : "catalog"}]`);
    const signer = sponsorSigner();
    const broker = await getBroker(signer);
    const svc = await imageService(broker);

    const g = await generate(broker, svc, cfg.baseBytes, cfg.prompt);

    setStatus(jobId, "verifying", "TEE attestation processed");
    saveGeneratedImage(jobId, g.bytes);

    setStatus(jobId, "storing", "uploading the image to 0G Storage");
    const img = await store(signer, g.bytes, `gen-${jobId}`);

    const seed = Math.floor(Math.random() * 1_000_000_000);
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

    setResult(
      jobId,
      {
        imageRoot: img.rootHash,
        imageUrl: `/generate/${jobId}/image`,
        provenanceHash,
        teeAttestation,
        teeVerified: g.verified,
        teeSigner: g.teeSigner,
        model: g.model,
        verifiability: g.verifiability,
        chatId: g.chatId,
        latencyMs: g.latencyMs,
        seed,
        mintable: true,
        usedBrain: cfg.usedBrain,
      },
      provenanceRecord,
    );
  } catch (e: any) {
    setError(jobId, String(e?.message ?? e).slice(0, 300));
  } finally {
    genGuardRelease();
  }
}
