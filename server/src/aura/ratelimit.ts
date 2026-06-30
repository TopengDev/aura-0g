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
const inFlight = { gen: 0, create: 0 };

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
