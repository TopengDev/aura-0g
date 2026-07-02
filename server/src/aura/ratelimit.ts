// SERVER-ONLY. Cost guards for the SPONSOR wallet + a SQLite-backed fixed-window rate limiter.
// Ported from lib/aura/ratelimit.ts: keeps the IN-PROCESS gen guard + MAX_CONCURRENT semaphore
// (so a single instance never over-spends the sponsor), but moves the per-key window counters to
// SQLite so they survive a restart. The global generation cap + in-flight count live in-process
// (they bound the live process, which is what the semaphore is for).
import { db } from "./db.js";
import {
  GLOBAL_GEN_CAP,
  MAX_CONCURRENT_GEN,
  PER_ADDRESS_GEN_QUOTA,
  GLOBAL_CREATE_CAP,
  PER_ADDRESS_CREATE_QUOTA,
  MAX_CONCURRENT_CREATE,
} from "./config.js";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetInMs: number;
}

/** Fixed-window per-key limiter, persisted in SQLite. Default: 5 requests / 60s. */
export function rateLimit(key: string, limit = 5, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const d = db();
  const row = d.prepare(`SELECT count, reset_at FROM rate_counters WHERE bucket_key=?`).get(key) as
    | { count: number; reset_at: number }
    | undefined;
  if (!row || now >= row.reset_at) {
    d.prepare(
      `INSERT INTO rate_counters (bucket_key,count,reset_at) VALUES (?,1,?)
       ON CONFLICT(bucket_key) DO UPDATE SET count=1, reset_at=excluded.reset_at`,
    ).run(key, now + windowMs);
    return { ok: true, remaining: limit - 1, resetInMs: windowMs };
  }
  if (row.count >= limit) {
    return { ok: false, remaining: 0, resetInMs: row.reset_at - now };
  }
  d.prepare(`UPDATE rate_counters SET count=count+1 WHERE bucket_key=?`).run(key);
  return { ok: true, remaining: limit - (row.count + 1), resetInMs: row.reset_at - now };
}

// ── global cost guards (across all callers) - protect the funded sponsor wallet ──
//
// The LIFETIME spend budget (global total + per-address total) is PERSISTED in SQLite (cost_counters),
// so a restart is NOT a reset-and-replay of the budget (B-2/B-3). The CONCURRENCY semaphore (inFlight) is
// in-process - it bounds only the live process, which is exactly what a semaphore is for.
const inFlight = { gen: 0, create: 0, summon: 0 };

// ── SUMMON-path cost guard caps (SEPARATE from the free-tier gen cap) ──
// Paid summons must NOT draw from the same lifetime budget as the free /generate + chat generate_and_mint
// path: a burst of transient free-tier TEE/0G failures (which increment gen:global) could otherwise
// permanently erode the shared cap and STARVE the paid summon path. The summon path therefore gets its OWN
// persisted lifetime cap + per-address quota + in-process concurrency ceiling. Summons are paid on-chain
// (the buyer escrows a real fee), so this cap is purely a sponsor-compute-spend bound, decoupled from the
// free tier. Env-overridable knobs; the higher default reflects that summon demand is fee-gated. (Co-located
// with the guard that uses them rather than in config.ts to keep this M2 fix self-contained.)
const SUMMON_GEN_CAP = Number(process.env.AURA_MAX_SUMMON_GENERATIONS ?? 200);
const MAX_CONCURRENT_SUMMON_GEN = Number(process.env.AURA_MAX_CONCURRENT_SUMMON_GEN ?? 2);
const PER_ADDRESS_SUMMON_QUOTA = Number(process.env.AURA_PER_ADDRESS_SUMMON_QUOTA ?? 50);

// ── persisted lifetime counters (cost_counters table) ──
function counterGet(scope: string): number {
  const row = db().prepare(`SELECT count FROM cost_counters WHERE scope = ?`).get(scope) as { count: number } | undefined;
  return row?.count ?? 0;
}
function counterIncr(scope: string): void {
  db()
    .prepare(
      `INSERT INTO cost_counters (scope, count) VALUES (?, 1)
       ON CONFLICT(scope) DO UPDATE SET count = count + 1`,
    )
    .run(scope);
}
function addrScope(prefix: string, address?: string): string | null {
  if (!address) return null;
  return `${prefix}:addr:${address.toLowerCase()}`;
}

