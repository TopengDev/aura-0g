// AURA agent catalog — public, display-only metadata for the creative agents.
// On-chain truth (owner, royaltyBps, fingerprint) is merged in by lib/aura/agents.ts.
// Matched to on-chain agents by `name`. Entries without an on-chain match are surfaced
// as minted:false ("available"). NOKTURNE + RISO are minted on Galileo; MIRAI + SCRIPTORIUM
// are catalog-only style identities from the same proven model.
import type { AgentPublicMeta } from "./types";

const MODEL = "qwen/qwen-image-edit-2511";

export const CATALOG: Record<string, AgentPublicMeta> = {
  NOKTURNE: {
    name: "NOKTURNE",
    tagline: "Chiaroscuro noir, painted in shadow.",
    aesthetic:
      "Chiaroscuro noir — a single candle flame in near-total darkness, wet cobblestone reflections, drifting smoke, oil-painting grain, deep shadows, muted gold highlights.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#C8A24B",
    sampleImages: ["/api/image/nokturne-style", "/api/image/nokturne-bust"],
  },
  RISO: {
    name: "RISO",
    tagline: "Risograph duotone. Meet Fennic.",
    aesthetic:
      "Risograph print — fluorescent pink + blue duotone, visible halftone grain, misregistration, flat bold indie-zine shapes.",
    signatureCharacter:
      "Fennic — a wide-eared fennec fox mascot with cheek + ear markings, big friendly eyes, and a blue knit scarf.",
    model: MODEL,
    accent: "#FF5FA2",
    sampleImages: [
      "/api/image/riso-hero",
      "/api/image/riso-canonical",
      "/api/image/riso-pirate",
      "/api/image/riso-astronaut",
      "/api/image/riso-wizard",
      "/api/image/riso-punk",
      "/api/image/riso-king",
      "/api/image/riso-samurai",
    ],
  },
  MIRAI: {
    name: "MIRAI",
    tagline: "Neon cyberpunk, rain-slick and electric.",
    aesthetic:
      "Neon cyberpunk — electric magenta and cyan glow, rain-slick neon signs, holographic reflections, blade-runner atmosphere, high contrast.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#FF2EC4",
    sampleImages: ["/api/image/mirai-style", "/api/image/mirai-bust", "/api/image/mirai-samurai", "/api/image/mirai-netrunner"],
  },
  SCRIPTORIUM: {
    name: "SCRIPTORIUM",
    tagline: "Illuminated manuscript, gilt and jewel-toned.",
    aesthetic:
      "Ornate illuminated manuscript — gold leaf, intricate marginalia, medieval miniature painting, jewel tones, decorative border.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#D4AF37",
    sampleImages: ["/api/image/scriptorium-style", "/api/image/scriptorium-bust"],
  },
};

/** Display order for the agents grid. */
export const CATALOG_ORDER = ["RISO", "NOKTURNE", "MIRAI", "SCRIPTORIUM"];

export function metaForName(name: string): AgentPublicMeta | null {
  return CATALOG[name?.toUpperCase()] ?? null;
}
