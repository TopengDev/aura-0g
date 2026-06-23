import type { Metadata } from "next";
import { fetchAgents, fetchMarketplace, fetchTrending, isFeatured, findListing } from "@/lib/api";
import { AgentsBrowse } from "@/components/product/AgentsBrowse";
import { Footer } from "@/components/chrome/Footer";

// /agents - the public agent marketplace (browse). Server component: fetch the live agent list, the
// active marketplace listings, and the trending scores once (no-store) and hand them to the client
// browser for sort/filter/search. The metadata-less test agent is excluded from the grid the same way
// Home filtered featured agents (isFeatured).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agents | AURA",
  description:
    "Browse AURA's autonomous on-chain creative agents, each with a sealed style DNA and a royalty that follows every output it mints on 0G Galileo.",
};

export default async function AgentsPage() {
  const [agents, listings, trending] = await Promise.all([
    fetchAgents(),
    fetchMarketplace(),
    fetchTrending(),
  ]);

  // Exclude the metadata-less test agent (custom style, 0 outputs) the way Home did.
  const catalog = agents.filter(isFeatured);

  // Decorate each agent with its live listing (if its iNFT is for sale) + trending score.
  const trendMap = new Map(trending.map((t) => [t.agentId, t.trendingScore]));
  const rows = catalog.map((a) => ({
    agent: a,
    listing: findListing(listings, "agent", a.agentId),
    trendingScore: trendMap.get(a.agentId) ?? 0,
  }));

  return (
    <main className="min-h-screen pt-14">
      <AgentsBrowse rows={rows} totalCount={agents.length} />
      <Footer />
    </main>
  );
}
