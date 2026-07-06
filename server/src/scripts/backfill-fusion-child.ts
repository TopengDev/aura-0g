// SERVER-ONLY one-off. Backfill the agent_brains row for a FUSION child that minted BEFORE the fuse pipeline
// staged its brain (the bug fixed in feat/fusion-child-portrait). Without a brain row, brainByAgentId(childId)
// is null and the agent-portrait endpoint has no canonicalBaseRoot to resolve, so the child renders NO portrait
// on its /agents/<id> detail page while /fuse (which reads the execute response) shows it fine.
//
// RECOVERY (deterministic, no re-mint): the child's on-chain styleFingerprint COMMITS its portrait root
// (buildChildIdentity: styleFingerprint = keccak(JCS(publicStyle)), and publicStyle.refImageRoot == the child's
// portrait root). Everything ELSE in publicStyle (name, genome, generation, parents, aesthetic, model) is
// recoverable from the chain. So we recompute the fingerprint for each cached output root in the local
// image-cache and find the ONE root that reproduces the on-chain styleFingerprint - that is provably the child's
// portrait (a keccak match is not forgeable). Then stageBrain + promoteBrainByRoot(childId), exactly as the
// create flow does at confirm-mint. The child's AES brain key is NOT recoverable (it was sealed to the fuser
// on-chain, never staged), so brain_key_hex is a clear sentinel: the PORTRAIT resolves, but re-generating from
// this historical child's brain will fail gracefully (BrainUnavailableError) - honest, not fabricated.
//
// Run INSIDE the server container (it has the DB, the image cache, and 0G/chain access):
//   docker exec aura-server node dist/scripts/backfill-fusion-child.js <childAgentId> [requestId]
// e.g. for Christopher's live child 33 from fusion request 1:
//   docker exec aura-server node dist/scripts/backfill-fusion-child.js 33 1
//
// Idempotent: re-running re-promotes the same 'agent:<id>' row (promoteBrainByRoot only touches an
// as-yet-unpromoted row; a re-run that finds the row already promoted is a no-op + prints the existing row).
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load the repo-root .env (RPC + contract addresses come from env/deployed-v2.json) BEFORE anything reads it.
// dist/scripts is three levels under REPO_ROOT (REPO_ROOT/server/dist/scripts), same as the sibling scripts.
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { db } from "../aura/db.js";
import { resolveBytesByRoot } from "../aura/image-cache.js";
import { agentsRead } from "../aura/contracts.js";
import { auraFusionRead, auraFusionConfigured } from "../aura/game/contracts.js";
import { buildChildIdentity } from "../aura/game/fuse.js";
import { blendedStyleDescriptor } from "../aura/game/genome-style.js";
import type { Genome } from "../aura/game/fuse-genome.js";
import { stageBrain, promoteBrainByRoot, brainByRoot, brainByAgentId } from "../aura/store.js";
import { upsertPersonaForAgent, personaByAgentId } from "../aura/persona-store.js";

// The child's AES data-key was ECIES-sealed to the fuser on-chain (childSealedKey) and never staged in server
// custody, so it is UNRECOVERABLE here. brain_key_hex is NOT NULL, so we store a clear, non-hex sentinel: the
// portrait path never reads it; any decrypt attempt fails cleanly (BrainUnavailableError), never silently wrong.
const KEY_SENTINEL = "UNRECOVERABLE-fusion-child-key-sealed-to-fuser-onchain";

function candidateRoots(): string[] {
  // prefer generated OUTPUTS (the child portrait was cached with source='output'), then any other cached root.
  const rows = db()
    .prepare(`SELECT root, source FROM image_blobs ORDER BY (source='output') DESC, created_at DESC`)
    .all() as Array<{ root: string; source: string | null }>;
  return rows.map((r) => r.root);
}

