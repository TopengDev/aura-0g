"use client";

import { Reveal } from "@/components/Reveal";
import { ZeroG } from "@/components/atoms/ZeroG";
import { CountUp } from "./CountUp";

// Section 3 - LIVE STATS ledger. Skeleton: split-asymmetric (label column left, big figures right,
// provenance hairline as each baseline rule). Technique T13: big-number count-up. Figures are LIVE
// (passed from a server fetch of /api/_indexer + /health).
export type LedgerData = {
  agents: number;
  outputs: number;
  events: number;
  chainId: number;
  sponsorBalance: number | null;
};

type Row = {
  label: string;
  sub: React.ReactNode;
  value: number;
  decimals?: number;
  suffix?: string;
  display?: string; // overrides the count-up for non-numeric figures
};

export function StatsLedger({ data }: { data: LedgerData }) {
  const rows: Row[] = [
    { label: "Living Auras", sub: "autonomous, on-chain", value: data.agents },
    { label: "Relics minted", sub: "verifiable, provable", value: data.outputs },
    { label: "On-chain events", sub: "mints, sales, transfers", value: data.events },
    { label: "Creator royalty", sub: "follows every resale", value: 9, display: "6-9%" },
    { label: "Network", sub: <>chainId on <ZeroG /> Galileo</>, value: data.chainId },
  ];

  return (
    <section className="relative px-5 py-24 sm:px-8" style={{ background: "color-mix(in oklab, var(--color-cream-deep) 60%, transparent)" }}>
      <div className="mx-auto grid w-full max-w-[var(--container-wrap)] gap-12 md:grid-cols-[0.5fr_1fr]">
        <Reveal>
          <div className="md:sticky md:top-28">
            <span className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
              The ledger
            </span>
            <h2 className="font-display mt-3" style={{ fontSize: "clamp(30px, 4.4vw, 52px)", lineHeight: 1.02, letterSpacing: "-0.015em" }}>
              Live, on-chain, and counting.
            </h2>
            <p className="mt-4 max-w-[34ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              Not a mockup. Every figure here is read straight from the indexer and the <ZeroG /> Galileo
              testnet, right now.
            </p>
          </div>
        </Reveal>

        <div>
          {rows.map((r, idx) => (
            <Reveal key={r.label} delay={idx * 0.06}>
              <div className="w-full border-t py-7 first:border-t-0 sm:py-8" style={{ borderColor: "var(--color-border)" }}>
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-[15px] font-medium" style={{ color: "var(--color-ink)" }}>{r.label}</div>
                    <div className="font-mono-x text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--color-ink-3)" }}>{r.sub}</div>
                  </div>
                  <div
                    className="font-display tabular-nums"
                    style={{ fontSize: "clamp(44px, 8vw, 116px)", lineHeight: 0.9, letterSpacing: "-0.02em", color: "var(--color-ink)" }}
                  >
                    {r.display ? r.display : <CountUp value={r.value} decimals={r.decimals} suffix={r.suffix} />}
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
          {data.sponsorBalance != null && (
            <Reveal delay={0.3}>
              <div className="mt-2 flex items-center justify-between border-t pt-5" style={{ borderColor: "var(--color-border)" }}>
                <span className="font-mono-x text-[11px] uppercase tracking-[0.08em]" style={{ color: "var(--color-ink-3)" }}>
                  Sponsor balance (covers free generation)
                </span>
                <span className="font-mono-x text-[13px]" style={{ color: "var(--color-ink)" }}>
                  {data.sponsorBalance.toFixed(3)} <ZeroG />
                </span>
              </div>
            </Reveal>
          )}
        </div>
      </div>
    </section>
  );
}
