"use client";

import { useState } from "react";
import type { Activity } from "@/lib/api";
import { shortHex } from "@/lib/api";
import { Kicker } from "./Kicker";

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
  // A control to pause the auto-scrolling marquee (WCAG 2.2.2: moving content that starts automatically
  // and lasts >5s must be pausable by more than just hover, which fails keyboard + touch users).
  const [paused, setPaused] = useState(false);
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
          <Kicker label="Live on-chain activity" />
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="micro ml-auto rounded-full border px-3 py-1 label-caps text-[12px] uppercase tracking-[0.1em] hover:-translate-y-px active:scale-[0.97]"
            style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)", background: "var(--color-paper)" }}
          >
            {paused ? "Play activity" : "Pause activity"}
          </button>
        </div>
      </div>

      <div className="aura-marquee relative w-full" style={{ ["--marquee-dur" as string]: `${dur}s` }}>
        <div className="aura-marquee-track" style={{ animationPlayState: paused ? "paused" : undefined }}>
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
    <span className="mx-5 inline-flex items-center gap-3 whitespace-nowrap text-[16px]">
      <span
        className="tag"
        style={{
          background: isSale ? "var(--color-accent)" : "color-mix(in oklab, var(--color-ink) 7%, transparent)",
          color: isSale ? "var(--color-cream)" : "var(--color-ink-2)",
          border: isSale ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
        }}
      >
        {KIND_LABEL[a.kind] ?? a.kind}
      </span>
      {a.agentName && <span className="font-semibold" style={{ color: "var(--color-ink)" }}>{a.agentName}</span>}
      {a.tokenId != null && <span className="font-mono-x tabular-nums" style={{ color: "var(--color-ink-3)" }}>#{a.tokenId}</span>}
      {a.price && (
        <span className="font-mono-x tabular-nums" style={{ color: "var(--color-accent)" }}>{a.price} 0G</span>
      )}
      <span className="font-mono-x" style={{ color: "var(--color-ink-3)" }}>{shortHex(a.txHash)}</span>
      <span style={{ color: "var(--color-border-strong)" }}>/</span>
    </span>
  );
}
