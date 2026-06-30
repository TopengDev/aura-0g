// The gacha rarity badge. A Relic's rarity is DERIVED from its on-chain seed (a provable pull roll), not a
// stored label - see the verify panel for the recompute. Legacy / non-summon Relics read as "Common".
// Common is intentionally understated (no badge by default via `hideCommon`) so the rarer tiers pop.
import type { CSSProperties } from "react";

export type RarityTier = "Common" | "Rare" | "Epic" | "Legendary";

const TIERS: Record<RarityTier, { fg: string; bg: string; ring: string; label: string }> = {
  // Tasteful, on-brand tints (not neon). Each tier reads instantly without fighting the artwork.
  Common: { fg: "#6b7280", bg: "rgba(107,114,128,0.10)", ring: "rgba(107,114,128,0.30)", label: "Common" },
  Rare: { fg: "#2563eb", bg: "rgba(37,99,235,0.12)", ring: "rgba(37,99,235,0.34)", label: "Rare" },
  Epic: { fg: "#7c3aed", bg: "rgba(124,58,237,0.13)", ring: "rgba(124,58,237,0.36)", label: "Epic" },
  Legendary: { fg: "#b45309", bg: "rgba(217,160,40,0.16)", ring: "rgba(217,160,40,0.45)", label: "Legendary" },
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
  const pad = size === "sm" ? "px-2 py-0.5 text-[9px]" : "px-2.5 py-1 text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-mono-x uppercase tracking-[0.12em] ${pad} ${className}`}
      style={style}
      title={`Rarity: ${t.label} (provably derived from the on-chain seed)`}
    >
      {tier !== "Common" ? <span aria-hidden>{tier === "Legendary" ? "★" : "◆"}</span> : null}
      {t.label}
    </span>
  );
}
