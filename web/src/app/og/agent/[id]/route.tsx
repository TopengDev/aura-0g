// GET /og/agent/[id] -> the dynamic 1200x630 Aura share card (og:image / twitter:image for /agents/[id]).
// Node runtime; served under /og NOT /api/og (nginx proxies /api/* to the backend in prod). The portrait
// is inlined as a base64 data URI. Uses the FAST indexer read (includeDna=false) so the crawler render
// stays quick. The card carries live-ish stats (relics/royalties), so it is cached with a short TTL and a
// 10-minute cache-key bucket rather than immutably.
import { fetchAgentById } from "@/lib/api";
import { agentArtDataUri } from "@/lib/og/art";
import { renderCard, AuraCard, AURA_CACHE_CONTROL } from "@/lib/og/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const bucket = Math.floor(Date.now() / 600000); // 10-minute bucket so stats refresh
  return renderCard(`a:${id}:${bucket}`, AURA_CACHE_CONTROL, async () => {
    const agent = await fetchAgentById(id, false);
    if (!agent) return null; // -> brand fallback
    const artUri = await agentArtDataUri(agent);
    const raw = agent.meta?.tagline || "";
    const tagline = raw.length > 90 ? `${raw.slice(0, 88).trimEnd()}…` : raw;
    return (
      <AuraCard
        artUri={artUri}
        name={agent.name}
        agentId={agent.agentId}
        rarity={agent.meta?.rarity}
        style={agent.style}
        tagline={tagline}
        relics={agent.outputCount}
        royalties={agent.royaltiesEarned}
      />
    );
  });
}
