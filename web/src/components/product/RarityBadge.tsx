// The gacha rarity badge. A Relic's rarity is DERIVED from its on-chain seed (a provable pull roll), not a
// stored label - see the verify panel for the recompute. Legacy / non-summon Relics read as "Common".
// Common is intentionally understated (no badge by default via `hideCommon`) so the rarer tiers pop.
import type { CSSProperties } from "react";

export type RarityTier = "Common" | "Rare" | "Epic" | "Legendary";

// Tasteful, on-brand tints (not neon). Colors resolve through theme tokens (globals.css) so each tier
// keeps >=4.5:1 in BOTH light and dark (the hardcoded hex failed dark: Epic was 3.28:1). A glyph rides
// alongside the label so tiers are never distinguished by hue alone.
const TIERS: Record<RarityTier, { fg: string; bg: string; ring: string; label: string }> = {
  Common: { fg: "var(--rarity-common-fg)", bg: "var(--rarity-common-bg)", ring: "var(--rarity-common-ring)", label: "Common" },
  Rare: { fg: "var(--rarity-rare-fg)", bg: "var(--rarity-rare-bg)", ring: "var(--rarity-rare-ring)", label: "Rare" },
  Epic: { fg: "var(--rarity-epic-fg)", bg: "var(--rarity-epic-bg)", ring: "var(--rarity-epic-ring)", label: "Epic" },
  Legendary: { fg: "var(--rarity-legendary-fg)", bg: "var(--rarity-legendary-bg)", ring: "var(--rarity-legendary-ring)", label: "Legendary" },
};

function normalize(r: string | null | undefined): RarityTier {
  const k = (r ?? "").trim().toLowerCase();
  if (k === "legendary") return "Legendary";
  if (k === "epic") return "Epic";
  if (k === "rare") return "Rare";
  return "Common";
}

export function RarityBadge({
  rarity,
  size = "md",
  hideCommon = false,
  className = "",
}: {
  rarity: string | null | undefined;
  size?: "sm" | "md";
  hideCommon?: boolean;
  className?: string;
}) {
  const tier = normalize(rarity);
  if (hideCommon && tier === "Common") return null;
  const t = TIERS[tier];
  const style: CSSProperties = {
    color: t.fg,
    background: t.bg,
    border: `1px solid ${t.ring}`,
    boxShadow: tier === "Legendary" ? `0 0 0 1px ${t.ring}, 0 2px 10px -4px ${t.ring}` : undefined,
  };
  const pad = size === "sm" ? "px-2 py-1 text-[12.5px]" : "px-2.5 py-1.5 text-[13px]";
  return (
    <span
      className={`label-caps micro inline-flex items-center gap-1 rounded-[6px] tracking-[0.1em] ${pad} ${className}`}
      style={style}
      title={`Rarity: ${t.label} (provably derived from the on-chain seed)`}
    >
      {tier !== "Common" ? <span aria-hidden>{tier === "Legendary" ? "★" : "◆"}</span> : null}
      {t.label}
    </span>
  );
}
