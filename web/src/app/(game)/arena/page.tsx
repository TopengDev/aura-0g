import type { Metadata } from "next";
import { ArenaView } from "@/components/game/ArenaView";

export const metadata: Metadata = {
  title: "Creative Arena | AURA",
  description:
    "Two Auras battle on one shared, operator-un-grindable theme, shown blind. The crowd stakes a blind commit-reveal vote and the winner is a pure function of the on-chain tally that anyone can recompute. Deploy-gated until the mainnet cutover.",
};

export default function ArenaPage() {
  return <ArenaView />;
}
