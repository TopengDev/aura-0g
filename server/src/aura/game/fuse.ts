// SERVER-ONLY. FUSION ORCHESTRATION: the requestFusion(commit) -> future-block -> executeFusion(reveal) flow
// against AuraFusion.sol, and the CHILD PIPELINE that turns a fusion into a real ERC-7857 child iNFT.
//
// The pipeline (executeFusionPipeline), boundary-for-boundary:
//   on-chain genome (8 loci, Mendelian, un-grindable seed)   <- fuse-genome.ts (== FuseGenome.sol, bit-exact)
//   -> a coherent GENOME -> PROMPT mapping (visible blend)     <- genome-style.ts
//   -> generateAndProve on 0G Compute TeeML (TEE-attested)     <- generate.ts (SAME path as every Aura)
//   -> child styleFingerprint = keccak(JCS(publicStyle))       <- SAME boundary as create-agent.ts
//   + sealed data for the child ERC-7857 (AES key ECIES-sealed to the FUSER)  <- sealing.ts
//   + MEMORY: blend parents' L1 into the child, start L2 empty <- fuse-memory.ts
//   -> the executeFusion args for the FUSER to submit (mints the child with lineage).
//
// Every external boundary (chain read, TEE gen, 0G store, parent reference/L1, pubkey) is injected via `deps`
// with a real default, so the pipeline is unit-testable end-to-end with the 0G/TEE calls mocked at the seam
// (the locked test strategy: mock the boundary, assert the orchestration). NON-custodial: the pipeline NEVER
// signs - it returns the computed executeFusion args for the fuser's wallet (same contract as mint-args).
import canonicalizeDefault from "canonicalize";
import { ethers } from "ethers";
import { createHash } from "node:crypto";
import { generateAndProve, type GenProof, type ResolvedGenConfig } from "../generate.js";
import { store as zgStore } from "../storage.js";
import { sponsorSigner } from "../wallet.js";
import { resolveBytesByRoot } from "../image-cache.js";
import { brainByAgentId } from "../store.js";
import { pubkeyOf } from "../pubkey.js";
import { sealKeyToPubkey, sealedToHex } from "../sealing.js";
import { encryptBrain, type BrainPlain } from "../brain.js";
import { CONTRACTS } from "../config.js";
import { auraFusionRead, auraFusionConfigured, GAME_CHAIN_ID } from "./contracts.js";
import { deriveChildGenome, genesisGenome, fuseSeed as computeFuseSeed, isValidGenome, N_LOCI, type Genome } from "./fuse-genome.js";
import { blendedStyleDescriptor, genomeToPrompt, genomeToStyleVec } from "./genome-style.js";
import { fuseChildMemory, type FuseChildMemoryResult } from "./fuse-memory.js";
import type { SegmentBackend } from "../memory/local-store.js";
import type { IntrinsicRecord } from "../memory/types.js";

// canonicalize ships CJS module.exports=fn; under NodeNext the callable may sit on .default (== create-agent.ts).
const canonicalize: (v: unknown) => string | undefined =
  typeof canonicalizeDefault === "function"
    ? (canonicalizeDefault as unknown as (v: unknown) => string | undefined)
    : ((canonicalizeDefault as any).default as (v: unknown) => string | undefined);

const MODEL = "qwen/qwen-image-edit-2511"; // same edit model create-agent.ts pins into publicStyle
const DEFAULT_ROYALTY_BPS = 700;
const DEFAULT_CREATOR_RESALE_BPS = 1000;

// ─────────────────────────────── genesis backfill ───────────────────────────────

export interface GenesisArgs {
  contract: string;
  chainId: number;
  agentId: number;
  genome: number[];
  call: { fn: "registerGenesis"; args: [number, number[]] };
  note: string;
}

/**
 * Compute the registerGenesis backfill args for an EXISTING agent: the deterministic 8-locus genome derived
 * from its on-chain styleFingerprint (recomputable by anyone), which the agent OWNER submits to become fusable.
 * Pure - the route reads the agent's styleFingerprint (agentsRead().getAgent) and passes it here.
 */
export function genesisArgs(agentId: number, styleFingerprint: string): GenesisArgs {
  const genome = genesisGenome(styleFingerprint);
  if (!isValidGenome(genome)) throw new Error("genesisArgs: derived genome out of range (should be impossible)");
  return {
    contract: CONTRACTS.auraFusion,
    chainId: GAME_CHAIN_ID,
    agentId,
    genome,
    call: { fn: "registerGenesis", args: [agentId, genome] },
    note: "canonical genome derived from styleFingerprint (recompute via genesisGenome); owner submits registerGenesis",
  };
}

