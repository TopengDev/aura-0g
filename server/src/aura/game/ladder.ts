// SERVER-ONLY. The season RATING LADDER (Tier-2): a pure, deterministic fixed-point Glicko-1 over the on-chain
// battle VERDICTS, anchored on ArenaReputation by a single Merkle root, and re-derivable via a keyless endpoint
// (the verify-public.ts pattern one layer up). The R7 split (dil-rating-ladder.md):
//   on-chain (trust root):  battle verdicts (ArenaVote commit-reveal tally, bit-exact, rig-evident)
//         | pure fn (fixed-point Glicko-1 over the verdict stream)  <- glicko.ts (bit-identical, integer math)
//   off-chain compute:      season ladder { agentId -> (rating, RD) }
//         | anchor (1 SSTORE/season)
//   on-chain:               ladderRoot = merkleRoot(sorted rows)     <- merkle.ts (== OZ StandardMerkleTree)
//         | keyless recompute
//   endpoint:               recompute the whole ladder from chain verdicts, assert root == anchored root.
//
// HARD RULE (dil-rating-ladder.md 6.2): rank feeds a SIGNAL (price / matchmaking / siring value), NEVER an
// emission - there is deliberately no payout on rank (the LooksRare ~90%-wash regime). This module RANKS; it
// never mints.
import {
  defaultRating,
  updatePlayer,
  inactivityInflate,
  softReset,
  ratingInt,
  rdInt,
  conservativeDisplay,
  S_WIN,
  S_LOSS,
  S_DRAW,
  type Rating,
  type Game,
} from "./glicko.js";
import { LadderMerkleTree, type LadderLeafInput } from "./merkle.js";

/** One finalized, RATED battle verdict (the only input the ladder trusts). winner: 1 = A, 2 = B, 0 = tie. */
export interface Verdict {
  agentA: number;
  agentB: number;
  winner: number; // 1 | 2 | 0
  period?: number; // rating period (default 0 = single-period season); processed in ascending order
}

export interface LadderOptions {
  /** RD inactivity inflation per period an agent sits out (whole points; dil default c~63 for ~30-period decay). */
  c?: number;
  /** Ratings carried in from a prior season (soft-reset applied): agentId -> Rating. Absent => fresh (1500/350). */
  carryIn?: Map<number, Rating>;
  /** RD-eligibility gate for the DISPLAYED/economically-live rank: an agent with RD above this is PROVISIONAL. */
  rdEligibleMax?: number;
}

const DEFAULT_RD_ELIGIBLE_MAX = 100;

function scoreFor(winner: number, agentIsA: boolean): bigint {
  if (winner === 0) return S_DRAW;
  const aWon = winner === 1;
  return aWon === agentIsA ? S_WIN : S_LOSS;
}

/**
 * Compute the full season ladder from the verdict stream. Deterministic + pure: agents are processed in sorted
 * order, periods in ascending order, each period a Glicko-1 batch over that period's games using opponents'
 * PRE-period ratings (the locality that starves the omnipresent attack). Inactive agents get RD inflation.
 */
export function computeLadder(verdicts: Verdict[], opts: LadderOptions = {}): Map<number, Rating> {
  const c = opts.c ?? 0;

  // roster: every agent that appears in any verdict.
  const roster = new Set<number>();
  for (const v of verdicts) {
    roster.add(v.agentA);
    roster.add(v.agentB);
  }
  const agents = [...roster].sort((a, b) => a - b);

  // seed ratings (carry-in soft-reset if provided, else fresh defaults).
  const ratings = new Map<number, Rating>();
  for (const a of agents) {
    const carried = opts.carryIn?.get(a);
    ratings.set(a, carried ? softReset(carried) : defaultRating());
  }

  // periods in ascending order.
  const periods = [...new Set(verdicts.map((v) => v.period ?? 0))].sort((x, y) => x - y);
  for (const period of periods) {
    const pv = verdicts.filter((v) => (v.period ?? 0) === period);
    // snapshot PRE-period ratings (all E use opponents' pre-period values - the Glicko batch semantics).
    const pre = new Map<number, Rating>();
    for (const a of agents) pre.set(a, ratings.get(a)!);
    // gather each agent's games this period.
    const games = new Map<number, Game[]>();
    for (const a of agents) games.set(a, []);
    for (const v of pv) {
      const preA = pre.get(v.agentA)!;
      const preB = pre.get(v.agentB)!;
      games.get(v.agentA)!.push({ oppRating: preB.rating, oppRd: preB.rd, score: scoreFor(v.winner, true) });
      games.get(v.agentB)!.push({ oppRating: preA.rating, oppRd: preA.rd, score: scoreFor(v.winner, false) });
    }
    // update each agent (batch); inactive agents inflate RD.
    for (const a of agents) {
      const g = games.get(a)!;
      ratings.set(a, g.length > 0 ? updatePlayer(pre.get(a)!, g, c) : inactivityInflate(pre.get(a)!, c));
    }
  }

  return ratings;
}

