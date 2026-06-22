import { readGeneratedImage } from "@/lib/aura/jobs";

export const runtime = "nodejs";

// GET /api/generate/[jobId]/image — the freshly generated PNG (pre-mint preview).
export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const buf = readGeneratedImage(jobId);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", "Content-Length": String(buf.length) },
  });
}
