// SERVER-ONLY. REPUTATION routes (game layer, Tier-2) over ArenaVote verdicts + ArenaReputation anchors. The
// off-chain fixed-point Glicko-1 ladder is computed here, surfaced for display, anchored by root (the anchorer
// signs), and RE-DERIVABLE by anyone via the keyless /api/arena/ladder/verify endpoint. Rank is a SIGNAL only
// (price / matchmaking / siring value); there is deliberately no emission on rank.
//
// GRACEFUL-OFF: rating/verify need ArenaVote wired (verdicts); anchor-args needs ArenaReputation wired. Until
// the phase-4 deploy sets those addresses, the routes return 501.
import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import { readProvider } from "../aura/contracts.js";
import { arenaVoteRead, arenaVoteConfigured, arenaReputationRead, arenaReputationConfigured } from "../aura/game/contracts.js";
import { CONTRACTS, GALILEO, GAME_DEPLOY_BLOCK } from "../aura/config.js";
import { GAME_CHAIN_ID } from "../aura/game/contracts.js";
import { computeLadder, ladderRows, ladderTree, rankSurface, verifyLadder, type Verdict, type LadderVerifyDeps } from "../aura/game/ladder.js";
import { ladderRoot } from "../aura/game/merkle.js";

function parseId(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return n >= 1 ? n : null;
  }
  return null;
}
function parseSeason(v: unknown): number | null {
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  return null;
}

/**
 * Read the RATED verdicts from ArenaVote: BattleCreated gives each battle's agents, Finalized gives the winner
 * + rated flag. Only rated battles confer a verdict (the quorum gate). Single-period (period 0) for the MVP
 * season anchor. Chunked by block range (the eth_getLogs gotcha).
 */
// fromBlock floors at the GAME deploy block (ARENA_DEPLOY_BLOCK env > deployed-v2.json gameDeployBlock) so the
// keyless /api/arena/ladder/verify scan starts at the contract deploy, NOT genesis (the mainnet hang fix).
async function readVerdicts(fromBlock = GAME_DEPLOY_BLOCK): Promise<Verdict[]> {
  const c = arenaVoteRead();
  const latest = await readProvider().getBlockNumber();
  const CHUNK = 2000;
  const agentsByBattle = new Map<number, { agentA: number; agentB: number }>();
  const finals: { battleId: number; winner: number; rated: boolean }[] = [];
  for (let from = fromBlock; from <= latest; from += CHUNK) {
    const to = Math.min(from + CHUNK - 1, latest);
    const [created, finalized] = await Promise.all([
      c.queryFilter(c.filters.BattleCreated(), from, to),
      c.queryFilter(c.filters.Finalized(), from, to),
    ]);
    for (const l of created) {
      const a = (l as ethers.EventLog).args;
      if (a) agentsByBattle.set(Number(a.battleId), { agentA: Number(a.agentA), agentB: Number(a.agentB) });
    }
    for (const l of finalized) {
      const a = (l as ethers.EventLog).args;
      if (a) finals.push({ battleId: Number(a.battleId), winner: Number(a.winner), rated: Boolean(a.rated) });
    }
  }
  const verdicts: Verdict[] = [];
  for (const f of finals) {
    if (!f.rated) continue; // unrated battles confer no verdict
    const ag = agentsByBattle.get(f.battleId);
    if (!ag) continue;
    verdicts.push({ agentA: ag.agentA, agentB: ag.agentB, winner: f.winner, period: 0 });
  }
  return verdicts;
}

function realLadderDeps(): LadderVerifyDeps {
  return {
    getVerdicts: () => readVerdicts(),
    async getAnchoredRoot(season) {
      return String(await arenaReputationRead().seasonRoot(season));
    },
  };
}

