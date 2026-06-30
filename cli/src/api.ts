// Thin typed client for the live AURA backend. Base URL is overridable via AURA_API (so the CLI can point
// at a local dev backend) but defaults to production. All reads are public + unauthenticated.

export const API_BASE = (process.env.AURA_API ?? "https://api-aura.topengdev.com").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(`${status} on ${path}`);
  }
}

async function get<T>(path: string, timeoutMs = 45_000, token?: string): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { accept: "application/json", "user-agent": "aura-cli/0.2", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, path, text.slice(0, 300));
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, path, `non-JSON response: ${text.slice(0, 120)}`);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new ApiError(0, path, `timed out after ${timeoutMs}ms`);
    throw new ApiError(0, path, e instanceof Error ? e.message : "network error");
  } finally {
    clearTimeout(t);
  }
}

// POST sibling of get(): JSON body in, JSON out, optional Bearer JWT (the authed chat surface). Same error
// + timeout shape as get() so callers handle one ApiError type.
async function post<T>(path: string, body: unknown, opts: { token?: string; timeoutMs?: number } = {}): Promise<T> {
  const { token, timeoutMs = 60_000 } = opts;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "aura-cli/0.2",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, path, text.slice(0, 300));
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(res.status, path, `non-JSON response: ${text.slice(0, 120)}`);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new ApiError(0, path, `timed out after ${timeoutMs}ms`);
    throw new ApiError(0, path, e instanceof Error ? e.message : "network error");
  } finally {
    clearTimeout(t);
  }
}

// ── response shapes (only the fields the CLI renders) ──────────────────────────────────────────────────
export interface AgentMeta {
  tagline?: string | null;
  aesthetic?: string | null;
  accent?: string | null;
  signatureCharacter?: string | null;
  model?: string | null;
}
export interface Agent {
  agentId: number;
  name: string;
  owner: string;
  creator?: string;
  royaltyBps: number;
  royaltyPct: number;
  creatorResaleBps: number;
  styleVersion: number;
  minted: boolean;
  outputCount: number;
  salesCount?: number;
  style?: string;
  meta?: AgentMeta;
}

export interface Output {
  tokenId: number;
  owner: string;
  creatorAgentId: number;
  agentName: string;
  imageRoot: string;
  imageUrl: string;
  storageScanUrl?: string;
  seed: string;
  rarity: string;
  provenanceHash: string;
  teeAttestation: string;
  mintedAt?: number;
}

export interface OutputDetail {
  tokenId: number;
  onChain: {
    creatorAgentId: number;
    imageRoot: string;
    provenanceHash: string;
    teeAttestation: string;
    seed: string;
  };
  rarity: string;
  agent: { agentId: number; name: string; owner: string; modelAttestation: string; styleFingerprint: string };
  verification: {
    agentExists: boolean;
    imageOnChain: boolean;
    teeAttestationPresent: boolean;
    royaltyReceiver: string;
    summary: string;
  };
}

export interface SummonRoll {
  provable: boolean;
  seedMatches: boolean;
  rarity: string;
  rarityRoll: number | null;
  subject: Record<string, string>;
  subjectProse: string;
  onChainSeed: string;
  recomputedSeedRoot: string;
  seedPreimage: { domain: string; requestId: number; buyer: string; agentId: number; summonBlockHash: string };
}
export interface SummonProof {
  tokenId: number;
  isSummon: boolean;
  enabled: boolean;
  requestId?: number;
  agentId?: number;
  buyer?: string;
  agentOwner?: string;
  ownerCut?: string;
  ownerCutWei?: string;
  platformFee?: string;
  platformFeeWei?: string;
  fee?: string;
  feeWei?: string;
  fulfillTx?: string;
  escrow?: string;
  roll?: SummonRoll | null;
}

export interface SummonAgentInfo {
  agentId: number;
  enabled: boolean;
  summonable: boolean;
  priceWei: string;
  price: string;
  escrow: string | null;
}

export interface SummonStatus {
  requestId: number;
  status: string;
  agentId: number | null;
  agentName: string | null;
  buyer: string | null;
  fee: string | null;
  tokenId: number | null;
  imageRoot: string | null;
  fulfillTx: string | null;
  settled: boolean;
  expired: boolean;
  error: string | null;
}

// ── chat-with-an-Aura (the SIWE-gated Living-Agents surface) ─────────────────────────────────────────────
export interface AuthSession {
  token: string;
  address: string;
  expiresIn: string;
}
export interface Attestation {
  teeVerified?: boolean;
  verifiability?: string; // e.g. "TeeML"
  teeSigner?: string;
  chatId?: string;
  model?: string;
}
export interface ToolInvocation {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  display: string; // a human one-liner of what the Aura did
  job: { jobId: string; status: string; subject: string } | null; // present for generate_and_mint
}
export interface ChatReply {
  agentId: number;
  agentName: string;
  reply: string;
  provider: string; // "zerog" | "anthropic"
  providerReason: string;
  attestation: Attestation | null; // non-null only when 0G TEE served the final reply
  teeAttested: boolean;
  toolInvocations: ToolInvocation[];
  jobId: string | null;
  latencyMs: number;
}
export interface ChatHealth {
  zerogHealthy: boolean;
  zerogModel: string | null;
  fallbackConfigured: boolean;
  preferred: string;
}
export interface ChatTurn {
  ts: string;
  ownerText: string;
  auraText: string;
  tools: string[];
}
export interface ChatHistory {
  agentId: number;
  turns: ChatTurn[];
}

export const api = {
  agents: () => get<{ agents: Agent[] }>("/agents").then((r) => r.agents),
  agent: (id: number) => get<Agent>(`/agents/${id}`),
  outputs: (limit = 15) => get<{ outputs: Output[] }>(`/outputs?limit=${limit}`).then((r) => r.outputs),
  output: (id: number) => get<OutputDetail>(`/outputs/${id}`),
  summonProof: (id: number) => get<SummonProof>(`/summon/output/${id}/proof`, 60_000),
  summonAgent: (id: number) => get<SummonAgentInfo>(`/summon/agent/${id}`),
  summonStatus: (requestId: number) => get<SummonStatus>(`/summon/${requestId}/status`),
  // auth + chat (the only authed calls the CLI makes; see siwe.ts for the non-custodial sign-in).
  authNonce: () => get<{ nonce: string }>("/auth/nonce").then((r) => r.nonce),
  authVerify: (message: string, signature: string) => post<AuthSession>("/auth/verify", { message, signature }),
  chat: (token: string, agentId: number, message: string) => post<ChatReply>("/chat", { agentId, message }, { token }),
  chatHistory: (token: string, agentId: number) => get<ChatHistory>(`/chat/${agentId}/history`, 45_000, token),
  chatHealth: () => get<ChatHealth>("/chat/health"),
};

/** Resolve an agent ref that may be a numeric id OR a name (case-insensitive). Returns the matched agent. */
export async function resolveAgent(ref: string): Promise<Agent> {
  if (/^\d+$/.test(ref)) return api.agent(Number(ref));
  const agents = await api.agents();
  const hit = agents.find((a) => a.name.toLowerCase() === ref.toLowerCase());
  if (!hit) {
    const names = agents.map((a) => a.name).join(", ");
    throw new ApiError(404, "/agents", `no Aura named "${ref}". Known: ${names}`);
  }
  return hit;
}

/** Build a full, clickable image URL from an Output's (often relative) imageUrl. */
export function imageUrl(u: string | undefined | null): string {
  if (!u) return "-";
  return u.startsWith("http") ? u : `${API_BASE}${u}`;
}
