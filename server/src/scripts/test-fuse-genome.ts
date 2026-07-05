// AURA game layer - UNIT test: the TS fuse-genome mirror is BIT-EXACT with the on-chain FuseGenome.sol.
//
// LOCAL ONLY (no network, no keys). Asserts the server's fuse-genome.ts reproduces, byte-for-byte, the SAME
// vectors the Solidity forge suite (contracts/test/FuseGenome.t.sol) asserts on-chain - so the child genome is
// recomputable identically across Solidity, ethers (this module), AND viem. If this passes, a juror recomputes
// any fused child from public inputs and a rigged/hand-picked child is impossible. Mirrors the repo's
// verify-gacha-crosscheck.ts style (a runnable tsx assertion script, no test runner).
import {
  DOMAIN_FUSE,
  TAG_INHERIT,
  TAG_MUTATE,
  TAG_ALLELE,
  poolSizes,
  fuseSeed,
  deriveChildGenome,
  genesisGenome,
  isValidGenome,
  type Genome,
} from "../aura/game/fuse-genome.js";
import { keccak256, encodeAbiParameters, getAddress } from "viem";

let pass = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error("  \x1b[31mFAIL:\x1b[0m", m);
    process.exit(1);
  }
  pass++;
  console.log("  \x1b[32mPASS:\x1b[0m", m);
};
const eqArr = (a: Genome, b: Genome) => a.length === b.length && a.every((x, i) => x === b[i]);

// ── the EXACT vectors from contracts/test/FuseGenome.t.sol (ethers == viem == cast == Solidity) ──
const FUSER = "0x0000000000000000000000000000000000000042";
const A_FP = "0x55f2e8c197e23f8f78cae12e4a70266a0821937425eb388dbae7cc60e0658b8b";
const B_FP = "0x3c7f28f3ee12859ba72d458f6caf7ced48b5433da6903fcb34a002c6b33fab8c";
const BH = "0x" + "c3".repeat(32);
const EXPECT_SEED = "0xd6ad21051b619d74fa7b5c2a0abab2dd47713692502107ef8898bfb2fd646a4c";
const EXPECT_DOMAIN = "0xc0ff70ec7b86376379139e55e8d4c9c7328a1a16abc2ed8705be11eaa9a8a4c4";
const EXPECT_INHERIT = "0x7b7137a4a0f7fd04246c1e054a72aafa8afb1c8c5988d13a67a5dbea18bd95fc";
const EXPECT_MUTATE = "0x53c8a35bc020bb21ab9cf726931dbcb14220889a5e0c2e981bececc6c25e4263";
const EXPECT_ALLELE = "0x6e6caa0fa86402fa9b1e20527283a7a4f7d8165c481b5032a4f807e819d2d372";
const GENOME_A: Genome = [0, 1, 2, 3, 4, 5, 6, 0];
const GENOME_B: Genome = [9, 7, 5, 6, 3, 2, 1, 4];
const EXPECT_CHILD_42: Genome = [0, 1, 5, 6, 3, 2, 1, 0];
const EXPECT_CHILD_43: Genome = [0, 1, 2, 6, 3, 5, 6, 4];

// ── an INDEPENDENT viem re-expression of the derivation (the "3rd-party verifier in another lib" path) ──
const TAG_INHERIT_V = keccak256("0x" + Buffer.from("AURA-FUSE-inherit-v1").toString("hex") as `0x${string}`);
function rollViem(seed: `0x${string}`, tag: `0x${string}`, i: number): bigint {
  return BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [seed, tag, BigInt(i)])));
}
function fuseSeedViem(req: number, fuser: string, aFp: string, bFp: string, bh: string): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
      [DOMAIN_FUSE as `0x${string}`, BigInt(req), getAddress(fuser), aFp as `0x${string}`, bFp as `0x${string}`, bh as `0x${string}`],
    ),
  );
}
function deriveChildViem(a: Genome, b: Genome, seed: `0x${string}`): Genome {
  const pools = poolSizes();
  const TAG_MUT = keccak256(("0x" + Buffer.from("AURA-FUSE-mutate-v1").toString("hex")) as `0x${string}`);
  const TAG_ALL = keccak256(("0x" + Buffer.from("AURA-FUSE-allele-v1").toString("hex")) as `0x${string}`);
  const child: Genome = new Array(8);
  for (let i = 0; i < 8; i++) {
    const parentBit = rollViem(seed, TAG_INHERIT_V, i) % 2n;
    const inherited = parentBit === 0n ? a[i]! : b[i]!;
    const mutRoll = rollViem(seed, TAG_MUT, i) % 10000n;
    child[i] = mutRoll < 500n ? Number(rollViem(seed, TAG_ALL, i) % BigInt(pools[i]!)) : inherited;
  }
  return child;
}

