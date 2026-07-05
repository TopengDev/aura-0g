// SERVER-ONLY. ARENA routes (game layer) against ArenaVote.sol. The OPERATOR (sponsor) signs createBattle +
// finalize (matchmaker actions); the votes (commit/reveal/claim) are returned as COMPUTED ARGS for the
// voter's own wallet - the server never casts or holds a vote. The keyless tally re-compute (GET
// /api/arena/tally) is public + wallet-free, cloned from verify-public.ts.
//
// GRACEFUL-OFF: until the phase-4 deploy wires ArenaVote (CONTRACTS.arenaVote == "" today), the flows return
// 501 (same graceful gate as Summon / secure-transfer).
import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import { GAS } from "../aura/config.js";
import { sponsorSigner } from "../aura/wallet.js";
import { generateAndProve } from "../aura/generate.js";
import { agentsRead, readProvider, parseEvent } from "../aura/contracts.js";
import { arenaVoteRead, arenaVoteWrite, arenaVoteConfigured, ARENA_VOTE_ABI } from "../aura/game/contracts.js";
import { createBattleFlow, prepareVote, buildCommitment, finalizeArgs, claimArgs, ArenaError, type BattleAgent, type CreateBattleDeps } from "../aura/game/arena.js";
import { recomputeBattleTally, defaultTallyDeps } from "../aura/game/arena-tally.js";
import { saveBattleArt, getBattleArt } from "../aura/game/battle-store.js";

function parseId(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return n >= 1 ? n : null;
  }
  return null;
}

/** Resolve an agent's { id, name, encBrainRoot } for a battle gen (style resolves from this on generateAndProve). */
async function resolveBattleAgent(agentId: number): Promise<BattleAgent> {
  const a = await agentsRead().getAgent(agentId);
  return { id: agentId, name: String(a.name), encBrainRoot: String(a.encBrainRoot ?? "") };
}

/** The REAL create-battle deps: operator (sponsor) signs createBattle, the theme seeds off its block hash. */
function realCreateBattleDeps(): CreateBattleDeps {
  return {
    async createBattleOnChain(agentA, agentB, commitDur, revealDur) {
      const contract = arenaVoteWrite(sponsorSigner());
      const tx = await contract.createBattle(agentA, agentB, commitDur, revealDur, { gasPrice: GAS.gasPrice });
      const rc = await tx.wait();
      const args = parseEvent(rc, new ethers.Interface(ARENA_VOTE_ABI as unknown as string[]), "BattleCreated");
      if (!args) throw new ArenaError(502, "createBattle: BattleCreated event not found in receipt");
      const battleId = Number(args.battleId);
      const block = await readProvider().getBlock(rc.blockNumber);
      if (!block?.hash) throw new ArenaError(502, "createBattle: could not read the battle block hash");
      return { battleId, blockNumber: rc.blockNumber, blockHash: block.hash };
    },
    async ownerOf(agentId) {
      return String(await agentsRead().ownerOf(agentId));
    },
    generate: generateAndProve,
  };
}

