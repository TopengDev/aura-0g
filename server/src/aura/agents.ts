// SERVER-ONLY. Agents = on-chain AgentRegistry (v2) truth merged with catalog display metadata.
// Ported from lib/aura/agents.ts; reads the v2 getAgent tuple (adds creatorResaleBps).
//
// PERF (M2): the immutable DNA (getAgent) + live owner (ownerOf) stay on-chain, run in parallel. The
// per-agent OUTPUT set (outputCount + token ids) is re-backed by the indexer read model (it already
// derives outputs[] from OutputNFT events), so a read no longer does an O(mints) sequential provenanceOf
// scan. The chain scan survives ONLY as an indexer-down fallback, behind a short in-process cache.
import { agentsRead, outputRead } from "./contracts.js";
import { CATALOG, CATALOG_ORDER, metaForName } from "./catalog.js";
import { personaMetaFor } from "./persona-store.js";
import { INDEXER_URL, INDEXER_TIMEOUT_MS } from "./config.js";
import type { AgentSummary, AgentDetail, AgentPublicMeta } from "./types.js";

/** Fetch JSON from the indexer read model with a timeout. Throws on non-2xx/timeout (caller falls back). */
async function indexerGet(pathAndQuery: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), INDEXER_TIMEOUT_MS);
  try {
    const res = await fetch(`${INDEXER_URL}${pathAndQuery}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`indexer ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Short in-process cache for the chain-scan fallback (only exercised when the indexer is unreachable), so
// a down indexer degrades to at most one full scan per window rather than one scan per request.
const OUTPUT_COUNTS_TTL_MS = 30_000;
let outputCountsCache: { at: number; data: Map<number, number[]> } | null = null;

async function cachedOutputCounts(): Promise<Map<number, number[]>> {
  const now = Date.now();
  if (outputCountsCache && now - outputCountsCache.at < OUTPUT_COUNTS_TTL_MS) return outputCountsCache.data;
  const data = await outputCounts();
  outputCountsCache = { at: now, data };
  return data;
}

/** outputCount + the agent's output token ids. Indexer-first (`/agents/:id` returns outputCount+outputs[]);
 *  on indexer-down, fall back to the short-cached chain scan. Never throws. */
async function agentOutputs(agentId: number): Promise<{ outputCount: number; outputs: number[] }> {
  try {
    const a = await indexerGet(`/agents/${agentId}`);
    if (a && Array.isArray(a.outputs)) {
      const outputs = a.outputs.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n));
      const outputCount = typeof a.outputCount === "number" ? a.outputCount : outputs.length;
      return { outputCount, outputs };
    }
  } catch {
    /* indexer unreachable / agent not yet indexed -> chain-scan fallback below */
  }
  const counts = await cachedOutputCounts();
  const outputs = counts.get(agentId) ?? [];
  return { outputCount: outputs.length, outputs };
}

/** Just the outputCount, for the chat persona flavor line. Indexer-first, and on indexer-down it uses an
 *  ALREADY-warm scan cache if present but NEVER triggers a fresh chain scan -> a chat turn cannot pay the
 *  O(mints) scan under any path. */
async function agentOutputCount(agentId: number): Promise<number> {
  try {
    const a = await indexerGet(`/agents/${agentId}`);
    if (a && typeof a.outputCount === "number") return a.outputCount;
    if (a && Array.isArray(a.outputs)) return a.outputs.length;
  } catch {
    /* indexer unreachable */
  }
  return outputCountsCache?.data.get(agentId)?.length ?? 0;
}

interface OnChainAgent {
  agentId: number;
  name: string;
  owner: string;
  royaltyBps: number;
  creatorResaleBps: number;
  styleVersion: number;
  styleFingerprint: string;
  modelAttestation: string;
  encBrainRoot: string;
}

/** Enumerate every minted agent on-chain (1 .. nextAgentId-1). Kept as the indexer-down fallback
 *  (routes/indexer.ts prefers the indexer; this chain scan only runs when the indexer is unreachable). */
async function onChainAgents(): Promise<OnChainAgent[]> {
  const reg = agentsRead();
  const next = Number(await reg.nextAgentId());
  const out: OnChainAgent[] = [];
  for (let i = 1; i < next; i++) {
    try {
      const a = await reg.getAgent(i);
      const owner = await reg.ownerOf(i);
      out.push({
        agentId: i,
        name: a.name,
        owner,
        royaltyBps: Number(a.royaltyBps),
        creatorResaleBps: Number(a.creatorResaleBps),
        styleVersion: Number(a.styleVersion),
        styleFingerprint: a.styleFingerprint,
        modelAttestation: a.modelAttestation,
        encBrainRoot: a.encBrainRoot,
      });
    } catch {
      /* skip a non-existent / unreadable agent id */
    }
  }
  return out;
}