/** The canonical ladder rows (sorted by agentId ascending) - the exact leaves the Merkle root commits. */
export function ladderRows(ladder: Map<number, Rating>): LadderLeafInput[] {
  return [...ladder.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([agentId, r]) => ({ agentId, rating: ratingInt(r), rd: rdInt(r) }));
}

/** Build the OZ-compatible Merkle tree over the ladder rows (for the anchor + per-agent proofs). */
export function ladderTree(ladder: Map<number, Rating>): LadderMerkleTree {
  return LadderMerkleTree.of(ladderRows(ladder));
}

export interface RankSurface {
  agentId: number;
  rating: number;
  rd: number;
  conservative: number; // r - 2*RD (the economically-live signal)
  rank: number; // 1-based rank among RD-ELIGIBLE agents by conservative display (0 if provisional/none)
  provisional: boolean; // RD above the eligibility gate => not yet ranked
  eligibleField: number; // how many agents are RD-eligible
}

/** Surface an agent's rating/rank for display. Rank is over RD-ELIGIBLE agents by conservative (r-2RD) display,
 *  so a high-RD smurf cannot top a freshly-opened board (the provisional gate). A SIGNAL only - no emission. */
export function rankSurface(agentId: number, ladder: Map<number, Rating>, rdEligibleMax = DEFAULT_RD_ELIGIBLE_MAX): RankSurface {
  const me = ladder.get(agentId);
  const eligible = [...ladder.entries()].filter(([, r]) => rdInt(r) <= rdEligibleMax);
  const eligibleField = eligible.length;
  if (!me) return { agentId, rating: 0, rd: 0, conservative: 0, rank: 0, provisional: true, eligibleField };
  const provisional = rdInt(me) > rdEligibleMax;
  const myCons = conservativeDisplay(me);
  const rank = provisional ? 0 : 1 + eligible.filter(([, r]) => conservativeDisplay(r) > myCons).length;
  return { agentId, rating: ratingInt(me), rd: rdInt(me), conservative: myCons, rank, provisional, eligibleField };
}

// ─────────────────────────────── keyless recompute ───────────────────────────────

export interface LadderVerifyDeps {
  getVerdicts(): Promise<Verdict[]>; // rated finalized verdicts from ArenaVote events (BattleCreated + Finalized)
  getAnchoredRoot(seasonEpoch: number): Promise<string>; // ArenaReputation.seasonRoot(season)
}

export interface LadderVerifyReport {
  season: number;
  agents: number;
  recomputedRoot: string;
  anchoredRoot: string;
  match: boolean;
  rows: LadderLeafInput[];
  note: string;
  generatedAt: string;
}

/**
 * KEYLESS ladder recompute: recompute the WHOLE ladder from the on-chain verdicts, rebuild the Merkle root, and
 * assert it equals the anchored ArenaReputation.seasonRoot(season). A third party runs this (or an equivalent
 * with @openzeppelin/merkle-tree + this fixed-point Glicko spec) and needs zero trust in AURA. Injectable seams.
 */
export async function verifyLadder(season: number, deps: LadderVerifyDeps, opts: LadderOptions = {}): Promise<LadderVerifyReport> {
  const verdicts = await deps.getVerdicts();
  const ladder = computeLadder(verdicts, opts);
  const rows = ladderRows(ladder);
  const recomputedRoot = rows.length > 0 ? LadderMerkleTree.of(rows).root() : "0x" + "0".repeat(64);
  const anchoredRoot = await deps.getAnchoredRoot(season);
  return {
    season,
    agents: rows.length,
    recomputedRoot,
    anchoredRoot,
    match: recomputedRoot.toLowerCase() === anchoredRoot.toLowerCase(),
    rows,
    note: "ladder = fixed-point Glicko-1 (glicko.ts) over the on-chain rated verdicts; root = OZ StandardMerkleTree(sorted rows). Recompute it yourself and assert == ArenaReputation.seasonRoot(season). Zero trust in AURA.",
    generatedAt: new Date().toISOString(),
  };
}
