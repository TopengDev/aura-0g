// SERVER-ONLY. The COMMAND SURFACE: the OpenAI-style tool definitions the Aura can call from chat, plus the
// router that executes each tool as a REAL, GUARDED, NON-CUSTODIAL AURA action.
//
// read_onchain      : a pure on-chain/indexer READ (the Aura reads its own stats). Safe, no signing, no cost.
// generate_and_mint : a GUARDED creation. It kicks off a REAL TEE generation via the EXACT existing guarded
//                     path (rate limit + global cost guard + the proven generateAndProve pipeline). It does
//                     NOT mint - minting stays a non-custodial wallet action the owner signs (the existing
//                     /mint-args -> OutputNFT.mintOutput card). The orchestrator never holds the owner key
//                     and no on-chain state changes without the owner's signature.
import type { ChatTool } from "./chat-compute.js";
import { getAgentById, rawAgent } from "./agents.js";
import { newJobId, createJob } from "./jobs.js";
import { runGeneration } from "./generate.js";
import { genGuardAcquire, genGuardRelease, rateLimit } from "./ratelimit.js";
import { INDEXER_URL, INDEXER_TIMEOUT_MS } from "./config.js";

/** The tool set advertised to the model. Kept FEW + unambiguous (DD: a 7B degrades on hard disambiguation). */
export const CHAT_TOOLS: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "read_onchain",
      description:
        "Read this Aura's own on-chain state: earnings/royalties, the number of Relics it has created, its current owner, or a worth summary. Use when the owner asks how much you have earned, what you have made, who owns you, or what you are worth.",
      parameters: {
        type: "object",
        properties: {
          field: {
            type: "string",
            enum: ["royalties", "earnings", "outputs", "owner", "worth"],
            description: "which on-chain fact to read",
          },
        },
        required: ["field"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_and_mint",
      description:
        "Create a brand-new Relic (artwork) in this Aura's signature style via 0G Compute (TEE-attested), and prepare it for the owner to mint as an OutputNFT to their own wallet. Use when the owner asks you to create / generate / make / paint a piece. The owner signs the mint in their wallet; you never sign for them.",
      parameters: {
        type: "object",
        properties: {
          subject: { type: "string", description: "what to depict, in this Aura's style (a short scene/subject)" },
        },
        required: ["subject"],
      },
    },
  },
];

export interface ToolContext {
  agentId: number;
  owner: string; // lowercased JWT address (the authed wallet)
}

export interface ToolResult {
  tool: string;
  ok: boolean;
  // compact data fed BACK to the model as the tool result (it narrates this in character):
  data: Record<string, unknown>;
  // a human one-liner + structured fields the UI renders as a tool card:
  display: string;
  // present for generate_and_mint: the job to poll + then mint via the existing /mint-args card.
  job?: { jobId: string; status: string; subject: string };
  error?: string;
}

