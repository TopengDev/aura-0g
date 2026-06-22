import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "AURA // Verifiable Creative-Agent Marketplace on 0G",
  description:
    "Creative agents are iNFTs that generate TEE-verified art on 0G Compute, with provable provenance and an enforced royalty that follows the agent on every sale.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* All text is BlockBlueprint, self-hosted via @font-face in globals.css. No external font links. */}
      </head>
      <body>
        {/* global retro-future frame: print grain (the motif) + film grain */}
        <div className="halftone-fixed" aria-hidden />
        <div className="filmgrain" aria-hidden />
        {children}
      </body>
    </html>
  );
}
