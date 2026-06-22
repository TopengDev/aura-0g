// Per-item chain reads (kept on chain - exact live provenance/royalty for ONE token). The list +
// dashboard + discovery + feed endpoints are Phase-3's job and are served by the indexer (proxied by
// routes/indexer.ts under the same origin). Public (no auth) - these are read-only views.
//   GET /agents/:id        -> one agent (live chain read)
//   GET /outputs/:id       -> alias of provenance for one output
//   GET /provenance/:id    -> full provenance for one output
//   GET /royalty/:id       -> live royalty for one output
// NOTE: GET /agents, GET /outputs, GET /marketplace are now owned by routes/indexer.ts (indexer-first
// with a chain-scan fallback), so they are intentionally NOT defined here (Fastify forbids dupes).
import type { FastifyInstance } from "fastify";
import { getAgentById } from "../aura/agents.js";
import { getProvenance } from "../aura/provenance.js";
import { getRoyalty } from "../aura/royalty.js";

function parseId(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

export async function readsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/agents/:id", async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: "invalid agent id" });
    const a = await getAgentById(id);
    if (!a) return reply.code(404).send({ error: "agent not found" });
    return a;
  });

  app.get<{ Params: { id: string } }>("/outputs/:id", async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: "invalid output id" });
    const p = await getProvenance(id);
    if (!p) return reply.code(404).send({ error: "output not found" });
    return p;
  });

  app.get<{ Params: { id: string } }>("/provenance/:id", async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: "invalid output id" });
    const p = await getProvenance(id);
    if (!p) return reply.code(404).send({ error: "output not found" });
    return p;
  });

  app.get<{ Params: { id: string } }>("/royalty/:id", async (req, reply) => {
    const id = parseId(req.params.id);
    if (id === null) return reply.code(400).send({ error: "invalid output id" });
    const r = await getRoyalty(id);
    if (!r) return reply.code(404).send({ error: "output not found" });
    return r;
  });
}
