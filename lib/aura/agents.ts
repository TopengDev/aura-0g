// SERVER-ONLY. Agents = on-chain AgentRegistry truth merged with catalog display metadata.
import { registryRead, outputRead } from "./contracts";
import { CATALOG, CATALOG_ORDER, metaForName } from "./catalog";
import type { AgentSummary, AgentDetail, AgentPublicMeta } from "./types";

interface OnChainAgent {
  agentId: number;
  name: string;
  owner: string;
  royaltyBps: number;
  styleVersion: number;
  styleFingerprint: string;
  modelAttestation: string;
  encBrainRoot: string;
}

/** Enumerate every minted agent on-chain (1 .. nextAgentId-1). */
async function onChainAgents(): Promise<OnChainAgent[]> {
  const reg = registryRead();
  const next = Number(await reg.nextAgentId());
  const out: OnChainAgent[] = [];
  for (let i = 1; i < next; i++) {
    try {
      const a = await reg.getAgent(i);
      const owner = await reg.ownerOf(i);
      out.push({
        agentId: i, name: a.name, owner, royaltyBps: Number(a.royaltyBps), styleVersion: Number(a.styleVersion),
        styleFingerprint: a.styleFingerprint, modelAttestation: a.modelAttestation, encBrainRoot: a.encBrainRoot,
      });
    } catch {
      /* skip a non-existent / unreadable agent id */
    }
  }
  return out;
}

/** Count how many outputs each agent created (creatorAgentId). */
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
    name, tagline: "Creative agent on 0G.", aesthetic: "On-chain creative agent.",
    signatureCharacter: null, model: "qwen/qwen-image-edit-2511", accent: "#8A8AFF", sampleImages: [],
  };
}

/** All agents for the marketplace grid: on-chain agents (minted) + catalog-only agents (available). */
export async function listAgents(): Promise<AgentSummary[]> {
  const [chain, counts] = await Promise.all([onChainAgents(), outputCounts()]);
  const byName = new Map(chain.map((a) => [a.name.toUpperCase(), a]));
  const summaries: AgentSummary[] = [];

  // catalog entries first (in display order), matched to on-chain where present
  const seen = new Set<string>();
  for (const name of CATALOG_ORDER) {
    const meta = CATALOG[name];
    const oc = byName.get(name.toUpperCase());
    seen.add(name.toUpperCase());
    if (oc) {
      summaries.push({
        agentId: oc.agentId, name: oc.name, owner: oc.owner, royaltyBps: oc.royaltyBps,
        royaltyPct: oc.royaltyBps / 100, styleVersion: oc.styleVersion, minted: true,
        outputCount: counts.get(oc.agentId)?.length ?? 0, meta,
      });
    } else {
      summaries.push({
        agentId: -1, name, owner: null, royaltyBps: 700, royaltyPct: 7, styleVersion: 0,
        minted: false, outputCount: 0, meta,
      });
    }
  }

  // any on-chain agent not in the catalog (defensive — shouldn't happen for the demo)
  for (const oc of chain) {
    if (seen.has(oc.name.toUpperCase())) continue;
    summaries.push({
      agentId: oc.agentId, name: oc.name, owner: oc.owner, royaltyBps: oc.royaltyBps,
      royaltyPct: oc.royaltyBps / 100, styleVersion: oc.styleVersion, minted: true,
      outputCount: counts.get(oc.agentId)?.length ?? 0, meta: metaForName(oc.name) ?? fallbackMeta(oc.name),
    });
  }

  return summaries;
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
    agentId, name: a.name, owner, royaltyBps: Number(a.royaltyBps), royaltyPct: Number(a.royaltyBps) / 100,
    styleVersion: Number(a.styleVersion), minted: true, outputCount: counts.get(agentId)?.length ?? 0, meta,
    styleFingerprint: a.styleFingerprint, modelAttestation: a.modelAttestation, encBrainRoot: a.encBrainRoot,
    outputs: counts.get(agentId) ?? [],
  };
}

/** Resolve an agent for generation by id OR name (used by /api/generate). */
export async function resolveAgentForGenerate(idOrName: number | string): Promise<{ agentId: number; name: string; meta: AgentPublicMeta } | null> {
  if (typeof idOrName === "number" || /^\d+$/.test(String(idOrName))) {
    const d = await getAgentById(Number(idOrName));
    if (d) return { agentId: d.agentId, name: d.name, meta: d.meta };
    return null;
  }
  // by name → must be minted on-chain to mint outputs under it
  const all = await listAgents();
  const found = all.find((s) => s.name.toUpperCase() === String(idOrName).toUpperCase() && s.minted);
  if (found) return { agentId: found.agentId, name: found.name, meta: found.meta };
  return null;
}