/** Count outputs per creating agent. Kept as the indexer-down fallback (the indexer serves this in prod). */
async function outputCounts(): Promise<Map<number, number[]>> {
  const out = outputRead();
  const next = Number(await out.nextTokenId());
  const byAgent = new Map<number, number[]>();
  for (let i = 1; i < next; i++) {
    try {
      const p = await out.provenanceOf(i);
      const aid = Number(p.creatorAgentId);
      if (!byAgent.has(aid)) byAgent.set(aid, []);
      byAgent.get(aid)!.push(i);
    } catch {
      /* skip */
    }
  }
  return byAgent;
}

function fallbackMeta(name: string): AgentPublicMeta {
  return {
    name,
    tagline: "Creative agent on 0G.",
    aesthetic: "On-chain creative agent.",
    signatureCharacter: null,
    model: "qwen/qwen-image-edit-2511",
    accent: "#8A8AFF",
    sampleImages: [],
  };
}

/** Resolve the chat/display meta (the aura's VOICE) with the SOUL ladder:
 *    1. metaForName(name)            -> the ~30 hand-written CATALOG auras keep their curated meta (no regression).
 *    2. personaMetaFor(id, root)     -> a USER-created aura's stored persona (its derived/floor soul).
 *    3. fallbackMeta(name)           -> only a truly-empty aura (no catalog, no stored persona) hits the generic voice.
 *  This is THE fix: user auras are no longer flat-generic in chat + on their agent page. */
function resolveMeta(name: string, agentId: number, encBrainRoot?: string | null): AgentPublicMeta {
  return metaForName(name) ?? personaMetaFor(agentId, encBrainRoot) ?? fallbackMeta(name);
}

/** All agents for the grid: on-chain agents (minted) + catalog-only agents (available). */
export async function listAgents(): Promise<AgentSummary[]> {
  // NOTE: this is the indexer-DOWN fallback for GET /agents (routes/indexer.ts prefers the indexer). The
  // scan is cached (cachedOutputCounts) so a down indexer doesn't re-scan the chain on every request.
  const [chain, counts] = await Promise.all([onChainAgents(), cachedOutputCounts()]);
  const byName = new Map(chain.map((a) => [a.name.toUpperCase(), a]));
  const summaries: AgentSummary[] = [];
  const seen = new Set<string>();

  for (const name of CATALOG_ORDER) {
    const meta = CATALOG[name];
    const oc = byName.get(name.toUpperCase());
    seen.add(name.toUpperCase());
    if (oc) {
      summaries.push(summaryFromChain(oc, counts, meta));
    } else {
      summaries.push({
        agentId: -1,
        name,
        owner: null,
        royaltyBps: 700,
        royaltyPct: 7,
        creatorResaleBps: 1000,
        styleVersion: 0,
        minted: false,
        outputCount: 0,
        meta,
      });
    }
  }

  // any on-chain agent not in the catalog (e.g. a freshly user-created agent): resolve its stored persona
  // so the GRID + agent page show its real soul, not the generic fallback.
  for (const oc of chain) {
    if (seen.has(oc.name.toUpperCase())) continue;
    summaries.push(summaryFromChain(oc, counts, resolveMeta(oc.name, oc.agentId, oc.encBrainRoot)));
  }
  return summaries;
}

function summaryFromChain(oc: OnChainAgent, counts: Map<number, number[]>, meta: AgentPublicMeta): AgentSummary {
  return {
    agentId: oc.agentId,
    name: oc.name,
    owner: oc.owner,
    royaltyBps: oc.royaltyBps,
    royaltyPct: oc.royaltyBps / 100,
    creatorResaleBps: oc.creatorResaleBps,
    styleVersion: oc.styleVersion,
    minted: true,
    outputCount: counts.get(oc.agentId)?.length ?? 0,
    meta,
  };
}

export async function getAgentById(agentId: number): Promise<AgentDetail | null> {
  const reg = agentsRead();
  // immutable DNA + live owner in parallel; the output set comes from the indexer (agentOutputs), not an
  // O(mints) scan. (This is the root fix that also removes the per-message chat scan -- see getAgentIdentity.)
  let a: any;
  let owner: string;
  try {
    [a, owner] = await Promise.all([reg.getAgent(agentId), reg.ownerOf(agentId)]);
  } catch {
    return null;
  }
  const meta = resolveMeta(a.name, agentId, a.encBrainRoot);
  const { outputCount, outputs } = await agentOutputs(agentId);
  return {
    agentId,
    name: a.name,
    owner,
    royaltyBps: Number(a.royaltyBps),
    royaltyPct: Number(a.royaltyBps) / 100,
    creatorResaleBps: Number(a.creatorResaleBps),
    styleVersion: Number(a.styleVersion),
    minted: true,
    outputCount,
    meta,
    styleFingerprint: a.styleFingerprint,
    modelAttestation: a.modelAttestation,
    encBrainRoot: a.encBrainRoot,
    outputs,
  };
}

