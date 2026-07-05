// AURA game layer - UNIT/INTEGRATION test: the FUSE pipeline (genome -> prompt -> gen -> seal -> mint payload)
// + memory INHERIT-L1 / RESET-L2, with the 0G/TEE gen + 0G store MOCKED at the boundary (the locked test
// strategy: live 0G calls are impractical in a unit test, so mock the seam + assert the ORCHESTRATION).
//
// LOCAL ONLY (no network). Proves: (1) the child identity commits its on-chain genome via keccak(JCS), (2) the
// blended style is a VISIBLE mix of both parents, (3) the child mint payload is well-formed + per-owner sealed
// to the fuser, (4) memory inherits a BLEND of both parents' L1 and resets L2 to empty.
import { ethers } from "ethers";
import { createHash } from "node:crypto";
import { recoverSiwePubkey } from "../aura/pubkey.js";
import { openSealedKey, sealedFromHex } from "../aura/sealing.js";
import { MemoryBackend } from "../aura/memory/local-store.js";
import { MemoryService, readLayer } from "../aura/memory/core.js";
import type { IntrinsicRecord, StyleVec } from "../aura/memory/types.js";
import type { GenProof } from "../aura/generate.js";
import { deriveChildGenome, fuseSeed, type Genome } from "../aura/game/fuse-genome.js";
import { genomeToStyleVec, blendedStyleDescriptor, genomeToStyle, STYLE_POOLS } from "../aura/game/genome-style.js";
import { buildChildIdentity, executeFusionPipeline, type FusePipelineDeps } from "../aura/game/fuse.js";
import { fuseChildMemory, readIntrinsicViaEscrow, blendIntrinsic, assertFusionMemoryShape } from "../aura/game/fuse-memory.js";

let pass = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error("  \x1b[31mFAIL:\x1b[0m", m);
    process.exit(1);
  }
  pass++;
  console.log("  \x1b[32mPASS:\x1b[0m", m);
};

async function pubkeyOf(w: ethers.HDNodeWallet): Promise<string> {
  return recoverSiwePubkey(`login:${w.address}`, (await w.signMessage(`login:${w.address}`)) as `0x${string}`);
}

// the same on-chain FuseGenome vectors (fuse-genome.t.sol): parents A/B, reqId 42 => child [0,1,5,6,3,2,1,0].
const A_FP = "0x55f2e8c197e23f8f78cae12e4a70266a0821937425eb388dbae7cc60e0658b8b";
const B_FP = "0x3c7f28f3ee12859ba72d458f6caf7ced48b5433da6903fcb34a002c6b33fab8c";
const BH = "0x" + "c3".repeat(32);
const GENOME_A: Genome = [0, 1, 2, 3, 4, 5, 6, 0];
const GENOME_B: Genome = [9, 7, 5, 6, 3, 2, 1, 4];
const EXPECT_CHILD: Genome = [0, 1, 5, 6, 3, 2, 1, 0];
const FUSER_FOR_SEED = "0x0000000000000000000000000000000000000042";

function mockGen(imageRoot: string): FusePipelineDeps["generate"] {
  return (async (input) => {
    // assert the fusion path supplied its own base+prompt (override), not the brain resolver.
    if (!input.overrideConfig) throw new Error("mockGen: expected overrideConfig (fusion path)");
    const g: GenProof = {
      imageRoot,
      provenanceHash: ethers.keccak256(ethers.toUtf8Bytes("prov")),
      teeAttestation: ethers.keccak256(ethers.toUtf8Bytes("tee")),
      seed: 123456789012345678901234567890n,
      model: "qwen/qwen-image-edit-2511",
      teeSigner: "0x2A94D671f1A5e080f75A8164087Cdd35c8442e69",
      verified: true,
      verifiability: "TeeML",
      chatId: "chat-1",
      latencyMs: 42,
      bytes: input.overrideConfig.baseBytes,
      prompt: input.overrideConfig.prompt,
      usedBrain: false,
      provenanceRecord: {},
      teeText: null,
      teeSig: null,
      dataHash: null,
      teeSignerVerified: null,
    };
    return g;
  }) as FusePipelineDeps["generate"];
}

