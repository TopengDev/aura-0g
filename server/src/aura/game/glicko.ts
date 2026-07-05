// SERVER-ONLY, PURE. The CANONICAL FIXED-POINT INTEGER Glicko-1 (dil-rating-ladder.md decision 4 + the R7
// float-determinism wrinkle). Glicko-1 needs floats (sqrt / exp / 10^x), and IEEE-754 exp/pow are NOT
// guaranteed bit-identical across libm/language implementations - so a naive float ladder could fail the
// "anyone recomputes it bit-exact" property the gacha/fusion have. This module removes that wrinkle: ALL math
// is BigInt fixed-point at a pinned SCALE with pinned transcendental algorithms (integer Newton sqrt +
// range-reduced fixed-order Taylor exp), so the ladder is bit-identical across any faithful reimplementation
// (TS here, viem in a verifier, or a Solidity-view). Deterministic by construction (no floats anywhere).
//
// Glicko-1 (NOT Glicko-2): no volatility sigma => no farmable rating multiplier (the empirically-disqualified
// Glicko-2 attack surface). Rank feeds a SIGNAL (price/matchmaking), never an emission (the wash-trading rule).
//
// Spec (Glickman, glicko.pdf), reproduced in fixed point:
//   q=ln(10)/400; g(RD)=1/sqrt(1+3 q^2 RD^2/pi^2); E=1/(1+10^(-g(RDj)(r-rj)/400));
//   d^-2=q^2 SUM g^2 E(1-E); r'=r+(q/(1/RD^2+d^-2)) SUM g(s-E); RD'=sqrt(1/(1/RD^2+d^-2));
//   inactivity: RD=min(sqrt(RD^2+c^2 t),350); defaults r0=1500, RD0=350.

// ── the pinned canonical scale + constants (a bit-exact reimplementation MUST use these exact integers) ──
export const SCALE = 1_000_000_000_000n; // 1e12 fixed-point unit (a real value v is stored as round(v*SCALE))
const N_TAYLOR = 25; // pinned exp() Taylor order (|reduced r| <= ln2/2 => converges far before this)

// constants as scaled integers (derivation in the comment; pinned so any lib recomputes identically).
export const Q = 5_756_462_732n; //       ln(10)/400             * 1e12  (0.005756462732)
const Q2 = 33_136_863n; //                q^2                    * 1e12  (3.3136863e-5)
const PI2 = 9_869_604_401_089n; //        pi^2                   * 1e12  (9.869604401089)
const LN10 = 2_302_585_092_994n; //       ln(10)                 * 1e12  (2.302585092994)
const LN2 = 693_147_180_560n; //          ln(2)                  * 1e12  (0.693147180560)
const THREE_Q2 = 3n * Q2; //              3 q^2                  * 1e12

// Glicko defaults + ladder guards (whole rating points, scaled on use).
export const R0 = 1500; // starting rating
export const RD0 = 350; // starting RD
export const RD_MAX = 350; // RD ceiling
export const RD_FLOOR = 30; // RD floor (Glickman: very low RD becomes sticky; keep the board responsive)

// scores as fixed-point (loss/draw/win).
export const S_LOSS = 0n;
export const S_DRAW = SCALE / 2n;
export const S_WIN = SCALE;

// ── fixed-point primitives (all BigInt, all truncating-toward-zero => deterministic) ──
export function fpMul(a: bigint, b: bigint): bigint {
  return (a * b) / SCALE;
}
export function fpDiv(a: bigint, b: bigint): bigint {
  return (a * SCALE) / b;
}
/** Integer sqrt of a non-negative BigInt (Newton). Exact + deterministic. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt: negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
/** Fixed-point sqrt: sqrt(a_real) in fixed point == isqrt(a * SCALE). */
export function fpSqrt(a: bigint): bigint {
  if (a < 0n) throw new Error("fpSqrt: negative");
  return isqrt(a * SCALE);
}
/** round(x / LN2) as a plain integer (banker-free nearest, deterministic). */
function kForExp(x: bigint): bigint {
  if (x >= 0n) return (x + LN2 / 2n) / LN2;
  return -(((-x) + LN2 / 2n) / LN2);
}
/**
 * Fixed-point exp(x_real). Range-reduce x = k*ln2 + r (|r_real| <= ln2/2), exp = 2^k * Taylor(r). Pinned order
 * + truncating division => bit-exact across any faithful reimplementation.
 */
export function fpExp(x: bigint): bigint {
  const k = kForExp(x);
  const r = x - k * LN2; // fixed-point remainder, |r_real| <= ln2/2
  let term = SCALE; // r^0/0! = 1
  let sum = SCALE;
  for (let n = 1n; n <= BigInt(N_TAYLOR); n++) {
    term = (term * r) / SCALE; // * r
    term = term / n; // / n  (builds r^n/n!)
    sum += term;
  }
  if (k >= 0n) return sum * (2n ** k);
  return sum / (2n ** (-k));
}
/** Fixed-point 10^x_real = exp(x_real * ln10). */
export function fpPow10(x: bigint): bigint {
  return fpExp(fpMul(x, LN10));
}

