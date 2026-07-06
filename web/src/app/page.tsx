import {
  fetchActivity,
  fetchAgents,
  fetchHealth,
  fetchIndexerCounts,
  fetchOutputs,
  featuredAgents,
  fetchFeaturedOutputs,
  nonFeaturedOutputs,
  isTestAgentName,
} from "@/lib/api";
import { CHAIN_ID } from "@/lib/chains";
import { Hero } from "@/components/home/Hero";
import { CharacterGallery } from "@/components/home/CharacterGallery";
import { Thesis } from "@/components/home/Thesis";
import { AgentTheatre } from "@/components/home/AgentTheatre";
import { StatsLedger, type LedgerData } from "@/components/home/StatsLedger";
import { FeaturedAgents } from "@/components/home/FeaturedAgents";
import { OutputsRail } from "@/components/home/OutputsRail";
import { ActivityTicker } from "@/components/home/ActivityTicker";
import { HowItWorks } from "@/components/home/HowItWorks";
import { CtaClose } from "@/components/home/CtaClose";
import { Footer } from "@/components/chrome/Footer";

// Home. Server component: fetch all live data once (no-store) and pass to the section components.
// Every fetch fails soft (empty array / null), so a down backend degrades a section to empty, never
// a crash. The live/animated sections (count-up, rail, marquee) are client components fed by props.
//
// COMPOSITION (recomposed to be its own thing, not arca): the hero is CHARACTER-ART-FORWARD and
// asymmetric (a left editorial column beside the two showpiece characters), then a character gallery
// strip doubles down on the art, the thesis lands, and only THEN does the faux-OS scene appear as a
// repositioned supporting "watch an agent work" beat (AgentTheatre); it no longer anchors the hero
// the way arca's faux-OS-under-a-centered-headline does. Stats, the agent catalog, the outputs rail,
// the live activity, how-it-works, and the close follow.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [health, counts, agents, outputs, activity, heroFeature] = await Promise.all([
    fetchHealth(),
    fetchIndexerCounts(),
    fetchAgents(),
    fetchOutputs(20),
    fetchActivity(12),
    fetchFeaturedOutputs(),
  ]);

  const featured = featuredAgents(agents);
  // The curated showpiece characters (relics 55 / 63 / 91), fetched BY ID (they sit outside the newest-first
  // /outputs page). The hero slots them lead / bottom-left / top-right; the gallery strip shows the curated
  // set first, then fills with the freshest other art.
  const galleryOutputs = [...heroFeature, ...nonFeaturedOutputs(outputs)].slice(0, 8);

  // Keep internal test-agent events (Created BRAINTEST/TESTAGENT ...) out of the home activity ticker.
  const cleanActivity = activity.filter((e) => !isTestAgentName(e.agentName));

  const agentCount = counts?.counts.agents ?? agents.length;
  const outputCount = counts?.counts.outputs ?? outputs.length;

  const ledger: LedgerData = {
    agents: agentCount,
    outputs: outputCount,
    events: counts?.counts.events ?? activity.length,
    chainId: health?.chainId ?? CHAIN_ID,
    sponsorBalance: health?.sponsorBalance ? Number(health.sponsorBalance) : null,
  };

  // Footer is a <footer> (contentinfo) landmark and must be a SIBLING of <main>, not nested inside it.
  return (
    <>
      <main>
        <Hero feature={heroFeature} agentCount={agentCount} outputCount={outputCount} />
        {galleryOutputs.length > 0 && <CharacterGallery outputs={galleryOutputs} />}
        <Thesis />
        <AgentTheatre />
        <StatsLedger data={ledger} />
        {featured.length > 0 && <FeaturedAgents agents={featured} />}
        <OutputsRail outputs={outputs} />
        <ActivityTicker activity={cleanActivity} />
        <HowItWorks />
        <CtaClose />
      </main>
      <Footer />
    </>
  );
}
