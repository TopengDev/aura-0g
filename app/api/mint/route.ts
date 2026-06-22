import { NextResponse } from "next/server";
import { getJob, generatedImagePath } from "@/lib/aura/jobs";
import { demoSigner, demoAddress } from "@/lib/aura/wallet";
import { mintOutput } from "@/lib/aura/mint";
import { appendMintIndex, readMintIndex } from "@/lib/aura/store-index";
import { buildOutputSummary } from "@/lib/aura/outputs";
import { txUrl } from "@/lib/aura/contracts";
import { demoPrivateKey } from "@/lib/aura/config";
import { rateLimit, clientKey } from "@/lib/aura/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/mint  { jobId }
// Mints the OutputNFT for a completed generation job (provenance + storage root + TEE attestation
// baked on-chain). Idempotent per jobId — re-minting a job returns the existing token.
export async function POST(req: Request) {
  try {
    demoPrivateKey();
  } catch {
    return NextResponse.json({ error: "demo wallet not configured (DEMO_PRIVATE_KEY unset) — minting disabled" }, { status: 503 });
  }

  const rl = rateLimit(`mint:${clientKey(req)}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limited", retryInMs: rl.resetInMs }, { status: 429 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const jobId = String(body?.jobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "jobId is required" }, { status: 400 });

  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "job not found (server may have restarted)" }, { status: 404 });
  if (job.status !== "done" || !job.result) {
    return NextResponse.json({ error: `job not ready (status=${job.status})` }, { status: 409 });
  }

  // idempotency: this job already minted?
  const existing = readMintIndex().find((r) => r.jobId === jobId);
  if (existing) {
    const output = await buildOutputSummary(existing.tokenId);
    return NextResponse.json({
      tokenId: existing.tokenId, txHash: existing.mintTx, explorerUrl: existing.mintTx ? txUrl(existing.mintTx) : null,
      creatorAgentId: existing.creatorAgentId, imageRoot: existing.imageRoot, owner: existing.owner, output, idempotent: true,
    });
  }

  try {
    const signer = demoSigner();
    const to = demoAddress();
    const r = job.result;
    const { tokenId, txHash } = await mintOutput(signer, {
      to,
      creatorAgentId: job.agentId,
      imageRoot: r.imageRoot,
      provenanceHash: r.provenanceHash,
      teeAttestation: r.teeAttestation,
      seed: r.seed,
    });

    appendMintIndex({
      tokenId,
      jobId,
      imageFile: generatedImagePath(jobId),
      imageRoot: r.imageRoot,
      provenanceHash: r.provenanceHash,
      teeAttestation: r.teeAttestation,
      seed: r.seed,
      creatorAgentId: job.agentId,
      owner: to,
      createdAt: new Date().toISOString(),
      // EnrichRecord fields
      label: `${job.agentName} · API mint`,
      imageKey: `output-${tokenId}`,
      model: r.model,
      prompt: job.prompt,
      teeSigner: r.teeSigner,
      teeVerifiability: r.verifiability,
      teeVerified: r.teeVerified,
      chatId: r.chatId,
      mintTx: txHash,
      provenanceRecord: job.provenanceRecord ?? null,
    });

    const output = await buildOutputSummary(tokenId);
    return NextResponse.json({
      tokenId, txHash, explorerUrl: txUrl(txHash),
      creatorAgentId: job.agentId, imageRoot: r.imageRoot, owner: to, output,
    });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 });
  }
}
