// POST /agents/:id/sale/{list,commit,settle,refund} + GET /market/agents - the PAID OPEN-MARKET AGENT SALE
// (Flow B: server-custodian escrow, NO new on-chain contract).
//
// The headline "buy a living agent and ownership + brain + memory + royalty all transfer" feature. The
// AuraMarketplace can NOT be reused (its buy() safeTransferFrom reverts on the spec-strict AuraINFT), and the
// legacy AgentRegistry is 0x000 on mainnet, so no priced agent path existed. Flow B closes that with a TRUSTED
// custodian (honestly disclosed in the UI): the platform holds the buyer's payment between commit and settle,
// submits the proof-gated AuraINFT.transfer with its own wallet, then splits the escrowed ETH (EIP-2981
// creator royalty -> creator, platform fee -> platform, remainder -> seller). The re-encrypt / re-seal /
// dual-wall-memory logic is the EXACT proven code from the directed transfer, shared via aura/sale-service.ts.
//
//   POST /agents/:id/sale/list    (owner)  -> record a priced listing (validates ownerOf == caller + approval)
//   GET  /market/agents           (public) -> the active agent sales (replaces the dead AgentRegistry scan)
//   POST /agents/:id/sale/commit  (buyer)  -> reserve an escrow + return the custodian address to pay (SIWE pubkey required)
//   POST /agents/:id/sale/settle  (buyer)  -> verify payment -> transfer -> confirm -> split the ETH
//   POST /agents/:id/sale/refund  (buyer)  -> refund an unsettled escrow past its deadline (anti-rug)
import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import { SALE_PLATFORM, SALE_PLATFORM_BPS, agentSaleWindowSec, GALILEO } from "../aura/config.js";
import { auraInftConfigured, auraInftRead, readProvider } from "../aura/contracts.js";
import { pubkeyOf, storePubkey, pubkeyMatchesAddress } from "../aura/pubkey.js";
import { brainByAgentId } from "../aura/store.js";
import { rateLimit } from "../aura/ratelimit.js";
import {
  upsertListing,
  deactivateListing,
  getActiveListing,
  listActiveListings,
  createEscrow,
  getEscrow,
  claimPaymentTx,
  beginSettle,
  resetEscrowToCommitted,
  setEscrowStatus,
  flipStatus,
  setEscrowSplitsJson,
  getPayoutLeg,
  type SaleEscrow,
} from "../aura/sale-store.js";
import { settleAgentSale, refundAgentSale, computeSplit, SaleError, type SplitLeg } from "../aura/sale-service.js";

