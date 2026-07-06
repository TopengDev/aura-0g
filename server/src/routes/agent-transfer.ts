// POST /agents/:id/transfer/prepare + /confirm (authed) - the ERC-7857 SECURE-TRANSFER flow, wired.
//
// The de-mock's server half, exposed as an app endpoint. Mirrors the create/mint shape: the SERVER (which
// holds the trusted re-encryption oracle key + the brain custody) computes the oracle-signed transfer args;
// the USER submits AuraINFT.transfer() with THEIR OWN wallet (non-custodial). Ownership only ever moves
// through that proof-gated on-chain call (raw ERC721 transfers revert on AuraINFT).
//
//   prepare: owner-only. Re-encrypts the brain to the buyer, seals the fresh key to the buyer's pubkey,
//            uploads the new envelope, signs the EIP-191 transfer proof, returns AuraINFT.transfer() args.
//   confirm: after the user's transfer tx lands, verifies ownerOf == buyer ON-CHAIN, then re-custodies the
//            brain to the buyer AND fires the memory DUAL-WALL reseal (the buyer's relationship starts fresh;
//            the seller's epoch key is dropped) - so the on-chain re-key and the off-chain memory wall move
//            together. NEVER prints or returns a private key.
//
// The prepare/confirm BODIES live in aura/sale-service.ts (prepareSecureTransfer / confirmSecureTransfer) so
// the priced open-market sale-settle path (routes/agent-sale.ts) reuses the EXACT same proven logic. This
// route keeps the directed-transfer surface: owner auth, the per-owner rate limit, and the in-memory pending
// map (a prepared-but-unsubmitted directed transfer is cheap to re-prepare, so losing it on restart is fine;
// the SALE path persists its equivalent in the escrow row because it holds money).
import type { FastifyInstance } from "fastify";
import { auraInftConfigured } from "../aura/contracts.js";
import { rateLimit } from "../aura/ratelimit.js";
import { prepareSecureTransfer, confirmSecureTransfer, SaleError, type PendingRekey } from "../aura/sale-service.js";

interface PendingTransfer extends PendingRekey {
  createdAt: number;
}
const pending = new Map<number, PendingTransfer>();

function parseAgentId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function agentTransferRoutes(app: FastifyInstance): Promise<void> {
  // POST /agents/:id/transfer/prepare  { to, toPubkey? } -> AuraINFT.transfer() args (owner-only)
  app.post<{ Params: { id: string }; Body: { to?: string; toPubkey?: string } }>(
    "/agents/:id/transfer/prepare",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraInftConfigured()) {
        return reply.code(501).send({ error: "secure transfer not enabled (AuraINFT is not wired on this deployment)" });
      }
      const from = req.user.address;
      const agentId = parseAgentId(req.params.id);
      if (agentId === null) return reply.code(400).send({ error: "bad agentId" });

      // rate limit: prepare runs an oracle re-encryption + a sponsor-paid 0G upload of the new envelope.
      const rl = rateLimit(`transfer:${from}`, 5, 60_000);
      if (!rl.ok) return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });

      const to = (req.body?.to ?? "").trim();
      try {
        const { pending: rekey, args } = await prepareSecureTransfer(agentId, from, to, req.body?.toPubkey);
        pending.set(agentId, { ...rekey, createdAt: Date.now() });
        // the args the USER submits to AuraINFT.transfer(...) with their own wallet. NO private key is returned.
        return args;
      } catch (e) {
        if (e instanceof SaleError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );

  // POST /agents/:id/transfer/confirm - after the user's transfer tx lands: re-custody + memory reseal.
  app.post<{ Params: { id: string } }>(
    "/agents/:id/transfer/confirm",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraInftConfigured()) return reply.code(501).send({ error: "secure transfer not enabled" });
      const agentId = parseAgentId(req.params.id);
      if (agentId === null) return reply.code(400).send({ error: "bad agentId" });
      const p = pending.get(agentId);
      if (!p) return reply.code(404).send({ error: "no pending transfer for this agent (prepare first)" });

      try {
        const { epoch } = await confirmSecureTransfer(agentId, p);
        pending.delete(agentId);
        return { ok: true, agentId, newOwner: p.to, brainRecustodied: true, memoryReset: true, relationshipEpoch: epoch };
      } catch (e) {
        if (e instanceof SaleError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    },
  );
}
