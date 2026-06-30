"use client";

import Link from "next/link";
import { useRef } from "react";
import { Reveal } from "@/components/Reveal";
import { imageUrl, type Output } from "@/lib/api";

// Section - CHARACTER GALLERY. A horizontal showpiece strip directly under the hero that doubles down
// on the art-forward lead: the curated character pieces as large portrait cards, each linking to its
// verifiable provenance. This is AURA's own structural beat (arca has no character wall) and it keeps
// the striking art the dominant element for the first two screens. Tokens + type + tilt vocabulary
// are the catalog card's, unchanged. Reduced-motion / coarse pointers get a plain horizontal scroll.
export function CharacterGallery({ outputs }: { outputs: Output[] }) {
  if (outputs.length === 0) return null;

  return (
    <section className="relative px-5 py-20 sm:px-8 sm:py-24" style={{ background: "color-mix(in oklab, var(--color-cream-deep) 55%, transparent)" }}>
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                Featured characters
              </span>
              <h2 className="font-display mt-3" style={{ fontSize: "clamp(30px, 4.8vw, 58px)", lineHeight: 1, letterSpacing: "-0.015em" }}>
                Made by Auras. Owned by you.
              </h2>
            </div>
            <Link href="/explore" className="font-mono-x text-[12px] underline-offset-4 hover:underline" style={{ color: "var(--color-accent)" }}>
              See the gallery -&gt;
            </Link>
          </div>
        </Reveal>

        {/* horizontal snap strip: large portrait cards, the art carrying the section */}
        <div className="flex snap-x snap-mandatory gap-5 overflow-x-auto pb-3" style={{ scrollbarWidth: "none" }}>
          {outputs.map((o, i) => (
            <Reveal key={o.tokenId} delay={Math.min(0.06 * i, 0.3)} className="snap-start">
              <CharacterCard output={o} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function CharacterCard({ output: o }: { output: Output }) {
  const ref = useRef<HTMLAnchorElement>(null);
  // Card is <=320 CSS px; 820 keeps it crisp to ~DPR 2.5 while downscaling the 1024^2 source (cheaper decode).
  const src = imageUrl(o.imageRoot, o.style, 820);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || window.matchMedia("(pointer: coarse)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1000px) rotateX(${(-py * 4).toFixed(2)}deg) rotateY(${(px * 5).toFixed(2)}deg)`;
  };
  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
  };

  return (
    <Link
      ref={ref}
      href={`/outputs/${o.tokenId}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="group relative block w-[78vw] max-w-[320px] shrink-0 overflow-hidden rounded-[22px] border transition-[box-shadow] duration-300 will-change-transform hover:shadow-[var(--shadow-card)] sm:w-[300px]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
    >
      <div className="relative aspect-[4/5] w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
        <img
          src={src}
          alt={`${o.agentName} character #${o.tokenId}`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
        <span
          className="absolute left-3 top-3 rounded-full px-2.5 py-1 font-mono-x text-[9px] uppercase tracking-[0.1em]"
          style={{ background: "color-mix(in oklab, var(--color-ink) 82%, transparent)", color: "var(--color-cream)" }}
        >
          {o.style}
        </span>
        <div
          className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-4 pb-4 pt-12"
          style={{ background: "linear-gradient(to top, color-mix(in oklab, var(--color-ink) 76%, transparent), transparent)" }}
        >
          <div>
            <div className="font-display text-[24px] leading-none" style={{ color: "var(--color-cream)" }}>
              {o.agentName}
            </div>
            <div className="mt-1.5 font-mono-x text-[10px] uppercase tracking-[0.12em]" style={{ color: "color-mix(in oklab, var(--color-cream) 70%, transparent)" }}>
              tee-attested
            </div>
          </div>
          <span className="font-mono-x text-[11px]" style={{ color: "color-mix(in oklab, var(--color-cream) 80%, transparent)" }}>
            #{o.tokenId}
          </span>
        </div>
      </div>
    </Link>
  );
}
