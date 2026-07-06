// Sponsored generation (authed). The SPONSOR wallet funds compute + storage; the job is OWNED by
// jwt.address and every read is owner-scoped.
//   POST /generate { agentId, prompt }        -> { jobId }  (kicks off background gen)
//   GET  /generate/:jobId                      -> job status/result (owner-scoped)
//   GET  /generate/:jobId/image                -> preview PNG (owner-scoped)
import type { FastifyInstance } from "fastify";
import { rawAgent } from "../aura/agents.js";
import { newJobId, createJob, getJobForOwner, readGeneratedImage } from "../aura/jobs.js";
import { runGeneration } from "../aura/generate.js";
import { genGuardAcquire, genGuardRelease, rateLimit } from "../aura/ratelimit.js";

export async function generateRoutes(app: FastifyInstance): Promise<void> {
  // POST /generate
  app.post<{ Body: { agentId?: number; prompt?: string; subject?: string } }>(
    "/generate",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const owner = req.user.address;
      const { agentId, prompt, subject } = req.body ?? {};
      if (typeof agentId !== "number" || !Number.isInteger(agentId) || agentId < 1) {
        return reply.code(400).send({ error: "agentId (positive integer) required" });
      }
      if (!prompt || prompt.trim().length < 2) {
        return reply.code(400).send({ error: "prompt required (>=2 chars)" });
      }
      // OPTIONAL PULL-MODE seam. When `subject` is present + non-empty, this gen runs in style-lock-only PULL
      // mode: the agent's signature style is preserved but the SUBJECT is fresh (no "keep the exact subject"
      // lock), so distinct subjects render distinct art for the same agent. Must be a string when supplied.
      const subjectClean = typeof subject === "string" ? subject.trim() : "";
      if (subject !== undefined && typeof subject !== "string") {
        return reply.code(400).send({ error: "subject must be a string when provided" });
      }

      // per-user rate limit (5 gen/60s) on top of the global cost guard.
      const rl = rateLimit(`gen:${owner}`, 5, 60_000);
      if (!rl.ok) {
        return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });
      }

      // the agent must exist on-chain (so the eventual mintOutput references a real creatorAgentId).
      const agent = await rawAgent(agentId);
      if (!agent) {
        return reply.code(404).send({ error: `agent #${agentId} not found on-chain` });
      }

      // global cost guard (protects the funded sponsor wallet). Acquire BEFORE creating the job. Pass the
      // owner so the per-address LIFETIME quota applies (B-2: a single Sybil address cannot drain the
      // shared global cap, and the global counter is persisted so a restart is not a reset-and-replay).
      const guard = genGuardAcquire(owner);
      if (!guard.ok) {
        return reply.code(503).send({ error: guard.reason ?? "generation temporarily unavailable" });
      }

      const jobId = newJobId();
      createJob(jobId, owner, agent.agentId, agent.name, prompt.trim());

      // kick off in the background - do NOT await. runGeneration releases the gen guard in its finally.
      void runGeneration({
        jobId,
        agentId: agent.agentId,
        agentName: agent.name,
        encBrainRoot: agent.encBrainRoot,
        userPrompt: prompt.trim(),
        // Non-empty subject -> PULL mode (fresh subject, agent style locked). Empty/absent -> unchanged path.
        ...(subjectClean ? { subject: subjectClean } : {}),
      }).catch((e) => {
        // belt-and-suspenders: if runGeneration throws synchronously before its own try, release here.
        app.log.error({ err: e, jobId }, "runGeneration crashed");
        genGuardRelease();
      });

      return reply.code(202).send({ jobId, status: "pending" });
    },
  );

  // GET /generate/:jobId
  app.get<{ Params: { jobId: string } }>(
    "/generate/:jobId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const job = getJobForOwner(req.params.jobId, req.user.address);
      if (!job) return reply.code(404).send({ error: "job not found (or not owned by you)" });
      return job;
    },
  );

  // GET /generate/:jobId/image
  app.get<{ Params: { jobId: string } }>(
    "/generate/:jobId/image",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const job = getJobForOwner(req.params.jobId, req.user.address);
      if (!job) return reply.code(404).send({ error: "job not found (or not owned by you)" });
      const bytes = readGeneratedImage(req.params.jobId);
      if (!bytes) return reply.code(404).send({ error: "image not ready" });
      return reply.header("Content-Type", "image/png").send(bytes);
    },
  );
}