async function main() {
  console.log("\n=== AURA fuse pipeline - identity + memory inherit/reset + mint payload (gen mocked) ===\n");
  const backend = new MemoryBackend();
  const fuser = ethers.Wallet.createRandom();
  const fuserPub = await pubkeyOf(fuser);
  const stranger = ethers.Wallet.createRandom();

  // ── A. child identity (PURE): fingerprint commits the on-chain genome ──
  const childGenome = deriveChildGenome(GENOME_A, GENOME_B, fuseSeed({ requestId: 42, fuser: FUSER_FOR_SEED, aFingerprint: A_FP, bFingerprint: B_FP, blockHash: BH }));
  ok(childGenome.join(",") === EXPECT_CHILD.join(","), "pipeline child genome == on-chain vector [0,1,5,6,3,2,1,0]");
  const idA = buildChildIdentity({ childName: "HYBRID", childGenome, generation: 2, parentA: 1, parentB: 2, refImageRoot: "0xportrait" });
  const idA2 = buildChildIdentity({ childName: "HYBRID", childGenome, generation: 2, parentA: 1, parentB: 2, refImageRoot: "0xportrait" });
  ok(idA.styleFingerprint === idA2.styleFingerprint, "buildChildIdentity is deterministic (same inputs => same fingerprint)");
  const idMut = buildChildIdentity({ childName: "HYBRID", childGenome: [1, 1, 5, 6, 3, 2, 1, 0], generation: 2, parentA: 1, parentB: 2, refImageRoot: "0xportrait" });
  ok(idA.styleFingerprint !== idMut.styleFingerprint, "styleFingerprint COMMITS the genome (a changed allele => different fingerprint => rig-evident)");
  ok((idA.publicStyle as any).fusion.genome.join(",") === childGenome.join(","), "publicStyle embeds the on-chain genome (anchored, recomputable)");
  ok((idA.publicStyle as any).fusion.parents.join(",") === "1,2" && (idA.publicStyle as any).fusion.generation === 2, "publicStyle embeds lineage (parents + generation)");

  // ── B. VISIBLE blend: the child's style mixes both parents' genome-derived traits ──
  const picks = genomeToStyle(childGenome);
  const desc = blendedStyleDescriptor(childGenome);
  ok(desc.length > 40 && desc.includes(picks.palette) && desc.includes(picks.light), "blended descriptor is a coherent style sentence built from the genome picks");
  // parent A's palette allele (0) is inherited by the child (locus 0 = 0), so the child's palette == A's palette word.
  ok(picks.palette === STYLE_POOLS.palette[GENOME_A[0]!], "child inherited parent A's palette locus (visible trait inheritance)");
  const styleVec: StyleVec = genomeToStyleVec(childGenome);
  ok(styleVec.descriptor === desc, "genomeToStyleVec.descriptor == blendedStyleDescriptor");

  // ── C. memory INHERIT-L1 / RESET-L2 blend ──
  const pa = ethers.Wallet.createRandom();
  const pb = ethers.Wallet.createRandom();
  const paPub = await pubkeyOf(pa);
  const pbPub = await pubkeyOf(pb);
  const paSvc = MemoryService.create({ agentId: "PARENT-A", ownerAddr: pa.address, ownerPubkey: paPub, backend });
  const pbSvc = MemoryService.create({ agentId: "PARENT-B", ownerAddr: pb.address, ownerPubkey: pbPub, backend });
  const STYLE_A: StyleVec = { descriptor: "risograph duotone", identityLock: "same", negative: "no 3d", basePolicy: "ref" };
  const STYLE_B: StyleVec = { descriptor: "charcoal chiaroscuro", identityLock: "same", negative: "no 3d", basePolicy: "ref" };
  await paSvc.service.appendIntrinsic([
    { kind: "style_delta", before: STYLE_A, after: STYLE_A, note: "A style", ts: "d1" },
    { kind: "skill", tag: "risograph", proficiency: 0.8, ts: "d1" },
    { kind: "taste", descriptor: "leans warm and playful", ts: "d1" },
  ]);
  await pbSvc.service.appendIntrinsic([
    { kind: "skill", tag: "chiaroscuro", proficiency: 0.7, ts: "d1" },
    { kind: "skill", tag: "risograph", proficiency: 0.6, ts: "d1" }, // shared tag -> should MERGE/average
    { kind: "taste", descriptor: "leans architectural and stark", ts: "d1" },
  ]);
  // ALSO put a RELATIONSHIP (L2) record on parent A - it must NOT cross into the child (owner-specific).
  await paSvc.service.appendRelationship([{ kind: "chat", turns: [{ role: "owner", text: "hi from A's owner" }], ts: "2026-07-05T00:00:00Z" }], paSvc.ownerL2Key);

  const pAL1 = await readIntrinsicViaEscrow(paSvc.service, backend);
  const pBL1 = await readIntrinsicViaEscrow(pbSvc.service, backend);
  ok(pAL1.length === 3 && pBL1.length === 3, "server reads both parents' L1 via escrow (owner-agnostic)");

  const mem = await fuseChildMemory({ childAgentId: "CHILD-1", fuserAddr: fuser.address, fuserPubkey: fuserPub, parentAL1: pAL1, parentBL1: pBL1, childStyle: styleVec, ts: "2026-07-05", backend });
  ok(assertFusionMemoryShape(mem.service).ok, "child memory has the FUSION shape (L1 inherited, L2 reset)");
  ok(mem.service.manifest.relationship.segments.length === 0, "child L2 is EMPTY (relationship reset - no inherited owner bond)");

  // the fuser reads the child's inherited L1 (sealed to the fuser).
  const childL1 = (await readLayer(mem.service.manifest, "intrinsic", fuser.privateKey, backend)) as IntrinsicRecord[];
  const skills = childL1.filter((r) => r.kind === "skill") as Extract<IntrinsicRecord, { kind: "skill" }>[];
  const tastes = childL1.filter((r) => r.kind === "taste") as Extract<IntrinsicRecord, { kind: "taste" }>[];
  const styleDeltas = childL1.filter((r) => r.kind === "style_delta") as Extract<IntrinsicRecord, { kind: "style_delta" }>[];
  ok(childL1.length >= 4, `child inherited a BLEND of both parents' L1 (${childL1.length} records)`);
  ok(styleDeltas.some((s) => s.after.descriptor === styleVec.descriptor), "child L1 has the founding fused style_delta (genome-derived blended style)");
  ok(skills.some((s) => s.tag === "chiaroscuro") && skills.some((s) => s.tag === "risograph"), "child inherited skills from BOTH parents (chiaroscuro from B, risograph from A)");
  const riso = skills.find((s) => s.tag === "risograph")!;
  ok(Math.abs(riso.proficiency - 0.7) < 1e-9, "shared skill 'risograph' MERGED by averaging (0.8 & 0.6 -> 0.7)");
  ok(tastes.some((t) => t.descriptor.includes("warm")) && tastes.some((t) => t.descriptor.includes("architectural")), "child inherited tastes from BOTH parents");

  // the child's L2 is empty for the fuser too; a stranger reads NOTHING from the child's L1 (per-owner seal).
  ok((await readLayer(mem.service.manifest, "relationship", fuser.privateKey, backend)).length === 0, "fuser reads ZERO child L2 records (clean bond)");
  ok((await readLayer(mem.service.manifest, "intrinsic", stranger.privateKey, backend)).length === 0, "a stranger reads ZERO child L1 records (sealed to the fuser)");

  // blendIntrinsic is pure + always emits at least the founding style_delta (never an empty batch).
  ok(blendIntrinsic([], [], styleVec, "d").length === 1, "blendIntrinsic of two empty parents still yields the founding style_delta (never empty)");

  // ── D. full pipeline with mocked gen/store: the child mint payload ──
  const portraitRoot = "0xportraitrootdeadbeef";
  const deps: Partial<FusePipelineDeps> = {
    async getRequest() {
      return { fuser: fuser.address, parentA: 1n, parentB: 2n, targetBlock: 100n, fee: 0n, executed: false, refunded: false };
    },
    async getLineage(agentId) {
      return agentId === 1n
        ? { genome: GENOME_A, styleFingerprint: A_FP, generation: 1 }
        : { genome: GENOME_B, styleFingerprint: B_FP, generation: 1 };
    },
    async getFuseSeed() {
      // NOTE: on-chain fuseSeed binds the REAL fuser address; here the pipeline's fuser is the random wallet,
      // so we return the seed for THAT fuser (the pipeline derives the child from whatever seed the chain gives).
      return fuseSeed({ requestId: 42, fuser: fuser.address, aFingerprint: A_FP, bFingerprint: B_FP, blockHash: BH });
    },
    async getParentReference() {
      return Buffer.from("x".repeat(256)); // a fake >=100-byte reference base
    },
    getFuserPubkey() {
      return fuserPub;
    },
    generate: mockGen(portraitRoot),
    async store(bytes) {
      return { rootHash: "0x" + createHash("sha256").update(bytes).digest("hex") };
    },
    getParentL1: async (pid) => (pid === 1n ? pAL1 : pBL1),
    memoryBackend: backend,
    now: () => new Date("2026-07-05T00:00:00Z"),
  };
  const res = await executeFusionPipeline(42, { childName: "HYBRID", royaltyBps: 700, creatorResaleBps: 1000, deps });

  const seedForFuser = fuseSeed({ requestId: 42, fuser: fuser.address, aFingerprint: A_FP, bFingerprint: B_FP, blockHash: BH });
  const expectChildForFuser = deriveChildGenome(GENOME_A, GENOME_B, seedForFuser);
  ok(res.childGenome.join(",") === expectChildForFuser.join(","), "pipeline derives the child genome from the on-chain fuse seed");
  ok(res.generation === 2, "child generation = max(parentGen)+1 = 2");
  const call = res.executeArgs.call;
  ok(call.fn === "executeFusion" && call.requestId === 42, "executeArgs is an executeFusion call for the request");
  ok(/^0x[0-9a-f]{64}$/i.test(call.childStyleFingerprint), "childStyleFingerprint is a bytes32");
  // recompute the fingerprint independently from the portrait root + genome (the keyless recompute boundary).
  const idRecompute = buildChildIdentity({ childName: "HYBRID", childGenome: res.childGenome, generation: 2, parentA: 1, parentB: 2, refImageRoot: portraitRoot });
  ok(call.childStyleFingerprint === idRecompute.styleFingerprint, "childStyleFingerprint recomputes from (genome + portrait root + lineage) - keyless verifiable");
  ok(/^0x[0-9a-f]{64}$/i.test(call.childDataHash), "childDataHash is a sha256 bytes32");
  ok(call.childEncBrainRoot.startsWith("0x"), "childEncBrainRoot is a 0G content root");
  ok(call.royaltyBps === 700 && call.creatorResaleBps === 1000, "royalty/creatorResale flow through (clamped <= 2000)");
  ok(call.childSealedKey !== "0x" && call.childSealedKey.length > 10, "childSealedKey is a real per-owner ECIES seal (not empty)");
  // the seal opens with the FUSER's key (per-owner sealing) and NOT with a stranger's.
  const opened = openSealedKey(fuser.privateKey, sealedFromHex(call.childSealedKey));
  ok(opened.length === 32, "the childSealedKey opens with the FUSER's key -> a real 32-byte AES data key (per-owner seal)");
  let strangerFailed = false;
  try {
    openSealedKey(stranger.privateKey, sealedFromHex(call.childSealedKey));
  } catch {
    strangerFailed = true;
  }
  ok(strangerFailed, "a STRANGER cannot open the childSealedKey (sealed to the fuser only)");
  ok(res.portrait.imageRoot === portraitRoot && res.portrait.teeVerified === true, "child portrait was generated through the TEE-attested path (verified=true)");
  ok(res.memory?.l2Reset === true && (res.memory?.inheritedL1Count ?? 0) >= 1, "pipeline memory verdict: L2 reset + L1 inherited");
  // the prompt must carry THIS child's genome-blended style (derived from res.childGenome, which is bound to
  // the real fuser's seed - NOT the fixed-vector `picks` above, which used a different fuser).
  const resPicks = genomeToStyle(res.childGenome);
  ok(res.portrait.prompt.includes(resPicks.palette) && res.portrait.prompt.includes(resPicks.light), "the gen prompt carried the genome-blended style (visible blend into the render)");

  console.log(`\n=== fuse pipeline: ${pass}/${pass} assertions PASS ===\n`);
}

main().catch((e) => {
  console.error("\nfuse pipeline TEST ERROR:", e);
  process.exit(1);
});
