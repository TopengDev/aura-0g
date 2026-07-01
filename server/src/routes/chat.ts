// POST /chat (authed, owner-scoped) - talk to an Aura. The Living-Agents core: in-character reply grounded
// in on-chain identity + owner-relationship memory, every reply TEE-attested when 0G serves it, and the Aura
// can ACT (the command surface) via guarded, non-custodial tools.
//
// Flow per turn: load identity+persona -> retrieve owner memory (dual-wall) -> provider seam (0G TEE, anthropic
// fallback behind a health check) -> if tool_calls, route them (read = inline; create = a real guarded gen job)
// -> synthesize -> persist the turn to sealed owner memory -> return { reply, provider, attestation,
// toolInvocations, jobId? }.
//
//   GET /chat/:agentId/history  -> the owner's decrypted relationship history (for the UI)
//   GET /chat/health            -> which provider would serve now (badge copy; never leaks the key)
import type { FastifyInstance } from "fastify";
import type { ChatMessage } from "../aura/chat-compute.js";
import { getAgentById } from "../aura/agents.js";
import { buildSystemPrompt } from "../aura/chat-persona.js";
import { loadOwnerMemory, retrieve, renderMemory, appendTurn, historyForOwner } from "../aura/chat-memory.js";
import { pickProvider, runLlm, fallbackConfigured, type LlmResult } from "../aura/chat-llm.js";
import { CHAT_TOOLS, routeTool, type ToolResult } from "../aura/chat-tools.js";
import { chatComputeHealthy, listChatModels } from "../aura/chat-compute.js";
import { rateLimit } from "../aura/ratelimit.js";

const MAX_TOOL_ROUNDS = 2;

/** Enforce the no-long-hyphen house rule on user-facing model output (em/en dash -> comma). The LLM does
 *  not always obey the system-prompt instruction, so we sanitize the served reply deterministically. */
