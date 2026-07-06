import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  fetchAgentById,
  fetchMarketplace,
  fetchOutputById,
  fetchProvenance,
  fetchRoyalty,
  findListing,
} from "@/lib/api";
import { OutputDetailView } from "@/components/product/OutputDetailView";
import { Footer } from "@/components/chrome/Footer";
import { absoluteUrl, farcasterEmbed, X_HANDLE } from "@/lib/share";
import { CHAIN_SHORT } from "@/lib/chains";

// /outputs/[id] - one output: the artwork, its creator agent (linked), the generative direction, a
// provenance block (TEE attestation, model, 0G storage root, provenance hash, seed), a wallet-signed
// trade panel (kind=output), the live royalty info (dynamic % to the CURRENT agent owner), and an
// inline Verify action that re-checks provenance + royalty on-chain. Data: GET /outputs/:id +
// /provenance/:id + /royalty/:id (ROOT-mounted live reads) + the active listings + the creating agent.
// ISR, not force-dynamic: rendered on demand then cached 30s. loading.tsx streams an instant skeleton on
// the cold render, and the inline Verify action re-checks live on-chain regardless, so the trust claims
// stay fresh. See the page body for the removal of the blocking creator-agent DNA read.
export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const output = await fetchOutputById(id);
  if (!output) return { title: "Relic | AURA" };
  const title = `${output.agentName} #${output.tokenId} | AURA`;
  const description = `A verifiable AURA Relic by ${output.agentName}, with on-chain provenance and a TEE attestation on 0G ${CHAIN_SHORT}.`;
  const ogImage = `/og/output/${output.tokenId}`;
  const pageUrl = `/outputs/${output.tokenId}`;
  return {
    title,
    description,
    openGraph: {
      type: "article",
      title,
      description,
      url: pageUrl,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `${output.agentName} Relic #${output.tokenId} on AURA` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
      site: `@${X_HANDLE}`,
      creator: `@${X_HANDLE}`,
    },
    other: {
      "fc:miniapp": farcasterEmbed({ imageUrl: absoluteUrl(ogImage), url: absoluteUrl(pageUrl), label: "View Relic" }),
    },
  };
}

export default async function OutputDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [output, provenance, royalty, listings] = await Promise.all([
    fetchOutputById(id, 300),
    fetchProvenance(id, 30),
    fetchRoyalty(id, 20),
    fetchMarketplace(15),
  ]);
  if (!output) notFound();

  // The creating agent, for the display identity (accent + aesthetic direction + the back-link). We pass
  // includeDna=false so this resolves from ONLY the fast 85ms indexer read, NOT the multi-second on-chain
  // DNA read - that stage-B read was the single biggest cost on this page (~5.7s of blocking SSR). The
  // unforgeable model + style attestations are still rendered from `provenance.agent` (which the view
  // already prefers), so dropping the DNA read here costs the page nothing the user can see.
  const agent = await fetchAgentById(output.creatorAgentId, false);
  const listing = findListing(listings, "output", output.tokenId);

  return (
    <>
    <main className="min-h-screen pt-14">
      <OutputDetailView
        output={output}
        provenance={provenance}
        royalty={royalty}
        agent={agent}
        listing={listing}
      />
    </main>
      <Footer />
    </>
  );
}