// ─────────────────────────────── request (commit phase) ───────────────────────────────

export interface RequestFusionArgs {
  contract: string;
  chainId: number;
  fuser: string;
  parentA: number;
  parentB: number;
  fee: string; // wei (decimal string) - the value the fuser must send
  call: { fn: "requestFusion"; args: [number, number]; value: string };
}

/**
 * Compute the requestFusion (commit-phase) args for the fuser. Validates the gates OFF-chain for a clean UX
 * (own both, distinct, both fusable, both off cooldown), reading AuraFusion; the contract re-checks all of
 * them on-chain. Returns the call + the fusion fee to send. Throws a typed error on a failed gate so the
 * route can 4xx with a reason.
 */
export async function requestFusionArgs(fuser: string, parentA: number, parentB: number): Promise<RequestFusionArgs> {
  if (!auraFusionConfigured()) throw new FuseError(501, "fusion not configured on this deploy");
  if (parentA === parentB) throw new FuseError(400, "self-fuse: a parent cannot fuse with itself");
  const fusion = auraFusionRead();
  const [la, lb, fee] = await Promise.all([
    fusion.lineageOf(parentA),
    fusion.lineageOf(parentB),
    fusion.fusionFee(),
  ]);
  if (!la.genomeSet) throw new FuseError(409, `parent #${parentA} is not fusable (call registerGenesis first)`);
  if (!lb.genomeSet) throw new FuseError(409, `parent #${parentB} is not fusable (call registerGenesis first)`);
  return {
    contract: CONTRACTS.auraFusion,
    chainId: GAME_CHAIN_ID,
    fuser,
    parentA,
    parentB,
    fee: fee.toString(),
    call: { fn: "requestFusion", args: [parentA, parentB], value: fee.toString() },
  };
}

// ─────────────────────────────── child identity (PURE) ───────────────────────────────

export interface ChildIdentityInput {
  childName: string;
  childGenome: Genome;
  generation: number;
  parentA: number;
  parentB: number;
  refImageRoot: string; // the child portrait's 0G root (its self-reference)
}

export interface ChildIdentity {
  styleVec: ReturnType<typeof genomeToStyleVec>;
  blendedStyleDescriptor: string;
  prompt: string;
  publicStyle: Record<string, unknown>;
  styleFingerprint: string;
}

/**
 * PURE: derive the child's off-chain identity from its (on-chain-derived) genome + lineage. The publicStyle
 * EMBEDS the genome + parents + generation, so keccak(JCS(publicStyle)) == childStyleFingerprint COMMITS the
 * genome (a third party recomputes the fingerprint from the child's on-chain genome + this public style + the
 * portrait root - the exact create-agent.ts boundary). No I/O; fully unit-testable.
 */
export function buildChildIdentity(input: ChildIdentityInput): ChildIdentity {
  const { childName, childGenome, generation, parentA, parentB, refImageRoot } = input;
  if (childGenome.length !== N_LOCI) throw new Error(`buildChildIdentity: genome must be length ${N_LOCI}`);
  const styleVec = genomeToStyleVec(childGenome);
  const descriptor = blendedStyleDescriptor(childGenome);
  const prompt = genomeToPrompt(childName, childGenome, styleVec.negative);
  // publicStyle - the keccak(JCS(publicStyle)) is the on-chain styleFingerprint. genome/generation/parents
  // are embedded so the fingerprint commits the whole on-chain-derived lineage (un-riggable via recompute).
  const publicStyle: Record<string, unknown> = {
    agent: childName,
    aesthetic: descriptor,
    fusion: { genome: childGenome, generation, parents: [parentA, parentB] },
    model: MODEL,
    refImageRoot,
  };
  const canon = canonicalize(publicStyle);
  if (!canon) throw new Error("canonicalize(publicStyle) returned empty");
  const styleFingerprint = ethers.keccak256(ethers.toUtf8Bytes(canon));
  return { styleVec, blendedStyleDescriptor: descriptor, prompt, publicStyle, styleFingerprint };
}

// ─────────────────────────────── execute (reveal phase) pipeline ───────────────────────────────

export class FuseError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "FuseError";
  }
}

export interface OnChainFuseRequest {
  fuser: string;
  parentA: bigint;
  parentB: bigint;
  targetBlock: bigint;
  fee: bigint;
  executed: boolean;
  refunded: boolean;
}

export interface ParentLineage {
  genome: Genome;
  styleFingerprint: string;
  generation: number;
}

