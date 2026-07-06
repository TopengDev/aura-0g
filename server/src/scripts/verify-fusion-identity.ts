// SERVER-ONLY live verification of the FUSION-IDENTITY feature (name + uniqueness + blended persona), run
// INSIDE the deployed server container (it has the .env -> mainnet RPC + 0G brokers + the SQLite persona/name
// sources). It performs NO on-chain writes and mints NOTHING: it drives the REAL 0G-TEE derivation seams for a
// chosen parent pair and prints the actual derived NAME + blended PERSONA + the uniqueness proof, so the
// headline claims are shown with real evidence rather than asserted.
//
//   docker exec aura-server node dist/scripts/verify-fusion-identity.js [parentA] [parentB]
//   e.g. the real lineage of child #33:  docker exec aura-server node dist/scripts/verify-fusion-identity.js 32 31
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { getAgentIdentity, isNameTaken, collectTakenNames } from "../aura/agents.js";
import { deriveUniqueChildName } from "../aura/game/fuse.js";
import { deriveFusedPersona, type FuseParentPersona } from "../aura/persona-derive.js";
import { deriveChildGenome, fuseSeed } from "../aura/game/fuse-genome.js";
import { blendedStyleDescriptor } from "../aura/game/genome-style.js";
import { auraFusionRead } from "../aura/game/contracts.js";
import { pickProvider } from "../aura/chat-llm.js";
import { chatComputeHealthy } from "../aura/chat-compute.js";
import { ethers } from "ethers";

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
  const parentA = Number(process.argv[2] ?? 32);
  const parentB = Number(process.argv[3] ?? 31);
  console.log(`\n=== FUSION IDENTITY live verification (parents #${parentA} + #${parentB}, NO mint) ===\n`);

  // 0. which 0G TEE network/model actually serves the derivation (the on-thesis, verifiable path).
  const health = await chatComputeHealthy();
  const prov = await pickProvider();
  console.log(`[0G] chat-compute health: ok=${health.ok} network=${health.network ?? "?"} model=${health.model ?? "?"} reason=${health.reason ?? ""}`);
  console.log(`[0G] provider picked for derivation: ${prov.provider} (${prov.reason})\n`);

  // 1. GLOBAL name uniqueness: existing names collide, a novel coinage does not.
  const taken = await collectTakenNames();
  console.log(`[uniqueness] collected ${taken.size} existing aura names (indexer/chain-scan + catalog).`);
  for (const n of ["RIOT", "NYXARA", "AUREON", "nyxara", "  RiOt  "]) {
    console.log(`[uniqueness] isNameTaken(${JSON.stringify(n)}) = ${await isNameTaken(n)}   (existing -> expect true)`);
  }
  const novel = "ZZZ-" + ethers.hexlify(ethers.randomBytes(4)).slice(2).toUpperCase();
  console.log(`[uniqueness] isNameTaken(${JSON.stringify(novel)}) = ${await isNameTaken(novel)}   (novel -> expect false)\n`);

  // 2. resolve BOTH parents (catalog meta OR stored persona - the exact unified source the pipeline uses).
  const [pa, pb] = await Promise.all([parentIdentity(parentA), parentIdentity(parentB)]);
  console.log(`[parents] A #${parentA} = ${pa.name} :: ${pa.aesthetic.slice(0, 90)}${pa.aesthetic.length > 90 ? "..." : ""}`);
  console.log(`[parents] B #${parentB} = ${pb.name} :: ${pb.aesthetic.slice(0, 90)}${pb.aesthetic.length > 90 ? "..." : ""}\n`);

  // 3. derive a representative child genome from the real parents' on-chain genomes (a synthetic seed, since we
  //    are not minting) -> the blended style descriptor the name + persona are shaped by.
  const [la, lb] = await Promise.all([auraFusionRead().lineageOf(parentA), auraFusionRead().lineageOf(parentB)]);
  const genomeA = Array.from(la.genome as ArrayLike<unknown>).map(Number);
  const genomeB = Array.from(lb.genome as ArrayLike<unknown>).map(Number);
  const seed = fuseSeed({ requestId: Date.now() % 1_000_000, fuser: "0x000000000000000000000000000000000000dEaD", aFingerprint: String(la.styleFingerprint), bFingerprint: String(lb.styleFingerprint), blockHash: ethers.hexlify(ethers.randomBytes(32)) });
  const childGenome = deriveChildGenome(genomeA, genomeB, seed);
  const blended = blendedStyleDescriptor(childGenome);
  console.log(`[genome] child genome = [${childGenome.join(",")}]`);
  console.log(`[genome] blended style = ${blended}\n`);

  // 4. THE HEADLINE: a beautiful, GLOBALLY-UNIQUE 0G-derived name (the real seam the pipeline runs).
  console.log(`[name] deriving via 0G TEE compute (this hits the same GLM/qwen path chat uses)...`);
  const t0 = Date.now();
  const childName = await deriveUniqueChildName({ requestId: 0, parentA: pa, parentB: pb, childGenome, blendedStyleDescriptor: blended });
  console.log(`[name] -> ${JSON.stringify(childName)}  (${Date.now() - t0}ms)`);
  console.log(`[name] is AURA-FUSION-N? ${/^AURA-FUSION-\d+$/.test(childName)}  (expect false)`);
  console.log(`[name] isNameTaken(${JSON.stringify(childName)}) = ${await isNameTaken(childName)}  (expect false -> globally unique)\n`);

  // 5. THE HEADLINE: a RICH persona BLENDED from both parents + the genome (the real seam the pipeline runs).
  console.log(`[persona] deriving blended persona via 0G TEE compute...`);
  const t1 = Date.now();
  const persona = await deriveFusedPersona({ childName, parentA: pa, parentB: pb, blendedStyleDescriptor: blended });
  console.log(`[persona] derived=${!!(persona.personality || persona.lore)}  (${Date.now() - t1}ms)`);
  console.log(JSON.stringify(persona, null, 2));

  console.log(`\n=== RESULT: name="${childName}" | persona.derived=${!!(persona.personality || persona.lore)} | done (no on-chain writes) ===\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[verify-fusion-identity] fatal:", e);
  process.exit(1);
});
