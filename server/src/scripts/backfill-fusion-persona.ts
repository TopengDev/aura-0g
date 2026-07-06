// SERVER-ONLY one-off. Backfill a RICH, 0G-derived blended PERSONA onto an ALREADY-MINTED fusion child that
// only has the floor persona (e.g. the live AURA-FUSION-1 = agent #33, minted before this feature). Derives
// the persona from the child's on-chain lineage (BOTH parents' identities + its genome) via the SAME 0G TEE
// compute path the pipeline uses - so it needs NEITHER the child's AES brain key (sealed to the fuser,
// unrecoverable server-side) NOR a re-fusion. After this, the child chats in-character + shows its
// personality / lore / tagline on its detail page (via personaByAgentId -> enrichAgentSoul).
//
//   docker exec aura-server node dist/scripts/backfill-fusion-persona.js <childAgentId>
//   e.g. the live child:  docker exec aura-server node dist/scripts/backfill-fusion-persona.js 33
//
// NOTE ON THE NAME: the child's on-chain name (AURA-FUSION-1) is IMMUTABLE (ERC-7857 stores it at mint), so
// this backfill CANNOT retroactively give #33 a beautiful name - only NEW fusions get the 0G-derived name.
// The persona row therefore keeps the on-chain name for display consistency; the VALUE here is the rich soul.
// Idempotent: re-running re-derives + overwrites the 'agent:<id>' persona row (upsertPersonaForAgent).
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { agentsRead } from "../aura/contracts.js";
import { auraFusionRead, auraFusionConfigured } from "../aura/game/contracts.js";
import { getAgentIdentity } from "../aura/agents.js";
import { deriveFusedPersona, type FuseParentPersona } from "../aura/persona-derive.js";
import { blendedStyleDescriptor } from "../aura/game/genome-style.js";
import { upsertPersonaForAgent, personaByAgentId } from "../aura/persona-store.js";
import type { Genome } from "../aura/game/fuse-genome.js";

async function parentIdentity(id: number): Promise<FuseParentPersona> {
  const d = await getAgentIdentity(id);
  if (!d?.meta) return { name: `Aura #${id}`, aesthetic: "", personality: null, lore: null, tagline: null, signatureCharacter: null };
  return {
    name: d.meta.name,
    aesthetic: d.meta.aesthetic,
    personality: d.meta.personality ?? null,
    lore: d.meta.lore ?? null,
    tagline: d.meta.tagline ?? null,
    signatureCharacter: d.meta.signatureCharacter ?? null,
  };
}

async function main(): Promise<void> {
  const childAgentId = Number(process.argv[2]);
  if (!Number.isInteger(childAgentId) || childAgentId < 1) {
    console.error("usage: node dist/scripts/backfill-fusion-persona.js <childAgentId>");
    process.exit(2);
  }
  if (!auraFusionConfigured()) {
    console.error("[backfill-persona] AuraFusion not configured on this deploy. Aborting.");
    process.exit(2);
  }

  // 1. read the child + its lineage on-chain.
  const inft = agentsRead();
  const fusion = auraFusionRead();
  const agent = await inft.getAgent(childAgentId);
  const lin = await fusion.lineageOf(childAgentId);
  const childName = String(agent.name);
  const encBrainRoot = String(agent.encBrainRoot);
  const genome = Array.from(lin.genome as ArrayLike<unknown>).map(Number) as Genome;
  const parentA = Number(lin.parentA);
  const parentB = Number(lin.parentB);
  const blended = blendedStyleDescriptor(genome);
  console.log(`[backfill-persona] child #${childAgentId} "${childName}"  parents=[${parentA},${parentB}]  gen=${Number(lin.generation)}`);
  console.log(`[backfill-persona] genome=[${genome.join(",")}]`);
  console.log(`[backfill-persona] blended style = ${blended}`);
  if (parentA < 1 || parentB < 1) {
    console.error("[backfill-persona] child has no recorded parents on-chain (not a fused child?). Aborting.");
    process.exit(1);
  }

  // 2. resolve BOTH parents' identity (catalog meta OR stored persona).
  const [pa, pb] = await Promise.all([parentIdentity(parentA), parentIdentity(parentB)]);
  console.log(`[backfill-persona] parent A #${parentA} = ${pa.name} (personality? ${!!pa.personality}, lore? ${!!pa.lore})`);
  console.log(`[backfill-persona] parent B #${parentB} = ${pb.name} (personality? ${!!pb.personality}, lore? ${!!pb.lore})`);

  // 3. derive the RICH blended persona via 0G TEE compute.
  console.log(`[backfill-persona] deriving blended persona via 0G TEE compute...`);
  const persona = await deriveFusedPersona({ childName, parentA: pa, parentB: pb, blendedStyleDescriptor: blended });
  const derived = !!(persona.personality || persona.lore);
  console.log(`[backfill-persona] derived=${derived}`);
  console.log(JSON.stringify(persona, null, 2));
  if (!derived) {
    console.warn("[backfill-persona] 0G derivation returned only the FLOOR (no personality/lore). Persisting the floor anyway (still names both parents + the blended style).");
  }

  // 4. upsert the persona keyed by the KNOWN agentId (keep the on-chain name for display consistency).
  upsertPersonaForAgent(childAgentId, encBrainRoot, {
    name: childName,
    aesthetic: persona.aesthetic || blended,
    signatureCharacter: persona.signatureCharacter,
    personality: persona.personality,
    lore: persona.lore,
    tagline: persona.tagline,
    rarity: null,
    derived,
  });

  // 5. read back as evidence.
  const rec = personaByAgentId(childAgentId);
  console.log("[backfill-persona] agent_personas row now ->");
  console.log(JSON.stringify(
    { agentId: rec?.agentId, name: rec?.name, derived: rec?.derived, personality: rec?.personality, lore: rec?.lore, tagline: rec?.tagline, signatureCharacter: rec?.signatureCharacter, aesthetic: rec?.aesthetic },
    null,
    2,
  ));
  if (!rec || !(rec.personality || rec.lore)) {
    console.error("[backfill-persona] WARNING: no rich fields persisted (floor only). The detail page still shows the blended style + parents tagline.");
  }
  console.log(`[backfill-persona] DONE. GET /agents/${childAgentId} + /api/agents/${childAgentId} now resolve this persona (via personaByAgentId -> enrichAgentSoul).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill-persona] fatal:", e);
  process.exit(1);
});