async function fetchIndexerCreator(wallet: string): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), INDEXER_TIMEOUT_MS);
    const res = await fetch(`${INDEXER_URL}/api/creators/${wallet}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function doReadOnchain(ctx: ToolContext, field: string): Promise<ToolResult> {
  const agent = await getAgentById(ctx.agentId);
  if (!agent) {
    return { tool: "read_onchain", ok: false, data: { error: "agent not found" }, display: "I could not read my own record on-chain.", error: "agent not found" };
  }
  // best-effort live royalties earned for the current owner (indexer aggregate); falls back gracefully.
  const creator = agent.owner ? await fetchIndexerCreator(agent.owner) : null;
  const royaltiesEarned = creator?.royaltiesEarned ?? null;

  const base = {
    agentId: agent.agentId,
    name: agent.name,
    owner: agent.owner,
    royaltyPct: agent.royaltyPct,
    relicsCreated: agent.outputCount,
  };

  let data: Record<string, unknown>;
  let display: string;
  switch (field) {
    case "owner":
      data = { ...base };
      display = `Owner: ${agent.owner}`;
      break;
    case "outputs":
      data = { ...base, relicsCreated: agent.outputCount, relicTokenIds: agent.outputs };
      display = `${agent.outputCount} Relic(s) created`;
      break;
    case "royalties":
    case "earnings":
      data = { ...base, royaltyPct: agent.royaltyPct, royaltiesEarned, note: "royalty follows the Aura to its current owner" };
      display = royaltiesEarned != null ? `${royaltiesEarned} 0G earned, royalty ${agent.royaltyPct}%` : `royalty ${agent.royaltyPct}% (lifetime total not indexed yet)`;
      break;
    case "worth":
    default:
      data = { ...base, royaltiesEarned, relicsCreated: agent.outputCount, note: "worth = body of work + the transferable royalty stream + provable earning record" };
      display = `${agent.outputCount} Relic(s), ${agent.royaltyPct}% royalty${royaltiesEarned != null ? `, ${royaltiesEarned} 0G earned` : ""}`;
      break;
  }
  return { tool: "read_onchain", ok: true, data, display };
}

async function doGenerateAndMint(ctx: ToolContext, subject: string): Promise<ToolResult> {
  const subj = (subject || "").trim();
  if (subj.length < 2) {
    return { tool: "generate_and_mint", ok: false, data: { error: "no subject" }, display: "Tell me what to depict and I will create it.", error: "subject required (>=2 chars)" };
  }
  const agent = await rawAgent(ctx.agentId);
  if (!agent) {
    return { tool: "generate_and_mint", ok: false, data: { error: "agent not found" }, display: "I could not find my own record on-chain to create from.", error: "agent not found" };
  }

  // SAME guards as POST /generate: per-user rate limit, then the global cost guard (protects the sponsor).
  const rl = rateLimit(`gen:${ctx.owner}`, 5, 60_000);
  if (!rl.ok) {
    return { tool: "generate_and_mint", ok: false, data: { error: "rate_limited", retryInMs: rl.resetInMs }, display: "I am creating too fast right now; give me a moment before the next piece.", error: "rate limited" };
  }
  const guard = genGuardAcquire(ctx.owner);
  if (!guard.ok) {
    return { tool: "generate_and_mint", ok: false, data: { error: "capacity" }, display: "I am at my creation limit for now and cannot start a new piece.", error: guard.reason ?? "capacity" };
  }

  const jobId = newJobId();
  createJob(jobId, ctx.owner, agent.agentId, agent.name, subj);
  // kick off in the background exactly like the /generate route. runGeneration releases the guard in finally.
  void runGeneration({ jobId, agentId: agent.agentId, agentName: agent.name, encBrainRoot: agent.encBrainRoot, userPrompt: subj }).catch(() => {
    genGuardRelease();
  });

  return {
    tool: "generate_and_mint",
    ok: true,
    data: {
      jobId,
      status: "generating",
      subject: subj,
      note: "TEE-attested generation started; the owner mints the result by signing in their own wallet (non-custodial). No mint happens without the owner's signature.",
    },
    display: `Creating a Relic: "${subj}" (TEE-attested). You sign the mint in your wallet when it is ready.`,
    job: { jobId, status: "generating", subject: subj },
  };
}

/** Route + execute ONE tool call. Always resolves (never throws) so the orchestrator can narrate failures. */
export async function routeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  try {
    if (name === "read_onchain") return await doReadOnchain(ctx, String(args.field ?? "worth"));
    if (name === "generate_and_mint") return await doGenerateAndMint(ctx, String(args.subject ?? ""));
    return { tool: name, ok: false, data: { error: "unknown tool" }, display: `Unknown command: ${name}`, error: "unknown tool" };
  } catch (e: any) {
    return { tool: name, ok: false, data: { error: String(e?.message ?? e).slice(0, 160) }, display: "That action failed.", error: String(e?.message ?? e).slice(0, 160) };
  }
}
