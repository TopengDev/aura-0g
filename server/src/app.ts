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
import { reapStuckSettlingEscrows } from "./aura/sale-service.js";
import { pruneSiweNonces } from "./aura/siwe.js";
import { authenticate } from "./lib/auth.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { generateRoutes } from "./routes/generate.js";
import { mintArgsRoutes } from "./routes/mint-args.js";
import { agentsCreateRoutes } from "./routes/agents-create.js";
import { agentTransferRoutes } from "./routes/agent-transfer.js";
import { agentSaleRoutes } from "./routes/agent-sale.js";
import { imageRoutes } from "./routes/image.js";
import { readsRoutes } from "./routes/reads.js";
import { indexerRoutes } from "./routes/indexer.js";
import { verifyPublicRoutes } from "./routes/verify-public.js";
import { summonRoutes } from "./routes/summon.js";
import { chatRoutes } from "./routes/chat.js";
import { gameFuseRoutes } from "./routes/game-fuse.js";
import { gameArenaRoutes } from "./routes/game-arena.js";
import { gameReputationRoutes } from "./routes/game-reputation.js";

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 2 * 1024 * 1024, // 2MB JSON bodies (multipart has its own limit)
    // Behind nginx every request arrives from the loopback, so WITHOUT this the global rate-limiter keys
    // every browser onto one shared 120/min bucket (verified perf finding: sections silently render empty
    // + images fall to placeholders under modest demo load). trustProxy makes Fastify resolve the real
    // client IP from X-Forwarded-For, so the limiter buckets per client. The tight per-address AUTHED
    // limits (chat/generate, keyed on the JWT address) are unaffected.
    //
    // M3: trust EXACTLY ONE hop (the single nginx directly in front of this app - host nginx in prod, the
    // compose nginx locally). `true` trusts the WHOLE X-Forwarded-For chain, so a client can SPOOF its own
    // request.ip by sending a forged XFF header and defeat the global 120/min limiter (the last ceiling on
    // H1, which keys on request.ip). `1` makes proxy-addr take the address our nginx appended (the real peer)
    // and IGNORE any client-prepended XFF entries. nginx sets XFF via $proxy_add_x_forwarded_for (verified in
    // deploy/nginx.conf + the host vhost), so the appended entry is authoritative.
    trustProxy: 1,
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
  await app.register(agentSaleRoutes); // paid open-market agent sale (Flow B: server-custodian escrow + split)
  await app.register(imageRoutes); // public GET /image/:root -> real bytes (local cache, 0G fallback)
  // Public KEYLESS verify endpoint (GET /api/verify?token=). A STATIC route, so find-my-way gives it
  // precedence over the /api/* indexer wildcard below (static beats wildcard): it intercepts before the
  // request would fall through to the Ponder proxy. Registered before indexerRoutes for readable intent
  // (precedence is order-independent for static-vs-wildcard, but this reads clearest).
  await app.register(verifyPublicRoutes);
  // Phase-3 indexer integration: /api/* passthrough + indexer-first /agents,/outputs,/marketplace
  // (with a graceful chain-scan fallback). Registered before readsRoutes; their paths don't overlap
  // (indexer owns the lists + /api/*, reads owns the per-id /agents/:id, /outputs/:id, etc.).
  await app.register(indexerRoutes);
  await app.register(readsRoutes);
  await app.register(summonRoutes); // public Summon reads (agent price + request status)
  await app.register(chatRoutes); // chat-with-an-Aura: 0G TEE chat + command-surface tools + L2 memory
  // Game layer (phase 2): FUSION (own-both hybrid mint w/ on-chain genome + L1-inherit/L2-reset memory) +
  // Creative Arena (2-gen shared-theme battle, blind staked commit-reveal vote, keyless tally recompute).
  // Every flow is graceful-off (501) until the phase-4 deploy wires AuraFusion / ArenaVote.
  await app.register(gameFuseRoutes);
  await app.register(gameArenaRoutes);
  await app.register(gameReputationRoutes); // Tier-2: Glicko rating ladder + Merkle anchor + keyless recompute

  // boot housekeeping: any job left mid-flight by a previous process can never finish -> mark failed.
  const reaped = reapOrphanJobs();
  if (reaped > 0) app.log.warn(`reaped ${reaped} orphaned in-flight job(s) on boot`);

  // M5: reconcile any sale escrow stuck 'settling' from a crash mid-settle (reapOrphanJobs only touches jobs).
  // Chain-reconciled by ownerOf: transfer landed -> complete idempotently (no re-transfer, chain-reconciled
  // split); else reset to committed. Fire-and-forget so a slow 0G RPC read never blocks app assembly.
  reapStuckSettlingEscrows()
    .then((n) => {
      if (n > 0) app.log.warn(`reconciled ${n} stuck settling escrow(s) on boot`);
    })
    .catch((e) => app.log.error({ err: String((e as any)?.message).slice(0, 200) }, "settling-escrow boot reconcile failed"));

  // L9: prune spent/expired SIWE nonces on boot + hourly (the table is otherwise append-only, unbounded).
  try {
    const prunedNonces = pruneSiweNonces();
    if (prunedNonces > 0) app.log.info(`pruned ${prunedNonces} used/expired siwe nonce(s) on boot`);
  } catch (e) {
    app.log.warn(`siwe nonce prune (boot) failed: ${String((e as any)?.message).slice(0, 120)}`);
  }
  const noncePruneTimer = setInterval(() => {
    try {
      pruneSiweNonces();
    } catch {
      /* best-effort background prune */
    }
  }, 60 * 60 * 1000);
  noncePruneTimer.unref?.(); // never keep the process (or an app.inject() harness) alive on this timer

  return app;
}
