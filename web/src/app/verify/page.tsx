import type { Metadata } from "next";
import { VerifyView } from "@/components/product/VerifyView";
import { Footer } from "@/components/chrome/Footer";

// /verify - the standalone PUBLIC provenance verifier. No wallet, read-only on-chain. Enter (or deep-link
// via ?id=) an output token id and AURA re-reads /provenance/:id + /royalty/:id live through the SHARED
// runVerification (the identical five checks the output detail page's inline Verify runs) and renders the
// all-green (or failed) checklist with the real on-chain values. Showcases AURA's verifiable thesis to
// anyone, signed in or not. Dynamic: every verification is a fresh live chain read.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify provenance | AURA",
  description:
    "Re-derive any AURA Relic's on-chain provenance live, no wallet required. Confirms the creating Aura, the on-chain image and TEE attestation, the provenance hash, and that the royalty resolves to the current Aura owner.",
};

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const initialId = Array.isArray(id) ? id[0] : id;

  return (
    <main className="min-h-screen pt-14">
      <VerifyView initialId={initialId} />
      <Footer />
    </main>
  );
}