/**
 * Acquire a generation slot. Enforces, atomically (better-sqlite3 is synchronous):
 *   1. the persisted GLOBAL lifetime cap (sponsor compute spend),
 *   2. the in-process concurrency ceiling,
 *   3. a persisted PER-ADDRESS lifetime quota (anti-Sybil: one address cannot drain the shared cap).
 * Increments the persisted counters + the in-process in-flight count only on success. Pass the owner
 * address to enforce the per-address quota (the free /generate path); omit it for an unattributed caller.
 */
export function genGuardAcquire(address?: string): { ok: boolean; reason?: string } {
  const d = db();
  const aScope = addrScope("gen", address);
  const tx = d.transaction((): { ok: boolean; reason?: string } => {
    if (counterGet("gen:global") >= GLOBAL_GEN_CAP)
      return { ok: false, reason: `global generation cap reached (${GLOBAL_GEN_CAP})` };
    if (inFlight.gen >= MAX_CONCURRENT_GEN)
      return { ok: false, reason: `too many concurrent generations (max ${MAX_CONCURRENT_GEN}) - retry shortly` };
    if (aScope && counterGet(aScope) >= PER_ADDRESS_GEN_QUOTA)
      return { ok: false, reason: `per-address generation quota reached (${PER_ADDRESS_GEN_QUOTA})` };
    counterIncr("gen:global");
    if (aScope) counterIncr(aScope);
    inFlight.gen += 1;
    return { ok: true };
  });
  return tx();
}

export function genGuardRelease(): void {
  inFlight.gen = Math.max(0, inFlight.gen - 1);
}

/**
 * Refund a generation LIFETIME slot (NOT the concurrency count - use genGuardRelease for that). Called when
 * a guarded generation does NOT complete (transient TEE/0G failure, brain-unavailable, TEE-verify refusal,
 * storage error) so a non-producing gen cannot permanently erode the global cap or the caller's per-address
 * quota - otherwise transient flakiness would burn the sponsor's lifetime budget forever + charge a user's
 * quota for nothing. Decrements the persisted global + per-address counters, floored at 0. Mirrors
 * createGuardRefund. Successful generations are NEVER refunded (1 completed gen == 1 consumed slot).
 */
export function genGuardRefund(address?: string): void {
  const aScope = addrScope("gen", address);
  const d = db();
  d.transaction(() => {
    d.prepare(`UPDATE cost_counters SET count = MAX(0, count - 1) WHERE scope = ?`).run("gen:global");
    if (aScope) d.prepare(`UPDATE cost_counters SET count = MAX(0, count - 1) WHERE scope = ?`).run(aScope);
  })();
}

export function genStats() {
  return {
    totalGenerations: counterGet("gen:global"),
    inFlight: inFlight.gen,
    cap: GLOBAL_GEN_CAP,
    maxConcurrent: MAX_CONCURRENT_GEN,
    perAddressQuota: PER_ADDRESS_GEN_QUOTA,
  };
}

/**
 * B-3: acquire a create-agent slot. create-agent makes the SPONSOR pay for TWO 0G Storage uploads, so it
 * needs its OWN global cost cap (it used to be guarded only by a per-user rate window, with no global
 * bound, letting Sybil wallets collectively drain the sponsor's storage ledger). Same shape as the gen
 * guard: persisted global + per-address lifetime caps, in-process concurrency ceiling.
 */
export function createGuardAcquire(address?: string): { ok: boolean; reason?: string } {
  const d = db();
  const aScope = addrScope("create", address);
  const tx = d.transaction((): { ok: boolean; reason?: string } => {
    if (counterGet("create:global") >= GLOBAL_CREATE_CAP)
      return { ok: false, reason: `global create-agent cap reached (${GLOBAL_CREATE_CAP})` };
    if (inFlight.create >= MAX_CONCURRENT_CREATE)
      return { ok: false, reason: `too many concurrent create-agents (max ${MAX_CONCURRENT_CREATE}) - retry shortly` };
    if (aScope && counterGet(aScope) >= PER_ADDRESS_CREATE_QUOTA)
      return { ok: false, reason: `per-address create-agent quota reached (${PER_ADDRESS_CREATE_QUOTA})` };
    counterIncr("create:global");
    if (aScope) counterIncr(aScope);
    inFlight.create += 1;
    return { ok: true };
  });
  return tx();
}

