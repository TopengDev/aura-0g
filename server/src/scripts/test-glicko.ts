// AURA game layer - UNIT test (Tier-2): the fixed-point integer Glicko-1 is DETERMINISTIC (bit-exact) and
// tracks Glickman's published worked example. LOCAL ONLY. Determinism is the load-bearing property (the ladder
// must recompute bit-identically for the keyless anchor); the worked-example closeness confirms the fixed-point
// faithfully approximates the real Glicko-1 formula.
import {
  SCALE,
  Q,
  fpExp,
  fpSqrt,
  fpPow10,
  gFactor,
  expectedScore,
  updatePlayer,
  inactivityInflate,
  softReset,
  defaultRating,
  ratingInt,
  rdInt,
  conservativeDisplay,
  S_WIN,
  S_LOSS,
  type Rating,
  type Game,
} from "../aura/game/glicko.js";

let pass = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error("  \x1b[31mFAIL:\x1b[0m", m);
    process.exit(1);
  }
  pass++;
  console.log("  \x1b[32mPASS:\x1b[0m", m);
};
const fromFP = (v: bigint) => Number(v) / Number(SCALE);
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const FP = (real: number) => BigInt(Math.round(real * Number(SCALE)));

async function main() {
  console.log("\n=== AURA glicko-1 fixed-point - determinism + Glickman worked example ===\n");

  // ── A. fixed-point primitive sanity ──
  ok(near(fromFP(fpExp(0n)), 1, 1e-9), "fpExp(0) == 1.0");
  ok(near(fromFP(fpExp(SCALE)), Math.E, 1e-3), "fpExp(1) == e (2.71828)");
  ok(near(fromFP(fpExp(-SCALE)), 1 / Math.E, 1e-3), "fpExp(-1) == 1/e (range-reduce handles negatives)");
  ok(near(fromFP(fpSqrt(4n * SCALE)), 2, 1e-9), "fpSqrt(4) == 2");
  ok(near(fromFP(fpSqrt(2n * SCALE)), Math.SQRT2, 1e-9), "fpSqrt(2) == 1.41421356");
  ok(near(fromFP(fpPow10(2n * SCALE)), 100, 1e-2), "fpPow10(2) == 100");
  ok(near(fromFP(Q), Math.log(10) / 400, 1e-9), "Q == ln(10)/400");

  // ── B. g(RD) + E vs Glickman's published intermediate values ──
  const g30 = fromFP(gFactor(30n * SCALE));
  const g100 = fromFP(gFactor(100n * SCALE));
  const g300 = fromFP(gFactor(300n * SCALE));
  ok(near(g30, 0.9955, 1e-3), `g(30) ~ 0.9955 (got ${g30.toFixed(4)})`);
  ok(near(g100, 0.9531, 1e-3), `g(100) ~ 0.9531 (got ${g100.toFixed(4)})`);
  ok(near(g300, 0.7242, 1e-3), `g(300) ~ 0.7242 (got ${g300.toFixed(4)})`);
  const r1500 = 1500n * SCALE;
  const e1 = fromFP(expectedScore(r1500, 1400n * SCALE, 30n * SCALE));
  const e2 = fromFP(expectedScore(r1500, 1550n * SCALE, 100n * SCALE));
  const e3 = fromFP(expectedScore(r1500, 1700n * SCALE, 300n * SCALE));
  ok(near(e1, 0.639, 5e-3), `E(1500 vs 1400,30) ~ 0.639 (got ${e1.toFixed(3)})`);
  ok(near(e2, 0.432, 5e-3), `E(1500 vs 1550,100) ~ 0.432 (got ${e2.toFixed(3)})`);
  ok(near(e3, 0.303, 5e-3), `E(1500 vs 1700,300) ~ 0.303 (got ${e3.toFixed(3)})`);

  // ── C. the full worked example: r=1500 RD=200 vs (1400,30,W)(1550,100,L)(1700,300,L) -> r'~1464 RD'~151 ──
  const player: Rating = { rating: 1500n * SCALE, rd: 200n * SCALE };
  const games: Game[] = [
    { oppRating: 1400n * SCALE, oppRd: 30n * SCALE, score: S_WIN },
    { oppRating: 1550n * SCALE, oppRd: 100n * SCALE, score: S_LOSS },
    { oppRating: 1700n * SCALE, oppRd: 300n * SCALE, score: S_LOSS },
  ];
  const updated = updatePlayer(player, games);
  const rPrime = fromFP(updated.rating);
  const rdPrime = fromFP(updated.rd);
  ok(near(rPrime, 1464.1, 1.5), `new rating ~ 1464.1 (Glickman) (got ${rPrime.toFixed(2)})`);
  ok(near(rdPrime, 151.4, 1.5), `new RD ~ 151.4 (Glickman) (got ${rdPrime.toFixed(2)})`);
  ok(ratingInt(updated) >= 1462 && ratingInt(updated) <= 1466, `ratingInt rounds to ~1464 (got ${ratingInt(updated)})`);
  ok(rdInt(updated) >= 150 && rdInt(updated) <= 153, `rdInt rounds to ~151 (got ${rdInt(updated)})`);

  // ── D. DETERMINISM: recompute is BIT-IDENTICAL (the keyless-anchor load-bearing property) ──
  const again = updatePlayer(player, games);
  ok(again.rating === updated.rating && again.rd === updated.rd, "updatePlayer is BIT-IDENTICAL across calls (integer determinism)");
  // and identical when the games are supplied in a different construction (pure function of inputs).
  const games2 = games.map((g) => ({ ...g }));
  const u2 = updatePlayer({ rating: 1500n * SCALE, rd: 200n * SCALE }, games2);
  ok(u2.rating === updated.rating && u2.rd === updated.rd, "updatePlayer is a pure function (fresh inputs => identical output)");

  // ── E. monotonicity + confidence: a win raises rating + lowers RD; a loss lowers rating ──
  const base = defaultRating();
  const afterWin = updatePlayer(base, [{ oppRating: 1500n * SCALE, oppRd: 50n * SCALE, score: S_WIN }]);
  const afterLoss = updatePlayer(base, [{ oppRating: 1500n * SCALE, oppRd: 50n * SCALE, score: S_LOSS }]);
  ok(afterWin.rating > base.rating, "a win RAISES rating");
  ok(afterLoss.rating < base.rating, "a loss LOWERS rating");
  ok(afterWin.rd < base.rd, "playing a game LOWERS RD (more confidence)");

  // ── F. inactivity inflation + soft reset ──
  const inflated = inactivityInflate({ rating: 1600n * SCALE, rd: 60n * SCALE }, 63);
  ok(inflated.rd > 60n * SCALE && inflated.rating === 1600n * SCALE, "inactivity inflates RD, keeps rating");
  ok(fromFP(inflated.rd) <= 350.0001, "inflated RD is capped at RD_MAX (350)");
  const reset = softReset({ rating: 1700n * SCALE, rd: 60n * SCALE }, 200);
  ok(reset.rating === 1700n * SCALE && fromFP(reset.rd) >= 200, "soft reset carries rating forward, inflates RD to >= 200 (never a hard 1500 reset)");

  // ── G. conservative display r - 2*RD ──
  const cons = conservativeDisplay({ rating: 1600n * SCALE, rd: 100n * SCALE }, 2);
  ok(cons === 1400, "conservative display r - 2*RD = 1600 - 200 = 1400");

  // ── H. a smurf fed blowout wins tops RAW rating but keeps HIGH RD (the provisional gate rationale) ──
  const smurf = updatePlayer(defaultRating(), [
    { oppRating: 1400n * SCALE, oppRd: 50n * SCALE, score: S_WIN },
    { oppRating: 1420n * SCALE, oppRd: 50n * SCALE, score: S_WIN },
    { oppRating: 1410n * SCALE, oppRd: 50n * SCALE, score: S_WIN },
  ]);
  ok(rdInt(smurf) > 100, `after only 3 games RD stays high (${rdInt(smurf)} > 100) -> PROVISIONAL under an RD gate (no cold-start ladder jump)`);
  ok(conservativeDisplay(smurf) < ratingInt(smurf), "conservative (r-2RD) display discounts the smurf's raw rating (high RD penalized)");

  console.log(`\n=== glicko: ${pass}/${pass} assertions PASS (fixed-point determinism + Glickman example) ===\n`);
}

main().catch((e) => {
  console.error("\nglicko TEST ERROR:", e);
  process.exit(1);
});
