// POST /agents/create (authed, multipart) - the create-agent pipeline.
// Accepts a multipart form: the reference image (field "image") + text fields (name, royaltyBps,
// creatorResaleBps, styleDescriptor, identityLock?, negative?, signatureCharacter?). Returns the
// computed mintAgent args for the USER to submit (mintAgent is permissionless + user-signed).
import type { FastifyInstance } from "fastify";
// Load @fastify/multipart's type declarations (adds isMultipart()/parts() to FastifyRequest).
import "@fastify/multipart";
import { createAgent, type CreateAgentInput } from "../aura/create-agent.js";
import { rateLimit, createGuardAcquire, createGuardRelease, createGuardRefund } from "../aura/ratelimit.js";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12MB upload ceiling

export async function agentsCreateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/agents/create", { preHandler: [app.authenticate] }, async (req, reply) => {
    const owner = req.user.address;

    // rate limit create-agent (it stores 2 blobs + lists services - protect the sponsor wallet).
    const rl = rateLimit(`create:${owner}`, 5, 60_000);
    if (!rl.ok) return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });

    if (!req.isMultipart()) {
      return reply.code(400).send({ error: "multipart/form-data required (image + fields)" });
    }

    // collect the multipart parts: one file ("image") + text fields.
    const fields: Record<string, string> = {};
    let imageBytes: Buffer | null = null;
    let imageMime: string | undefined;

    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "file") {
          if (part.fieldname !== "image") {
            // drain + ignore unexpected files
            part.file.resume();
            continue;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of part.file) {
            total += chunk.length;
            if (total > MAX_IMAGE_BYTES) {
              return reply.code(413).send({ error: "image too large (max 12MB)" });
            }
            chunks.push(chunk as Buffer);
          }
          imageBytes = Buffer.concat(chunks);
          imageMime = part.mimetype;
        } else {
          fields[part.fieldname] = String((part as { value: unknown }).value ?? "");
        }
      }
    } catch (e: any) {
      return reply.code(400).send({ error: `multipart parse failed: ${String(e?.message).slice(0, 120)}` });
    }

    if (!imageBytes) return reply.code(400).send({ error: "reference image required (field 'image')" });

    const input: CreateAgentInput = {
      owner,
      name: fields.name ?? "",
      royaltyBps: Number(fields.royaltyBps ?? "NaN"),
      creatorResaleBps: Number(fields.creatorResaleBps ?? "NaN"),
      styleDescriptor: fields.styleDescriptor ?? "",
      identityLock: fields.identityLock,
      negative: fields.negative,
      signatureCharacter: fields.signatureCharacter ?? null,
      imageBytes,
      imageMime,
    };

    // B-3: global cost guard - create-agent makes the SPONSOR pay for TWO 0G Storage uploads, so it needs a
    // GLOBAL cap (not just the per-user window above), or Sybil wallets each upload on the sponsor's ledger.
    const guard = createGuardAcquire(owner);
    if (!guard.ok) {
      return reply.code(503).send({ error: guard.reason ?? "create-agent temporarily unavailable" });
    }
    try {
      const res = await createAgent(input);
      if ("ok" in res && res.ok === false) {
        // validation failed BEFORE any sponsor-paid upload -> refund the lifetime slot so a cheap invalid
        // request cannot burn the create budget (the concurrency slot is still released in finally).
        createGuardRefund(owner);
        return reply.code(res.status).send({ error: res.error });
      }
      return res;
    } finally {
      createGuardRelease();
    }
  });

  // POST /agents/confirm-mint { encBrainRoot, agentId } - after the user submits mintAgent, promote the
  // staged brain key to the concrete agentId so the generalized generator can decrypt it for this agent.
  app.post<{ Body: { encBrainRoot?: string; agentId?: number } }>(
    "/agents/confirm-mint",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { encBrainRoot, agentId } = req.body ?? {};
      if (!encBrainRoot || typeof agentId !== "number") {
        return reply.code(400).send({ error: "encBrainRoot and agentId required" });
      }
      const { promoteBrainByRoot } = await import("../aura/store.js");
      const { promotePersonaByRoot } = await import("../aura/persona-store.js");
      const { rawAgent } = await import("../aura/agents.js");
      // verify the on-chain agent actually has this encBrainRoot AND is owned by the caller.
      const agent = await rawAgent(agentId);
      if (!agent) return reply.code(404).send({ error: `agent #${agentId} not found on-chain` });
      if (agent.encBrainRoot.toLowerCase() !== encBrainRoot.toLowerCase()) {
        return reply.code(409).send({ error: "encBrainRoot does not match the on-chain agent" });
      }
      if (agent.owner.toLowerCase() !== req.user.address.toLowerCase()) {
        return reply.code(403).send({ error: "you do not own this agent" });
      }
      const promoted = promoteBrainByRoot(encBrainRoot, agentId, req.user.address);
      // promote the chat persona to the same agentId (its SOUL follows the brain). Best-effort: a persona
      // may be absent for a pre-persona agent, and the chat lookup falls back to encBrainRoot regardless.
      const personaPromoted = promotePersonaByRoot(encBrainRoot, agentId);
      return { ok: true, promoted, personaPromoted, agentId };
    },
  );
}
