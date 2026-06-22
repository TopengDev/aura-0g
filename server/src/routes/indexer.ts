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
import { getProvenance } from "../aura/provenance.js";
import { getMarketplace } from "../aura/marketplace.js";

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

export async function indexerRoutes(app: FastifyInstance): Promise<void> {
  // ── 1. generic passthrough: /api/* -> indexer/* (the single surface for the webapp) ──
  // GET-only (the indexed read surface is read-only). Body methods are intentionally not proxied.
  app.get("/api/*", async (req: FastifyRequest, reply: FastifyReply) => {
    const wildcard = (req.params as Record<string, string>)["*"] ?? "";
    const qs = req.raw.url?.includes("?") ? req.raw.url.slice(req.raw.url.indexOf("?")) : "";
    try {
      const data = await indexerGet(`/${wildcard}${qs}`);
      return reply.send(data);
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

  // GET /agents - prefer the indexer; fall back to the chain scan.
  app.get("/agents", async () => {
    try {
      return await indexerGet("/agents");
    } catch {
      return { agents: await listAgents(), source: "chain-scan-fallback", note: "indexer unreachable" };
    }
  });

  // GET /outputs - prefer the indexer (newest-first, paginated); fall back to the chain scan.
  app.get("/outputs", async (req: FastifyRequest) => {
    const qs = req.raw.url?.includes("?") ? req.raw.url.slice(req.raw.url.indexOf("?")) : "";
    try {
      return await indexerGet(`/outputs${qs}`);
    } catch {
      const { outputRead } = await import("../aura/contracts.js");
      const out = outputRead();
      const next = Number(await out.nextTokenId());
      const ids: number[] = [];
      for (let i = next - 1; i >= 1; i--) ids.push(i);
      const items = await Promise.all(ids.map((id) => getProvenance(id)));
      return { outputs: items.filter(Boolean), source: "chain-scan-fallback", note: "indexer unreachable" };
    }
  });

  // GET /marketplace - prefer the indexer (active listings via events); fall back to the chain scan.
  app.get("/marketplace", async () => {
    try {
      return await indexerGet("/marketplace");
    } catch {
      return await getMarketplace();
    }
  });
}
