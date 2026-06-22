import { NextResponse } from "next/server";
import { resolveAgentForGenerate } from "@/lib/aura/agents";
import { createJob, newJobId } from "@/lib/aura/jobs";
import { runGeneration } from "@/lib/aura/generate";
import { rateLimit, clientKey, genGuardAcquire, genGuardRelease } from "@/lib/aura/ratelimit";
import { demoPrivateKey } from "@/lib/aura/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT = 600;

// POST /api/generate  { agent: number|string, prompt: string }
// Async job: kicks off a TEE generation on 0G Compute (~45-50s) and returns a jobId to poll.
export async function POST(req: Request) {
  // demo wallet must be configured for any write
  try {
    demoPrivateKey();
  } catch {
    return NextResponse.json({ error: "demo wallet not configured (DEMO_PRIVATE_KEY unset) — generation disabled" }, { status: 503 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const prompt = String(body?.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  if (prompt.length > MAX_PROMPT) return NextResponse.json({ error: `prompt too long (max ${MAX_PROMPT} chars)` }, { status: 400 });

  const agentArg = body?.agent ?? body?.agentId ?? "RISO";

  // rate limit per client
  const rl = rateLimit(`gen:${clientKey(req)}`, 5, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate limited", retryInMs: rl.resetInMs }, { status: 429 });
  }

  // agent must be minted on-chain to mint outputs under it
  const agent = await resolveAgentForGenerate(agentArg);
  if (!agent || agent.agentId < 1) {
    return NextResponse.json({ error: `agent "${agentArg}" is not a minted on-chain agent — cannot generate+mint under it` }, { status: 400 });
  }

  // global cost guard (protects the capped demo wallet)
  const guard = genGuardAcquire();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: 429 });
  }

  const jobId = newJobId();
  createJob(jobId, agent.agentId, agent.name, prompt, null);

  // fire-and-forget — the persistent Node server runs this to completion; the client polls the job.
  void runGeneration({ jobId, agentId: agent.agentId, agentName: agent.name, userPrompt: prompt }).catch(() => {
    genGuardRelease(); // belt-and-suspenders; runGeneration already releases in finally
  });

  return NextResponse.json(
    {
      jobId,
      status: "pending",
      agentId: agent.agentId,
      agentName: agent.name,
      pollUrl: `/api/generate/${jobId}`,
      note: "poll pollUrl until status=done (~45-50s), then POST /api/mint { jobId }",
    },
    { status: 202 },
  );
}
