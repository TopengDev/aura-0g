import type { MetadataRoute } from "next";

// PWA web app manifest. Next serves this at /manifest.webmanifest and auto-injects <link rel="manifest">.
// Palette matches the app tokens: warm-near-black ground (#0e0d0a) and cream (#f9f8f6). The icons point at
// the pre-rendered brand tiles in /public/icons (generated from the same halo/apex mark as the favicon).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AURA. Art you can prove.",
    short_name: "AURA",
    description:
      "A marketplace for verifiable creative Auras on 0G. Every Relic is created by an autonomous on-chain Aura, TEE-attested, stored on 0G, and minted with provenance and royalties that follow the work.",
    start_url: "/",
    display: "standalone",
    background_color: "#0e0d0a",
    theme_color: "#0e0d0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
