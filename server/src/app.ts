// SERVER-ONLY. Fastify app assembly (Fastify v5). Registers CORS (explicit origin, NOT "*",
// credentials off - we use Bearer JWT), JWT, rate-limit, multipart, the `authenticate` decorator,
// and all route groups. On boot it reaps orphaned in-flight jobs. Exported buildApp() is used by both
// the entrypoint and the app.inject()-based verification scripts.
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimitPlugin from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { CORS_ORIGINS, JWT_SECRET } from "./aura/config.js";
import { reapOrphanJobs } from "./aura/db.js";
import { authenticate } from "./lib/auth.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { generateRoutes } from "./routes/generate.js";
import { mintArgsRoutes } from "./routes/mint-args.js";
import { agentsCreateRoutes } from "./routes/agents-create.js";
import { agentTransferRoutes } from "./routes/agent-transfer.js";
import { imageRoutes } from "./routes/image.js";
import { readsRoutes } from "./routes/reads.js";
import { indexerRoutes } from "./routes/indexer.js";
import { summonRoutes } from "./routes/summon.js";
import { chatRoutes } from "./routes/chat.js";

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 2 * 1024 * 1024, // 2MB JSON bodies (multipart has its own limit)
    // Behind nginx every request arrives from the loopback, so WITHOUT this the global rate-limiter keys
    // every browser onto one shared 120/min bucket (verified perf finding: sections silently render empty
    // + images fall to placeholders under modest demo load). trustProxy makes Fastify resolve the real
    // client IP from X-Forwarded-For, so the limiter buckets per client. The tight per-address AUTHED
    // limits (chat/generate, keyed on the JWT address) are unaffected.
    trustProxy: true,
  });

  // CORS - explicit origin allowlist (never "*" because we send a Bearer token). Credentials OFF
  // (the token is in the Authorization header, not a cookie).
  await app.register(cors, {
    origin: CORS_ORIGINS,
    credentials: false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  await app.register(jwt, { secret: JWT_SECRET });

  await app.register(rateLimitPlugin, {
    global: true,
    max: 120, // generous global ceiling; per-route limiters (gen/create) are tighter + per-user
    timeWindow: "1 minute",
  });

  await app.register(multipart, {
    limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 12 },
  });

  // the authenticate preHandler (reads/verifies the Bearer JWT -> request.user.address).
  app.decorate("authenticate", authenticate);

  // route groups
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(generateRoutes);
  await app.register(mintArgsRoutes);
  await app.register(agentsCreateRoutes);
  await app.register(agentTransferRoutes); // ERC-7857 secure-transfer flow (oracle proof + memory reseal)
  await app.register(imageRoutes); // public GET /image/:root -> real bytes (local cache, 0G fallback)
  // Phase-3 indexer integration: /api/* passthrough + indexer-first /agents,/outputs,/marketplace
  // (with a graceful chain-scan fallback). Registered before readsRoutes; their paths don't overlap
  // (indexer owns the lists + /api/*, reads owns the per-id /agents/:id, /outputs/:id, etc.).
  await app.register(indexerRoutes);
  await app.register(readsRoutes);
  await app.register(summonRoutes); // public Summon reads (agent price + request status)
  await app.register(chatRoutes); // chat-with-an-Aura: 0G TEE chat + command-surface tools + L2 memory

  // boot housekeeping: any job left mid-flight by a previous process can never finish -> mark failed.
  const reaped = reapOrphanJobs();
  if (reaped > 0) app.log.warn(`reaped ${reaped} orphaned in-flight job(s) on boot`);

  return app;
}
