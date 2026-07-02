// GET /health - liveness + key wiring facts (no secrets). Confirms the attestor address matches the
// deployed contract's attestor, and reports the sponsor balance + storage reachability + gen stats.
import type { FastifyInstance } from "fastify";
import { DEPLOYED, GALILEO } from "../aura/config.js";
import { attestorAddress } from "../aura/attestation.js";
import { sponsorAddress, sponsorBalance } from "../aura/wallet.js";
import { outputRead } from "../aura/contracts.js";
import { genStats } from "../aura/ratelimit.js";

// The home page SSR blocks on /health, and the client re-fetches it, so every uncached chain read here is
// on a hot path. attestor() is IMMUTABLE per deploy -> cache it for the whole process once read. The
// sponsor balance drifts slowly -> cache it briefly. Both reads are wrapped in a hard timeout so a slow
// RPC can never hang home SSR (it degrades to the last-known / null value instead).
const BALANCE_TTL_MS = 30_000;
const RPC_TIMEOUT_MS = 2500;
let attestorCache: string | null = null;
let balanceCache: { at: number; value: string } | null = null;

/** Resolve `p`, or reject once `ms` elapses, so a stuck RPC can't block the handler indefinitely. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error("rpc timeout")), ms);
      (t as { unref?: () => void }).unref?.(); // don't keep the event loop alive for the timer
    }),
  ]);
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    let onChainAttestor: string | null = attestorCache;
    if (onChainAttestor === null) {
      try {
        onChainAttestor = await withTimeout(outputRead().attestor() as Promise<string>, RPC_TIMEOUT_MS);
        if (onChainAttestor) attestorCache = onChainAttestor; // immutable per deploy: cache for process life
      } catch {
        /* RPC hiccup / timeout - report null, retry next call */
      }
    }

    let balance: string | null = null;
    const now = Date.now();
    if (balanceCache && now - balanceCache.at < BALANCE_TTL_MS) {
      balance = balanceCache.value;
    } else {
      try {
        balance = await withTimeout(sponsorBalance(), RPC_TIMEOUT_MS);
        balanceCache = { at: now, value: balance };
      } catch {
        balance = balanceCache?.value ?? null; // serve last-known on a hiccup, else null
      }
    }
    const attestor = attestorAddress();
    return {
      ok: true,
      chainId: GALILEO.chainId,
      contracts: {
        agentRegistry: DEPLOYED.agentRegistry,
        outputNFT: DEPLOYED.outputNFT,
        marketplace: DEPLOYED.marketplace,
      },
      sponsor: sponsorAddress(),
      attestor,
      attestorMatchesContract: onChainAttestor ? onChainAttestor.toLowerCase() === attestor.toLowerCase() : null,
      onChainAttestor,
      sponsorBalance: balance,
      gen: genStats(),
      time: new Date().toISOString(),
    };
  });
}
