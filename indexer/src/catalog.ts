// Off-chain, display-only style catalog for the SEEDED agents - mirrors server/src/aura/catalog.ts
// (the on-chain source of truth for owner/royaltyBps/etc. is the indexed `agents` table; this only
// adds presentation metadata + the `style` slug the discovery `by-style` filter keys on). Joined by
// the agent's on-chain `name` (uppercased). Kept in the indexer so the read APIs are self-contained.
export interface AgentStyle {
  style: string; // canonical style slug used by ?style= filtering (lowercase)
  tagline: string;
  aesthetic: string;
  accent: string; // hex for UI theming
  signatureCharacter: string | null;
}

export const CATALOG: Record<string, AgentStyle> = {
  NOKTURNE: {
    style: "noir",
    tagline: "Chiaroscuro noir, painted in shadow.",
    aesthetic:
      "Chiaroscuro noir - a single candle flame in near-total darkness, wet cobblestone reflections, drifting smoke, oil-painting grain, deep shadows, muted gold highlights.",
    accent: "#C8A24B",
    signatureCharacter: null,
  },
  MIRAI: {
    style: "cyberpunk",
    tagline: "Neon cyberpunk, rain-slick and electric.",
    aesthetic:
      "Neon cyberpunk - electric magenta and cyan glow, rain-slick neon signs, holographic reflections, blade-runner atmosphere, high contrast.",
    accent: "#FF2EC4",
    signatureCharacter: null,
  },
  RISO: {
    style: "risograph",
    tagline: "Risograph duotone. Meet Fennic.",
    aesthetic:
      "Risograph print - fluorescent pink + blue duotone, visible halftone grain, misregistration, flat bold indie-zine shapes.",
    accent: "#FF5FA2",
    signatureCharacter:
      "Fennic - a wide-eared fennec fox mascot with cheek + ear markings, big friendly eyes, and a blue knit scarf.",
  },
  SCRIPTORIUM: {
    style: "illuminated",
    tagline: "Illuminated manuscript, gilt and jewel-toned.",
    aesthetic:
      "Ornate illuminated manuscript - gold leaf, intricate marginalia, medieval miniature painting, jewel tones, decorative border.",
    accent: "#D4AF37",
    signatureCharacter: null,
  },
};

const FALLBACK: AgentStyle = {
  style: "custom",
  tagline: "Creative agent on 0G.",
  aesthetic: "On-chain creative agent.",
  accent: "#8A8AFF",
  signatureCharacter: null,
};

/** Style metadata for an agent name (uppercased lookup). Falls back to a generic "custom" style. */
export function styleForName(name: string | null | undefined): AgentStyle {
  if (!name) return FALLBACK;
  return CATALOG[name.toUpperCase()] ?? FALLBACK;
}
