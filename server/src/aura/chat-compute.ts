// SERVER-ONLY. 0G Compute - TEE-attested CHAT completion seam. The text-LLM analogue of compute.ts
// (which does image gen). DD-verified live 2026-06-30: serviceType "chatbot" / qwen2.5-omni-7b / TeeML
// returns valid OpenAI-shape completions sub-second and the reply is TEE-verified by the SAME
// processResponse path image gen uses. This wires that exact call (modeled on the DD smoke scripts)
// into the backend, reusing the proven broker + funding ritual. No change to the image compute path.
import { ethers } from "ethers";
import { getBroker, fundCompute } from "./compute.js";
import { sponsorSigner } from "./wallet.js";
import { CHAT_MAINNET_RPC, CHAT_MAINNET_CHAIN_ID, chatMainnetKey } from "./config.js";

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

// ── DUAL-NETWORK (mainnet chat, testnet everything-else) ────────────────────────────────────────────
// The CHAT path can run on 0G MAINNET (GLM-5.1) while image gen + contracts + summon + mint + indexer stay
// on 0G TESTNET Galileo. A 0G broker's NETWORK is determined ENTIRELY by its signer's provider (RPC +
// chainId): the testnet chat broker is built from the testnet SPONSOR signer (unchanged, same signer image
// gen uses); the mainnet chat broker is built from a DEDICATED key/RPC. The two brokers are therefore fully
// ISOLATED - a mainnet chat call can never touch the testnet ledger and vice-versa. Validated live
// 2026-07-01 (verified=true 4/4) that getBroker(walletOnMainnetRPC) yields a genuine in-enclave mainnet broker.
export type ChatNetwork = "testnet" | "mainnet";

/** The active chat network: mainnet when AURA_CHAT_MAINNET=1, else testnet (today's EXACT behavior). Read
 *  LIVE from the env each call (not a boot const) so it is unit-observable + flippable; safe because every
 *  broker/service/model cache below is keyed by network. */
export function chatNetwork(): ChatNetwork {
  return (process.env.AURA_CHAT_MAINNET ?? "0") === "1" ? "mainnet" : "testnet";
}

/**
 * The signer whose provider pins a chat broker's network.
 *   - testnet: the existing testnet SPONSOR signer (testnet Galileo RPC) - UNCHANGED.
 *   - mainnet: a DEDICATED wallet from AURA_CHAT_MAINNET_KEY on the mainnet RPC/chainId, ISOLATED from the
 *     sponsor/image broker. Built fresh per broker build; the BROKER it produces is what gets cached.
 */
function chatSigner(network: ChatNetwork): ethers.Wallet {
  if (network === "mainnet") {
    // explicit chainId => fail-closed if the RPC ever answers a different chain (never silently wrong-network).
    const provider = new ethers.JsonRpcProvider(CHAT_MAINNET_RPC, CHAT_MAINNET_CHAIN_ID);
    return new ethers.Wallet(chatMainnetKey(), provider);
  }
  return sponsorSigner();
}

// ── TeeML integrity allowlist (THE MOAT) ────────────────────────────────────────────────────────────
// WHY THIS EXISTS: on 0G MAINNET the on-chain `verifiability: "TeeML"` flag is OVER-INCLUSIVE. It is set not
// only on providers that genuinely run the model INSIDE a TEE, but ALSO on TeeTLS relay-proxies (e.g.
// DeepSeek / MiniMax / gpt-5.4) that merely FORWARD the request to an EXTERNAL cloud over an attested TLS
// tunnel. Those proxies are NOT in-enclave inference, yet they still carry "TeeML". So "TeeML" ALONE does
// NOT prove in-enclave execution on mainnet. We therefore require BOTH verifiability==="TeeML" AND the
// provider address be in this allowlist of providers we have INDIVIDUALLY verified run genuine in-enclave
// TeeML. A provider NOT in the allowlist is NEVER selectable or served on the chat path, even if tagged
// TeeML. Seed = the providers validated live 2026-07-01 (verified=true, genuinely in-enclave). Env-overridable
// via AURA_CHAT_TEEML_ALLOWLIST (comma-separated 0x addresses) to add/rotate trusted providers without a redeploy.
const DEFAULT_CHAT_TEEML_ALLOWLIST = [
  "0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D", // GLM-5.1-FP8    (teeSigner 0xA46EA4FC5889AD35A1487e1Ed04dCcfa872146B9)
  "0xDB7B465300B0acf454867683c5481055f698b2e8", // glm-5.1
  "0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9", // 0GM-1.0-35B-A3B (0G in-house)
];

