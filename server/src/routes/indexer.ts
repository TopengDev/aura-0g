// Phase-3 integration: the Fastify backend proxies the indexer's read APIs so the webapp reaches ONE
// coherent surface (the Fastify origin it already talks to), while the heavy reads are actually served
// by the Ponder process (PGlite-backed, in-process Drizzle). Two things live here:
//
//   1. A generic passthrough under /api/* -> INDEXER_URL/* (dashboard, discovery, feed, marketplace,
//      per-id reads, even the indexer's GraphQL/SQL-over-HTTP if the webapp wants them).
//   2. Indexer-first re-backing of the Phase-2 list endpoints (GET /agents, GET /outputs, GET
//      /marketplace): try the indexer; if it is unreachable/slow, FALL BACK to the existing chain-scan
//      so the API degrades gracefully instead of failing (the indexer is a separate process).
//
// This keeps the two-service split clean: the indexer OWNS the derived read model; Fastify OWNS the
// write/compute surface (generation, attestation, mint-args, SIWE) and fronts both for the webapp.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { INDEXER_URL, INDEXER_TIMEOUT_MS } from "../aura/config.js";
import { listAgents } from "../aura/agents.js";
import { metaForName } from "../aura/catalog.js";
import { personaMetaFor } from "../aura/persona-store.js";
import { getProvenance } from "../aura/provenance.js";
import { getMarketplace } from "../aura/marketplace.js";
import { hasHiddenOutputs, isHiddenOutput, isHiddenAgent } from "../aura/curation.js";