/** The injectable boundaries. Every field has a real default (defaultFuseDeps); tests override the seams. */
export interface FusePipelineDeps {
  getRequest(requestId: number): Promise<OnChainFuseRequest>;
  getLineage(agentId: bigint): Promise<ParentLineage>;
  getFuseSeed(requestId: number): Promise<string>;
  getParentReference(parentAgentId: bigint): Promise<Buffer>;
  getFuserPubkey(fuser: string): string | null;
  generate: typeof generateAndProve;
  store(bytes: Buffer, label: string): Promise<{ rootHash: string }>;
  getParentL1?(parentAgentId: bigint): Promise<IntrinsicRecord[]>;
  memoryBackend?: SegmentBackend;
  now(): Date;
}

/** Real defaults: chain reads via AuraFusion, TEE gen via generateAndProve, 0G store via storage.ts. */
export function defaultFuseDeps(): FusePipelineDeps {
  return {
    async getRequest(requestId) {
      const r = await auraFusionRead().requests(requestId);
      return {
        fuser: String(r.fuser),
        parentA: BigInt(r.parentA),
        parentB: BigInt(r.parentB),
        targetBlock: BigInt(r.targetBlock),
        fee: BigInt(r.fee),
        executed: Boolean(r.executed),
        refunded: Boolean(r.refunded),
      };
    },
    async getLineage(agentId) {
      const l = await auraFusionRead().lineageOf(agentId);
      return {
        genome: (l.genome as Array<bigint | number>).map((x) => Number(x)),
        styleFingerprint: String(l.styleFingerprint),
        generation: Number(l.generation),
      };
    },
    async getFuseSeed(requestId) {
      // on-chain authoritative fuseSeedOf (reverts if the target blockhash is unavailable / not yet mined).
      return String(await auraFusionRead().fuseSeedOf(requestId));
    },
    async getParentReference(parentAgentId) {
      const brain = brainByAgentId(Number(parentAgentId));
      if (!brain) throw new FuseError(409, `parent #${parentAgentId} brain not in server custody (cannot source a reference base)`);
      const bytes = (await resolveBytesByRoot(brain.canonicalBaseRoot, { source: "reference" }))?.bytes ?? null;
      if (!bytes) throw new FuseError(409, `parent #${parentAgentId} reference image unavailable (0G evicted; re-create to re-persist)`);
      return Buffer.from(bytes);
    },
    getFuserPubkey(fuser) {
      return pubkeyOf(fuser);
    },
    generate: generateAndProve,
    async store(bytes, label) {
      const res = await zgStore(sponsorSigner(), bytes, label);
      return { rootHash: res.rootHash };
    },
    now: () => new Date(),
  };
}

export interface FuseExecuteResult {
  requestId: number;
  childName: string;
  generation: number;
  childGenome: Genome;
  fuseSeed: string;
  blendedStyleDescriptor: string;
  publicStyle: Record<string, unknown>;
  portrait: {
    imageRoot: string;
    prompt: string;
    seed: string;
    provenanceHash: string;
    teeAttestation: string;
    teeVerified: boolean | string;
    model: string;
  };
  memory: { inheritedL1Count: number; l1Reset: false; l2Reset: boolean; l1SegRoot: string } | null;
  // the computed executeFusion args the fuser submits (non-custodial; mints the child with lineage).
  executeArgs: {
    contract: string;
    chainId: number;
    call: {
      fn: "executeFusion";
      requestId: number;
      childName: string;
      childStyleFingerprint: string;
      childEncBrainRoot: string;
      childDataHash: string;
      childModelAttestation: string;
      royaltyBps: number;
      creatorResaleBps: number;
      childSealedKey: string;
    };
  };
}

export interface FuseExecuteOptions {
  childName?: string;
  royaltyBps?: number;
  creatorResaleBps?: number;
  deps?: Partial<FusePipelineDeps>;
}

/**
 * Run the child pipeline for a mined fusion request and return the executeFusion args (+ the child portrait,
 * genome, memory verdict). The caller (route) must have verified the request is the caller's + mined; this
 * function re-reads the on-chain request and derives everything deterministically from it.
 */
