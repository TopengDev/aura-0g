// AURA game layer - UNIT test (Tier-2): the season ladder (fixed-point Glicko-1 over verdicts) + the
// OZ-compatible Merkle anchor + the KEYLESS ladder recompute. LOCAL ONLY. Proves: (1) the ladder is a
// deterministic pure function of the verdicts (bit-exact root across runs), (2) the leaf == ArenaReputation.
// leafOf and proofs verify under the commutative hash (== on-chain verifyRating), (3) a third party recomputes
// the whole ladder from verdicts and the root matches the anchor - and a tampered anchor is caught.
import { keccak256, encodeAbiParameters } from "viem";
import { SCALE, type Rating } from "../aura/game/glicko.js";
import { computeLadder, ladderRows, ladderTree, rankSurface, verifyLadder, type Verdict, type LadderVerifyDeps } from "../aura/game/ladder.js";
import { LadderMerkleTree, standardLeafHash, ladderRoot } from "../aura/game/merkle.js";

let pass = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error("  \x1b[31mFAIL:\x1b[0m", m);
    process.exit(1);
  }
  pass++;
  console.log("  \x1b[32mPASS:\x1b[0m", m);
};

async function main() {
  console.log("\n=== AURA ladder - Glicko season ladder + Merkle anchor + keyless recompute ===\n");

  // a small round-robin: 10 beats 20, 10 beats 30, 20 beats 30 (all rated, one period).
  const verdicts: Verdict[] = [
    { agentA: 10, agentB: 20, winner: 1 },
    { agentA: 10, agentB: 30, winner: 1 },
    { agentA: 20, agentB: 30, winner: 1 },
  ];

  // ── A. ladder ordering + determinism ──
  const ladder = computeLadder(verdicts);
  const rows = ladderRows(ladder);
  ok(rows.length === 3, "ladder has all 3 agents");
  const rating = (id: number) => rows.find((r) => r.agentId === id)!.rating;
  ok(rating(10) > rating(20) && rating(20) > rating(30), `2-0 > 1-1 > 0-2 ordering (10:${rating(10)} > 20:${rating(20)} > 30:${rating(30)})`);
  ok(rows[0]!.agentId === 10 && rows[2]!.agentId === 30, "ladderRows is sorted by agentId (canonical leaf order)");

  const ladder2 = computeLadder(verdicts.map((v) => ({ ...v })));
  const r1 = ladder.get(10)!;
  const r2 = ladder2.get(10)!;
  ok(r1.rating === r2.rating && r1.rd === r2.rd, "computeLadder is BIT-IDENTICAL across runs (deterministic ladder)");
  ok(ladderRoot(rows) === ladderRoot(ladderRows(ladder2)), "the Merkle root is identical across recomputes (deterministic anchor)");

  // ── B. leaf == ArenaReputation.leafOf, cross-lib (ethers here vs viem) ──
  const row = rows[0]!;
  const leafViem = keccak256(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint32" }, { type: "uint32" }], [BigInt(row.agentId), row.rating, row.rd])));
  ok(standardLeafHash(row) === leafViem, "standardLeafHash == keccak(keccak(abi.encode(uint256,uint32,uint32))) (== ArenaReputation.leafOf, cross-lib)");

  // ── C. every row's proof verifies against the root (commutative hash == on-chain MerkleProof.verify) ──
  const tree = ladderTree(ladder);
  const root = tree.root();
  let allVerify = true;
  for (const r of rows) {
    const leaf = standardLeafHash(r);
    const proof = tree.proofFor(r.agentId);
    if (!LadderMerkleTree.verify(root, leaf, proof)) allVerify = false;
  }
  ok(allVerify, "every ladder row's Merkle proof verifies against the root (== on-chain verifyRating)");
  // a TAMPERED rating fails the proof (rig-evident).
  const tamperedLeaf = standardLeafHash({ agentId: row.agentId, rating: row.rating + 100, rd: row.rd });
  ok(!LadderMerkleTree.verify(root, tamperedLeaf, tree.proofFor(row.agentId)), "a tampered (rating+100) leaf FAILS the proof (rig-evident)");

  // ── D. keyless recompute: 3rd-party ladder root == anchored root; a lying anchor is caught ──
  const deps: LadderVerifyDeps = {
    async getVerdicts() {
      return verdicts;
    },
    async getAnchoredRoot() {
      return root; // the honest anchor
    },
  };
  const good = await verifyLadder(1, deps);
  ok(good.match && good.recomputedRoot === root, "keyless verify: recomputed ladder root == anchored root (zero trust in AURA)");
  ok(good.agents === 3 && good.rows.length === 3, "keyless verify report carries the full recomputed ladder");

  const liar: LadderVerifyDeps = {
    getVerdicts: deps.getVerdicts,
    async getAnchoredRoot() {
      return "0x" + "de".repeat(32); // a wrong/tampered anchor
    },
  };
  ok(!(await verifyLadder(1, liar)).match, "keyless verify CATCHES a tampered anchor (recomputed root != anchored root)");

  // ── E. rank surface: conservative (r-2RD) ordering + RD-eligibility (provisional) gate ──
  // build a controlled ladder: a confident champion (low RD), a mid, and a high-RD smurf.
  const controlled = new Map<number, Rating>([
    [1, { rating: 1700n * SCALE, rd: 40n * SCALE }], // champion, eligible
    [2, { rating: 1550n * SCALE, rd: 60n * SCALE }], // mid, eligible
    [3, { rating: 1900n * SCALE, rd: 250n * SCALE }], // smurf: high RAW rating but high RD => provisional
  ]);
  const champ = rankSurface(1, controlled);
  const mid = rankSurface(2, controlled);
  const smurf = rankSurface(3, controlled);
  ok(champ.rank === 1 && !champ.provisional, "champion (low RD) is rank #1 by conservative display");
  ok(mid.rank === 2 && !mid.provisional, "mid agent is rank #2");
  ok(smurf.provisional && smurf.rank === 0, "the high-RD smurf is PROVISIONAL (rank 0) despite a higher RAW rating - no cold-start ladder jump");
  ok(champ.eligibleField === 2, "only the 2 RD-eligible agents form the ranked field (the smurf is gated out)");
  ok(champ.conservative === 1700 - 2 * 40, "conservative display = r - 2*RD (1700 - 80 = 1620)");

  console.log(`\n=== ladder: ${pass}/${pass} assertions PASS (Glicko ladder + Merkle anchor + keyless recompute) ===\n`);
}

main().catch((e) => {
  console.error("\nladder TEST ERROR:", e);
  process.exit(1);
});
