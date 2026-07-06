// SERVER-ONLY one-off. Backfill chat personas for the two USER-created auras that minted BEFORE the
// persona store existed (AUREON + NYXARA, Christopher's auras). They otherwise chat with the flat generic
// fallbackMeta. This decrypts each aura's brain (server custody) to recover its REAL styleDescriptor (the
// aesthetic floor), pins the drafted signatureCharacter (which was never stored on-chain), derives a rich
// persona via the chat LLM seam (best-effort, floor fallback), and upserts it keyed by the concrete agentId.
//
// Run INSIDE the server container (it has the DB, brain AES keys, image cache, and 0G access):
//   docker exec aura-server node dist/scripts/backfill-persona.js
// Optionally pass explicit names: node dist/scripts/backfill-persona.js AUREON NYXARA
//
// Idempotent: re-running re-derives + overwrites the same 'agent:<id>' persona rows.
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Load the repo-root .env (the funded sponsor key the 0G chat seam needs for derivation) BEFORE anything
// reads it. A standalone script does NOT go through index.ts, which is where the server normally loads it.
// The secrets are read lazily (at the runLlm call), so a top-level load here is in time. dist/scripts is
// three levels under REPO_ROOT (REPO_ROOT/server/dist/scripts), same as the sibling verify-*.ts scripts.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { db } from "../aura/db.js";
import { decryptBrain } from "../aura/brain.js";
import { resolveBytesByRoot } from "../aura/image-cache.js";
import { derivePersona } from "../aura/persona-derive.js";
import { upsertPersonaForAgent, personaMetaFor } from "../aura/persona-store.js";

// The drafted signature characters (NOT stored on-chain). Exact values from the persona-integration brief.
const SIGNATURES: Record<string, string> = {
  AUREON:
    "A sun-crowned divinity wrought in living gold: a serene, symmetrical face of hammered aurum, eyes like thin eclipse-rings, a halo of etched sunbeams, and robes of liquid light that dissolve into rays at the hem. Regal, ageless, impossibly fine.",
  NYXARA:
    "An abyssal deity crowned in drowned starlight: a pale, otherworldly figure veiled in flowing dark water and silver constellations, eyes like twin moons, trailing bioluminescent tendrils and slow-falling stardust. Serene, vast, and quietly terrifying in its beauty.",
};

interface BrainRow {
  agent_id: number;
  owner: string | null;
  name: string;
  enc_brain_root: string;
  brain_key_hex: string;
}

/** Newest minted brain row for a given aura name (max agent_id, agent_id NOT NULL). */
function newestBrainByName(name: string): BrainRow | null {
  const r = db()
    .prepare(
      `SELECT agent_id, owner, name, enc_brain_root, brain_key_hex
         FROM agent_brains
        WHERE UPPER(name)=UPPER(?) AND agent_id IS NOT NULL
        ORDER BY agent_id DESC LIMIT 1`,
    )
    .get(name) as any;
  return r ?? null;
}

async function backfillOne(name: string): Promise<void> {
  const sig = SIGNATURES[name.toUpperCase()] ?? null;
  const brain = newestBrainByName(name);
  if (!brain) {
    console.error(`[backfill] ${name}: no minted brain row found (agent_brains). Skipping.`);
    return;
  }
  console.log(`[backfill] ${name}: agentId=${brain.agent_id} owner=${brain.owner} root=${brain.enc_brain_root.slice(0, 14)}...`);

  // recover the REAL styleDescriptor from the brain (the aesthetic floor).
  let styleDescriptor = "";
  try {
    const env = (await resolveBytesByRoot(brain.enc_brain_root, { source: "brain" }))?.bytes ?? null;
    if (!env) throw new Error("brain envelope not in local cache or 0G");
    const plain = decryptBrain(Buffer.from(env), brain.brain_key_hex);
    styleDescriptor = plain.styleDescriptor?.trim() ?? "";
    console.log(`[backfill] ${name}: decrypted styleDescriptor (${styleDescriptor.length} chars)`);
  } catch (e: any) {
    console.error(`[backfill] ${name}: brain decrypt failed (${String(e?.message).slice(0, 120)}). Cannot backfill an accurate aesthetic. Skipping.`);
    return;
  }
  if (!styleDescriptor) {
    console.error(`[backfill] ${name}: empty styleDescriptor. Skipping.`);
    return;
  }

  // derive the rich persona (best-effort; derivePersona never throws, floor fallback on any failure).
  const rich = await derivePersona({ name, styleDescriptor, signatureCharacter: sig });
  const enriched = !!(rich.personality || rich.lore);
  console.log(`[backfill] ${name}: persona ${enriched ? "LLM-ENRICHED" : "FLOOR-ONLY"} (personality=${!!rich.personality} lore=${!!rich.lore})`);

  upsertPersonaForAgent(brain.agent_id, brain.enc_brain_root, {
    name,
    // floor aesthetic = the REAL styleDescriptor; derive may refine it to a one-liner (rich.aesthetic).
    aesthetic: rich.aesthetic || styleDescriptor,
    signatureCharacter: sig,
    personality: rich.personality,
    lore: rich.lore,
    tagline: rich.tagline,
    rarity: "Legendary",
    derived: enriched,
  });

  // read back + print the resolved chat meta as evidence.
  const meta = personaMetaFor(brain.agent_id, brain.enc_brain_root);
  console.log(`[backfill] ${name}: STORED persona meta ->`);
  console.log(JSON.stringify({
    agentId: brain.agent_id,
    name: meta?.name,
    tagline: meta?.tagline,
    aesthetic: meta?.aesthetic,
    signatureCharacter: meta?.signatureCharacter,
    personality: meta?.personality ?? null,
    lore: meta?.lore ?? null,
    rarity: meta?.rarity ?? null,
  }, null, 2));
}

async function main(): Promise<void> {
  const names = process.argv.slice(2).filter(Boolean);
  const targets = names.length ? names : ["AUREON", "NYXARA"];
  console.log(`[backfill] targets: ${targets.join(", ")}`);
  for (const n of targets) {
    await backfillOne(n);
  }
  console.log("[backfill] done.");
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill] fatal:", e);
  process.exit(1);
});
