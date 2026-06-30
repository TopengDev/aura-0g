// SERVER-ONLY. The PROVIDER SEAM for chat. One normalized interface over two backends:
//   - "zerog"     : 0G Compute TEE-attested chat (chat-compute.ts). The on-thesis default. Every reply is
//                   hardware-attested (processResponse) -> attestation is populated + surfaced honestly.
//   - "anthropic" : an OpenAI-class fallback (Anthropic Messages API) behind a health check, so a live
//                   jury demo survives the single 0G model/provider being down or flaky. NOT TEE-attested
//                   -> attestation is null and the UI labels the reply as fallback-served (honest).
//
// The route calls pickProvider() (a cheap 0G health probe) and falls back to anthropic on health-fail OR a
// hard call error, recording WHICH provider served each reply. The Anthropic key is server-side only
// (AURA_CHAT_ANTHROPIC_KEY) - NEVER NEXT_PUBLIC, never logged, never returned to the client.
import type { ChatMessage, ChatTool } from "./chat-compute.js";
import { chatCompletion, getChatBrokerAndService, chatComputeHealthy, resetChatCache } from "./chat-compute.js";

export type ChatProvider = "zerog" | "anthropic";

/** A parsed tool call the orchestrator can route. args is the parsed JSON object (best-effort). */
export interface NormalizedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  rawArgs: string;
}

/** The per-reply TEE attestation (only when the 0G TEE provider served the reply). */
export interface ReplyAttestation {
  teeVerified: boolean | string; // processResponse verdict (true = hardware-attested)
  verifiability: string; // e.g. "TeeML"
  teeSigner: string;
  chatId: string | null;
  model: string;
}

export interface LlmResult {
  text: string | null;
  toolCalls: NormalizedToolCall[];
  finishReason: string;
  provider: ChatProvider;
  attestation: ReplyAttestation | null; // null for the non-TEE fallback (labeled honestly in the UI)
  model: string;
  latencyMs: number;
}

const ANTHROPIC_KEY = () => process.env.AURA_CHAT_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = () => process.env.AURA_CHAT_ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
// Allow forcing a provider for testing/demo: AURA_CHAT_PROVIDER=zerog|anthropic. Unset = auto (0G first).
const FORCED = () => (process.env.AURA_CHAT_PROVIDER || "").toLowerCase();

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── 0G (zerog) ────────────────────────────────────────────────────────────────────────────────────
async function callZeroG(messages: ChatMessage[], tools: ChatTool[] | undefined, maxTokens: number): Promise<LlmResult> {
  const { broker, svc } = await getChatBrokerAndService();
  const r = await chatCompletion(broker, svc, messages, tools, { maxTokens });
  return {
    text: r.content,
    toolCalls: r.toolCalls.map((c) => ({ id: c.id, name: c.name, args: parseArgs(c.args), rawArgs: c.args })),
    finishReason: r.finishReason,
    provider: "zerog",
    attestation: {
      teeVerified: r.verified,
      verifiability: r.verifiability,
      teeSigner: r.teeSigner,
      chatId: r.chatId,
      model: r.model,
    },
    model: r.model,
    latencyMs: r.latencyMs,
  };
}

// ── Anthropic (fallback) ────────────────────────────────────────────────────────────────────────────
// Reshape the OpenAI-style transcript into the Anthropic Messages API shape, normalize the response back.
function toAnthropic(messages: ChatMessage[], tools?: ChatTool[]): {
  system: string;
  messages: any[];
  tools?: any[];
} {
  const systemParts: string[] = [];
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      // a tool result -> a user turn carrying a tool_result block
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: typeof m.content === "string" ? m.content : "" }],
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length) {
      const blocks: any[] = [];
      if (typeof m.content === "string" && m.content.trim()) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: parseArgs(tc.function.arguments) });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }
    out.push({ role: m.role, content: typeof m.content === "string" ? m.content : "" });
  }
  const shaped: any = { system: systemParts.join("\n\n"), messages: out };
  if (tools && tools.length) {
    shaped.tools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }
  return shaped;
}

async function callAnthropic(messages: ChatMessage[], tools: ChatTool[] | undefined, maxTokens: number): Promise<LlmResult> {
  const key = ANTHROPIC_KEY();
  if (!key) throw new Error("anthropic fallback unavailable: AURA_CHAT_ANTHROPIC_KEY not set");
  const model = ANTHROPIC_MODEL();
  const shaped = toAnthropic(messages, tools);
  const t0 = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: shaped.system, messages: shaped.messages, ...(shaped.tools ? { tools: shaped.tools } : {}) }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${raw.slice(0, 200)}`);
  const json = JSON.parse(raw);
  const blocks: any[] = Array.isArray(json?.content) ? json.content : [];
  const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("").trim() || null;
  const toolCalls: NormalizedToolCall[] = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: String(b.id), name: String(b.name), args: (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>, rawArgs: JSON.stringify(b.input ?? {}) }));
  return {
    text,
    toolCalls,
    finishReason: String(json?.stop_reason ?? "end_turn"),
    provider: "anthropic",
    attestation: null, // the fallback is NOT TEE-attested; the UI says so explicitly. Never overclaim.
    model,
    latencyMs: Date.now() - t0,
  };
}

// ── provider selection + the seam entrypoint ─────────────────────────────────────────────────────────

/** Decide which provider to use for THIS turn. 0G first (on-thesis), anthropic if 0G is unhealthy. */
export async function pickProvider(): Promise<{ provider: ChatProvider; reason: string }> {
  const forced = FORCED();
  if (forced === "anthropic") return { provider: "anthropic", reason: "forced" };
  if (forced === "zerog") return { provider: "zerog", reason: "forced" };
  const health = await chatComputeHealthy();
  if (health.ok) return { provider: "zerog", reason: `0G chat healthy (${health.model})` };
  if (ANTHROPIC_KEY()) return { provider: "anthropic", reason: `0G unhealthy (${health.reason}) -> fallback` };
  // no fallback configured: still try 0G (it will surface the real error to the caller).
  return { provider: "zerog", reason: `0G unhealthy (${health.reason}); no fallback configured` };
}

/**
 * Run ONE turn through the seam. Tries the chosen provider; on a 0G hard error with a configured fallback,
 * transparently retries on anthropic (recording the served provider). Returns the normalized result.
 */
export async function runLlm(
  chosen: ChatProvider,
  messages: ChatMessage[],
  tools?: ChatTool[],
  opts: { maxTokens?: number } = {},
): Promise<LlmResult> {
  const maxTokens = opts.maxTokens ?? 512;
  if (chosen === "anthropic") return callAnthropic(messages, tools, maxTokens);
  try {
    return await callZeroG(messages, tools, maxTokens);
  } catch (e) {
    resetChatCache();
    if (ANTHROPIC_KEY() && FORCED() !== "zerog") {
      // 0G failed mid-call (provider down / funding / network). Fall back so the live demo survives.
      return callAnthropic(messages, tools, maxTokens);
    }
    throw e;
  }
}

/** True if an Anthropic fallback key is configured (for the health route / badge copy). */
export function fallbackConfigured(): boolean {
  return !!ANTHROPIC_KEY();
}