function sanitizeReply(s: string): string {
  return s.replace(/\s*[—–]\s*/g, ", ").replace(/[—–]/g, ", ");
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // POST /chat
  app.post<{ Body: { agentId?: number; message?: string; model?: string; modelId?: string } }>(
    "/chat",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const owner = req.user.address;
      const { agentId, message } = req.body ?? {};
      if (typeof agentId !== "number" || !Number.isInteger(agentId) || agentId < 1) {
        return reply.code(400).send({ error: "agentId (positive integer) required" });
      }
      if (!message || message.trim().length < 1) {
        return reply.code(400).send({ error: "message required" });
      }
      const userText = message.trim().slice(0, 2000);
      // OPTIONAL model pick (from the /chat/models picker). Routed to iff it is online + TEE-attested +
      // acknowledged; otherwise the seam falls back to the auto-picked TEE model and flags modelFallback.
      const requestedModel =
        (typeof req.body?.model === "string" && req.body.model.trim()) ||
        (typeof req.body?.modelId === "string" && req.body.modelId.trim()) ||
        null;

      // per-user chat rate limit (each 0G reply costs the sponsor ledger).
      const rl = rateLimit(`chat:${owner}`, 20, 60_000);
      if (!rl.ok) return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });

      const agent = await getAgentById(agentId);
      if (!agent) return reply.code(404).send({ error: `agent #${agentId} not found on-chain` });

      // 1. memory (dual-wall at the loader) -> retrieve -> render
      const { records, blockedSegments } = await loadOwnerMemory(agentId, owner);
      const retrieved = retrieve(records, userText);
      const memoryText = renderMemory(retrieved);

      // 2. persona system prompt
      const system = buildSystemPrompt({ agent, retrievedMemory: memoryText, blockedSegments, ownerAddress: owner });

      // 3. provider (0G TEE first, anthropic fallback behind the health check)
      const { provider: chosen, reason: providerReason } = await pickProvider();

      // 4. the transcript (OpenAI shape) + the tool loop
      const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: userText },
      ];

      const toolInvocations: Array<{ name: string; args: Record<string, unknown>; result: ToolResult }> = [];
      let result: LlmResult;
      try {
        result = await runLlm(chosen, messages, CHAT_TOOLS, { modelId: requestedModel });
      } catch (e: any) {
        return reply.code(502).send({ error: `chat provider failed: ${String(e?.message ?? e).slice(0, 160)}` });
      }
      const modelFallback = !!result.modelFallback; // captured from the FIRST reply (the routing decision)

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        if (!result.toolCalls.length) break;

        // record the assistant tool-call turn (OpenAI shape) for the next round
        messages.push({
          role: "assistant",
          content: result.text ?? null,
          tool_calls: result.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.rawArgs } })),
        });

        for (const call of result.toolCalls) {
          const tr = await routeTool(call.name, call.args, { agentId, owner });
          toolInvocations.push({ name: call.name, args: call.args, result: tr });
          messages.push({ role: "tool", tool_call_id: call.id, name: call.name, content: JSON.stringify(tr.data) });
        }

        try {
          result = await runLlm(result.provider, messages, CHAT_TOOLS, { modelId: requestedModel });
        } catch (e: any) {
          // tools already executed; synthesize a minimal honest reply rather than 502.
          result = { ...result, text: result.text ?? "Done.", toolCalls: [] };
          break;
        }
      }

      const replyText = sanitizeReply((result.text ?? "").trim()) || "(no reply)";
      const jobId = toolInvocations.find((t) => t.result.job)?.result.job?.jobId ?? null;

      // 5. persist the turn to sealed owner memory (batched per turn)
      try {
        appendTurn(agentId, owner, {
          ts: new Date().toISOString(),
          ownerText: userText,
          auraText: replyText,
          tools: toolInvocations.map((t) => t.name),
        });
      } catch (e) {
        req.log.warn({ err: e }, "chat memory append failed (non-fatal)");
      }

      return {
        agentId,
        agentName: agent.name,
        reply: replyText,
        provider: result.provider, // which provider served the FINAL reply (zerog | anthropic)
        providerReason,
        // HONEST verifiable framing: per-reply TEE attestation ONLY when 0G served it. The fallback is NOT
        // TEE-attested (attestation null). The whole turn is not one proof - tool actions are separately
        // verifiable on-chain; private memory is owner-only. The UI labels exactly this.
        attestation: result.attestation,
        teeAttested: !!result.attestation && result.attestation.teeVerified === true,
        // model-picker honesty: what was asked for vs what actually served, and whether we substituted.
        requestedModel,
        servedModel: result.attestation?.model ?? result.model ?? null,
        modelFallback,
        toolInvocations: toolInvocations.map((t) => ({ name: t.name, args: t.args, ok: t.result.ok, display: t.result.display, job: t.result.job ?? null })),
        jobId,
        latencyMs: result.latencyMs,
      };
    },
  );

  // GET /chat/:agentId/history - the current owner's decrypted relationship history (dual-wall scoped).
  app.get<{ Params: { agentId: string } }>(
    "/chat/:agentId/history",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const agentId = Number(req.params.agentId);
      if (!Number.isInteger(agentId) || agentId < 1) return reply.code(400).send({ error: "bad agentId" });
      const records = await historyForOwner(agentId, req.user.address);
      return { agentId, turns: records };
    },
  );

  // GET /chat/health - which provider would serve a reply right now (for the badge). Never leaks the key.
  // `zerogNetwork` names the network that would actually serve (mainnet | testnet) so the badge is honest
  // about whether the reply is mainnet GLM-5.1 or the testnet qwen fallback rung.
  app.get("/chat/health", async () => {
    const zerog = await chatComputeHealthy();
    return {
      zerogHealthy: zerog.ok,
      zerogModel: zerog.ok ? zerog.model : null,
      zerogNetwork: zerog.ok ? (zerog.network ?? null) : null,
      fallbackConfigured: fallbackConfigured(),
      preferred: zerog.ok ? "zerog" : fallbackConfigured() ? "anthropic" : "zerog",
    };
  });

  // GET /chat/models - every 0G chat model + its live status for the picker. PUBLIC (no auth), READ-ONLY
  // (a cached, unbilled reachability probe -> NO broker spend), and fail-soft (never 500s the picker: a
  // total discovery failure degrades to an empty list so the UI just uses the server's auto-picked model).
  app.get("/chat/models", async (req) => {
    try {
      const { models, defaultId, network } = await listChatModels();
      return { models, default: defaultId, network, cacheTtlMs: 60_000 };
    } catch (e: any) {
      req.log.warn({ err: e }, "chat models discovery failed (non-fatal)");
      return { models: [], default: null, error: String(e?.message ?? e).slice(0, 120) };
    }
  });
}
