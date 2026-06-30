import type { Metadata } from "next";
import { FaucetView } from "@/components/product/FaucetView";
import { Footer } from "@/components/chrome/Footer";

// /faucet - the testnet gas helper. AURA's writes (mint, list, buy, create-agent) are user-signed, so
// they cost 0G gas even though generation is sponsored. This page shows the connected wallet's live 0G
// balance on Galileo (chain 16602) and links the canonical 0G faucet (https://faucet.0g.ai) with the
// claim steps + an honest note on what the gas is for. Client-rendered (the balance is wallet-scoped).
export const metadata: Metadata = {
  title: "Testnet faucet | AURA",
  description:
    "Get free testnet 0G for gas on 0G Galileo. Minting, listing, buying, and creating an Aura are user-signed transactions; generation itself is sponsored.",
};

export default function FaucetPage() {
  return (
    <main className="min-h-screen pt-14">
      <FaucetView />
      <Footer />
    </main>
  );
}
