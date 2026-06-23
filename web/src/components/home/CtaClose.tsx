"use client";

import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { ZeroG } from "@/components/atoms/ZeroG";
import { useInView } from "@/lib/useInView";

// Section 8 - CTA close. Skeleton: centered-form (max-contrast, minimal). Technique T1: full-bleed
// color-field settle (invert to a calm ink field). Two CTAs (Explore / Generate free). The
// provenance line returns as a single steady underscore bookend (the motif completing its journey).
export function CtaClose() {
  const [ref, inView] = useInView<HTMLDivElement>(0.4);

  return (
    <section className="px-5 py-10 sm:px-8 sm:py-16">
      <div
        className="mx-auto w-full max-w-[var(--container-wrap)] overflow-hidden rounded-[28px] px-6 py-24 text-center sm:px-12"
        style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}
      >
        <div ref={ref} className="mx-auto max-w-[760px]">
          <span className="font-mono-x text-[11px] uppercase tracking-[0.18em]" style={{ color: "color-mix(in oklab, var(--color-cream) 60%, transparent)" }}>
            Start now. It is free.
          </span>
          <h2 className="font-display mt-5" style={{ fontSize: "clamp(36px, 6.6vw, 84px)", lineHeight: 0.98, letterSpacing: "-0.02em" }}>
            Make art worth owning.
          </h2>
          <p className="mx-auto mt-6 max-w-[52ch] text-[16px] leading-relaxed" style={{ color: "color-mix(in oklab, var(--color-cream) 78%, transparent)" }}>
            Generate for free with any agent. When a piece is worth keeping, mint it with provenance and
            royalties on <ZeroG /> Galileo.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/explore"
              className="rounded-full px-8 py-4 font-mono-x text-[13px] tracking-[0.02em] transition-opacity hover:opacity-90"
              style={{ background: "var(--color-cream)", color: "var(--color-ink)" }}
            >
              Explore the gallery
            </Link>
            <Link
              href="/generate"
              className="rounded-full border px-8 py-4 font-mono-x text-[13px] tracking-[0.02em] transition-colors"
              style={{ borderColor: "color-mix(in oklab, var(--color-cream) 30%, transparent)", color: "var(--color-cream)" }}
            >
              Generate free
            </Link>
          </div>

          {/* the provenance line, returning as the closing bookend */}
          <div
            className="prov-rule mx-auto mt-14 h-px w-48"
            style={{
              background: "color-mix(in oklab, var(--color-cream) 50%, transparent)",
              transformOrigin: "center",
              transform: inView ? "scaleX(1)" : "scaleX(0)",
              transition: "transform 1.2s cubic-bezier(0.22,1,0.36,1)",
            }}
            aria-hidden
          />
        </div>
      </div>
    </section>
  );
}
