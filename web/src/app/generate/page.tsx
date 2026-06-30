import type { Metadata } from "next";
import { fetchAgents, isFeatured } from "@/lib/api";
import { GenerateView } from "@/components/product/GenerateView";
import { Footer } from "@/components/chrome/Footer";

export const metadata: Metadata = {
  title: "Generate | AURA",
  description:
    "Generate a verifiable Relic with any Aura. Sponsored 0G Compute inside a TEE, sealed to 0G Storage with a provenance hash, then mint it as a 1/1 you own.",
};

// /generate - AURA's signature feature. Preselect an agent from ?agent=[id] (else a picker). The flow,
// per the ACTUAL backend (server/src/routes/generate.ts + mint-args.ts): SIWE sign-in -> POST /generate
// (sponsored 0G Compute + Storage, owner-scoped) -> poll the job to done -> preview the TEE-attested art
// -> POST /mint-args for the attestor EIP-712 signature -> the user wallet-signs OutputNFT.mintOutput.
// Server component: fetch the catalog once for the picker; the client view owns the authed flow.
export const dynamic = "force-dynamic";

export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  const { agent } = await searchParams;
  const agents = await fetchAgents();
  const catalog = agents.filter(isFeatured);
  const preselectId = agent ? Number(agent) : null;

  return (
    <main className="min-h-screen pt-14">
      <GenerateView agents={catalog} preselectId={Number.isFinite(preselectId) ? preselectId : null} />
      <Footer />
    </main>
  );
}
