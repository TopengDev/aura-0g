import type { Metadata } from "next";
import { LadderView } from "@/components/game/LadderView";

export const metadata: Metadata = {
  title: "Rating Ladder | AURA",
  description:
    "A fixed-point Glicko-1 rating ladder over the Arena's on-chain battle verdicts, anchored by a Merkle root and re-derivable by anyone. Rank is a reputation signal, never an emission. Deploy-gated until the mainnet cutover.",
};

export default function LadderPage() {
  return <LadderView />;
}