/** The active chat TeeML allowlist (lowercased). An env override REPLACES the seed (comma-separated addresses). */
export function chatTeemlAllowlist(): Set<string> {
  const raw = (process.env.AURA_CHAT_TEEML_ALLOWLIST || "").trim();
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_CHAT_TEEML_ALLOWLIST;
  return new Set(list.map((a) => a.toLowerCase()));
}

/**
 * THE CHAT INTEGRITY GUARD. A 0G service may serve/be-selectable for chat iff:
 *   (1) verifiability === "TeeML"  - the TEE floor, enforced on BOTH networks (a non-TEE provider is never served); AND
 *   (2) on MAINNET, its provider is in the verified allowlist - defeats the TeeTLS relay-proxy impersonation.
 * On TESTNET the flag is honest (no relay-proxy problem; qwen2.5-omni-7b is genuinely in-enclave), so only
 * (1) applies, which qwen satisfies -> testnet selection is UNCHANGED. Pure + synchronous => trivially unit-traceable.
 */
export function chatServiceAllowed(svc: { provider: string; verifiability: string }, network: ChatNetwork): boolean {
  if (!/teeml/i.test(String(svc.verifiability || ""))) return false; // (1) TEE floor - both networks
  if (network === "mainnet" && !chatTeemlAllowlist().has(String(svc.provider || "").toLowerCase())) return false; // (2) mainnet allowlist
  return true;
}

// The 0G Compute SDK builds a broker via on-chain reads (slow); cache the broker + the auto-discovered
// default chat service for a short TTL so a chat route does not re-list services on every message. The
// broker is cached SEPARATELY from the discovered service so the /chat/models route + a pick-a-specific-
// model route can reuse the (expensive) broker without forcing the default-service discovery. Caches are
// keyed BY NETWORK so the mainnet + testnet brokers/services never collide (the isolation is enforced here).
const _brokerCache: Partial<Record<ChatNetwork, { broker: any; at: number }>> = {};
const _svcCache: Partial<Record<ChatNetwork, { svc: ChatService; at: number }>> = {};
const SVC_TTL_MS = 5 * 60_000;

/**
 * List chat-relevant services for a network.
 *   - testnet: EXACTLY today's acknowledged-only broker.inference.listService() (zero behavior change).
 *   - mainnet: include UNacknowledged services. A cold dedicated mainnet wallet has acknowledged NOTHING
 *     yet, so acknowledged-only would hide GLM-5.1; the funding ritual in chatCompletion acknowledges the
 *     picked provider on first use, and chatServiceAllowed() keeps listing-the-unacknowledged safe.
 */
