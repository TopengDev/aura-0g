// GET /og/output/[id] -> the dynamic 1200x630 Relic share card (og:image / twitter:image for /outputs/[id]).
// Node runtime (sharp + node:fs); served under /og NOT /api/og (nginx proxies /api/* to the backend in
// prod, so /api/og would be unreachable). The art is inlined as a base64 data URI inside the card (Satori
// silently fails to load a remote <img src> on self-hosted Node). The card is memoized per token id.
import { fetchOutputById, shortHex } from "@/lib/api";
import { outputArtDataUri } from "@/lib/og/art";
import { renderCard, RelicCard, RELIC_CACHE_CONTROL } from "@/lib/og/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return renderCard(`o:${id}`, RELIC_CACHE_CONTROL, async () => {
    const output = await fetchOutputById(id, 300);
    if (!output) return null; // -> brand fallback (a crawler never gets a blank image)
    const artUri = await outputArtDataUri(output);
    return (
      <RelicCard
        artUri={artUri}
        agentName={output.agentName}
        tokenId={output.tokenId}
        rarity={output.rarity}
        style={output.style}
        provPrefix={shortHex(output.provenanceHash || output.imageRoot, 6, 4)}
      />
    );
  });
}
