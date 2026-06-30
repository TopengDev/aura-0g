// Unit-style verification for the gacha-depth core (server/src/aura/gacha.ts). Run: `tsx src/scripts/
// verify-gacha.ts` (or `npm run verify:gacha`). Asserts: pool self-checks, the subject space, seed +
// subject + rarity DETERMINISM, per-pull UNIQUENESS, the 80/15/4/1 DISTRIBUTION over 10k pulls,
// independent PROVABILITY recompute, and BACKWARD-COMPAT (legacy/small seed -> Common). Exits non-zero on
// any failure so it can gate CI / the build report. No network, no chain, no sponsor spend - pure.
import {
  pullSeedRoot,
  mapSubject,
  deriveRarity,
  rarityRoll,
  isProvablePullSeed,
  SUBJECT_SPACE,
  DIMENSIONS,
  RARITY_TIERS,
  PULL_SEED_FLOOR,
} from "../aura/gacha.js";

let failures = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`  ✗ ${msg}`);
    failures++;
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

const BUYER = "0x1111111111111111111111111111111111111111";
const BUYER2 = "0x2222222222222222222222222222222222222222";
const BLOCKHASH = "0x" + "ab".repeat(32);
const AGENT = 20n;

console.log("\n[1] pools + subject space");
for (const d of DIMENSIONS) assert(d.pool.length === d.size, `pool ${d.key} = ${d.size}`);
console.log(`  SUBJECT_SPACE S = ${SUBJECT_SPACE.toString()} (~${Number(SUBJECT_SPACE).toExponential(3)})`);
assert(SUBJECT_SPACE > 10n ** 20n, "subject space exceeds 1e20 distinct subjects");

console.log("\n[2] seed determinism + uniqueness");
const seedA1 = pullSeedRoot({ requestId: 7, buyer: BUYER, agentId: AGENT, summonBlockHash: BLOCKHASH });
const seedA2 = pullSeedRoot({ requestId: 7, buyer: BUYER, agentId: AGENT, summonBlockHash: BLOCKHASH });
assert(seedA1 === seedA2, "same preimage -> identical seedRoot");
assert(isProvablePullSeed(seedA1), "pull seedRoot is above the legacy floor (2^64)");
const seedB = pullSeedRoot({ requestId: 8, buyer: BUYER, agentId: AGENT, summonBlockHash: BLOCKHASH });
assert(seedB !== seedA1, "different requestId -> different seedRoot (per-pull uniqueness)");
const seedC = pullSeedRoot({ requestId: 7, buyer: BUYER2, agentId: AGENT, summonBlockHash: BLOCKHASH });
assert(seedC !== seedA1, "different buyer -> different seedRoot");
const seedD = pullSeedRoot({ requestId: 7, buyer: BUYER, agentId: AGENT, summonBlockHash: "0x" + "cd".repeat(32) });
assert(seedD !== seedA1, "different summonBlockHash -> different seedRoot (buyer-unpredictable)");

console.log("\n[3] subject + rarity determinism");
const sub1 = mapSubject(seedA1);
const sub2 = mapSubject(seedA1);
assert(JSON.stringify(sub1.tuple) === JSON.stringify(sub2.tuple), "same seed -> identical subject tuple");
assert(deriveRarity(seedA1) === deriveRarity(seedA1), "same seed -> identical rarity");
console.log(`  sample subject: ${sub1.prose.slice(0, 140)}...`);
console.log(`  sample rarity:  ${deriveRarity(seedA1)} (roll ${rarityRoll(seedA1)})`);

console.log("\n[4] subject VARIETY (knight-free / no fixed subject)");
const proseSet = new Set<string>();
const protagSet = new Set<string>();
for (let i = 1; i <= 50; i++) {
  const s = pullSeedRoot({ requestId: i, buyer: BUYER, agentId: AGENT, summonBlockHash: BLOCKHASH });
  const m = mapSubject(s);
  proseSet.add(m.prose);
  protagSet.add(m.tuple.protagonist);
}
assert(proseSet.size === 50, `50 pulls -> ${proseSet.size} distinct subject scenes (expect 50)`);
assert(protagSet.size >= 25, `50 pulls -> ${protagSet.size} distinct protagonists (expect broad spread)`);

console.log("\n[5] rarity DISTRIBUTION over 10k pulls (~80/15/4/1)");
const N = 10000;
const counts: Record<string, number> = { Common: 0, Rare: 0, Epic: 0, Legendary: 0 };
for (let i = 1; i <= N; i++) {
  const s = pullSeedRoot({ requestId: i, buyer: BUYER, agentId: AGENT, summonBlockHash: BLOCKHASH });
  counts[deriveRarity(s)]!++;
}
for (const t of RARITY_TIERS) {
  const pct = (counts[t.tier]! / N) * 100;
  const tol = t.pct * 0.25 + 0.5; // 25% relative + 0.5pp absolute slack (10k sample noise)
  console.log(`  ${t.tier.padEnd(10)} ${counts[t.tier]} (${pct.toFixed(2)}%) target ${t.pct}%`);
  assert(Math.abs(pct - t.pct) <= tol, `${t.tier} within tolerance of ${t.pct}%`);
}

console.log("\n[6] PROVABILITY: independent recompute matches");
// A juror, given ONLY the public preimage, recomputes the seed -> subject -> rarity and matches.
const preimage = { requestId: 4242, buyer: BUYER2, agentId: 11n, summonBlockHash: "0x" + "9f".repeat(32) };
const onChainSeed = pullSeedRoot(preimage); // (what would be committed in Provenance.seed)
const jurorSeed = pullSeedRoot(preimage); // (juror recomputes from public Summoned event + block hash)
assert(jurorSeed === onChainSeed, "juror recomputes seedRoot == on-chain seed");
assert(JSON.stringify(mapSubject(jurorSeed).tuple) === JSON.stringify(mapSubject(onChainSeed).tuple), "juror recomputes the subject");
assert(deriveRarity(jurorSeed) === deriveRarity(onChainSeed), "juror recomputes the rarity");
// tamper: flip one preimage field -> seed no longer matches (proves it can't be faked).
const tampered = pullSeedRoot({ ...preimage, requestId: 4243 });
assert(tampered !== onChainSeed, "tampered preimage -> seed mismatch (rig-resistant)");

console.log("\n[7] BACKWARD-COMPAT: legacy/small seeds -> Common, no migration");
for (const legacy of [0n, 1n, 123456789n, 999_999_999n, PULL_SEED_FLOOR - 1n]) {
  assert(!isProvablePullSeed(legacy), `seed ${legacy} is below the pull floor`);
  assert(deriveRarity(legacy) === "Common", `legacy seed ${legacy} -> Common`);
}
assert(isProvablePullSeed(PULL_SEED_FLOOR), "exactly 2^64 is treated as a pull seed (boundary)");

console.log(`\n${failures === 0 ? "ALL GACHA CHECKS PASSED ✓" : `GACHA CHECKS FAILED: ${failures} ✗`}`);
process.exit(failures === 0 ? 0 : 1);