async function listChatServicesRaw(broker: any, network: ChatNetwork): Promise<any[]> {
  if (network === "mainnet") return await pageAllServices(broker, true);
  return await broker.inference.listService();
}

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
export async function chatService(broker: any, network: ChatNetwork = chatNetwork()): Promise<ChatService> {
  const services = await listChatServicesRaw(broker, network);
  // THE MOAT: only consider services that pass the integrity guard (TeeML on both nets; TeeML + allowlist on
  // mainnet). This runs BEFORE ranking, so a higher-scoring relay-proxy tagged "TeeML" (e.g. a DeepSeek proxy,
  // family score 40) can NEVER be auto-picked on mainnet - it is filtered out before the sort even sees it.
  const chats = services.filter(isChatService).filter((s: any) => chatServiceAllowed(s, network));
  if (!chats.length) throw new Error(`no allowlisted TEE chat service served on 0G ${network} right now`);

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

/** Build (or reuse) the cached broker FOR A NETWORK. Testnet uses the SPONSOR signer (unchanged); mainnet
 *  uses the dedicated isolated mainnet signer. Defaults to the active network so existing no-arg callers are
 *  testnet when AURA_CHAT_MAINNET is unset (today's behavior) and mainnet when it is set. */
export async function getChatBroker(network: ChatNetwork = chatNetwork()): Promise<any> {
  const hit = _brokerCache[network];
  if (hit && Date.now() - hit.at < SVC_TTL_MS) return hit.broker;
  const broker = await getBroker(chatSigner(network));
  _brokerCache[network] = { broker, at: Date.now() };
  return broker;
}

/** Build (or reuse a cached) broker + the auto-discovered (ranked, allowlist-guarded) default chat service
 *  for a network. Returns the network too so callers can label attestation/health honestly. */
export async function getChatBrokerAndService(
  network: ChatNetwork = chatNetwork(),
): Promise<{ broker: any; svc: ChatService; network: ChatNetwork }> {
  const broker = await getChatBroker(network);
  const hit = _svcCache[network];
  if (hit && Date.now() - hit.at < SVC_TTL_MS) return { broker, svc: hit.svc, network };
  const svc = await chatService(broker, network);
  _svcCache[network] = { svc, at: Date.now() };
  return { broker, svc, network };
}

/** Drop the cached broker/service (called after a hard failure so the next call rediscovers). Pass a network
 *  to reset just that one (keeps the other network's warm broker); no arg resets BOTH. */
export function resetChatCache(network?: ChatNetwork): void {
  if (network) {
    delete _brokerCache[network];
    delete _svcCache[network];
    return;
  }
  (Object.keys(_brokerCache) as ChatNetwork[]).forEach((n) => delete _brokerCache[n]);
  (Object.keys(_svcCache) as ChatNetwork[]).forEach((n) => delete _svcCache[n]);
}

// ── Model discovery + reachability (the /chat/models picker surface + specific-model routing) ──────────
// The FULL registry (incl UNacknowledged services) surfaces every chat model honestly: the acknowledged +
// TEE-attested + reachable one is `selectable`; the rest are shown offline / unverified so the moat stays
// legible in the UI. Each provider endpoint's reachability is probed READ-ONLY (an UNBILLED POST -> the
// provider rejects the unsigned request BEFORE any inference, so it costs NOTHING) and CACHED (~5 min) so a
// poll never re-probes the network. Everything here is fail-soft: a probe/meta miss marks a model unknown.

/** Public status of one 0G chat model for the picker (verified live 2026-07-01 against the Galileo registry). */
export interface ChatModelInfo {
  id: string; // model id, e.g. "qwen/qwen2.5-omni-7b"
  provider: string; // the representative provider address serving it (on-chain public)
  label: string; // human display label, e.g. "Qwen2.5 Omni 7B"
  sizeB: number; // parsed parameter count in billions (0 = unknown)
  teeAttested: boolean; // the RAW on-chain verifiability === "TeeML" flag (over-inclusive on mainnet - see allowlisted)
  allowlisted: boolean; // passes the integrity guard for this network (TeeML on testnet; TeeML + allowlist on mainnet)
  acknowledged: boolean; // this caller has acknowledged the provider's TEE signer (a precondition to bill it)
  online: boolean | null; // endpoint reachable now (null = probe inconclusive / unknown)
  selectable: boolean; // online === true && acknowledged && allowlisted (safe to route + expect a genuine TEE reply)
  verifiability: string; // e.g. "TeeML" or ""
  network: ChatNetwork; // which network this row was discovered on (mainnet | testnet)
}

const REACH_TTL_MS = 5 * 60_000;
const MODELS_TTL_MS = 60_000;
const _reachCache = new Map<string, { online: boolean | null; at: number }>();
const _modelsCache: Partial<Record<ChatNetwork, { models: ChatModelInfo[]; defaultId: string | null; at: number }>> = {};

/** Page the FULL inference registry (optionally including services whose TEE signer is unacknowledged). */
async function pageAllServices(broker: any, includeUnacknowledged: boolean): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; off < 500; off += 50) {
    const page = await broker.inference.listService(off, 50, includeUnacknowledged);
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    if (page.length < 50) break;
  }
  return out;
}

/**
 * READ-ONLY reachability check: an UNBILLED POST to a provider's /chat/completions. Any HTTP status means
 * the endpoint is UP (it rejects the unsigned request before inference, so NO broker spend). A transport
 * failure means DOWN. Anything ambiguous returns null (unknown). NEVER throws.
 */