export async function gameArenaRoutes(app: FastifyInstance): Promise<void> {
  // POST /game/arena/battles - OPERATOR creates a battle + generates both portraits on ONE shared theme.
  app.post<{ Body: { agentA?: number; agentB?: number; commitDur?: number; revealDur?: number } }>(
    "/game/arena/battles",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!arenaVoteConfigured()) return reply.code(501).send({ error: "arena not configured on this deploy" });
      const agentA = parseId(req.body?.agentA);
      const agentB = parseId(req.body?.agentB);
      if (agentA === null || agentB === null) return reply.code(400).send({ error: "agentA and agentB (positive integers) required" });
      if (agentA === agentB) return reply.code(400).send({ error: "self-match: agentA and agentB must differ" });
      let a: BattleAgent;
      let b: BattleAgent;
      try {
        [a, b] = await Promise.all([resolveBattleAgent(agentA), resolveBattleAgent(agentB)]);
      } catch {
        return reply.code(404).send({ error: "one or both agents not found on-chain" });
      }
      try {
        const result = await createBattleFlow(a, b, {
          commitDur: parseId(req.body?.commitDur) ?? undefined,
          revealDur: parseId(req.body?.revealDur) ?? undefined,
          deps: realCreateBattleDeps(),
        });
        // Journal the blind art + shared theme so a battle BROWSED later renders the pieces (not just the tally).
        // Best-effort: the battle is already on-chain, so a persist hiccup must NEVER fail the created battle.
        try {
          saveBattleArt(result);
        } catch (e) {
          req.log.warn(`arena: battle-art persist failed for #${result.battleId}: ${String((e as any)?.message).slice(0, 120)}`);
        }
        return result;
      } catch (e) {
        if (e instanceof ArenaError) return reply.code(e.status).send({ error: e.message });
        return reply.code(500).send({ error: `create-battle failed: ${String((e as any)?.message).slice(0, 200)}` });
      }
    },
  );

  // GET /game/arena/battles/:id - read the on-chain battle state (public).
  app.get<{ Params: { id: string } }>("/game/arena/battles/:id", async (req, reply) => {
    if (!arenaVoteConfigured()) return reply.code(501).send({ error: "arena not configured on this deploy" });
    const battleId = parseId(req.params.id);
    if (battleId === null) return reply.code(400).send({ error: "battle id must be a positive integer" });
    try {
      const b = await arenaVoteRead().getBattle(battleId);
      if (Number(b.commitEnd) === 0) return reply.code(404).send({ error: `no such battle #${battleId}` });
      const now = Math.floor(Date.now() / 1000);
      const phase = now < Number(b.commitEnd) ? "commit" : now < Number(b.revealEnd) ? "reveal" : b.finalized ? "finalized" : "awaiting-finalize";
      const onChain = {
        battleId,
        agentA: Number(b.agentA),
        agentB: Number(b.agentB),
        commitEnd: Number(b.commitEnd),
        revealEnd: Number(b.revealEnd),
        finalized: Boolean(b.finalized),
        rated: Boolean(b.rated),
        winner: Number(b.winner),
        weightA: b.weightA.toString(),
        weightB: b.weightB.toString(),
        revealCount: Number(b.revealCount),
        pool: b.pool.toString(),
        phase,
      };
      // Attach the blind art + shared theme journaled at createBattle so a BROWSED battle shows the two pieces +
      // theme (the phase-3-flagged gap), not just the on-chain tally. Best-effort: a battle created on another
      // instance / after a DB reset has no journal -> the read cleanly degrades to on-chain-only (unchanged).
      try {
        const art = getBattleArt(battleId);
        if (art) return { ...onChain, theme: art.theme, images: art.images };
      } catch {
        /* journal unavailable -> serve on-chain state only (degrade-safe) */
      }
      return onChain;
    } catch (e) {
      return reply.code(502).send({ error: `battle read failed: ${String((e as any)?.message).slice(0, 120)}` });
    }
  });

  // POST /game/arena/vote/prepare - build a blind staked-vote commitment + the commit/reveal call args. The
  // salt is returned to the CLIENT (client-secret; the server never stores it, so the ballot stays blind).
  app.post<{ Body: { battleId?: number; choice?: number; salt?: string } }>("/game/arena/vote/prepare", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!arenaVoteConfigured()) return reply.code(501).send({ error: "arena not configured on this deploy" });
    const battleId = parseId(req.body?.battleId);
    const choice = req.body?.choice;
    if (battleId === null) return reply.code(400).send({ error: "battleId (positive integer) required" });
    if (choice !== 1 && choice !== 2) return reply.code(400).send({ error: "choice must be 1 (agent A) or 2 (agent B)" });
    const salt = req.body?.salt;
    if (salt !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(salt)) return reply.code(400).send({ error: "salt (if given) must be a 0x bytes32" });
    try {
      const prep = prepareVote(battleId, choice, req.user.address, salt);
      return { ...prep, keepSalt: "STORE the salt: you need it to reveal. Losing it forfeits f=50% of your stake (non-reveal)." };
    } catch (e) {
      return reply.code(400).send({ error: String((e as any)?.message).slice(0, 120) });
    }
  });

  // POST /game/arena/vote/commitment - pure helper: the exact bytes32 commitment for a (battleId, choice, salt).
  app.post<{ Body: { battleId?: number; choice?: number; salt?: string } }>("/game/arena/vote/commitment", { preHandler: [app.authenticate] }, async (req, reply) => {
    const battleId = parseId(req.body?.battleId);
    const choice = req.body?.choice;
    const salt = req.body?.salt;
    if (battleId === null) return reply.code(400).send({ error: "battleId required" });
    if (choice !== 1 && choice !== 2) return reply.code(400).send({ error: "choice must be 1 or 2" });
    if (!salt || !/^0x[0-9a-fA-F]{64}$/.test(salt)) return reply.code(400).send({ error: "salt (0x bytes32) required" });
    return { commitment: buildCommitment(battleId, choice, salt, req.user.address) };
  });

  // GET /game/arena/battles/:id/finalize-args + /claim-args - pure call-arg builders.
  app.get<{ Params: { id: string } }>("/game/arena/battles/:id/finalize-args", async (req, reply) => {
    const battleId = parseId(req.params.id);
    if (battleId === null) return reply.code(400).send({ error: "battle id must be a positive integer" });
    return finalizeArgs(battleId);
  });
  app.get<{ Params: { id: string } }>("/game/arena/battles/:id/claim-args", async (req, reply) => {
    const battleId = parseId(req.params.id);
    if (battleId === null) return reply.code(400).send({ error: "battle id must be a positive integer" });
    return claimArgs(battleId);
  });

  // GET /api/arena/tally?battleId= - KEYLESS tally recompute (public). Under /api/ so it is same-origin
  // reachable on the main domain (prod nginx proxies /api/* to the backend), exactly like /api/verify.
  app.get<{ Querystring: { battleId?: string } }>("/api/arena/tally", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!arenaVoteConfigured()) return reply.code(501).send({ error: "arena not configured on this deploy" });
    const battleId = parseId(req.query?.battleId);
    if (battleId === null) return reply.code(400).send({ error: "battleId (positive integer) required (?battleId=<n>)" });
    try {
      return await recomputeBattleTally(battleId, defaultTallyDeps());
    } catch (e) {
      return reply.code(502).send({ error: `tally recompute failed: ${String((e as any)?.message).slice(0, 120)}` });
    }
  });
}
