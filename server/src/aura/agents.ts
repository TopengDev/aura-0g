// SERVER-ONLY. Agents = on-chain AgentRegistry (v2) truth merged with catalog display metadata.
// Ported from lib/aura/agents.ts; reads the v2 getAgent tuple (adds creatorResaleBps). Per-item reads
// are re-backed on chain for now (the indexer is Phase 3). listAgents() is a simple chain scan with a
// TODO that Phase 3 re-backs it via the indexer.
import { registryRead, outputRead } from "./contracts.js";
import { CATALOG, CATALOG_ORDER, metaForName } from "./catalog.js";
import type { AgentSummary, AgentDetail, AgentPublicMeta } from "./types.js";

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

/** Enumerate every minted agent on-chain (1 .. nextAgentId-1). TODO(Phase 3): re-back via indexer. */
async function onChainAgents(): Promise<OnChainAgent[]> {
  const reg = registryRead();
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

/** Count outputs per creating agent. TODO(Phase 3): re-back via indexer. */
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

/** All agents for the grid: on-chain agents (minted) + catalog-only agents (available). */
export async function listAgents(): Promise<AgentSummary[]> {
  const [chain, counts] = await Promise.all([onChainAgents(), outputCounts()]);
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

  // any on-chain agent not in the catalog (e.g. a freshly user-created agent)
  for (const oc of chain) {
    if (seen.has(oc.name.toUpperCase())) continue;
    summaries.push(summaryFromChain(oc, counts, metaForName(oc.name) ?? fallbackMeta(oc.name)));
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
  const reg = registryRead();
  let a: any;
  try {
    a = await reg.getAgent(agentId);
  } catch {
    return null;
  }
  const owner = await reg.ownerOf(agentId);
  const counts = await outputCounts();
  const meta = metaForName(a.name) ?? fallbackMeta(a.name);
  return {
    agentId,
    name: a.name,
    owner,
    royaltyBps: Number(a.royaltyBps),
    royaltyPct: Number(a.royaltyBps) / 100,
    creatorResaleBps: Number(a.creatorResaleBps),
    styleVersion: Number(a.styleVersion),
    minted: true,
    outputCount: counts.get(agentId)?.length ?? 0,
    meta,
    styleFingerprint: a.styleFingerprint,
    modelAttestation: a.modelAttestation,
    encBrainRoot: a.encBrainRoot,
    outputs: counts.get(agentId) ?? [],
  };
}

/** Raw on-chain agent (name + encBrainRoot) for the generalized generator. */
export async function rawAgent(agentId: number): Promise<{ agentId: number; name: string; encBrainRoot: string; owner: string } | null> {
  const reg = registryRead();
  try {
    const a = await reg.getAgent(agentId);
    const owner = await reg.ownerOf(agentId);
    return { agentId, name: a.name, encBrainRoot: a.encBrainRoot, owner };
  } catch {
    return null;
  }
}