export async function gameReputationRoutes(app: FastifyInstance): Promise<void> {
  // GET /game/arena/rating/:agentId - surface an agent's rating/rank (recomputed live from chain verdicts).
  app.get<{ Params: { agentId: string } }>("/game/arena/rating/:agentId", async (req, reply) => {
    if (!arenaVoteConfigured()) return reply.code(501).send({ error: "arena not configured on this deploy" });
    const agentId = parseId(req.params.agentId);
    if (agentId === null) return reply.code(400).send({ error: "agentId must be a positive integer" });
    try {
      const verdicts = await readVerdicts();
      const ladder = computeLadder(verdicts);
      const surface = rankSurface(agentId, ladder);
      return {
        ...surface,
        battlesCounted: verdicts.length,
        note: "fixed-point Glicko-1 over on-chain rated verdicts. rank is over RD-eligible agents by conservative (r-2*RD) display. SIGNAL only, no emission.",
      };
    } catch (e) {
      return reply.code(502).send({ error: `rating recompute failed: ${String((e as any)?.message).slice(0, 120)}` });
    }
  });

  // GET /game/arena/rating/:agentId/proof - the ladder rating + Merkle proof (for on-chain verifyRating).
  app.get<{ Params: { agentId: string } }>("/game/arena/rating/:agentId/proof", async (req, reply) => {
    if (!arenaVoteConfigured()) return reply.code(501).send({ error: "arena not configured on this deploy" });
    const agentId = parseId(req.params.agentId);
    if (agentId === null) return reply.code(400).send({ error: "agentId must be a positive integer" });
    try {
      const ladder = computeLadder(await readVerdicts());
      if (!ladder.has(agentId)) return reply.code(404).send({ error: `agent #${agentId} has no verdicts (not on the ladder)` });
      const tree = ladderTree(ladder);
      const rows = ladderRows(ladder);
      const row = rows.find((r) => r.agentId === agentId)!;
      return { agentId, rating: row.rating, rd: row.rd, root: tree.root(), proof: tree.proofFor(agentId), verifyNote: "call ArenaReputation.verifyRating(season, agentId, rating, rd, proof) after the season is anchored" };
    } catch (e) {
      return reply.code(502).send({ error: `proof build failed: ${String((e as any)?.message).slice(0, 120)}` });
    }
  });

  // POST /game/arena/season/anchor-args - compute the season ladder root + the anchorSeason args (anchorer signs).
  app.post<{ Body: { seasonEpoch?: number } }>("/game/arena/season/anchor-args", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!arenaVoteConfigured()) return reply.code(501).send({ error: "arena not configured on this deploy" });
    if (!arenaReputationConfigured()) return reply.code(501).send({ error: "reputation anchor not configured on this deploy" });
    const seasonEpoch = parseSeason(req.body?.seasonEpoch);
    if (seasonEpoch === null) return reply.code(400).send({ error: "seasonEpoch (non-negative integer) required" });
    try {
      const ladder = computeLadder(await readVerdicts());
      const rows = ladderRows(ladder);
      if (rows.length === 0) return reply.code(409).send({ error: "no rated verdicts yet - nothing to anchor" });
      const root = ladderRoot(rows);
      return {
        contract: CONTRACTS.arenaReputation,
        chainId: GAME_CHAIN_ID,
        seasonEpoch,
        ladderRoot: root,
        agents: rows.length,
        call: { fn: "anchorSeason", args: [seasonEpoch, root] },
        note: "the anchorer (off-chain Glicko compute service) submits anchorSeason; 1 SSTORE/season. Rows are keyless-recomputable via /api/arena/ladder/verify.",
      };
    } catch (e) {
      return reply.code(502).send({ error: `anchor-args build failed: ${String((e as any)?.message).slice(0, 120)}` });
    }
  });

  // GET /api/arena/ladder/verify?season= - KEYLESS ladder recompute (public). Recompute the whole ladder from
  // chain verdicts, assert its root == the anchored ArenaReputation.seasonRoot(season). Under /api/ (same-origin).
  app.get<{ Querystring: { season?: string } }>("/api/arena/ladder/verify", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!arenaVoteConfigured()) return reply.code(501).send({ error: "arena not configured on this deploy" });
    if (!arenaReputationConfigured()) return reply.code(501).send({ error: "reputation anchor not configured on this deploy" });
    const season = parseSeason(req.query?.season);
    if (season === null) return reply.code(400).send({ error: "season (non-negative integer) required (?season=<n>)" });
    try {
      const report = await verifyLadder(season, realLadderDeps());
      return {
        ...report,
        selfCheck: {
          anchoredRoot: `cast call ${CONTRACTS.arenaReputation} 'seasonRoot(uint256)' ${season} --rpc-url ${GALILEO.rpc}`,
          recompute: "recompute the ladder from ArenaVote's rated Finalized+BattleCreated events with this fixed-point Glicko-1 spec + OZ StandardMerkleTree(sorted rows); assert the root matches.",
        },
      };
    } catch (e) {
      return reply.code(502).send({ error: `ladder verify failed: ${String((e as any)?.message).slice(0, 120)}` });
    }
  });
}
