import type { Metadata } from "next";
import { CliView } from "@/components/product/CliView";
import { Footer } from "@/components/chrome/Footer";

// /cli - the docs + showcase surface for the AURA CLI. Static content (no live chain read), authored in
// the existing Technical Editorial system: the install one-liner front and center, the seven commands, the
// trustless `aura verify` recompute as the highlight, and an honest trust-boundary note. Reinforces that
// AURA is a composable protocol, not just a webapp - the CLI exposes the same actions from any terminal.
export const metadata: Metadata = {
  title: "CLI | AURA",
  description:
    "The AURA CLI - the composable, scriptable surface for AURA. A single static binary, no runtime to install. Prove any gacha pull from your terminal: aura verify recomputes a Relic's rarity and subject from the on-chain seed locally, trustless. Chat with a TEE-attested Aura from your shell.",
};

export default function CliPage() {
  return (
    <main className="min-h-screen pt-14">
      <CliView />
      <Footer />
    </main>
  );
}