async function probeReach(endpoint: string): Promise<boolean | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "probe", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    void res.text().catch(() => {}); // drain + ignore the body; we only care that it answered
    return true;
  } catch (e: any) {
    clearTimeout(timer);
    const m = String(e?.message || e);
    if (/abort|timeout/i.test(m)) return false;
    if (/eof|ECONNREFUSED|fetch failed|handshake|socket|ENOTFOUND|EAI_AGAIN|network|dns/i.test(m)) return false;
    return null; // inconclusive -> unknown (never falsely claim up/down)
  }
}

/** Cached reachability (TTL ~5 min). Shared by the models list + specific-model routing so neither re-probes. */
export async function serviceOnline(endpoint: string): Promise<boolean | null> {
  if (!endpoint) return null;
  const hit = _reachCache.get(endpoint);
  if (hit && Date.now() - hit.at < REACH_TTL_MS) return hit.online;
  let online: boolean | null = null;
  try {
    online = await probeReach(endpoint);
  } catch {
    online = null;
  }
  _reachCache.set(endpoint, { online, at: Date.now() });
  return online;
}

/** Parse the parameter count in billions from a model id (7b / 20b / 27b / 0.5b -> 7 / 20 / 27 / 0.5). */
function parseSizeB(model: string): number {
  const m = model.toLowerCase().match(/(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/);
  return m ? parseFloat(m[1]) : 0;
}

/** A human display label derived from a model id (last path segment, spaced + tastefully cased). */
function labelForModel(model: string): string {
  const seg = (model.split("/").pop() || model).trim();
  return seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => {
      if (/^(gpt|oss|it|tee|glm|llm|ai|hd)$/i.test(w)) return w.toUpperCase();
      if (/^\d+(?:\.\d+)?b$/i.test(w)) return w.toUpperCase(); // 7B / 20B / 0.5B
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/**
 * Discover EVERY 0G chat model with its live status for the picker. Dedups by model id (a model served by
 * several providers collapses to one row: online if UP on ANY provider, TEE/acknowledged if so on ANY).
 * CACHED for a short TTL; the per-endpoint reachability underneath is cached longer (~5 min). Robust: a
 * probe/meta failure marks that model unknown, never throws.
 */
export async function listChatModels(
  network: ChatNetwork = chatNetwork(),
): Promise<{ models: ChatModelInfo[]; defaultId: string | null; network: ChatNetwork }> {
  const cached = _modelsCache[network];
  if (cached && Date.now() - cached.at < MODELS_TTL_MS) {
    return { models: cached.models, defaultId: cached.defaultId, network };
  }
  const broker = await getChatBroker(network);
  const all = await pageAllServices(broker, true);
  const chats = all.filter(isChatService);

  // resolve endpoint + reachability per raw service (parallel, fail-soft). `trusted` = the integrity guard
  // verdict for THIS network (TeeML on testnet; TeeML + allowlist on mainnet) - the raw teeAttested flag is
  // ALSO kept so the UI can show a relay-proxy honestly as "tagged TeeML but not a trusted in-enclave provider".
  const raw = await Promise.all(
    chats.map(async (s: any) => {
      const teeAttested = /teeml/i.test(String(s.verifiability || ""));
      const trusted = chatServiceAllowed(s, network);
      const acknowledged = !!s.teeSignerAcknowledged;
      let online: boolean | null = null;
      try {
        const meta = await broker.inference.getServiceMetadata(s.provider);
        online = await serviceOnline(meta.endpoint);
      } catch {
        online = null; // metadata lookup failed -> unknown, never throw
      }
      return { id: String(s.model), provider: String(s.provider), teeAttested, trusted, acknowledged, online, verifiability: String(s.verifiability || "") };
    }),
  );

  // dedup by model id, merging each group to its strongest status
  const groups = new Map<string, typeof raw>();
  for (const r of raw) {
    const g = groups.get(r.id) ?? [];
    g.push(r);
    groups.set(r.id, g);
  }
  const models: ChatModelInfo[] = [];
  for (const [id, group] of groups) {
    const onlines = group.map((g) => g.online);
    const online: boolean | null = onlines.includes(true) ? true : onlines.includes(false) ? false : null;
    const teeAttested = group.some((g) => g.teeAttested);
    const trusted = group.some((g) => g.trusted);
    const acknowledged = group.some((g) => g.acknowledged);
    // the representative provider is the one routing would actually serve: prefer a trusted + live provider,
    // then any trusted one, then fall back to the live/first so a relay-proxy row still renders (non-selectable).
    const rep =
      group.find((g) => g.trusted && g.online === true) ??
      group.find((g) => g.trusted) ??
      group.find((g) => g.online === true) ??
      group[0];
    models.push({
      id,
      provider: rep.provider,
      label: labelForModel(id),
      sizeB: parseSizeB(id),
      teeAttested,
      allowlisted: trusted,
      acknowledged,
      online,
      // selectable requires the integrity guard (`trusted`) - a relay-proxy tagged TeeML but NOT allowlisted
      // is never selectable on mainnet, even when online + acknowledged. Honest by construction.
      selectable: online === true && acknowledged && trusted,
      verifiability: rep.verifiability,
      network,
    });
  }

  models.sort(
    (a, b) => Number(b.selectable) - Number(a.selectable) || chatModelScore(b.id) - chatModelScore(a.id) || a.label.localeCompare(b.label),
  );
  const defaultId = models.find((m) => m.selectable)?.id ?? null;
  _modelsCache[network] = { models, defaultId, at: Date.now() };
  return { models, defaultId, network };
}

/**
 * Resolve a specific requested model id to a routable ChatService, or null. THE MOAT: the match must pass
 * chatServiceAllowed() - verifiability === "TeeML" on both networks, PLUS the provider allowlist on mainnet -
 * so it can NEVER return a non-TEE provider nor a mainnet relay-proxy tagged "TeeML". A miss (offline model,
 * a relay-proxy, a typo) returns null and the caller falls back to the auto-picked model - a reply is never
 * silently served off an untrusted provider. (Testnet lists acknowledged-only, as before; mainnet includes
 * unacknowledged so a not-yet-acknowledged-but-allowlisted GLM is routable, then funded on first use.)
 */
export async function chatServiceFor(
  broker: any,
  modelId: string,
  network: ChatNetwork = chatNetwork(),
): Promise<ChatService | null> {
  const target = String(modelId || "").trim().toLowerCase();
  if (!target) return null;
  const services = await listChatServicesRaw(broker, network);
  const chats = services.filter(isChatService);
  const match =
    chats.find((s: any) => String(s.model).toLowerCase() === target) ??
    chats.find((s: any) => String(s.model).toLowerCase().includes(target)) ??
    chats.find((s: any) => target.includes(String(s.model).toLowerCase()));
  if (!match) return null;
  if (!chatServiceAllowed(match, network)) return null; // TEE floor (both nets) + allowlist (mainnet)
  const meta = await broker.inference.getServiceMetadata(match.provider);
  return { provider: match.provider, endpoint: meta.endpoint, model: meta.model, verifiability: match.verifiability, teeSigner: match.teeSignerAddress };
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

/** Cheap liveness probe: can we build a broker + see an allowlisted chat service right now? (No paid call.)
 *  Reflects the REAL fallback capability: on the mainnet primary it also probes the testnet qwen rung the
 *  seam would fall back to, so it reports 0G-healthy whenever EITHER rung can serve, and names which network. */
export async function chatComputeHealthy(): Promise<{ ok: boolean; network?: ChatNetwork; model?: string; reason?: string }> {
  const primary = chatNetwork();
  try {
    const { svc } = await getChatBrokerAndService(primary);
    return { ok: true, network: primary, model: svc.model };
  } catch (e: any) {
    resetChatCache(primary);
    if (primary === "mainnet") {
      // mainnet GLM unreachable -> is the testnet qwen fallback rung healthy? (the seam falls through to it)
      try {
        const { svc } = await getChatBrokerAndService("testnet");
        return { ok: true, network: "testnet", model: svc.model };
      } catch (e2: any) {
        resetChatCache("testnet");
        return { ok: false, reason: `mainnet+testnet chat down: ${String(e2?.message ?? e2).slice(0, 90)}` };
      }
    }
    return { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
  }
}