/** SLIM identity read for the chat hot path. POST /chat needs the Aura's identity + persona for the system
 *  prompt, NOT its full body of work, so this reads only the immutable DNA (getAgent) + live owner (ownerOf)
 *  in parallel and the outputCount from the indexer -- deliberately NOT scanning outputs on-chain, so a chat
 *  turn never pays the O(mints) provenanceOf scan (was ~3-6s/message, growing). `outputs` is left empty (the
 *  persona uses only the count). */
export async function getAgentIdentity(agentId: number): Promise<AgentDetail | null> {
  const reg = agentsRead();
  let a: any;
  let owner: string;
  try {
    [a, owner] = await Promise.all([reg.getAgent(agentId), reg.ownerOf(agentId)]);
  } catch {
    return null;
  }
  const meta = resolveMeta(a.name, agentId, a.encBrainRoot);
  const outputCount = await agentOutputCount(agentId);
  return {
    agentId,
    name: a.name,
    owner,
    royaltyBps: Number(a.royaltyBps),
    royaltyPct: Number(a.royaltyBps) / 100,
    creatorResaleBps: Number(a.creatorResaleBps),
    styleVersion: Number(a.styleVersion),
    minted: true,
    outputCount,
    meta,
    styleFingerprint: a.styleFingerprint,
    modelAttestation: a.modelAttestation,
    encBrainRoot: a.encBrainRoot,
    outputs: [],
  };
}

/** Raw on-chain agent (name + encBrainRoot) for the generalized generator. */
export async function rawAgent(agentId: number): Promise<{ agentId: number; name: string; encBrainRoot: string; owner: string } | null> {
  const reg = agentsRead();
  try {
    const a = await reg.getAgent(agentId);
    const owner = await reg.ownerOf(agentId);
    return { agentId, name: a.name, encBrainRoot: a.encBrainRoot, owner };
  } catch {
    return null;
  }
}

// ─────────────────────────── GLOBAL name uniqueness ───────────────────────────
// There is no on-chain name-uniqueness constraint anywhere (create-agent, fusion, and the mint all accept
// any string), so two Auras COULD share a name. This is the single shared check that keeps every Aura's name
// globally distinct: it collects every EXISTING aura name (case-insensitively) and reports collisions. It is
// wired into BOTH the create-agent path (reject a duplicate mint) and the fusion pipeline (regenerate a
// collided 0G name). BEST-EFFORT: names are not enforced on-chain, so a residual race between two as-yet-
// unminted creates/fusions is possible - this narrows the window, it does not close it on-chain.

const normName = (n: string): string => (n ?? "").normalize("NFKC").trim().toLowerCase();

/**
 * The set of ALL existing aura names, normalized (NFKC + trim + lowercase), for a global uniqueness check.
 * Source ladder: the INDEXER agent list (the authoritative live minted set the app already reads) with a
 * chain-scan fallback (onChainAgents) when the indexer is down; unioned with the display CATALOG so a
 * curated-but-not-yet-minted catalog name is also reserved. Best-effort: any source that throws is skipped
 * (the remaining sources still populate the set); it never throws.
 */
export async function collectTakenNames(): Promise<Set<string>> {
  const names = new Set<string>();
  // catalog names are reserved even if a given one is not currently minted.
  for (const n of Object.keys(CATALOG)) names.add(normName(n));
  // indexer-first (the live, complete minted set), chain-scan fallback only if the indexer list failed.
  let gotIndexerList = false;
  try {
    const data = await indexerGet("/agents");
    const arr: unknown[] = Array.isArray((data as any)?.agents)
      ? (data as any).agents
      : Array.isArray(data)
        ? (data as unknown[])
        : [];
    for (const a of arr) {
      const nm = (a as any)?.name;
      if (typeof nm === "string" && nm.trim()) {
        names.add(normName(nm));
        gotIndexerList = true;
      }
    }
  } catch {
    /* indexer unreachable -> chain-scan fallback below */
  }
  if (!gotIndexerList) {
    try {
      for (const a of await onChainAgents()) names.add(normName(a.name));
    } catch {
      /* chain unreadable too -> return whatever we have (at least the catalog) */
    }
  }
  return names;
}

/**
 * True iff `name` collides (case-insensitively) with any existing aura name. Best-effort (see
 * collectTakenNames): an empty/whitespace name is treated as NOT taken (validation handles that separately).
 * Never throws.
 */
export async function isNameTaken(name: string): Promise<boolean> {
  const n = normName(name);
  if (!n) return false;
  try {
    return (await collectTakenNames()).has(n);
  } catch {
    return false; // source failure -> do not block on a uniqueness check we could not perform
  }
}
