// SERVER-ONLY. SQLite CRUD for the paid open-market AGENT SALE (Flow B, server-custodian escrow):
// the seller's standing LISTING + a buyer's in-flight ESCROW. The escrow holds REAL FUNDS between commit
// and settle, so it is persisted here (NEVER the in-memory transfer pending map). Tables live in db.ts.
import { db } from "./db.js";

export type EscrowStatus = "committed" | "settling" | "settled" | "refunded" | "expired" | "failed";

export interface SaleListing {
  agentId: number;
  seller: string;
  priceWei: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SaleEscrow {
  id: number;
  agentId: number;
  seller: string;
  buyer: string;
  priceWei: string;
  custodian: string;
  deadline: number; // unix seconds
  status: EscrowStatus;
  paymentTx: string | null;
  rekeyJson: string | null;
  transferTx: string | null;
  splitsJson: string | null;
  relationshipEpoch: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── listings ──────────────────────────────────────────────────────────────

/** Create or replace the active listing for an agent (one active listing per agent). */
export function upsertListing(agentId: number, seller: string, priceWei: string): SaleListing {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO agent_sale_listings (agent_id, seller, price_wei, active, created_at, updated_at)
       VALUES (?,?,?,1,?,?)
       ON CONFLICT(agent_id) DO UPDATE SET seller=excluded.seller, price_wei=excluded.price_wei, active=1, updated_at=excluded.updated_at`,
    )
    .run(agentId, seller.toLowerCase(), priceWei, now, now);
  return getListing(agentId)!;
}

/** Deactivate the listing for an agent (sold / cancelled). Idempotent. */
export function deactivateListing(agentId: number): void {
  db()
    .prepare(`UPDATE agent_sale_listings SET active=0, updated_at=? WHERE agent_id=?`)
    .run(new Date().toISOString(), agentId);
}

export function getListing(agentId: number): SaleListing | null {
  const r = db().prepare(`SELECT * FROM agent_sale_listings WHERE agent_id=?`).get(agentId) as any;
  return r ? rowToListing(r) : null;
}

/** The active listing for an agent, or null. */
export function getActiveListing(agentId: number): SaleListing | null {
  const l = getListing(agentId);
  return l && l.active ? l : null;
}

/** All active listings (for GET /market/agents). Newest-updated first. */
export function listActiveListings(): SaleListing[] {
  const rows = db()
    .prepare(`SELECT * FROM agent_sale_listings WHERE active=1 ORDER BY updated_at DESC`)
    .all() as any[];
  return rows.map(rowToListing);
}

function rowToListing(r: any): SaleListing {
  return {
    agentId: r.agent_id,
    seller: r.seller,
    priceWei: r.price_wei,
    active: !!r.active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── escrows ───────────────────────────────────────────────────────────────

/** Record a buyer's commit (one in-flight escrow row). Returns the created row (with its id). */
export function createEscrow(input: {
  agentId: number;
  seller: string;
  buyer: string;
  priceWei: string;
  custodian: string;
  deadline: number;
}): SaleEscrow {
  const now = new Date().toISOString();
  const info = db()
    .prepare(
      `INSERT INTO agent_sale_escrows (agent_id, seller, buyer, price_wei, custodian, deadline, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?, 'committed', ?, ?)`,
    )
    .run(
      input.agentId,
      input.seller.toLowerCase(),
      input.buyer.toLowerCase(),
      input.priceWei,
      input.custodian.toLowerCase(),
      input.deadline,
      now,
      now,
    );
  return getEscrow(Number(info.lastInsertRowid))!;
}

export function getEscrow(id: number): SaleEscrow | null {
  const r = db().prepare(`SELECT * FROM agent_sale_escrows WHERE id=?`).get(id) as any;
  return r ? rowToEscrow(r) : null;
}

/**
 * Atomically bind a buyer->custodian funding tx to this escrow. Returns true if newly claimed (or already
 * this exact tx = idempotent), false if the tx is already bound to a DIFFERENT escrow (the partial UNIQUE
 * index rejects the reuse) or the escrow already carries a different payment tx (double-spend guard).
 */
export function claimPaymentTx(escrowId: number, paymentTx: string): boolean {
  const cur = getEscrow(escrowId);
  if (!cur) return false;
  const tx = paymentTx.toLowerCase();
  if (cur.paymentTx) return cur.paymentTx.toLowerCase() === tx; // already bound: idempotent iff same tx
  try {
    const r = db()
      .prepare(`UPDATE agent_sale_escrows SET payment_tx=?, updated_at=? WHERE id=? AND payment_tx IS NULL`)
      .run(tx, new Date().toISOString(), escrowId);
    return r.changes > 0;
  } catch {
    // UNIQUE(payment_tx) violation -> this funding tx already settled/backs another escrow.
    return false;
  }
}

/**
 * Atomically claim the exclusive right to settle this escrow: flip committed -> settling. Returns true only
 * for the ONE caller that wins the flip (serializes concurrent settle calls). A false means the escrow is
 * already settling / settled / terminal (the caller inspects the current status to decide the response).
 */
export function beginSettle(id: number): boolean {
  const r = db()
    .prepare(`UPDATE agent_sale_escrows SET status='settling', updated_at=? WHERE id=? AND status='committed'`)
    .run(new Date().toISOString(), id);
  return r.changes > 0;
}

/** Release the settle claim back to committed (keeps payment_tx / rekey / transfer_tx) after a transient
 *  failure, so the buyer can retry settle or refund after the deadline. */
export function resetEscrowToCommitted(id: number, error?: string | null): void {
  db()
    .prepare(`UPDATE agent_sale_escrows SET status='committed', error=?, updated_at=? WHERE id=? AND status='settling'`)
    .run(error ?? null, new Date().toISOString(), id);
}

/** Persist the prepared re-encryption (PendingRekey JSON) before submitting the transfer (crash-resumable). */
export function setEscrowRekey(id: number, rekeyJson: string): void {
  db().prepare(`UPDATE agent_sale_escrows SET rekey_json=?, updated_at=? WHERE id=?`).run(rekeyJson, new Date().toISOString(), id);
}

/** Persist the on-chain transfer tx immediately after it confirms (before the split), so a crash between the
 *  transfer and the split is resumable (the retry sees the move already landed and skips re-transferring). */
export function setEscrowTransferTx(id: number, transferTx: string): void {
  db().prepare(`UPDATE agent_sale_escrows SET transfer_tx=?, updated_at=? WHERE id=?`).run(transferTx, new Date().toISOString(), id);
}

/** Mark an escrow settled with the on-chain transfer tx + the split legs + the buyer's fresh memory epoch. */
export function markEscrowSettled(
  id: number,
  fields: { transferTx: string; splitsJson: string; relationshipEpoch: number },
): void {
  db()
    .prepare(
      `UPDATE agent_sale_escrows SET status='settled', transfer_tx=?, splits_json=?, relationship_epoch=?, error=NULL, updated_at=? WHERE id=?`,
    )
    .run(fields.transferTx, fields.splitsJson, fields.relationshipEpoch, new Date().toISOString(), id);
}

/** Set a terminal / error status (refunded | expired | failed) with an optional message. */
export function setEscrowStatus(id: number, status: EscrowStatus, error?: string | null): void {
  db()
    .prepare(`UPDATE agent_sale_escrows SET status=?, error=?, updated_at=? WHERE id=?`)
    .run(status, error ?? null, new Date().toISOString(), id);
}

/** Atomically flip status `from` -> `to` for ONE winner (serialization primitive). Returns true iff flipped. */
export function flipStatus(id: number, from: EscrowStatus, to: EscrowStatus): boolean {
  const r = db()
    .prepare(`UPDATE agent_sale_escrows SET status=?, updated_at=? WHERE id=? AND status=?`)
    .run(to, new Date().toISOString(), id, from);
  return r.changes > 0;
}

/** Record the split / refund legs JSON (used by the refund path to persist its refund tx). */
export function setEscrowSplitsJson(id: number, splitsJson: string): void {
  db().prepare(`UPDATE agent_sale_escrows SET splits_json=?, updated_at=? WHERE id=?`).run(splitsJson, new Date().toISOString(), id);
}

function rowToEscrow(r: any): SaleEscrow {
  return {
    id: r.id,
    agentId: r.agent_id,
    seller: r.seller,
    buyer: r.buyer,
    priceWei: r.price_wei,
    custodian: r.custodian,
    deadline: r.deadline,
    status: r.status,
    paymentTx: r.payment_tx ?? null,
    rekeyJson: r.rekey_json ?? null,
    transferTx: r.transfer_tx ?? null,
    splitsJson: r.splits_json ?? null,
    relationshipEpoch: r.relationship_epoch ?? null,
    error: r.error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
