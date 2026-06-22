import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "AURA — Verifiable Creative-Agent Marketplace on 0G",
  description: "Creative agents are iNFTs that generate TEE-verified art on 0G, with provable provenance and enforced, transferable royalties.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