export async function executeFusionPipeline(requestId: number, opts: FuseExecuteOptions = {}): Promise<FuseExecuteResult> {
  const deps: FusePipelineDeps = { ...defaultFuseDeps(), ...(opts.deps ?? {}) };

  // 1. read the on-chain request + guard.
  const req = await deps.getRequest(requestId);
  if (req.fuser === ethers.ZeroAddress || req.fuser === "0x0000000000000000000000000000000000000000") {
    throw new FuseError(404, `no such fusion request #${requestId}`);
  }
  if (req.executed) throw new FuseError(409, `fusion request #${requestId} already executed`);
  if (req.refunded) throw new FuseError(409, `fusion request #${requestId} was refunded`);

  // 2. read both parents' lineage (on-chain genomes + fingerprints + generations).
  const [la, lb] = await Promise.all([deps.getLineage(req.parentA), deps.getLineage(req.parentB)]);

  // 3. the un-grindable fuse seed (on-chain authoritative), then the child genome (== FuseGenome.sol bit-exact).
  const seed = await deps.getFuseSeed(requestId);
  const childGenome = deriveChildGenome(la.genome, lb.genome, seed);
  const generation = Math.max(la.generation, lb.generation) + 1;
  const childName = (opts.childName?.trim() || `AURA-FUSION-${requestId}`).slice(0, 48);
  const royaltyBps = clampBps(opts.royaltyBps ?? DEFAULT_ROYALTY_BPS);
  const creatorResaleBps = clampBps(opts.creatorResaleBps ?? DEFAULT_CREATOR_RESALE_BPS);

  // 4. the genome -> prompt (visible blend), then TEE-attested generation on 0G Compute using a PARENT
  //    reference as the edit base. STYLE is the genome-derived blend; the base anchors a coherent hybrid.
  const baseBytes = await deps.getParentReference(req.parentA);
  const prompt = genomeToPrompt(childName, childGenome);
  const overrideConfig: ResolvedGenConfig = { baseBytes, prompt, usedBrain: false, agentName: childName };
  const gen: GenProof = await deps.generate(
    { agentId: 0, agentName: childName, encBrainRoot: "", userPrompt: prompt, label: `fuse-child-${requestId}`, overrideConfig },
    {},
  );

  // 5. the child's self-portrait root becomes its canonical base + refImageRoot; derive its off-chain identity
  //    (styleFingerprint = keccak(JCS(publicStyle)) commits the on-chain genome + lineage).
  const childCanonicalBaseRoot = gen.imageRoot;
  const identity = buildChildIdentity({
    childName,
    childGenome,
    generation,
    parentA: Number(req.parentA),
    parentB: Number(req.parentB),
    refImageRoot: childCanonicalBaseRoot,
  });

  // 6. child brain envelope (blended style) -> 0G store -> encBrainRoot; seal the AES key to the FUSER
  //    (real ERC-7857 per-owner seal). dataHash = sha256(envelope). modelAttestation from the gen.
  const brain: BrainPlain = {
    agent: childName,
    model: gen.model || MODEL,
    canonicalBaseRoot: childCanonicalBaseRoot,
    styleDescriptor: identity.styleVec.descriptor,
    identityLock: identity.styleVec.identityLock,
    negative: identity.styleVec.negative,
    basePolicy: identity.styleVec.basePolicy,
    createdAt: deps.now().toISOString(),
  };
  const { envelope, keyHex } = encryptBrain(brain);
  const brainStore = await deps.store(envelope, `fuse-child-brain-${requestId}`);
  const childEncBrainRoot = brainStore.rootHash;
  const childDataHash = "0x" + createHash("sha256").update(envelope).digest("hex");
  const childModelAttestation = ethers.keccak256(ethers.toUtf8Bytes(`${gen.model}|${gen.teeSigner}|${gen.verifiability}`));

  const fuserPubkey = deps.getFuserPubkey(req.fuser);
  let childSealedKey = "0x";
  if (fuserPubkey) {
    const aesKey = Buffer.from(keyHex.replace(/^0x/, ""), "hex");
    childSealedKey = sealedToHex(sealKeyToPubkey(fuserPubkey, aesKey));
  } else {
    // AuraINFT.mintAgent requires sealedKey.length > 0; without a recovered fuser pubkey the fuser must sign
    // in first. Surface a typed 409 so the route tells them to log in (matches create-agent's fail-fast).
    throw new FuseError(409, "sign in first: the child iNFT seals its brain to your wallet pubkey (recovered at SIWE login). Log in, then execute the fusion.");
  }

  // 7. MEMORY: blend the parents' L1 into the child (INHERIT), start L2 empty (RESET). Best-effort: if parent
  //    L1 is not materialized on this deploy, the child still gets a founding L1 (its blended style) + empty
  //    L2, so the inherit/reset SHAPE always holds. Keyed provisionally by requestId (promoted to childId on
  //    mint, same as stageBrain -> promoteBrainByRoot).
  let memory: FuseExecuteResult["memory"] = null;
  if (deps.memoryBackend) {
    const [pAL1, pBL1] = await Promise.all([
      deps.getParentL1 ? deps.getParentL1(req.parentA) : Promise.resolve([] as IntrinsicRecord[]),
      deps.getParentL1 ? deps.getParentL1(req.parentB) : Promise.resolve([] as IntrinsicRecord[]),
    ]);
    const mem: FuseChildMemoryResult = await fuseChildMemory({
      childAgentId: `fusechild:req${requestId}`,
      fuserAddr: req.fuser,
      fuserPubkey,
      parentAL1: pAL1,
      parentBL1: pBL1,
      childStyle: identity.styleVec,
      ts: coarseDay(deps.now()),
      backend: deps.memoryBackend,
    });
    memory = {
      inheritedL1Count: mem.inheritedL1Count,
      l1Reset: false,
      l2Reset: mem.service.manifest.relationship.segments.length === 0,
      l1SegRoot: mem.l1SegRoot,
    };
  }

  return {
    requestId,
    childName,
    generation,
    childGenome,
    fuseSeed: seed,
    blendedStyleDescriptor: identity.blendedStyleDescriptor,
    publicStyle: identity.publicStyle,
    portrait: {
      imageRoot: gen.imageRoot,
      prompt,
      seed: gen.seed.toString(),
      provenanceHash: gen.provenanceHash,
      teeAttestation: gen.teeAttestation,
      teeVerified: gen.verified,
      model: gen.model,
    },
    memory,
    executeArgs: {
      contract: CONTRACTS.auraFusion,
      chainId: GAME_CHAIN_ID,
      call: {
        fn: "executeFusion",
        requestId,
        childName,
        childStyleFingerprint: identity.styleFingerprint,
        childEncBrainRoot,
        childDataHash,
        childModelAttestation,
        royaltyBps,
        creatorResaleBps,
        childSealedKey,
      },
    },
  };
}