function parseAgentId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Parse a price into wei from either `priceWei` (decimal string) or `priceEther` (decimal string). > 0. */
function parsePriceWei(body: { priceWei?: string; priceEther?: string } | undefined): bigint | null {
  try {
    if (body?.priceWei != null && String(body.priceWei).trim() !== "") {
      const w = BigInt(String(body.priceWei).trim());
      return w > 0n ? w : null;
    }
    if (body?.priceEther != null && String(body.priceEther).trim() !== "") {
      const w = ethers.parseEther(String(body.priceEther).trim());
      return w > 0n ? w : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Confirm the buyer's funding tx: to == custodian, from == buyer, value >= price, mined + succeeded. */
async function verifyPayment(
  paymentTx: string,
  expect: { custodian: string; buyer: string; priceWei: bigint },
): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(paymentTx)) throw new SaleError(400, "paymentTx must be a 0x transaction hash");
  const provider = readProvider();
  let tx: ethers.TransactionResponse | null;
  let rcpt: ethers.TransactionReceipt | null;
  try {
    [tx, rcpt] = await Promise.all([provider.getTransaction(paymentTx), provider.getTransactionReceipt(paymentTx)]);
  } catch {
    throw new SaleError(502, "could not read the payment transaction from the chain");
  }
  if (!tx || !rcpt) throw new SaleError(400, "payment transaction not found or not yet mined");
  if (rcpt.status !== 1) throw new SaleError(400, "payment transaction reverted on-chain");
  if (!tx.to || tx.to.toLowerCase() !== expect.custodian.toLowerCase()) {
    throw new SaleError(400, "payment was not sent to the sale custodian");
  }
  if (tx.from.toLowerCase() !== expect.buyer.toLowerCase()) {
    throw new SaleError(400, "payment was not sent by the committing buyer");
  }
  if (tx.value < expect.priceWei) {
    throw new SaleError(402, `underpaid: sent ${tx.value.toString()} wei, price is ${expect.priceWei.toString()} wei`);
  }
}

/** Shape a settled escrow into the settle response (for the idempotent already-settled return). */
function settledResponse(e: SaleEscrow) {
  let split: SplitLeg[] = [];
  try {
    split = e.splitsJson ? (JSON.parse(e.splitsJson) as SplitLeg[]) : [];
  } catch {
    /* leave empty */
  }
  return {
    ok: true,
    alreadySettled: true,
    escrowId: e.id,
    agentId: e.agentId,
    transferTx: e.transferTx,
    ownerNow: e.buyer,
    relationshipEpoch: e.relationshipEpoch,
    split,
  };
}

export async function agentSaleRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /agents/:id/sale/list (owner-only): record a priced listing ──────────────────────────────
  app.post<{ Params: { id: string }; Body: { priceWei?: string; priceEther?: string } }>(
    "/agents/:id/sale/list",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraInftConfigured()) return reply.code(501).send({ error: "agent sales not enabled (AuraINFT is not wired)" });
      const agentId = parseAgentId(req.params.id);
      if (agentId === null) return reply.code(400).send({ error: "bad agentId" });
      const seller = req.user.address;

      const rl = rateLimit(`sale-list:${seller}`, 10, 60_000);
      if (!rl.ok) return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });

      const priceWei = parsePriceWei(req.body);
      if (priceWei === null) return reply.code(400).send({ error: "price required (priceEther or priceWei, > 0)" });

      const inft = auraInftRead();
      let owner: string;
      try {
        owner = (await inft.ownerOf(agentId)) as string;
      } catch {
        return reply.code(404).send({ error: `agent #${agentId} not found on AuraINFT` });
      }
      if (owner.toLowerCase() !== seller.toLowerCase()) {
        return reply.code(403).send({ error: "only the current on-chain owner may list this agent" });
      }

      // brain custody is required to re-encrypt at settle (a sale that could never settle must not be listed).
      if (!brainByAgentId(agentId)) {
        return reply.code(409).send({ error: "no brain custody for this agent on this backend - it cannot be securely sold here" });
      }

      // The platform CUSTODIAN submits the transfer at settle, so unless the seller IS the platform it must
      // have approved the platform as an ERC-721 operator (isApprovedForAll) - exactly like approving a
      // marketplace. Verified now so a buyer never commits + pays against a listing that could not settle.
      if (seller.toLowerCase() !== SALE_PLATFORM.toLowerCase()) {
        let approved = false;
        try {
          approved =
            (await inft.isApprovedForAll(seller, SALE_PLATFORM)) === true ||
            ((await inft.getApproved(agentId)) as string).toLowerCase() === SALE_PLATFORM.toLowerCase();
        } catch {
          approved = false;
        }
        if (!approved) {
          return reply.code(409).send({
            error: "approve the sale custodian first: call AuraINFT.setApprovalForAll(custodian, true)",
            custodian: SALE_PLATFORM,
          });
        }
      }

      const listing = upsertListing(agentId, seller, priceWei.toString());
      return {
        ok: true,
        agentId,
        seller: listing.seller,
        priceWei: listing.priceWei,
        priceEther: ethers.formatEther(priceWei),
        custodian: SALE_PLATFORM,
        chainId: GALILEO.chainId,
      };
    },
  );

  // ── GET /market/agents (public): active agent sales (replaces the dead AgentRegistry scan) ────────
  app.get("/market/agents", async () => {
    const inft = auraInftConfigured() ? auraInftRead() : null;
    const listings = listActiveListings();

    const activeSales = await Promise.all(
      listings.map(async (l) => {
        const base = {
          agentId: l.agentId,
          seller: l.seller,
          priceWei: l.priceWei,
          price: ethers.formatEther(BigInt(l.priceWei)),
          custodian: SALE_PLATFORM,
        };
        if (!inft) return { ...base, stale: false };
        try {
          // enrich + stale-check: the on-chain owner must still be the seller (else the listing is stale).
          const [owner, agent] = await Promise.all([inft.ownerOf(l.agentId), inft.getAgent(l.agentId)]);
          const stale = (owner as string).toLowerCase() !== l.seller.toLowerCase();
          return {
            ...base,
            name: agent.name as string,
            styleVersion: Number(agent.styleVersion),
            creatorResaleBps: Number(agent.creatorResaleBps),
            stale,
          };
        } catch {
          return { ...base, stale: false };
        }
      }),
    );

    return {
      custodian: SALE_PLATFORM,
      platform: SALE_PLATFORM,
      platformBps: SALE_PLATFORM_BPS,
      platformPct: SALE_PLATFORM_BPS / 100,
      custodial: true, // HONEST disclosure: server-custodian settlement (trustless on-chain escrow is post-vote)
      chainId: GALILEO.chainId,
      activeSales: activeSales.filter((s) => !s.stale),
      count: activeSales.filter((s) => !s.stale).length,
    };
  });

  // ── POST /agents/:id/sale/commit (buyer): reserve an escrow, return the custodian to pay ──────────
  app.post<{ Params: { id: string }; Body: { buyerPubkey?: string } }>(
    "/agents/:id/sale/commit",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraInftConfigured()) return reply.code(501).send({ error: "agent sales not enabled (AuraINFT is not wired)" });
      const agentId = parseAgentId(req.params.id);
      if (agentId === null) return reply.code(400).send({ error: "bad agentId" });
      const buyer = req.user.address;

      // rate limit commit like prepare (it snapshots an escrow + re-reads the chain).
      const rl = rateLimit(`sale-commit:${buyer}`, 5, 60_000);
      if (!rl.ok) return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });

      const listing = getActiveListing(agentId);
      if (!listing) return reply.code(404).send({ error: "this agent is not listed for sale" });
      if (listing.seller.toLowerCase() === buyer.toLowerCase()) {
        return reply.code(400).send({ error: "you already own this agent (you are the seller)" });
      }

      // SIWE pubkey required (else 409): settle re-encrypts + ECIES-seals the brain to the buyer's pubkey.
      // Accept an explicit buyerPubkey (validated to hash to the buyer) and persist it; else require a prior login.
      const explicit = (req.body?.buyerPubkey ?? "").trim();
      if (explicit) {
        if (!pubkeyMatchesAddress(explicit, buyer)) {
          return reply.code(400).send({ error: "buyerPubkey does not correspond to your address" });
        }
        storePubkey(buyer, explicit);
      }
      if (!pubkeyOf(buyer)) {
        return reply.code(409).send({ error: "sign in first (SIWE): the brain is re-sealed to your wallet pubkey on settle" });
      }

      // stale-listing guard: the seller must still own the agent on-chain.
      try {
        const owner = (await auraInftRead().ownerOf(agentId)) as string;
        if (owner.toLowerCase() !== listing.seller.toLowerCase()) {
          deactivateListing(agentId);
          return reply.code(409).send({ error: "listing is stale (the seller no longer owns this agent)" });
        }
      } catch {
        return reply.code(502).send({ error: "chain read failed" });
      }

      const deadline = Math.floor(Date.now() / 1000) + agentSaleWindowSec();
      const escrow = createEscrow({
        agentId,
        seller: listing.seller,
        buyer,
        priceWei: listing.priceWei,
        custodian: SALE_PLATFORM,
        deadline,
      });

      return {
        ok: true,
        escrowId: escrow.id,
        agentId,
        seller: listing.seller,
        buyer: escrow.buyer,
        custodian: SALE_PLATFORM,
        amountWei: escrow.priceWei,
        amountEther: ethers.formatEther(BigInt(escrow.priceWei)),
        deadline,
        chainId: GALILEO.chainId,
        custodial: true,
        instructions: "send exactly amountWei to `custodian`, then POST /agents/:id/sale/settle with { escrowId, paymentTx }",
      };
    },
  );

  // ── POST /agents/:id/sale/settle (buyer): verify payment -> transfer -> confirm -> split ──────────
  app.post<{ Params: { id: string }; Body: { escrowId?: number; paymentTx?: string } }>(
    "/agents/:id/sale/settle",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraInftConfigured()) return reply.code(501).send({ error: "agent sales not enabled (AuraINFT is not wired)" });
      const agentId = parseAgentId(req.params.id);
      if (agentId === null) return reply.code(400).send({ error: "bad agentId" });
      const buyer = req.user.address;

      const rl = rateLimit(`sale-settle:${buyer}`, 5, 60_000);
      if (!rl.ok) return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });

      const escrowId = Number(req.body?.escrowId);
      if (!Number.isInteger(escrowId) || escrowId < 1) return reply.code(400).send({ error: "escrowId required" });
      const paymentTx = (req.body?.paymentTx ?? "").trim();
      if (!paymentTx) return reply.code(400).send({ error: "paymentTx (the buyer->custodian funding tx) required" });

      let escrow = getEscrow(escrowId);
      if (!escrow || escrow.agentId !== agentId || escrow.buyer.toLowerCase() !== buyer.toLowerCase()) {
        return reply.code(404).send({ error: "escrow not found for this agent + buyer" });
      }
      if (escrow.status === "settled") return settledResponse(escrow);
      if (escrow.status === "settling") return reply.code(409).send({ error: "settle already in progress" });
      if (escrow.status === "refunded" || escrow.status === "expired") {
        return reply.code(409).send({ error: `escrow is ${escrow.status}` });
      }
      if (Math.floor(Date.now() / 1000) > escrow.deadline) {
        return reply.code(409).send({ error: "escrow deadline passed - use /sale/refund instead" });
      }

      // verify the buyer actually funded the custodian (read-only) BEFORE claiming the settle.
      try {
        await verifyPayment(paymentTx, { custodian: escrow.custodian, buyer, priceWei: BigInt(escrow.priceWei) });
      } catch (e) {
        if (e instanceof SaleError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }

      // serialize: exactly one caller flips committed -> settling.
      if (!beginSettle(escrowId)) {
        const cur = getEscrow(escrowId);
        if (cur?.status === "settled") return settledResponse(cur);
        return reply.code(409).send({ error: "settle already in progress" });
      }

      // bind the funding tx to THIS escrow (double-spend guard via the partial UNIQUE index).
      if (!claimPaymentTx(escrowId, paymentTx)) {
        resetEscrowToCommitted(escrowId, "payment tx already used by another escrow");
        return reply.code(409).send({ error: "this payment transaction is already bound to another escrow" });
      }

      escrow = getEscrow(escrowId)!; // reload with payment_tx + status=settling
      try {
        const res = await settleAgentSale(escrow);
        return {
          ok: true,
          escrowId,
          agentId,
          transferTx: res.transferTx,
          ownerNow: res.ownerNow,
          styleVersion: res.styleVersion,
          relationshipEpoch: res.relationshipEpoch,
          split: res.split,
          custodial: true,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // MONEY-SAFETY (H2): NEVER reset a post-send failure straight back to committed without a chain check.
        // Only reset to 'committed' when the transfer PROVABLY did NOT land (owner is still the seller); the
        // funds stay with the custodian and the buyer can retry or, after the deadline, refund. If the transfer
        // already landed (or the chain is unreadable), leave the escrow 'settling' so the idempotent boot reaper
        // completes it - a reset on a half-done (post-move) settle would re-open refund/re-settle races.
        let transferLanded = true; // fail-closed default: an unreadable chain must NOT trigger a reset
        try {
          transferLanded = ((await auraInftRead().ownerOf(agentId)) as string).toLowerCase() === buyer.toLowerCase();
        } catch {
          transferLanded = true;
        }
        if (!transferLanded) resetEscrowToCommitted(escrowId, msg.slice(0, 300));
        req.log.error(
          { err: msg, escrowId, transferLanded },
          transferLanded ? "agent sale settle failed post-transfer - left 'settling' for idempotent boot-reconcile" : "agent sale settle failed pre-transfer - reset to committed (retryable)",
        );
        const status = e instanceof SaleError ? e.status : 502;
        return reply.code(status).send({ error: `settle failed: ${msg.slice(0, 200)}`, ...(transferLanded ? { willReconcile: true } : {}) });
      }
    },
  );

  // ── POST /agents/:id/sale/refund (buyer): refund an unsettled escrow past its deadline ────────────
  app.post<{ Params: { id: string }; Body: { escrowId?: number; paymentTx?: string } }>(
    "/agents/:id/sale/refund",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const agentId = parseAgentId(req.params.id);
      if (agentId === null) return reply.code(400).send({ error: "bad agentId" });
      const buyer = req.user.address;

      const rl = rateLimit(`sale-refund:${buyer}`, 5, 60_000);
      if (!rl.ok) return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });

      const escrowId = Number(req.body?.escrowId);
      if (!Number.isInteger(escrowId) || escrowId < 1) return reply.code(400).send({ error: "escrowId required" });

      let escrow = getEscrow(escrowId);
      if (!escrow || escrow.agentId !== agentId || escrow.buyer.toLowerCase() !== buyer.toLowerCase()) {
        return reply.code(404).send({ error: "escrow not found for this agent + buyer" });
      }
      if (escrow.status === "settled") return reply.code(409).send({ error: "escrow already settled (the sale completed)" });
      if (escrow.status === "settling") return reply.code(409).send({ error: "a settle is in progress" });
      if (escrow.status === "refunded") {
        let refundTx: string | null = null;
        try {
          refundTx = escrow.splitsJson ? (JSON.parse(escrow.splitsJson).refund?.tx ?? null) : null;
        } catch {
          /* ignore */
        }
        return { ok: true, refunded: true, alreadyRefunded: true, escrowId, refundTx };
      }
      if (escrow.status === "expired") return { ok: true, refunded: false, escrowId, note: "no payment was recorded; nothing to refund" };

      if (Math.floor(Date.now() / 1000) <= escrow.deadline) {
        return reply.code(409).send({ error: "not yet expired - the escrow is still settleable until its deadline" });
      }

      // MONEY-SAFETY: never refund if the transfer already landed (a prior partial settle moved ownership to
      // the buyer). Refunding then would let the buyer keep the agent AND reclaim the payment. Fail closed on
      // an unreadable chain (a refund that cannot prove the transfer did NOT happen must not disburse).
      try {
        const ownerNow = (await auraInftRead().ownerOf(agentId)) as string;
        if (ownerNow.toLowerCase() === buyer.toLowerCase()) {
          return reply.code(409).send({ error: "the agent already transferred to you - this sale completed and cannot be refunded" });
        }
      } catch {
        return reply.code(502).send({ error: "chain read failed - refusing to refund without confirming the transfer did not happen" });
      }

      // claim the refund exclusively: committed -> refunded (optimistic). Only the winner disburses.
      if (!flipStatus(escrowId, "committed", "refunded")) {
        return reply.code(409).send({ error: "escrow is not in a refundable state" });
      }

      const paymentTx = (req.body?.paymentTx ?? "").trim() || escrow.paymentTx || "";
      if (!paymentTx) {
        // nothing was ever paid to the custodian -> just expire the escrow (no funds to return).
        setEscrowStatus(escrowId, "expired", "no payment recorded at refund");
        return { ok: true, refunded: false, escrowId, note: "no payment was recorded; nothing to refund" };
      }

      // verify the payment (defensively) + bind it, then send the price back to the buyer.
      try {
        await verifyPayment(paymentTx, { custodian: escrow.custodian, buyer, priceWei: BigInt(escrow.priceWei) });
      } catch (e) {
        flipStatus(escrowId, "refunded", "committed"); // reset the optimistic claim
        if (e instanceof SaleError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
      if (!claimPaymentTx(escrowId, paymentTx)) {
        flipStatus(escrowId, "refunded", "committed");
        return reply.code(409).send({ error: "this payment transaction is bound to another escrow" });
      }

      escrow = getEscrow(escrowId)!;
      try {
        const { refundTx } = await refundAgentSale(escrow);
        setEscrowSplitsJson(escrowId, JSON.stringify({ refund: { receiver: buyer.toLowerCase(), wei: escrow.priceWei, tx: refundTx } }));
        return { ok: true, refunded: true, escrowId, refundTx, amountWei: escrow.priceWei, amountEther: ethers.formatEther(BigInt(escrow.priceWei)) };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // MONEY-SAFETY (H2): only reopen to 'committed' if NOTHING was broadcast (no refund sentinel). If a
        // refund tx may already be out, keep the escrow 'refunded' so a settle can never pay out an
        // already-refunded escrow; a retried refund reconciles the recorded tx by chain read (never double-refunds).
        const refundLeg = getPayoutLeg(escrowId, "refund");
        if (!refundLeg) flipStatus(escrowId, "refunded", "committed"); // nothing sent -> safe to retry
        req.log.error({ err: msg, escrowId, mayHaveSent: !!refundLeg }, "agent sale refund failed");
        const status = e instanceof SaleError ? e.status : 502;
        return reply.code(status).send({ error: `refund failed: ${msg.slice(0, 200)}` });
      }
    },
  );
}
