// SERVER-ONLY. Tiny in-memory fixed-window rate limiter + global cost guards for the demo wallet.
// Single Node process => a module-level Map is shared across requests. Not for multi-instance prod,
// but exactly right for a single-instance capped demo. Protects the funded demo wallet from abuse.

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetInMs: number;
}

/** Fixed-window per-key limiter. Default: 5 requests / 60s. */
export function rateLimit(key: string, limit = 5, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, resetInMs: windowMs };
  }
  if (b.count >= limit) {
    return { ok: false, remaining: 0, resetInMs: b.resetAt - now };
  }
  b.count += 1;
  return { ok: true, remaining: limit - b.count, resetInMs: b.resetAt - now };
}

// ── global cost guards (across all callers) — protect the capped demo wallet ──
// Counters live on globalThis (genCounters) so the cap holds across separate route bundles.
import { genCounters } from "./global-store";

const GLOBAL_GEN_CAP = Number(process.env.AURA_MAX_GENERATIONS ?? 40); // total live generations this process
const MAX_CONCURRENT = Number(process.env.AURA_MAX_CONCURRENT_GEN ?? 2);

export function genGuardAcquire(): { ok: boolean; reason?: string } {
  const c = genCounters();
  if (c.total >= GLOBAL_GEN_CAP) return { ok: false, reason: `global generation cap reached (${GLOBAL_GEN_CAP})` };
  if (c.inFlight >= MAX_CONCURRENT) return { ok: false, reason: `too many concurrent generations (max ${MAX_CONCURRENT}) — retry shortly` };
  c.inFlight += 1;
  c.total += 1;
  return { ok: true };
}

export function genGuardRelease(): void {
  const c = genCounters();
  c.inFlight = Math.max(0, c.inFlight - 1);
}

export function genStats() {
  const c = genCounters();
  return { totalGenerations: c.total, inFlight: c.inFlight, cap: GLOBAL_GEN_CAP, maxConcurrent: MAX_CONCURRENT };
}

/** Best-effort client key from a request (IP via forwarded headers, else a constant). */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}
