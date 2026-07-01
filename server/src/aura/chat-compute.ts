// SERVER-ONLY. 0G Compute - TEE-attested CHAT completion seam. The text-LLM analogue of compute.ts
// (which does image gen). DD-verified live 2026-06-30: serviceType "chatbot" / qwen2.5-omni-7b / TeeML
// returns valid OpenAI-shape completions sub-second and the reply is TEE-verified by the SAME
// processResponse path image gen uses. This wires that exact call (modeled on the DD smoke scripts)
// into the backend, reusing the proven broker + funding ritual. No change to the image compute path.
import { getBroker, fundCompute } from "./compute.js";
import { sponsorSigner } from "./wallet.js";

/** An OpenAI-style chat message. content is null only on an assistant turn that is pure tool_calls. */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  // assistant tool-call turns / tool results (OpenAI shape) - passed through verbatim to the model.
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

/** An OpenAI-style function/tool definition (the command-surface). */
export interface ChatTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatService {
  provider: string;
  endpoint: string;
  model: string;
  verifiability: string;
  teeSigner: string;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; args: string }>;
  finishReason: string;
  chatId: string | null;
  verified: boolean | string; // processResponse TEE verdict (true = hardware-attested)
  latencyMs: number;
  model: string;
  teeSigner: string;
  verifiability: string;
}

// The 0G Compute SDK builds a broker via on-chain reads (slow); cache it + the discovered chat service
// for a short TTL so a chat route does not re-list services on every message.
let _cached: { broker: any; svc: ChatService; at: number } | null = null;
const SVC_TTL_MS = 5 * 60_000;

/** True when a discovered 0G service can serve chat completions (its serviceType or model id signals it). */
function isChatService(s: any): boolean {
  return (
    /chat|text|llm|chatbot|completion/i.test(String(s.serviceType)) ||
    /omni|qwen2|llm|chatbot|instruct|deepseek|glm|gpt|gemma|llama|mixtral|mistral/i.test(String(s.model))
  );
}

/**
 * Capability score for ranking chat services (higher = stronger). Lets an Aura automatically prefer a stronger
 * TEE-attested chat model the moment 0G Compute serves (acknowledges) one, with qwen as the guaranteed floor.
 * Pure + deterministic: score = a known-family bonus + the parameter count parsed from the model id, minus a
 * small penalty for the "omni" multimodal variant (weaker at pure-text chat than a same-size text model).
 * IMPORTANT: this only ever ranks services listService() ALREADY returned - i.e. acknowledged, TEE-attestable
 * providers - so it can never select an unattested provider and the verifiability moat is fully preserved.
 * (Verified live 2026-07-01: 0G Compute serves qwen2.5-omni-7b acknowledged; gpt-oss-20b + gemma-3-27b-it are
 * registered as TeeML but NOT yet acknowledged, so today only qwen is returned and this ranking is a no-op.)
 */