/** Fetch JSON from the indexer with a timeout. Throws on non-2xx or timeout (caller decides fallback). */
async function indexerGet(pathAndQuery: string): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), INDEXER_TIMEOUT_MS);
  try {
    const res = await fetch(`${INDEXER_URL}${pathAndQuery}`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`indexer ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ── output display curation (superseded z-image relics hidden from public feeds) ─────────────────────
// The image-gen path was reverted from 0G mainnet z-image-turbo back to 0G testnet qwen-image-edit, and
// OutputNFT.teeSigner re-pinned to the qwen enclave (0x2A94D671). The first showcase Relics minted under
// the z-image enclave (0x592056) no longer match the site's advertised qwen provenance, so they are
// curated OUT of the public LIST feeds (gallery, discover, agent-detail) while staying on-chain + directly
// resolvable by tokenId. Env-driven (AURA_HIDDEN_OUTPUT_TOKENS="1,2,3,4") + reversible (unset => show all).
// Applied at the proxy layer so it needs no indexer/Ponder redeploy (a Ponder rebuild forces a schema
// migration). The owner dashboard uses different keys (outputsOwned/outputsCreatedByMyAgents) and is not
// touched, so an owner still sees their own tokens. The hidden-set parse + predicate live in aura/curation.ts
// so the single-token direct-read paths (reads.ts /outputs/:id + /provenance/:id, verify-public /api/verify)
// share the EXACT same curation (a hidden token is masked on direct read too, not just dropped from lists).

/** Filter the superseded relics out of an indexer LIST response: {outputs:[{tokenId}...]}, {items:[{tokenId}...]},
 *  or an agent-detail {outputs:number[]}. Single-item reads (no such array) pass through untouched. No-op when
 *  the hidden set is empty. Mutates + returns the decoded object (it is a fresh parse per request). */
function curateOutputs(data: unknown): unknown {
  if (!hasHiddenOutputs() || !data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  const hidden = (t: unknown) => isHiddenOutput(t as number | bigint | string | null | undefined);
  if (Array.isArray(d.outputs)) {
    d.outputs = (d.outputs as unknown[]).filter((o) =>
      o !== null && typeof o === "object" ? !hidden((o as { tokenId?: unknown }).tokenId) : !hidden(o),
    );
  }
  if (Array.isArray(d.items)) {
    d.items = (d.items as unknown[]).filter((o) => !hidden((o as { tokenId?: unknown } | null)?.tokenId));
  }
  return d;
}

// ── agent-browse curation (throwaway / test agents hidden from public LIST feeds) ────────────────────
// The AGENT analog of curateOutputs: the Flow-B agent-sale e2e minted 4 un-removable "SALE-E2E-THROWAWAY"
// agents (ids 35-38) that leaked into the LIVE public catalog (GET /api/agents count 28 -> 32). They are
// on-chain-immutable (orphaned keys / immutable name / no burn), so they are curated OUT of the public
// browse surfaces at the proxy layer (needs no indexer/Ponder redeploy). Hide predicate + env parse live
// in aura/curation.ts (isHiddenAgent = by-name OR by-id via AURA_HIDDEN_AGENT_IDS), shared with any other
// server surface. Applied to LIST arrays ONLY (agents[] grid, agentsOwned[] portfolio, a bare agent
// array, and an items[] list of agent-shaped rows). A SINGLE-agent DETAIL object passes through untouched
// so GET /agents/:id (e.g. /api/agents/35) still resolves -- hidden from BROWSE/COUNT, not hard-404'd.
function isAgentRow(o: unknown): o is { agentId?: number | bigint | string | null; name?: string | null } {
  return !!o && typeof o === "object" && "agentId" in (o as Record<string, unknown>);
}

/** Drop curated-out agents from any agent LIST arrays in a proxied response. Mutates + returns the fresh
 *  parse. A top-level single-agent object (detail read) is returned untouched (never filtered to null). */
function curateAgentsInResponse(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const keep = (el: unknown) => !(isAgentRow(el) && isHiddenAgent(el));
  if (Array.isArray(data)) return (data as unknown[]).filter(keep);
  const d = data as Record<string, unknown>;
  for (const k of Object.keys(d)) {
    if (Array.isArray(d[k])) d[k] = (d[k] as unknown[]).filter(keep);
  }
  return d;
}

// ── persona SOUL enrichment of proxied agent reads ───────────────────────────────────────────────────
// ROOT CAUSE of the "user auras chat/display generic" live bug: the indexer (Ponder/PGlite) OWNS the
// derived agent read model that the webapp actually fetches (/api/agents/:id, /api/agents, /api/creators),
// but the chat PERSONA store (agent_personas) lives in the SERVER's SQLite, which the indexer cannot see.
// So a user-created aura came back with the indexer's flat generic meta on every /api/* read, even though
// the server's own root /agents/:id (getAgentById -> resolveMeta -> personaMetaFor) resolved the full
// persona correctly. This proxy layer is exactly where the server can re-attach the soul the indexer lacks.
//
// SURGICAL + NO-REGRESSION: a CATALOG aura is left byte-identical (metaForName != null -> we do NOT touch
// it, so its hand-written meta the indexer already serves is preserved). Only a USER aura WITH a stored
// persona gets its meta overlaid (persona fields win; any indexer-only meta keys are kept via the spread).
// A personaless user aura is also left untouched (keeps the indexer's generic meta). Idempotent + pure.
function isAgentObj(o: unknown): o is { agentId: number; name: string; meta: Record<string, unknown> } {
  return (
    !!o &&
    typeof o === "object" &&
    typeof (o as any).agentId === "number" &&
    typeof (o as any).name === "string" &&
    !!(o as any).meta &&
    typeof (o as any).meta === "object"
  );
}

function enrichAgentSoul(o: { agentId: number; name: string; meta: Record<string, unknown> }): void {
  // Catalog auras keep their curated meta (the indexer already serves it): do not touch -> no regression.
  if (metaForName(o.name)) return;
  // User aura: overlay the stored persona (chat-readable soul) if one exists. enc_brain_root is not carried
  // on the indexer object, but the persona rows are keyed by the concrete agentId, so agentId alone resolves.
  const soul = personaMetaFor(o.agentId);
  if (soul) o.meta = { ...o.meta, ...(soul as unknown as Record<string, unknown>) };
}

/** Overlay the persona soul onto any agent object(s) in a proxied indexer response. Handles the three
 *  shapes the webapp reads: a single agent (detail), { agents:[...] } (grid), and { agentsOwned:[...] }
 *  (creator portfolio), plus a bare array and an { items:[...] } list. Mutates + returns the fresh parse. */
function enrichAgentsInResponse(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    for (const el of data) if (isAgentObj(el)) enrichAgentSoul(el);
    return data;
  }
  if (isAgentObj(data)) enrichAgentSoul(data);
  for (const v of Object.values(data as Record<string, unknown>)) {
    if (Array.isArray(v)) for (const el of v) if (isAgentObj(el)) enrichAgentSoul(el);
  }
  return data;
}

// ── indexer-DOWN fallback caching (perf) ─────────────────────────────────────────────────────────────
// The chain-scan fallbacks below are expensive (a full agent/output scan) and were re-run on EVERY request
// while the indexer was unreachable. Wrap them in a short TTL cache + single-flight so a down indexer
// degrades to one scan per window (shared across concurrent callers) instead of one scan per request. This
// is consulted ONLY inside the catch branch, so a recovered indexer is served fresh (the cache is bypassed).
const FALLBACK_TTL_MS = 45_000;
const fallbackCache = new Map<string, { at: number; data: unknown }>();
const fallbackInflight = new Map<string, Promise<unknown>>();

async function cachedFallback<T>(key: string, produce: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = fallbackCache.get(key);
  if (hit && now - hit.at < FALLBACK_TTL_MS) return hit.data as T;
  const inflight = fallbackInflight.get(key);
  if (inflight) return inflight as Promise<T>;
  // register the in-flight promise SYNCHRONOUSLY (no await between the miss and the set) so concurrent
  // callers dedup onto this single scan.
  const p = (async () => {
    try {
      const data = await produce();
      fallbackCache.set(key, { at: Date.now(), data });
      return data;
    } finally {
      fallbackInflight.delete(key);
    }
  })();
  fallbackInflight.set(key, p);
  return p;
}

/** Map over items with a bounded concurrency (replaces an unbounded Promise.all fan-out over ALL tokens). */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function indexerRoutes(app: FastifyInstance): Promise<void> {
  // ── 1. generic passthrough: /api/* -> indexer/* (the single surface for the webapp) ──
  // GET-only (the indexed read surface is read-only). Body methods are intentionally not proxied.
  app.get("/api/*", async (req: FastifyRequest, reply: FastifyReply) => {
    const wildcard = (req.params as Record<string, string>)["*"] ?? "";
    const qs = req.raw.url?.includes("?") ? req.raw.url.slice(req.raw.url.indexOf("?")) : "";
    try {
      const data = await indexerGet(`/${wildcard}${qs}`);
      // Re-attach the persona SOUL the indexer's read model cannot see (see enrichAgentsInResponse), then
      // strip curated-out agents (throwaway/test) from any LIST arrays, then apply the output curation
      // mask. All three are no-ops on responses that carry no agent/output arrays. Order is independent
      // (they touch disjoint array fields), but agent curation runs on the persona-enriched object so a
      // hidden agent is gone from every browse LIST (/api/agents, /api/discover, /api/creators/:w) while
      // a single-agent DETAIL object (/api/agents/:id) passes through untouched.
      return reply.send(curateAgentsInResponse(curateOutputs(enrichAgentsInResponse(data))));
    } catch (err) {
      app.log.warn({ err: String(err), path: wildcard }, "indexer proxy failed");
      return reply.code(502).send({
        error: "indexer unavailable",
        detail: String(err),
        hint: "the Ponder indexer (INDEXER_URL) is not reachable; start it with `pnpm --dir indexer dev`",
      });
    }
  });

  // ── 2. indexer-first re-backing of the Phase-2 list endpoints (graceful fallback to chain-scan) ──

  // GET /agents - prefer the indexer; fall back to the (cached, single-flighted) chain scan.
  app.get("/agents", async () => {
    try {
      // indexer-first: overlay each user aura's stored persona soul (the chain-scan fallback below uses
      // listAgents() -> resolveMeta, which is already persona-aware, so it needs no extra enrichment), then
      // strip curated-out throwaway/test agents from the grid (this is the raw list the webapp's
      // fetchAgents() reads; it must return the clean count independent of the web-side isFeatured filter).
      return curateAgentsInResponse(enrichAgentsInResponse(await indexerGet("/agents")));
    } catch {
      return await cachedFallback("agents", async () => ({
        // curate the chain-scan fallback too, so a down indexer still serves the clean grid.
        agents: (await listAgents()).filter((a) => !isHiddenAgent(a as { agentId?: number; name?: string })),
        source: "chain-scan-fallback",
        note: "indexer unreachable",
      }));
    }
  });

  // GET /outputs - prefer the indexer (newest-first, paginated); fall back to the chain scan.
  app.get("/outputs", async (req: FastifyRequest) => {
    const qs = req.raw.url?.includes("?") ? req.raw.url.slice(req.raw.url.indexOf("?")) : "";
    try {
      return curateOutputs(await indexerGet(`/outputs${qs}`));
    } catch {
      return await cachedFallback(`outputs${qs}`, async () => {
        const { outputRead } = await import("../aura/contracts.js");
        const out = outputRead();
        const next = Number(await out.nextTokenId());
        const ids: number[] = [];
        for (let i = next - 1; i >= 1; i--) ids.push(i);
        // bounded fan-out (was an unbounded Promise.all over EVERY token id).
        const items = await mapWithConcurrency(ids, 8, (id) => getProvenance(id));
        return curateOutputs({ outputs: items.filter(Boolean), source: "chain-scan-fallback", note: "indexer unreachable" });
      });
    }
  });

  // GET /marketplace - prefer the indexer (active listings via events); fall back to the chain scan.
  app.get("/marketplace", async () => {
    try {
      return await indexerGet("/marketplace");
    } catch {
      return await cachedFallback("marketplace", () => getMarketplace());
    }
  });
}
