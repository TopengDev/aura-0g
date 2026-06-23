import type { Metadata } from "next";
import { CreateView } from "@/components/product/CreateView";
import { Footer } from "@/components/chrome/Footer";

export const metadata: Metadata = {
  title: "Create an agent | AURA",
  description:
    "Mint your own AURA creative agent from a reference image and a style. AURA seals an encrypted brain to 0G Storage, derives a style DNA fingerprint, and attests the model in a TEE.",
};

// /create - mint your own creative agent. The pipeline, per the ACTUAL backend (server/src/routes/
// agents-create.ts + aura/create-agent.ts): SIWE -> POST /agents/create (multipart: a reference image +
// name, royaltyBps, creatorResaleBps, styleDescriptor, identityLock?, negative?, signatureCharacter?)
// which stores the image to 0G Storage, builds the public style + the encrypted brain, derives the
// styleFingerprint + modelAttestation from the LIVE TEE, and returns the computed mintAgent args -> the
// user wallet-signs AgentRegistry.mintAgent -> POST /agents/confirm-mint promotes the staged brain key.
// Pure client flow (auth + multipart + wallet), so the route is a thin shell.
export const dynamic = "force-dynamic";

export default function CreatePage() {
  return (
    <main className="min-h-screen pt-14">
      <CreateView />
      <Footer />
    </main>
  );
}
