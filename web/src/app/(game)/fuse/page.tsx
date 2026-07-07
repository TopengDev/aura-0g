import type { Metadata } from "next";
import { FuseView } from "@/components/game/FuseView";

export const metadata: Metadata = {
  title: "Fusion | AURA",
  description:
    "Fuse two Auras you own into a descendant with an on-chain, operator- and fuser-un-grindable genome and provable lineage. Non-custodial commit-reveal, deploy-gated until the mainnet cutover.",
};

export default function FusePage() {
  return <FuseView />;
}
