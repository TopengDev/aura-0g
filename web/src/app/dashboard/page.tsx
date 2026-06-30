import type { Metadata } from "next";
import { DashboardView } from "@/components/product/DashboardView";
import { Footer } from "@/components/chrome/Footer";

export const metadata: Metadata = {
  title: "Dashboard | AURA",
  description:
    "Your AURA studio: every Aura you own, every Relic you hold, your active listings, and the royalties your work earns on 0G Galileo.",
};

// /dashboard - the wallet-gated portfolio. Tabs: My Agents (owned + royalties earned), My Outputs
// (owned), My Listings (active listings with inline cancel / update-price via the TradePanel logic),
// and Activity (the wallet's on-chain history + earnings). All data is owned-by-address, so it is a
// client fetch keyed to the connected wallet: GET /api/creators/:wallet (the portfolio) + /api/marketplace
// (listings, filtered to seller) + /api/activity (filtered to the address). Connect-wallet empty state.
export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <main className="min-h-screen pt-14">
      <DashboardView />
      <Footer />
    </main>
  );
}