async function main() {
  console.log("\n=== AURA fuse-genome - BIT-EXACT vs on-chain FuseGenome.sol ===\n");

  // 1. domain tags recompute to the exact on-chain bytes32.
  ok(DOMAIN_FUSE === EXPECT_DOMAIN, "DOMAIN_FUSE == on-chain constant");
  ok(TAG_INHERIT === EXPECT_INHERIT, "TAG_INHERIT == on-chain constant");
  ok(TAG_MUTATE === EXPECT_MUTATE, "TAG_MUTATE == on-chain constant");
  ok(TAG_ALLELE === EXPECT_ALLELE, "TAG_ALLELE == on-chain constant");

  // 2. the 6-field fuseSeed matches the on-chain value.
  const seed42 = fuseSeed({ requestId: 42, fuser: FUSER, aFingerprint: A_FP, bFingerprint: B_FP, blockHash: BH });
  ok(seed42 === EXPECT_SEED, `fuseSeed(42) == on-chain EXPECT_SEED (${seed42.slice(0, 12)}...)`);

  // 3. the full 8-locus child genome matches the on-chain vector (reqId 42 + 43).
  ok(eqArr(deriveChildGenome(GENOME_A, GENOME_B, seed42), EXPECT_CHILD_42), "child(reqId=42) == on-chain [0,1,5,6,3,2,1,0]");
  const seed43 = fuseSeed({ requestId: 43, fuser: FUSER, aFingerprint: A_FP, bFingerprint: B_FP, blockHash: BH });
  ok(eqArr(deriveChildGenome(GENOME_A, GENOME_B, seed43), EXPECT_CHILD_43), "child(reqId=43) == on-chain [0,1,2,6,3,5,6,4]");

  // 4. ALLOW-REPEAT: same pair, different requestId => different child (siblings not clones); fuser-bound seed.
  ok(seed42 !== seed43, "distinct requestId => distinct seed (allow-repeat, un-grindable)");
  ok(!eqArr(deriveChildGenome(GENOME_A, GENOME_B, seed42), deriveChildGenome(GENOME_A, GENOME_B, seed43)), "reqId-42 child != reqId-43 child (siblings)");
  const seedOtherFuser = fuseSeed({ requestId: 42, fuser: "0x0000000000000000000000000000000000000043", aFingerprint: A_FP, bFingerprint: B_FP, blockHash: BH });
  ok(seed42 !== seedOtherFuser, "seed is fuser-bound (no cross-fuser reuse)");

  // 5. determinism: recomputing twice is bit-identical.
  ok(fuseSeed({ requestId: 42, fuser: FUSER, aFingerprint: A_FP, bFingerprint: B_FP, blockHash: BH }) === seed42, "seed deterministic across calls");

  // 6. ethers (server) == viem (3rd-party lib) over a wide sample (600 fusions).
  let xbad = 0;
  for (let r = 1; r <= 300; r++) {
    for (const [fp1, fp2] of [[A_FP, B_FP], [B_FP, A_FP]] as const) {
      const s = fuseSeed({ requestId: r, fuser: FUSER, aFingerprint: fp1, bFingerprint: fp2, blockHash: BH });
      const sv = fuseSeedViem(r, FUSER, fp1, fp2, BH);
      if (s !== sv) xbad++;
      const c = deriveChildGenome(GENOME_A, GENOME_B, s);
      const cv = deriveChildViem(GENOME_A, GENOME_B, sv);
      if (!eqArr(c, cv)) xbad++;
    }
  }
  ok(xbad === 0, "ethers == viem child genome + seed over 600 fusions (cross-lib determinism)");

  // 7. mutation-rate + parent-share sanity over a wide sample (target 5% mutation, ~50/50 parent share).
  let mut = 0;
  let bShare = 0;
  let nonMut = 0;
  const SAMPLES = 2000;
  for (let r = 1; r <= SAMPLES; r++) {
    const s = fuseSeed({ requestId: r, fuser: FUSER, aFingerprint: A_FP, bFingerprint: B_FP, blockHash: BH });
    const child = deriveChildGenome(GENOME_A, GENOME_B, s);
    for (let i = 0; i < 8; i++) {
      if (child[i] === GENOME_A[i] && child[i] === GENOME_B[i]) continue; // ambiguous locus, skip
      if (child[i] !== GENOME_A[i] && child[i] !== GENOME_B[i]) {
        mut++;
      } else {
        nonMut++;
        if (child[i] === GENOME_B[i]) bShare++;
      }
    }
  }
  const mutRate = mut / (mut + nonMut);
  const bRate = bShare / nonMut;
  ok(mutRate > 0.02 && mutRate < 0.09, `mutation rate ~5% (got ${(mutRate * 100).toFixed(2)}%)`);
  ok(bRate > 0.4 && bRate < 0.6, `parent-B share ~50% of non-mutated (got ${(bRate * 100).toFixed(1)}%)`);

  // 8. GENESIS backfill: deterministic, in-range, fingerprint-bound (different fingerprints => diff genomes).
  const gA = genesisGenome(A_FP);
  const gB = genesisGenome(B_FP);
  ok(isValidGenome(gA) && isValidGenome(gB), "genesisGenome yields in-range 8-locus genomes");
  ok(eqArr(gA, genesisGenome(A_FP)), "genesisGenome deterministic (same fingerprint => same genome)");
  ok(!eqArr(gA, gB), "genesisGenome is fingerprint-bound (different fingerprints => different genome)");

  console.log(`\n=== fuse-genome: ${pass}/${pass} assertions PASS (bit-exact vs FuseGenome.sol) ===\n`);
}

main().catch((e) => {
  console.error("\nfuse-genome TEST ERROR:", e);
  process.exit(1);
});