export function createGuardRelease(): void {
  inFlight.create = Math.max(0, inFlight.create - 1);
}

/**
 * Refund a create-agent lifetime slot (NOT the concurrency count - use createGuardRelease for that). Used
 * when a guarded create fails VALIDATION before doing any sponsor-paid upload, so a cheap invalid request
 * cannot burn the lifetime budget. Decrements the persisted global + per-address counters, floored at 0.
 */
export function createGuardRefund(address?: string): void {
  const aScope = addrScope("create", address);
  const d = db();
  d.transaction(() => {
    d.prepare(`UPDATE cost_counters SET count = MAX(0, count - 1) WHERE scope = ?`).run("create:global");
    if (aScope) d.prepare(`UPDATE cost_counters SET count = MAX(0, count - 1) WHERE scope = ?`).run(aScope);
  })();
}

export function createStats() {
  return {
    totalCreates: counterGet("create:global"),
    inFlight: inFlight.create,
    cap: GLOBAL_CREATE_CAP,
    maxConcurrent: MAX_CONCURRENT_CREATE,
    perAddressQuota: PER_ADDRESS_CREATE_QUOTA,
  };
}

// ── SUMMON generation guard (paid path) ──
// A DEDICATED cost guard for the demand-pull Summon path, isolated from the free-tier gen guard so free-tier
// failures cannot exhaust the paid summon budget (and vice-versa). Same shape as genGuardAcquire: persisted
// global + per-address lifetime caps ('summon:global' / 'summon:addr:<buyer>') + an in-process concurrency
// ceiling. The watcher acquires per fulfillment attempt (attributes the per-address quota to the BUYER) and,
// on any non-fulfilling exit, REFUNDS via summonGuardRefund so a transient failure + its bounded retries
// never erode the cap - only a summon that actually fulfilled (minted to the buyer) consumes a slot.

/**
 * Acquire a SUMMON generation slot (paid path). Atomically (better-sqlite3 is synchronous) enforces the
 * persisted summon lifetime cap, the in-process concurrency ceiling, and the per-address (buyer) lifetime
 * quota. Increments the persisted counters + in-flight count only on success.
 */
export function summonGuardAcquire(address?: string): { ok: boolean; reason?: string } {
  const d = db();
  const aScope = addrScope("summon", address);
  const tx = d.transaction((): { ok: boolean; reason?: string } => {
    if (counterGet("summon:global") >= SUMMON_GEN_CAP)
      return { ok: false, reason: `global summon generation cap reached (${SUMMON_GEN_CAP})` };
    if (inFlight.summon >= MAX_CONCURRENT_SUMMON_GEN)
      return { ok: false, reason: `too many concurrent summon generations (max ${MAX_CONCURRENT_SUMMON_GEN}) - retry shortly` };
    if (aScope && counterGet(aScope) >= PER_ADDRESS_SUMMON_QUOTA)
      return { ok: false, reason: `per-address summon quota reached (${PER_ADDRESS_SUMMON_QUOTA})` };
    counterIncr("summon:global");
    if (aScope) counterIncr(aScope);
    inFlight.summon += 1;
    return { ok: true };
  });
  return tx();
}

export function summonGuardRelease(): void {
  inFlight.summon = Math.max(0, inFlight.summon - 1);
}

/**
 * Refund a SUMMON lifetime slot (NOT the concurrency count - use summonGuardRelease for that). Called when a
 * summon attempt does NOT fulfill (transient gen/fulfill failure, settled-elsewhere, expired). Decrements the
 * persisted global + per-address counters, floored at 0. Mirrors genGuardRefund/createGuardRefund.
 */
export function summonGuardRefund(address?: string): void {
  const aScope = addrScope("summon", address);
  const d = db();
  d.transaction(() => {
    d.prepare(`UPDATE cost_counters SET count = MAX(0, count - 1) WHERE scope = ?`).run("summon:global");
    if (aScope) d.prepare(`UPDATE cost_counters SET count = MAX(0, count - 1) WHERE scope = ?`).run(aScope);
  })();
}

export function summonStats() {
  return {
    totalSummonGenerations: counterGet("summon:global"),
    inFlight: inFlight.summon,
    cap: SUMMON_GEN_CAP,
    maxConcurrent: MAX_CONCURRENT_SUMMON_GEN,
    perAddressQuota: PER_ADDRESS_SUMMON_QUOTA,
  };
}
