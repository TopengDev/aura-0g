// PUBLIC image-by-root endpoint. GET /image/:root -> the real image bytes for a 0G Storage content
// root, served from the DURABLE local content-addressed cache first (create-time reference images +
// generated outputs are persisted there), with a best-effort 0G Storage download as a fallback.
//
// WHY: 0G Storage testnet evicts image-sized blobs within ~minutes-to-an-hour (root-caused 2026-06-23),
// so streaming straight from 0G is unreliable for any content older than minutes. The local cache is
// the durable source. The WEB /images/[root] route falls through to THIS endpoint for any root it does
// not have baked in, and renders its deterministic placeholder only if this 404s.
//
// No auth: images are public content (the gallery is public). Read-only.
import type { FastifyInstance } from "fastify";
import { resolveBytesByRoot } from "../aura/image-cache.js";
import { brainByAgentId } from "../aura/store.js";
import { db } from "../aura/db.js";

const IMMUTABLE = "public, max-age=31536000, immutable"; // content-addressed => safe to cache hard

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  // ── GET /image/:root -> real bytes for an output/reference 0G root ──
  app.get<{ Params: { root: string } }>("/image/:root", async (req, reply) => {
    const root = decodeURIComponent(req.params.root || "").trim();
    if (!root) return reply.code(400).send({ error: "root required" });
    const hit = await resolveBytesByRoot(root);
    if (hit) return reply.header("Content-Type", hit.contentType || "image/png").header("Cache-Control", IMMUTABLE).send(hit.bytes);
    return reply.code(404).send({ error: "image bytes not available for this root" });
  });

  // ── GET /agent-portrait/:agentId -> a user agent's REAL portrait ──
  // The web builds slash-free showcase-<name> slugs for catalog portraits (baked in the web image), but
  // a USER agent has no baked portrait. Its portrait IS its reference image (canonicalBaseRoot, persisted
  // in the local cache at create time). Resolve: reference image -> agent's first output image -> 404
  // (web then renders its placeholder). This is what makes a user agent's card show real art.
  app.get<{ Params: { agentId: string } }>("/agent-portrait/:agentId", async (req, reply) => {
    const agentId = Number(req.params.agentId);
    if (!Number.isInteger(agentId) || agentId < 1) return reply.code(400).send({ error: "agentId required" });

    // 1. the reference image (the brain's canonicalBaseRoot).
    const rec = brainByAgentId(agentId);
    if (rec?.canonicalBaseRoot) {
      const hit = await resolveBytesByRoot(rec.canonicalBaseRoot);
      if (hit) return reply.header("Content-Type", hit.contentType || "image/png").header("Cache-Control", IMMUTABLE).send(hit.bytes);
    }

    // 2. fallback: the agent's most recent generated output image (cached locally by its root).
    try {
      const row = db()
        .prepare(
          `SELECT json_extract(result_json,'$.imageRoot') AS root FROM jobs
           WHERE agent_id=? AND status='done' AND json_extract(result_json,'$.imageRoot') IS NOT NULL
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(agentId) as { root?: string } | undefined;
      if (row?.root) {
        const hit = await resolveBytesByRoot(row.root);
        if (hit) return reply.header("Content-Type", hit.contentType || "image/png").header("Cache-Control", "public, max-age=3600").send(hit.bytes);
      }
    } catch {
      /* fall through to 404 */
    }

    return reply.code(404).send({ error: "no portrait available for this agent" });
  });
}
