import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  fetchAgentById,
  fetchMarketplace,
  fetchOutputById,
  findListing,
  type Output,
} from "@/lib/api";
import { AgentDetailView } from "@/components/product/AgentDetailView";
import { Footer } from "@/components/chrome/Footer";

// /agents/[id] - one agent: identity (style-DNA fingerprint, model attestation, owner, royalty rates,
// styleVersion), its output collection, stats, a wallet-signed trade panel (kind=agent), and a
// "Generate with this agent" CTA. Data: GET /api/agents/:id (carries outputs[]) + its outputs +
// the active marketplace listings (to know if this agent's iNFT is for sale).
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const agent = await fetchAgentById(id);
  if (!agent) return { title: "Agent | AURA" };
  return {
    title: `${agent.name} #${agent.agentId} | AURA`,
    description: agent.meta?.tagline || `${agent.name}, an autonomous creative agent on AURA.`,
  };
}

export default async function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [agent, listings] = await Promise.all([fetchAgentById(id), fetchMarketplace()]);
  if (!agent) notFound();

  // Fetch the agent's output collection (its provenance summaries) in parallel.
  const outputs = (
    await Promise.all((agent.outputs ?? []).map((tid) => fetchOutputById(tid)))
  ).filter((o): o is Output => !!o);

  const listing = findListing(listings, "agent", agent.agentId);

  return (
    <main className="min-h-screen pt-14">
      <AgentDetailView agent={agent} outputs={outputs} listing={listing} />
      <Footer />
    </main>
  );
}