async function main(): Promise<void> {
  const childAgentId = Number(process.argv[2]);
  const requestId = process.argv[3] ? Number(process.argv[3]) : null;
  if (!Number.isInteger(childAgentId) || childAgentId < 1) {
    console.error("usage: node dist/scripts/backfill-fusion-child.js <childAgentId> [requestId]");
    process.exit(2);
  }
  if (!auraFusionConfigured()) {
    console.error("[backfill-fuse] AuraFusion is not configured on this deploy (no AURA_FUSION_ADDR / deployed-v2.json). Aborting.");
    process.exit(2);
  }

  // ── 1. read the on-chain child identity (the source of truth we must reproduce) ──
  const inft = agentsRead();
  const fusion = auraFusionRead();
  const agent = await inft.getAgent(childAgentId);
  const owner: string = await inft.ownerOf(childAgentId);
  const lin = await fusion.lineageOf(childAgentId);

  const childName: string = String(agent.name);
  const targetFingerprint = String(agent.styleFingerprint).toLowerCase();
  const encBrainRoot = String(agent.encBrainRoot);
  const modelAttestation = String(agent.modelAttestation);
  const dataHash = String(agent.dataHash);

  const genome = Array.from(lin.genome as ArrayLike<unknown>).map((x) => Number(x)) as Genome;
  const generation = Number(lin.generation);
  let parentA = Number(lin.parentA);
  let parentB = Number(lin.parentB);
  // lineage parents SHOULD be set for a fused child; if a read gave 0, recover them from the fusion request.
  if ((!parentA || !parentB) && requestId !== null) {
    const r = await fusion.requests(requestId);
    parentA = parentA || Number(r.parentA);
    parentB = parentB || Number(r.parentB);
  }

  console.log(`[backfill-fuse] child #${childAgentId} "${childName}"`);
  console.log(`[backfill-fuse]   owner            = ${owner}`);
  console.log(`[backfill-fuse]   encBrainRoot     = ${encBrainRoot}`);
  console.log(`[backfill-fuse]   styleFingerprint = ${targetFingerprint}`);
  console.log(`[backfill-fuse]   genome           = [${genome.join(",")}] gen=${generation} parents=[${parentA},${parentB}]`);
  console.log(`[backfill-fuse]   aesthetic        = ${blendedStyleDescriptor(genome)}`);

  if (parentA < 1 || parentB < 1 || genome.length !== 8) {
    console.error("[backfill-fuse] could not recover a complete lineage (parents/genome). Pass the requestId as the 2nd arg. Aborting.");
    process.exit(1);
  }

  // ── 2. find the cached output root whose fingerprint reproduces the on-chain styleFingerprint ──
  const roots = candidateRoots();
  console.log(`[backfill-fuse] scanning ${roots.length} cached image root(s) for the portrait that reproduces the fingerprint...`);
  let matchRoot: string | null = null;
  for (const root of roots) {
    let fp: string;
    try {
      fp = buildChildIdentity({ childName, childGenome: genome, generation, parentA, parentB, refImageRoot: root }).styleFingerprint.toLowerCase();
    } catch {
      continue; // a non-conforming root (wrong genome length etc.) - skip
    }
    if (fp === targetFingerprint) {
      matchRoot = root;
      break;
    }
  }

  if (!matchRoot) {
    console.error("[backfill-fuse] NO cached output root reproduces the on-chain styleFingerprint.");
    console.error("[backfill-fuse] The child's portrait bytes are not in this server's local image-cache (0G testnet");
    console.error("[backfill-fuse] evicts image-sized blobs), so the ORIGINAL portrait root is unrecoverable here.");
    console.error("[backfill-fuse] NOT fabricating a portrait. The code fix makes the NEXT fusion stage+promote correctly;");
    console.error("[backfill-fuse] Christopher can re-fuse to get a fresh, correctly-persisted child.");
    process.exit(3);
  }

  const hit = await resolveBytesByRoot(matchRoot);
  console.log(`[backfill-fuse] MATCH: portrait root = ${matchRoot} (${hit ? hit.bytes.length + " bytes in local cache" : "bytes NOT resolvable"})`);
  if (!hit) {
    console.error("[backfill-fuse] the matched root has no resolvable bytes (cache file missing). Aborting to avoid a dead portrait row.");
    process.exit(3);
  }

  // ── 3. stage (if absent) + promote the brain to the childId - exactly the create -> confirm-mint sequence ──
  if (!brainByRoot(encBrainRoot)) {
    stageBrain({
      owner,
      name: childName,
      encBrainRoot,
      brainKeyHex: KEY_SENTINEL, // unrecoverable (sealed to the fuser on-chain); portrait path never reads it
      canonicalBaseRoot: matchRoot,
      styleFingerprint: String(agent.styleFingerprint),
      modelAttestation,
      sealedKey: null,
      dataHash,
    });
    console.log(`[backfill-fuse] staged brain (pending) for encBrainRoot ${encBrainRoot.slice(0, 14)}...`);
  } else {
    console.log(`[backfill-fuse] a brain row already exists for this encBrainRoot (skip stage).`);
  }
  const promoted = promoteBrainByRoot(encBrainRoot, childAgentId, owner);
  console.log(`[backfill-fuse] promoteBrainByRoot -> ${promoted ? "PROMOTED" : "already promoted / no-op"}`);

  // ── 3b. floor chat persona (deterministic blended aesthetic) so the child also has a soul, matching the fix ──
  if (!personaByAgentId(childAgentId)) {
    upsertPersonaForAgent(childAgentId, encBrainRoot, {
      name: childName,
      aesthetic: blendedStyleDescriptor(genome),
      signatureCharacter: null,
      personality: null,
      lore: null,
      tagline: "A fused descendant Aura on 0G.",
      rarity: null,
      derived: false,
    });
    console.log(`[backfill-fuse] staged floor chat persona for #${childAgentId}.`);
  }

  // ── 4. read back the row as evidence ──
  const rec = brainByAgentId(childAgentId);
  console.log("[backfill-fuse] agent_brains row now ->");
  console.log(JSON.stringify(
    {
      agentId: rec?.agentId ?? null,
      owner: rec?.owner ?? null,
      name: rec?.name ?? null,
      canonicalBaseRoot: rec?.canonicalBaseRoot ?? null,
      encBrainRoot: rec?.encBrainRoot ?? null,
    },
    null,
    2,
  ));
  if (!rec || !rec.canonicalBaseRoot) {
    console.error("[backfill-fuse] FAILED: brainByAgentId still resolves no canonicalBaseRoot. Aborting non-zero.");
    process.exit(1);
  }
  console.log(`[backfill-fuse] DONE. brainByAgentId(${childAgentId}).canonicalBaseRoot resolves -> the portrait endpoint will now serve real bytes.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[backfill-fuse] fatal:", e);
  process.exit(1);
});
