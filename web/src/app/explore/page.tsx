import type { Metadata } from "next";
import {
  fetchAgents,
  fetchActivity,
  fetchIndexerCounts,
  fetchOutputs,
  fetchTrending,
  creatorsLeaderboard,
  featuredOutputs,
  nonFeaturedOutputs,
  isFeatured,
  type Agent,
} from "@/lib/api";
import { ExploreView, type ExploreData } from "@/components/product/ExploreView";
import { Footer } from "@/components/chrome/Footer";

// /explore - the discovery hub (the "pulse of AURA"). Server component: fetch the trending scores, the
// agent catalog, recent outputs, and the live activity feed once (no-store), join trending items to their
// agent records (for accent + tagline), derive the creators royalties leaderboard, and hand it all to the
// client view. DISTINCT from /agents (the sort/filter catalog): this surface is alive + ranked + editorial,
// and it gives outputs their own discovery surface (a recent-outputs gallery linking to /outputs/[id]).
// The metadata-less test agent is excluded the same way the rest of the app does (isFeatured).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore | AURA",
  description:
    "The pulse of AURA: trending creative agents, fresh on-chain outputs, the creators earning royalties, and live marketplace activity on 0G Galileo.",
};

export default async function ExplorePage() {
  const [agents, trending, rawOutputs, activity, counts] = await Promise.all([
    fetchAgents(),
    fetchTrending(),
    fetchOutputs(24),
    fetchActivity(24),
    fetchIndexerCounts(),
  ]);

  // LEAD the recent-outputs gallery with the curated character showpieces (12, 15, 9, 13, 7), then the
  // rest newest-first (showcase pseudo-outputs excluded). So /explore opens with the strongest art.
  const outputs = [...featuredOutputs(rawOutputs), ...nonFeaturedOutputs(rawOutputs)];

  // Join each trending item to its full agent record (for the accent + tagline + style). Skip any whose
  // agent isn't in the catalog (e.g. the excluded test agent), so trending stays consistent with /agents.
  const agentById = new Map<number, Agent>(agents.map((a) => [a.agentId, a]));
  const trendingJoined = trending
    .map((item) => ({ item, agent: agentById.get(item.agentId) }))
    .filter((t): t is { item: (typeof trending)[number]; agent: Agent } => !!t.agent && isFeatured(t.agent));

  const data: ExploreData = {
    trending: trendingJoined,
    outputs,
    creators: creatorsLeaderboard(agents),
    activity,
    // True on-chain totals from the indexer counts (the outputs[] array is capped at the fetch limit).
    totalAgents: counts?.counts.agents ?? agents.length,
    totalOutputs: counts?.counts.outputs ?? outputs.length,
  };

  return (
    <main className="min-h-screen pt-14">
      <ExploreView data={data} />
      <Footer />
    </main>
  );
}