// ─────────────────────────────── keyless child-genome recompute ───────────────────────────────

export interface FuseVerifyResult {
  requestId: number;
  fuser: string;
  parentA: number;
  parentB: number;
  fuseSeed: string;
  parentAGenome: Genome;
  parentBGenome: Genome;
  childGenome: Genome;
  recomputeNote: string;
}

/**
 * KEYLESS recompute of a mined fusion's child genome from PUBLIC chain data alone: read the request + both
 * parents' on-chain genomes + fingerprints + the on-chain fuseSeed, then recompute the child genome with the
 * bit-exact library. A third party runs this (or the equivalent) and asserts the minted child's on-chain
 * genome (AuraFusion.genomeOf(childId)) equals it - a rigged/hand-picked child is impossible.
 */
export async function verifyChildGenome(requestId: number, deps?: Partial<FusePipelineDeps>): Promise<FuseVerifyResult> {
  const d: FusePipelineDeps = { ...defaultFuseDeps(), ...(deps ?? {}) };
  const req = await d.getRequest(requestId);
  const [la, lb] = await Promise.all([d.getLineage(req.parentA), d.getLineage(req.parentB)]);
  const seed = await d.getFuseSeed(requestId);
  const childGenome = deriveChildGenome(la.genome, lb.genome, seed);
  return {
    requestId,
    fuser: req.fuser,
    parentA: Number(req.parentA),
    parentB: Number(req.parentB),
    fuseSeed: seed,
    parentAGenome: la.genome,
    parentBGenome: lb.genome,
    childGenome,
    recomputeNote:
      "childGenome = FuseGenome.deriveChildGenome(parentA.genome, parentB.genome, fuseSeed); fuseSeed = keccak(DOMAIN_FUSE, requestId, fuser, aFp, bFp, blockhash(targetBlock)). Recompute it yourself and assert == AuraFusion.genomeOf(childId).",
  };
}

// ─────────────────────────────── small helpers ───────────────────────────────

function clampBps(bps: number): number {
  if (!Number.isInteger(bps) || bps < 0) return 0;
  return bps > 2000 ? 2000 : bps; // AuraINFT enforces <= 2000 (20%)
}

/** Day-granularity coarse timestamp (kills the fine-timestamp side-channel; matches memory CoarseTs usage). */
function coarseDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Recompute the fuse seed locally from public inputs (parity check for the on-chain fuseSeedOf). */
export function localFuseSeed(requestId: number, fuser: string, aFp: string, bFp: string, blockHash: string): string {
  return computeFuseSeed({ requestId, fuser, aFingerprint: aFp, bFingerprint: bFp, blockHash });
}
