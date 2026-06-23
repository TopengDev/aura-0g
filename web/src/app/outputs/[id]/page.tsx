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

// /outputs/[id] - one output: the artwork, its creator agent (linked), the generative direction, a
// provenance block (TEE attestation, model, 0G storage root, provenance hash, seed), a wallet-signed
// trade panel (kind=output), the live royalty info (dynamic % to the CURRENT agent owner), and an
// inline Verify action that re-checks provenance + royalty on-chain. Data: GET /outputs/:id +
// /provenance/:id + /royalty/:id (ROOT-mounted live reads) + the active listings + the creating agent.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const output = await fetchOutputById(id);
  if (!output) return { title: "Output | AURA" };
  return {
    title: `${output.agentName} #${output.tokenId} | AURA`,
    description: `A verifiable AURA output by ${output.agentName}, with on-chain provenance and a TEE attestation on 0G Galileo.`,
  };
}

export default async function OutputDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [output, provenance, royalty, listings] = await Promise.all([
    fetchOutputById(id),
    fetchProvenance(id),
    fetchRoyalty(id),
    fetchMarketplace(),
  ]);
  if (!output) notFound();

  // The creating agent (for the model + aesthetic direction + linking). Best-effort.
  const agent = await fetchAgentById(output.creatorAgentId);
  const listing = findListing(listings, "output", output.tokenId);

  return (
    <main className="min-h-screen pt-14">
      <OutputDetailView
        output={output}
        provenance={provenance}
        royalty={royalty}
        agent={agent}
        listing={listing}
      />
      <Footer />
    </main>
  );
}
