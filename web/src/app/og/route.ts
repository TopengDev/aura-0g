// GET /og -> the default AURA brand share card (used as the site-wide og:image fallback for pages that
// have no per-item card, e.g. home / explore). Backend-free (a baked showpiece), so it always renders.
// Served under /og (NOT /api/og): in the prod deploy nginx routes /api/* straight to the Fastify backend,
// so an /api/og route would be unreachable; /og is served by Next.
import { renderBrand } from "@/lib/og/card";

export const runtime = "nodejs"; // MUST be Node: uses sharp + node:fs (self-hosted Docker, not Vercel edge)
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return renderBrand();
}
