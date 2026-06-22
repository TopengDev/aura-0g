// SERVER-ONLY. Orchestrates one async generation job: TEE generate on 0G Compute → persist →
// store on 0G Storage → assemble provenance. Mirrors demo/run-aura.ts phaseHero (gen→store),
// stopping BEFORE the mint (mint is a separate explicit API step). Releases the gen guard always.
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { demoSigner } from "./wallet";
import { getBroker, imageService, generate } from "./compute";
import { store } from "./storage";
import { resolveBasePreset } from "./images";
import { metaForName } from "./catalog";
import { setStatus, setResult, setError, saveGeneratedImage } from "./jobs";
import { genGuardRelease } from "./ratelimit";

const ROOT = process.cwd();

/** Base image preset to edit FROM, per agent (qwen-image-edit is EDIT-only). */
export function baseForAgent(agentName: string): string {
  const n = agentName.toUpperCase();
  if (n === "RISO") return "riso-fox";
  if (n === "MIRAI") return "mirai-bust";
  return "nokturne-scene"; // neutral scene for NOKTURNE / SCRIPTORIUM / fallback
}

/** Build the styled prompt: character-consistency for RISO, style reinforcement for all. */
export function buildPrompt(agentName: string, userPrompt: string): string {
  const meta = metaForName(agentName);
  const aesthetic = meta?.aesthetic ?? "";
  const clean = userPrompt.trim();
  if (agentName.toUpperCase() === "RISO") {
    return `Keep the EXACT same fennec fox character (same fur, cheek and ear markings, eyes, blue knit scarf). ${clean}. Style: risograph duotone, fluorescent pink and blue, halftone grain, misregistration, flat bold shapes, indie zine.`;
  }
  return `${clean}. Render in ${agentName} style: ${aesthetic}`;
}

export interface GenerateInput {
  jobId: string;
  agentId: number;
  agentName: string;
  userPrompt: string;
}

/**
 * Runs in the background (the route does NOT await this). Drives the job to done|error.
 * Cost-bounded by the caller's gen guard (released here in finally).
 */
export async function runGeneration(input: GenerateInput): Promise<void> {
  const { jobId, agentId, agentName, userPrompt } = input;
  try {
    const baseKey = baseForAgent(agentName);
    const basePath = resolveBasePreset(baseKey) ?? "";
    if (!basePath) throw new Error(`no base preset for agent ${agentName}`);
    const baseBytes = readFileSync(basePath);
    const prompt = buildPrompt(agentName, userPrompt);

    setStatus(jobId, "generating", "connecting to 0G Compute + generating inside the TEE (~45s)");
    const signer = demoSigner();
    const broker = await getBroker(signer);
    const svc = await imageService(broker);

    const g = await generate(broker, svc, baseBytes, prompt);

    setStatus(jobId, "verifying", "TEE attestation processed");
    saveGeneratedImage(jobId, g.bytes);

    setStatus(jobId, "storing", "uploading the image to 0G Storage");
    const img = await store(signer, g.bytes, `gen-${jobId}`);

    // provenance record (committed on-chain at mint via its keccak hash; kept here for verify)
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const provenanceRecord = {
      agentId, agentName, model: g.model, prompt, seed,
      teeSigner: g.teeSigner, teeVerifiability: g.verifiability, teeVerified: g.verified,
      chatId: g.chatId, imageRoot: img.rootHash,
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
        imageUrl: `/api/generate/${jobId}/image`,
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
      },
      provenanceRecord, // persisted on the job (disk + globalThis) so the mint route can read it
    );
  } catch (e: any) {
    setError(jobId, String(e?.message ?? e).slice(0, 300));
  } finally {
    genGuardRelease();
  }
}
