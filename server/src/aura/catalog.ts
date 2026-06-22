// AURA agent catalog - public, display-only metadata for the 4 SEEDED creative agents.
// Ported verbatim from lib/aura/catalog.ts. On-chain truth (owner, royaltyBps, fingerprint) is merged
// in by agents.ts. Matched to on-chain agents by `name`. These 4 are the brain-less seeded agents the
// generalized generator FALLS BACK to (zero regression) when an agent has no decryptable brain.
import type { AgentPublicMeta } from "./types.js";

const MODEL = "qwen/qwen-image-edit-2511";

export const CATALOG: Record<string, AgentPublicMeta> = {
  NOKTURNE: {
    name: "NOKTURNE",
    tagline: "Chiaroscuro noir, painted in shadow.",
    aesthetic:
      "Chiaroscuro noir - a single candle flame in near-total darkness, wet cobblestone reflections, drifting smoke, oil-painting grain, deep shadows, muted gold highlights.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#C8A24B",
    sampleImages: [],
  },
  MIRAI: {
    name: "MIRAI",
    tagline: "Neon cyberpunk, rain-slick and electric.",
    aesthetic:
      "Neon cyberpunk - electric magenta and cyan glow, rain-slick neon signs, holographic reflections, blade-runner atmosphere, high contrast.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#FF2EC4",
    sampleImages: [],
  },
  RISO: {
    name: "RISO",
    tagline: "Risograph duotone. Meet Fennic.",
    aesthetic:
      "Risograph print - fluorescent pink + blue duotone, visible halftone grain, misregistration, flat bold indie-zine shapes.",
    signatureCharacter:
      "Fennic - a wide-eared fennec fox mascot with cheek + ear markings, big friendly eyes, and a blue knit scarf.",
    model: MODEL,
    accent: "#FF5FA2",
    sampleImages: [],
  },
  SCRIPTORIUM: {
    name: "SCRIPTORIUM",
    tagline: "Illuminated manuscript, gilt and jewel-toned.",
    aesthetic:
      "Ornate illuminated manuscript - gold leaf, intricate marginalia, medieval miniature painting, jewel tones, decorative border.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#D4AF37",
    sampleImages: [],
  },
};

/** Display order for the agents grid. */
export const CATALOG_ORDER = ["RISO", "NOKTURNE", "MIRAI", "SCRIPTORIUM"];

export function metaForName(name: string): AgentPublicMeta | null {
  return CATALOG[name?.toUpperCase()] ?? null;
}

/** Base-image preset per SEEDED agent, used by the catalog FALLBACK in the generalized generator.
 *  (Brain-backed agents reconstruct their base from canonicalBaseRoot on 0G Storage instead.) */
export function baseForSeededAgent(agentName: string): string {
  const n = agentName.toUpperCase();
  if (n === "RISO") return "images/characters/T1/RISO-bust.png";
  if (n === "MIRAI") return "images/characters/T1/MIRAI-bust.png";
  return "images/_base-scene.png"; // neutral scene for NOKTURNE / SCRIPTORIUM / unknown
}

/** Build the styled fallback prompt for a SEEDED agent (parity with the v1 buildPrompt). */
export function fallbackPrompt(agentName: string, userPrompt: string): string {
  const meta = metaForName(agentName);
  const aesthetic = meta?.aesthetic ?? "On-chain creative agent style.";
  const clean = userPrompt.trim();
  if (agentName.toUpperCase() === "RISO") {
    return `Keep the EXACT same fennec fox character (same fur, cheek and ear markings, eyes, blue knit scarf). ${clean}. Style: risograph duotone, fluorescent pink and blue, halftone grain, misregistration, flat bold shapes, indie zine.`;
  }
  return `${clean}. Render in ${agentName} style: ${aesthetic}`;
}