export function chatModelScore(model: string): number {
  const m = model.toLowerCase();
  const size = m.match(/(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/); // parses 27b / 20b / 7b / 0.5b
  const sizeB = size ? parseFloat(size[1]) : 0;
  let family = 0;
  if (/deepseek|glm/.test(m)) family = 40;
  else if (/gpt|gemma|llama|mixtral|mistral/.test(m)) family = 25;
  else if (/qwen/.test(m)) family = 10;
  return family + sizeB + (/omni/.test(m) ? -3 : 0);
}

/**
 * Discover the STRONGEST TEE chat service on 0G Compute. Ranks the discovered (acknowledged, attestable) chat
 * services by capability and prefers the strongest, with a safe fallback to qwen / the first chat service if
 * the preferred one is absent. An operator can pin a specific model via AURA_CHAT_PREFER (substring match) or
 * restore the old first-match behaviour with AURA_CHAT_RANK=0. Throws if no chat service is served right now.
 */
export async function chatService(broker: any): Promise<ChatService> {
  const services = await broker.inference.listService();
  const chats = services.filter(isChatService);
  if (!chats.length) throw new Error("no chat service served on 0G Compute right now");

  const prefer = (process.env.AURA_CHAT_PREFER || "").toLowerCase();
  const rank = (process.env.AURA_CHAT_RANK ?? "1") !== "0";

  let chat: any;
  if (prefer) chat = chats.find((s: any) => String(s.model).toLowerCase().includes(prefer)); // explicit operator pin
  if (!chat && rank) chat = [...chats].sort((a: any, b: any) => chatModelScore(String(b.model)) - chatModelScore(String(a.model)))[0];
  if (!chat) chat = chats.find((s: any) => /qwen/i.test(String(s.model))) ?? chats[0]; // safe qwen / first fallback

  const meta = await broker.inference.getServiceMetadata(chat.provider);
  return {
    provider: chat.provider,
    endpoint: meta.endpoint,
    model: meta.model,
    verifiability: chat.verifiability,
    teeSigner: chat.teeSignerAddress,
  };
}

/** Build (or reuse a cached) broker + discovered chat service. The SPONSOR wallet pays for inference. */
export async function getChatBrokerAndService(): Promise<{ broker: any; svc: ChatService }> {
  if (_cached && Date.now() - _cached.at < SVC_TTL_MS) return { broker: _cached.broker, svc: _cached.svc };
  const signer = sponsorSigner();
  const broker = await getBroker(signer);
  const svc = await chatService(broker);
  _cached = { broker, svc, at: Date.now() };
  return { broker, svc };
}

/** Drop the cached broker/service (called after a hard failure so the next call rediscovers). */
export function resetChatCache(): void {
  _cached = null;
}

/** The content string the billing header + TEE attestation are signed over (mirrors the DD smoke). */
function billText(messages: ChatMessage[]): string {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n")
    .slice(0, 6000);
}

/**
 * One TEE-attested chat completion on 0G Compute. On a funding-related failure it runs the funding ritual
 * once and retries (matches compute.ts). Returns the reply + tool calls + the processResponse TEE verdict.
 */
export async function chatCompletion(
  broker: any,
  svc: ChatService,
  messages: ChatMessage[],
  tools?: ChatTool[],
  opts: { maxTokens?: number; toolChoice?: "auto" | "none" } = {},
): Promise<ChatCompletionResult> {
  const bill = billText(messages);

  const attempt = async (): Promise<ChatCompletionResult> => {
    const headers = await broker.inference.getRequestHeaders(svc.provider, bill);
    const body: Record<string, unknown> = {
      model: svc.model,
      messages,
      max_tokens: opts.maxTokens ?? 2048,
    };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = opts.toolChoice ?? "auto";
    }

    const t0 = Date.now();
    const res = await fetch(`${svc.endpoint}/chat/completions`, {
      method: "POST",
      headers: { ...(headers as any), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => (respHeaders[k] = v));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 240)}`);

    const json = JSON.parse(raw);
    const msg = json?.choices?.[0]?.message ?? {};
    const finishReason = String(json?.choices?.[0]?.finish_reason ?? "stop");
    const chatId = respHeaders["zg-res-key"] || json?.id || null;

    const toolCalls = Array.isArray(msg.tool_calls)
      ? msg.tool_calls.map((c: any) => ({
          id: String(c.id ?? `call_${c.function?.name}`),
          name: String(c.function?.name ?? ""),
          args: String(c.function?.arguments ?? "{}"),
        }))
      : [];

    // TEE verification + settlement - processResponse must receive the chatId + the same content string.
    let verified: boolean | string = "n/a";
    try {
      verified = await broker.inference.processResponse(svc.provider, chatId, bill);
    } catch (e: any) {
      verified = `err:${String(e?.message).slice(0, 60)}`;
    }

    return {
      content: typeof msg.content === "string" ? msg.content : msg.content == null ? null : String(msg.content),
      toolCalls,
      finishReason,
      chatId,
      verified,
      latencyMs: Date.now() - t0,
      model: svc.model,
      teeSigner: svc.teeSigner,
      verifiability: svc.verifiability,
    };
  };

  try {
    return await attempt();
  } catch {
    // funding ritual (deposit + ack + transfer) then one retry - the DD documented the finicky 1.0 0G
    // locked reserve + unsettled-fee remainder that 400s calls until topped up. fundCompute is idempotent.
    await fundCompute(broker, svc.provider);
    return await attempt();
  }
}

/** Cheap liveness probe: can we build a broker + see a chat service right now? (Does NOT make a paid call.) */
export async function chatComputeHealthy(): Promise<{ ok: boolean; model?: string; reason?: string }> {
  try {
    const { svc } = await getChatBrokerAndService();
    return { ok: true, model: svc.model };
  } catch (e: any) {
    resetChatCache();
    return { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
  }
}
