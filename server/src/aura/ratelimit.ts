// SERVER-ONLY. Cost guards for the SPONSOR wallet + a SQLite-backed fixed-window rate limiter.
// Ported from lib/aura/ratelimit.ts: keeps the IN-PROCESS gen guard + MAX_CONCURRENT semaphore
// (so a single instance never over-spends the sponsor), but moves the per-key window counters to
// SQLite so they survive a restart. The global generation cap + in-flight count live in-process
// (they bound the live process, which is what the semaphore is for).
import { db } from "./db.js";
import { GLOBAL_GEN_CAP, MAX_CONCURRENT_GEN } from "./config.js";

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

// ── in-process global cost guards (across all callers) - protect the funded sponsor wallet ──
const counters = { total: 0, inFlight: 0 };

export function genGuardAcquire(): { ok: boolean; reason?: string } {
  if (counters.total >= GLOBAL_GEN_CAP) return { ok: false, reason: `global generation cap reached (${GLOBAL_GEN_CAP})` };
  if (counters.inFlight >= MAX_CONCURRENT_GEN)
    return { ok: false, reason: `too many concurrent generations (max ${MAX_CONCURRENT_GEN}) - retry shortly` };
  counters.inFlight += 1;
  counters.total += 1;
  return { ok: true };
}

export function genGuardRelease(): void {
  counters.inFlight = Math.max(0, counters.inFlight - 1);
}

export function genStats() {
  return { totalGenerations: counters.total, inFlight: counters.inFlight, cap: GLOBAL_GEN_CAP, maxConcurrent: MAX_CONCURRENT_GEN };
}
