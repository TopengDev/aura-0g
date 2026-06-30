"use client";

import type { Activity } from "@/lib/api";
import { shortHex } from "@/lib/api";

// Section 6 - ACTIVITY ticker. Skeleton: full-bleed-marquee (edge-to-edge single moving line - the
// provenance line, now in motion). Technique: continuous CSS/transform marquee (NOT scroll-scrubbed,
// so the scrollytelling count stays at 1). Pausable on hover. Real on-chain events. Reduced-motion:
// the CSS rule freezes the track to a static row.
const KIND_LABEL: Record<string, string> = {
  mint: "MINT",
  sale: "SALE",
  transfer: "TRANSFER",
  listing: "LISTING",
  agent_mint: "AURA MINT",
};

export function ActivityTicker({ activity }: { activity: Activity[] }) {
  // Keep meaningful events; if empty, render nothing (the page still flows).
  const items = activity.filter((a) => a.kind !== "transfer" || a.tokenId != null);
  if (items.length === 0) return null;

  // Duplicate the sequence so the -50% translate loops seamlessly.
  const loop = [...items, ...items];
  // Slow the marquee proportional to count so it reads, never blurs.
  const dur = Math.max(28, items.length * 5);

  return (
    <section className="relative overflow-hidden border-y py-10" style={{ borderColor: "var(--color-border)", background: "color-mix(in oklab, var(--color-cream-deep) 50%, transparent)" }}>
      <div className="mb-6 px-5 sm:px-8">
        <div className="mx-auto flex w-full max-w-[var(--container-wrap)] items-center gap-3">
          <span className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            Live on-chain activity
          </span>
        </div>
      </div>

      <div className="aura-marquee relative w-full" style={{ ["--marquee-dur" as string]: `${dur}s` }}>
        <div className="aura-marquee-track">
          {loop.map((a, i) => (
            <Chip key={`${a.id}-${i}`} a={a} />
          ))}
        </div>
        {/* edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24" style={{ background: "linear-gradient(90deg, var(--color-cream), transparent)" }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24" style={{ background: "linear-gradient(270deg, var(--color-cream), transparent)" }} />
      </div>
    </section>
  );
}

function Chip({ a }: { a: Activity }) {
  const isSale = a.kind === "sale";
  return (
    <span className="mx-5 inline-flex items-center gap-3 whitespace-nowrap font-mono-x text-[13px]">
      <span
        className="rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-[0.1em]"
        style={{
          background: isSale ? "var(--color-accent)" : "color-mix(in oklab, var(--color-ink) 8%, transparent)",
          color: isSale ? "var(--color-cream)" : "var(--color-ink-2)",
        }}
      >
        {KIND_LABEL[a.kind] ?? a.kind}
      </span>
      {a.agentName && <span style={{ color: "var(--color-ink)" }}>{a.agentName}</span>}
      {a.tokenId != null && <span style={{ color: "var(--color-ink-3)" }}>#{a.tokenId}</span>}
      {a.price && (
        <span style={{ color: "var(--color-accent)" }}>{a.price} 0G</span>
      )}
      <span style={{ color: "var(--color-ink-3)" }}>{shortHex(a.txHash)}</span>
      <span style={{ color: "var(--color-border-strong)" }}>/</span>
    </span>
  );
}
