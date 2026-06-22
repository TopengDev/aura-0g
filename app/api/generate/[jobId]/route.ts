import { NextResponse } from "next/server";
import { getJob } from "@/lib/aura/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/generate/[jobId] — poll the async generation job.
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getJob(jobId);
  if (!job) return NextResponse.json({ error: "job not found (server may have restarted)" }, { status: 404 });
  return NextResponse.json(job);
}