// ── Glicko-1 core ──
export interface Rating {
  rating: bigint; // fixed-point (rating_real * SCALE)
  rd: bigint; // fixed-point (RD_real * SCALE)
}
export interface Game {
  oppRating: bigint; // opponent pre-period rating (fixed-point)
  oppRd: bigint; // opponent pre-period RD (fixed-point)
  score: bigint; // S_WIN | S_DRAW | S_LOSS
}

/** g(RD) = 1/sqrt(1 + 3 q^2 RD^2 / pi^2). Fixed-point. */
export function gFactor(rd: bigint): bigint {
  const rd2 = fpMul(rd, rd); // RD^2
  const t = fpDiv(fpMul(THREE_Q2, rd2), PI2); // 3 q^2 RD^2 / pi^2
  return fpDiv(SCALE, fpSqrt(SCALE + t)); // 1/sqrt(1 + t)
}

/** E(r, rj, RDj) = 1/(1 + 10^(-g(RDj)(r-rj)/400)). Fixed-point. */
export function expectedScore(r: bigint, oppRating: bigint, oppRd: bigint): bigint {
  const g = gFactor(oppRd);
  const exponent = -fpDiv(fpMul(g, r - oppRating), 400n * SCALE); // -g (r-rj)/400
  return fpDiv(SCALE, SCALE + fpPow10(exponent));
}

/** Clamp an RD (fixed-point) to [RD_FLOOR, RD_MAX]. */
function clampRd(rd: bigint): bigint {
  const lo = BigInt(RD_FLOOR) * SCALE;
  const hi = BigInt(RD_MAX) * SCALE;
  if (rd < lo) return lo;
  if (rd > hi) return hi;
  return rd;
}

/**
 * One Glicko-1 rating-period update for a player over its games this period (opponents' PRE-period ratings).
 * Returns the new (rating, RD). If the player had NO games, apply inactivity RD inflation instead (see
 * inactivityInflate). Pure + deterministic.
 */
export function updatePlayer(prev: Rating, games: Game[], c = 0): Rating {
  if (games.length === 0) return inactivityInflate(prev, c);
  // d^-2 = q^2 SUM g^2 E (1-E);  ratingChange numerator = SUM g (s - E)
  let dInvSum = 0n; // SUM g^2 E (1-E)  (fixed-point)
  let scoreSum = 0n; // SUM g (s - E)    (fixed-point, signed)
  for (const gm of games) {
    const g = gFactor(gm.oppRd);
    const e = expectedScore(prev.rating, gm.oppRating, gm.oppRd);
    const g2 = fpMul(g, g);
    dInvSum += fpMul(fpMul(g2, e), SCALE - e); // g^2 E (1-E)
    scoreSum += fpMul(g, gm.score - e); // g (s - E)
  }
  const dInv2 = fpMul(Q2, dInvSum); // q^2 SUM ...
  const invRd2 = fpDiv(SCALE, fpMul(prev.rd, prev.rd)); // 1/RD^2
  const denom = invRd2 + dInv2; // 1/RD^2 + d^-2
  const rating = prev.rating + fpMul(fpDiv(Q, denom), scoreSum); // r + (q/denom) SUM g(s-E)
  const rd = clampRd(fpSqrt(fpDiv(SCALE, denom))); // sqrt(1/denom), clamped
  return { rating, rd };
}

/** Inactivity RD inflation for a period with no games: RD = min(sqrt(RD^2 + c^2), RD_MAX). c in whole points. */
export function inactivityInflate(prev: Rating, c: number): Rating {
  if (c <= 0) return prev;
  const cFp = BigInt(c) * SCALE;
  const inflated = fpSqrt(fpMul(prev.rd, prev.rd) + fpMul(cFp, cFp));
  return { rating: prev.rating, rd: clampRd(inflated) };
}

/** The default starting rating (fixed-point). */
export function defaultRating(): Rating {
  return { rating: BigInt(R0) * SCALE, rd: BigInt(RD0) * SCALE };
}

/** SOFT season reset: carry rating forward, inflate RD (never a hard 1500 reset). RD := max(RD, floorInflate). */
export function softReset(prev: Rating, minRd = 200): Rating {
  const lo = BigInt(minRd) * SCALE;
  return { rating: prev.rating, rd: prev.rd < lo ? clampRd(lo) : prev.rd };
}

// ── whole-integer projections for the on-chain leaf + display (rounded; uint32-safe: rating~1500, rd~350) ──
/** Round a fixed-point value to the nearest whole integer (deterministic half-up for non-negative). */
export function fpRound(v: bigint): number {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const r = (a + SCALE / 2n) / SCALE;
  return Number(neg ? -r : r);
}
export function ratingInt(r: Rating): number {
  return fpRound(r.rating);
}
export function rdInt(r: Rating): number {
  return fpRound(r.rd);
}
/** Conservative TrueSkill-style display: r - k*RD (default k=2). The economically-live rank (RD-eligibility
 *  gate lives in the ladder). Whole integer, never below 0. */
export function conservativeDisplay(r: Rating, k = 2): number {
  const v = r.rating - BigInt(k) * r.rd;
  const rounded = fpRound(v);
  return rounded < 0 ? 0 : rounded;
}
