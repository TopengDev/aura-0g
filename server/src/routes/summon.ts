// Public Summon reads for the webapp. No auth: a summon is self-funded by the BUYER (unlike /generate,
// which is sponsor-paid + owner-scoped), and a request's status is public.
//   GET /summon/agent/:agentId       -> is this agent summonable + the on-chain commission price
//   GET /summon/:requestId/status     -> the watcher's staged journal merged with the on-chain settled
//                                        state (what the ~42s progress UX polls)
import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import { db } from "../aura/db.js";
import { summonRead } from "../aura/contracts.js";
import { CONTRACTS } from "../aura/config.js";

interface SummonRow {
  request_id: number;
  agent_id: number;
  agent_name: string | null;
  buyer: string;
  fee: string;
  deadline: number;
  status: string;
  image_root: string | null;
  token_id: number | null;
  fulfill_tx: string | null;
  error: string | null;
}

export async function summonRoutes(app: FastifyInstance): Promise<void> {
  // GET /summon/agent/:agentId -> { agentId, enabled, summonable, priceWei, price }
  app.get<{ Params: { agentId: string } }>("/summon/agent/:agentId", async (req, reply) => {
    const agentId = Number(req.params.agentId);
    if (!Number.isInteger(agentId) || agentId < 1) return reply.code(400).send({ error: "bad agentId" });
    if (!CONTRACTS.summonEscrow) {
      return { agentId, enabled: false, summonable: false, priceWei: "0", price: "0", escrow: null };
    }
    try {
      const price: bigint = await summonRead().summonPrice(agentId);
      return {
        agentId,
        enabled: true,
        summonable: price > 0n,
        priceWei: price.toString(),
        price: ethers.formatEther(price),
        escrow: CONTRACTS.summonEscrow,
      };
    } catch (e: unknown) {
      return reply.code(502).send({ error: `chain read failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}` });
    }
  });

  // GET /summon/:requestId/status -> the off-chain journal (watcher stages) merged with on-chain truth.
  app.get<{ Params: { requestId: string } }>("/summon/:requestId/status", async (req, reply) => {
    const id = Number(req.params.requestId);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "bad requestId" });

    const row = db().prepare(`SELECT * FROM summon_requests WHERE request_id = ?`).get(id) as SummonRow | undefined;

    let onChain: { buyer: string; agentId: number; fee: string; deadline: number; settled: boolean } | null = null;
    if (CONTRACTS.summonEscrow) {
      try {
        const r = await summonRead().requests(id);
        if (r.buyer && r.buyer !== ethers.ZeroAddress) {
          onChain = { buyer: r.buyer, agentId: Number(r.agentId), fee: r.fee.toString(), deadline: Number(r.deadline), settled: r.settled };
        }
      } catch {
        /* chain read best-effort */
      }
    }

    if (!row && !onChain) return reply.code(404).send({ error: "no such summon request" });

    const feeWei = row?.fee ?? onChain?.fee ?? null;
    const settled = onChain?.settled ?? (row?.status === "fulfilled" || row?.status === "settled");
    const deadline = row?.deadline ?? onChain?.deadline ?? 0;
    const expired = !settled && deadline > 0 && Math.floor(Date.now() / 1000) > deadline;

    return {
      requestId: id,
      // the journal status is richer (generating/fulfilling); fall back to on-chain when the watcher is off.
      status: row?.status ?? (settled ? "settled" : "pending"),
      agentId: row?.agent_id ?? onChain?.agentId ?? null,
      agentName: row?.agent_name ?? null,
      buyer: row?.buyer ?? onChain?.buyer ?? null,
      feeWei,
      fee: feeWei ? ethers.formatEther(BigInt(feeWei)) : null,
      deadline,
      imageRoot: row?.image_root ?? null,
      tokenId: row?.token_id ?? null,
      fulfillTx: row?.fulfill_tx ?? null,
      settled,
      expired,
      error: row?.error ?? null,
    };
  });
}
