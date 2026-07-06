// SERVER-ONLY. FUSION routes (game layer) against AuraFusion.sol. Non-custodial: every user action
// (registerGenesis, requestFusion, executeFusion) is returned as COMPUTED ARGS for the user's own wallet -
// the server signs nothing here. The child pipeline (executeFusionPipeline) is the only heavy path (it runs a
// sponsor-paid TEE generation + 0G stores), gated behind auth + the configured check.
//
// GRACEFUL-OFF: until the phase-4 deploy wires AuraFusion (CONTRACTS.auraFusion == "" today), every route
// returns 501 - the same graceful gate as the Summon / secure-transfer flows.
import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import { agentsRead } from "../aura/contracts.js";
import { auraFusionRead, auraFusionConfigured } from "../aura/game/contracts.js";
import { genesisArgs, requestFusionArgs, executeFusionPipeline, verifyChildGenome, FuseError } from "../aura/game/fuse.js";

function parseId(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    return n >= 1 ? n : null;
  }
  return null;
}

export async function gameFuseRoutes(app: FastifyInstance): Promise<void> {
  // POST /game/fuse/genesis-args - the registerGenesis backfill args for an EXISTING agent the caller owns.
  app.post<{ Body: { agentId?: number } }>("/game/fuse/genesis-args", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!auraFusionConfigured()) return reply.code(501).send({ error: "fusion not configured on this deploy" });
    const agentId = parseId(req.body?.agentId);
    if (agentId === null) return reply.code(400).send({ error: "agentId (positive integer) required" });
    const owner = req.user.address;
    let styleFingerprint: string;
    let onChainOwner: string;
    try {
      const [agent, ownerRaw] = await Promise.all([agentsRead().getAgent(agentId), agentsRead().ownerOf(agentId)]);
      styleFingerprint = String(agent.styleFingerprint);
      onChainOwner = String(ownerRaw).toLowerCase();
    } catch {
      return reply.code(404).send({ error: `agent #${agentId} not found on-chain` });
    }
    if (onChainOwner !== owner.toLowerCase()) {
      return reply.code(403).send({ error: "registerGenesis is owner-gated: you do not own this agent" });
    }
    // guard: already registered?
    try {
      const fusable = await auraFusionRead().isFusable(agentId);
      if (fusable) return reply.code(409).send({ error: `agent #${agentId} already has a genome (already fusable)` });
    } catch {
      /* read hiccup -> let the on-chain "genome already set" revert be the backstop */
    }
    return genesisArgs(agentId, styleFingerprint);
  });

  // POST /game/fuse/request-args - the requestFusion (commit-phase) args (own both parents, fee attached).
  app.post<{ Body: { parentA?: number; parentB?: number } }>("/game/fuse/request-args", { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!auraFusionConfigured()) return reply.code(501).send({ error: "fusion not configured on this deploy" });
    const parentA = parseId(req.body?.parentA);
    const parentB = parseId(req.body?.parentB);
    if (parentA === null || parentB === null) return reply.code(400).send({ error: "parentA and parentB (positive integers) required" });
    const owner = req.user.address;
    // own-both precheck (the contract re-checks): both parents' current owner must be the caller.
    try {
      const [oa, ob] = await Promise.all([agentsRead().ownerOf(parentA), agentsRead().ownerOf(parentB)]);
      if (String(oa).toLowerCase() !== owner.toLowerCase()) return reply.code(403).send({ error: `you do not own parent #${parentA}` });
      if (String(ob).toLowerCase() !== owner.toLowerCase()) return reply.code(403).send({ error: `you do not own parent #${parentB}` });
    } catch {
      return reply.code(404).send({ error: "one or both parents not found on-chain" });
    }
    try {
      return await requestFusionArgs(owner, parentA, parentB);
    } catch (e) {
      if (e instanceof FuseError) return reply.code(e.status).send({ error: e.message });
      return reply.code(502).send({ error: `fusion read failed: ${String((e as any)?.message).slice(0, 120)}` });
    }
  });

  // POST /game/fuse/execute - run the child pipeline for a MINED fusion request the caller owns, returning the
  // executeFusion args (+ the child portrait, genome, memory verdict). This runs a sponsor-paid TEE generation.
  app.post<{ Body: { requestId?: number; childName?: string; royaltyBps?: number; creatorResaleBps?: number } }>(
    "/game/fuse/execute",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraFusionConfigured()) return reply.code(501).send({ error: "fusion not configured on this deploy" });
      const requestId = parseId(req.body?.requestId);
      if (requestId === null) return reply.code(400).send({ error: "requestId (positive integer) required" });
      const owner = req.user.address;
      // the request must belong to the caller (executeFusion is fuser-only on-chain; fail fast off-chain).
      try {
        const r = await auraFusionRead().requests(requestId);
        if (String(r.fuser) === ethers.ZeroAddress) return reply.code(404).send({ error: `no such fusion request #${requestId}` });
        if (String(r.fuser).toLowerCase() !== owner.toLowerCase()) return reply.code(403).send({ error: "this fusion request is not yours" });
      } catch {
        return reply.code(502).send({ error: "could not read the fusion request" });
      }
      try {
        const result = await executeFusionPipeline(requestId, {
          childName: req.body?.childName,
          royaltyBps: req.body?.royaltyBps,
          creatorResaleBps: req.body?.creatorResaleBps,
        });
        return result;
      } catch (e) {
        if (e instanceof FuseError) return reply.code(e.status).send({ error: e.message });
        return reply.code(500).send({ error: `fusion pipeline failed: ${String((e as any)?.message).slice(0, 200)}` });
      }
    },
  );

  // POST /game/fuse/finalize { childEncBrainRoot, agentId, txHash? } - after the fuser submits executeFusion,
  // promote the staged child brain (+ persona) to the concrete childId, so brainByAgentId(childId) resolves and
  // the agent-portrait endpoint serves the child's portrait. The FUSION analog of /agents/confirm-mint: auth'd,
  // and gated on the on-chain child actually carrying this encBrainRoot AND being owned by the caller.
  app.post<{ Body: { childEncBrainRoot?: string; agentId?: number; txHash?: string } }>(
    "/game/fuse/finalize",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraFusionConfigured()) return reply.code(501).send({ error: "fusion not configured on this deploy" });
      const childEncBrainRoot = typeof req.body?.childEncBrainRoot === "string" ? req.body.childEncBrainRoot : "";
      const agentId = parseId(req.body?.agentId);
      if (!childEncBrainRoot || agentId === null) {
        return reply.code(400).send({ error: "childEncBrainRoot and agentId (positive integer) required" });
      }
      const { promoteBrainByRoot } = await import("../aura/store.js");
      const { promotePersonaByRoot } = await import("../aura/persona-store.js");
      const { rawAgent } = await import("../aura/agents.js");
      // verify the on-chain child actually carries this encBrainRoot AND is owned by the caller (same gate as
      // /agents/confirm-mint: never promote a brain onto an agent the caller does not own / does not match).
      const agent = await rawAgent(agentId);
      if (!agent) return reply.code(404).send({ error: `child agent #${agentId} not found on-chain` });
      if (agent.encBrainRoot.toLowerCase() !== childEncBrainRoot.toLowerCase()) {
        return reply.code(409).send({ error: "childEncBrainRoot does not match the on-chain agent" });
      }
      if (agent.owner.toLowerCase() !== req.user.address.toLowerCase()) {
        return reply.code(403).send({ error: "you do not own this fusion child" });
      }
      // promoteBrainByRoot / promotePersonaByRoot are idempotent (only touch an as-yet-unpromoted row), so a
      // retry or a double-call is safe.
      const promoted = promoteBrainByRoot(childEncBrainRoot, agentId, req.user.address);
      const personaPromoted = promotePersonaByRoot(childEncBrainRoot, agentId);
      return { ok: true, promoted, personaPromoted, agentId };
    },
  );

  // GET /game/fuse/verify?requestId= - KEYLESS child-genome recompute from public chain data (no wallet, no
  // auth). A 3rd party recomputes the child genome from the parents' on-chain genomes + the on-chain fuseSeed.
  app.get<{ Querystring: { requestId?: string } }>("/game/fuse/verify", async (req, reply) => {
    reply.header("cache-control", "no-store");
    if (!auraFusionConfigured()) return reply.code(501).send({ error: "fusion not configured on this deploy" });
    const requestId = parseId(req.query?.requestId);
    if (requestId === null) return reply.code(400).send({ error: "requestId (positive integer) required (?requestId=<n>)" });
    try {
      return await verifyChildGenome(requestId);
    } catch (e) {
      if (e instanceof FuseError) return reply.code(e.status).send({ error: e.message });
      return reply.code(502).send({ error: `verify failed (target block may not be mined / hash unavailable): ${String((e as any)?.message).slice(0, 120)}` });
    }
  });
}
