import { readFileSync, existsSync } from "node:fs";
import { resolveImageKey } from "@/lib/aura/images";
import { generatedImageFile } from "@/lib/aura/store-index";

export const runtime = "nodejs";

// Serve an allowlisted image by key (agent samples + per-output images). For API-minted outputs
// (output-<N> not in the static allowlist) fall back to the generated PNG recorded in the mint index.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;

  let file = resolveImageKey(key);
  if (!file) {
    const m = /^output-(\d+)$/.exec(key);
    if (m) file = generatedImageFile(Number(m[1]));
  }
  if (!file || !existsSync(file)) {
    return new Response("not found", { status: 404 });
  }
  const buf = readFileSync(file);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
      "Content-Length": String(buf.length),
    },
  });
}
