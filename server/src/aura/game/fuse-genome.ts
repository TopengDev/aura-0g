// SERVER-ONLY, PURE + dependency-light (only ethers for keccak/abi). The bit-exact TS mirror of the on-chain
// FuseGenome.sol library: the un-grindable per-fusion seed + the Mendelian 8-locus child-genome derivation. It
// is byte-identical to the Solidity (same domain tags, same abi.encode layout, same modulo picks), so the
// server derives the SAME child genome the contract will, and a third party recomputes it from public inputs
// alone (parents' on-chain genomes + fingerprints + the committed future blockhash). This is the FUSION analog
// of the shipped gacha.ts recompute (proven 600-fusion cross-lib determinism, 5/5 forge in the pf-smoke).
//
// HONEST BOUNDARY (identical to gacha/create-agent): the GENOME derivation is on-chain-exact (this module ==
// FuseGenome.sol); the child styleFingerprint = keccak(JCS(publicStyle)) stays an OFF-CHAIN step (RFC-8785
// canonicalization is impractical in Solidity), exactly like create-agent.ts. The heritable DNA that must be
// un-riggable IS the genome, and it is fully recomputable here.
import { ethers } from "ethers";

const abi = ethers.AbiCoder.defaultAbiCoder();

export const N_LOCI = 8;
/** 5% per-locus provable mutation (gacha rarity-roll pattern: roll % 10000 < 500). Mirrors MUTATION_BPS. */
export const MUTATION_BPS = 500n;

// Domain-separation tags (FUSION namespace) - keccak of the STATIC labels the Solidity library pins. Versioned:
// never edit a tag string or reorder a pool without bumping the version (it changes every recompute).
export const DOMAIN_FUSE = ethers.keccak256(ethers.toUtf8Bytes("AURA-FUSE-v1"));
export const TAG_INHERIT = ethers.keccak256(ethers.toUtf8Bytes("AURA-FUSE-inherit-v1"));
export const TAG_MUTATE = ethers.keccak256(ethers.toUtf8Bytes("AURA-FUSE-mutate-v1"));
export const TAG_ALLELE = ethers.keccak256(ethers.toUtf8Bytes("AURA-FUSE-allele-v1"));
// GENESIS backfill (server-side, NOT in FuseGenome.sol): the deterministic genome an EXISTING agent registers
// to become fusable, derived from its public styleFingerprint so anyone recomputes it (see genesisGenome).
export const TAG_GENESIS = ethers.keccak256(ethers.toUtf8Bytes("AURA-FUSE-genesis-v1"));

/**
 * The canonical 8-locus pool sizes: palette(12), linework(8), texture(8), renderingModel(8), motifVocab(10),
 * compositionBias(8), lightBehavior(8), finish(6). Byte-identical to FuseGenome.poolSizes(). The allele index
 * at each locus is taken modulo the pool size.
 */
export function poolSizes(): number[] {
  return [12, 8, 8, 8, 10, 8, 8, 6];
}

export type Genome = number[]; // length N_LOCI, allele index per locus (0 <= genome[i] < poolSizes()[i])

/** uint256 keccak of a bytes32 seed as a 0x32-byte hex (the form the Solidity library hashes over). */
function b32(seed: string): string {
  return ethers.zeroPadValue(seed, 32);
}

/**
 * The un-grindable per-fusion seed. keccak256(abi.encode(DOMAIN_FUSE, requestId, fuser, aFp, bFp, blockHash)).
 * Byte-identical to FuseGenome.fuseSeed. Binds the fuser + BOTH parent fingerprints + a FUTURE blockhash, so
 * the child is a deterministic SURPRISE fixed only after the target block is mined.
 */
export function fuseSeed(args: {
  requestId: bigint | number;
  fuser: string;
  aFingerprint: string;
  bFingerprint: string;
  blockHash: string;
}): string {
  return ethers.keccak256(
    abi.encode(
      ["bytes32", "uint256", "address", "bytes32", "bytes32", "bytes32"],
      [DOMAIN_FUSE, BigInt(args.requestId), ethers.getAddress(args.fuser), args.aFingerprint, args.bFingerprint, args.blockHash],
    ),
  );
}

/** The per-locus roll primitive: uint256(keccak256(abi.encode(seed, tag, i))). VERBATIM the gacha pick. */
function roll(seed: string, tag: string, i: number): bigint {
  return BigInt(ethers.keccak256(abi.encode(["bytes32", "bytes32", "uint256"], [seed, tag, BigInt(i)])));
}

/**
 * Mendelian 2-parent inheritance + provable 5% mutation. Byte-identical to FuseGenome.deriveChildGenome. Each
 * locus: 50/50 which parent (TAG_INHERIT), then a 5% mutation roll (TAG_MUTATE) that on a hit replaces the
 * allele with a fresh in-pool pick (TAG_ALLELE). A juror recomputes the child from public inputs; any tampered
 * allele fails the recompute.
 */
export function deriveChildGenome(genomeA: Genome, genomeB: Genome, seed: string): Genome {
  if (genomeA.length !== N_LOCI || genomeB.length !== N_LOCI) {
    throw new Error(`deriveChildGenome: both genomes must be length ${N_LOCI}`);
  }
  const pools = poolSizes();
  const child: Genome = new Array(N_LOCI);
  for (let i = 0; i < N_LOCI; i++) {
    const parentBit = roll(seed, TAG_INHERIT, i) % 2n; // 50/50 which parent
    const inherited = parentBit === 0n ? genomeA[i]! : genomeB[i]!;
    const mutRoll = roll(seed, TAG_MUTATE, i) % 10000n; // gacha rarity-roll pattern
    if (mutRoll < MUTATION_BPS) {
      child[i] = Number(roll(seed, TAG_ALLELE, i) % BigInt(pools[i]!)); // gacha subject-pick, VERBATIM
    } else {
      child[i] = inherited;
    }
  }
  return child;
}

/**
 * GENESIS backfill: derive an EXISTING agent's 8-locus genome deterministically from its on-chain
 * styleFingerprint so it becomes fusable (registerGenesis). The derivation is a domain-separated per-locus
 * keccak of the PUBLIC fingerprint, so a third party recomputes the exact genome an agent registered and any
 * hand-picked genome is caught. Always in-range (< pool size), so AuraFusion.registerGenesis accepts it.
 *
 * NOTE: registerGenesis on-chain accepts a caller-supplied genome (validated only in-range) - the agent OWNER
 * submits this. Making that genome a CANONICAL function of the fingerprint (not a free choice) keeps genesis
 * agents on the same "recompute it yourself" footing as fused children.
 */
export function genesisGenome(styleFingerprint: string): Genome {
  const pools = poolSizes();
  const g: Genome = new Array(N_LOCI);
  for (let i = 0; i < N_LOCI; i++) {
    const h = BigInt(ethers.keccak256(abi.encode(["bytes32", "bytes32", "uint256"], [b32(styleFingerprint), TAG_GENESIS, BigInt(i)])));
    g[i] = Number(h % BigInt(pools[i]!));
  }
  return g;
}

/** Validate a genome is well-formed + in-range (the same check AuraFusion.registerGenesis enforces on-chain). */
export function isValidGenome(g: Genome): boolean {
  if (!Array.isArray(g) || g.length !== N_LOCI) return false;
  const pools = poolSizes();
  for (let i = 0; i < N_LOCI; i++) {
    const v = g[i];
    if (!Number.isInteger(v) || v! < 0 || v! >= pools[i]!) return false;
  }
  return true;
}
