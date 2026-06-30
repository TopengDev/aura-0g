"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { EASE } from "@/lib/motion";
import { ZeroG } from "@/components/atoms/ZeroG";
import { imageUrl, type Output } from "@/lib/api";

// Section 1 - HERO. AURA's hero is CHARACTER-ART-FORWARD and asymmetric: a left editorial column
// (eyebrow, oversized word-swap display headline, lede, CTAs, a live-stat hairline) beside a right
// showpiece composition that leads with the two strongest character pieces (street-samurai + the
// illuminated knight). This deliberately breaks the old centered-headline-above-a-faux-OS-window
// arrangement (the faux-OS now lives lower, as a supporting "watch an agent work" section), so the
// page reads as a gallery/marketplace from the first frame, not an OS demo. Typography + tokens +
// motion vocabulary are unchanged (Ethereal Glamour display, Geist Mono labels, the word-swap, EASE).
const SWAP_WORDS = ["prove", "own", "trade", "verify"];

export function Hero({ feature, agentCount, outputCount }: { feature: Output[]; agentCount: number; outputCount: number }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    const id = setInterval(() => setI((v) => (v + 1) % SWAP_WORDS.length), 2600);
    return () => clearInterval(id);
  }, []);

  const [lead, second, ...overflow] = feature;
  const third = overflow[0];

  return (
    <section className="relative px-5 pb-16 pt-28 sm:px-8 sm:pt-32 lg:pb-24">
      <div className="mx-auto grid w-full max-w-[var(--container-wrap)] items-center gap-x-12 gap-y-14 lg:grid-cols-[0.92fr_1.08fr]">
        {/* Left: editorial column (left-aligned, asymmetric, NOT arca's centered stack) */}
        <div className="order-2 lg:order-1">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="flex items-center gap-3 font-mono-x text-[11px] uppercase tracking-[0.18em]"
            style={{ color: "var(--color-ink-3)" }}
          >
            <span>A marketplace for verifiable creative Auras</span>
            <span className="hidden sm:inline" style={{ color: "var(--color-ink-3)" }}>
              · on <ZeroG /> Galileo
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.08 }}
            className="aura-deblur font-display mt-7 max-w-[15ch]"
            style={{ fontSize: "clamp(44px, 6.4vw, 104px)", lineHeight: 0.96, letterSpacing: "-0.02em" }}
          >
            Art you can{" "}
            <span className="prov-underline is-in relative inline-block" style={{ color: "var(--color-accent)" }}>
              <AnimatePresence mode="wait">
                <motion.span
                  key={SWAP_WORDS[i]}
                  initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -14, filter: "blur(6px)" }}
                  transition={{ duration: 0.5, ease: EASE }}
                  className="aura-deblur inline-block"
                >
                  {SWAP_WORDS[i]}
                </motion.span>
              </AnimatePresence>
            </span>
            .
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.2 }}
            className="mt-7 max-w-[52ch] text-[16px] leading-relaxed sm:text-[17px]"
            style={{ color: "var(--color-ink-2)" }}
          >
            Every Relic is created by an autonomous on-chain Aura, attested in a TEE, and stored on{" "}
            <ZeroG />. Generate free. Mint when you want to own it, with provenance and royalties that
            follow the work.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.3 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Link
              href="/explore"
              className="rounded-full px-7 py-3.5 font-mono-x text-[13px] tracking-[0.02em] transition-opacity hover:opacity-85"
              style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}
            >
              Explore the gallery
            </Link>
            <Link
              href="/generate"
              className="rounded-full border px-7 py-3.5 font-mono-x text-[13px] tracking-[0.02em] transition-colors hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)]"
              style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink)" }}
            >
              Generate free
            </Link>
          </motion.div>

          {/* live-stat hairline: a small proof of life under the CTAs (asymmetric, left-set) */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.42 }}
            className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-2 border-t pt-6 font-mono-x text-[11px] uppercase tracking-[0.12em]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-ink-3)" }}
          >
            <span>
              <span style={{ color: "var(--color-ink)" }}>{agentCount}</span> living Auras
            </span>
            <span>
              <span style={{ color: "var(--color-ink)" }}>{outputCount}</span> verifiable Relics
            </span>
            <span>chain 16602</span>
          </motion.div>
        </div>

        {/* Right: the showpiece character composition (leads the page with the art) */}
        <div className="relative order-1 lg:order-2">
          {lead ? (
            <div className="relative">
              <ShowpieceCard output={lead} priority tilt width={960} className="relative z-10" aspect="aspect-[4/5]" />

              {/* the second showpiece, overlapping at the lower-left for an editorial, gallery-wall feel */}
              {second ? (
                <motion.div
                  initial={{ opacity: 0, y: 26, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.9, ease: EASE, delay: 0.5 }}
                  className="absolute -bottom-10 -left-6 z-20 hidden w-[46%] sm:block lg:-left-10"
                >
                  <ShowpieceCard output={second} aspect="aspect-square" compact width={600} />
                </motion.div>
              ) : null}

              {/* a third piece peeking at the top-right corner (depth, still gallery, never OS chrome) */}
              {third ? (
                <motion.div
                  initial={{ opacity: 0, y: -18, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.9, ease: EASE, delay: 0.66 }}
                  className="absolute -right-5 -top-6 z-0 hidden w-[34%] lg:block"
                >
                  <ShowpieceCard output={third} aspect="aspect-square" compact muted width={600} />
                </motion.div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// A single framed character piece with a mono provenance chip. The lead card tilts to the cursor
// (transform-only, off on coarse pointers), reusing the catalog card's tilt vocabulary so the motion
// language stays one hand. Links straight to the output's verifiable provenance page.
function ShowpieceCard({
  output: o,
  priority = false,
  tilt = false,
  compact = false,
  muted = false,
  aspect = "aspect-[4/5]",
  width = 720,
  className = "",
}: {
  output: Output;
  priority?: boolean;
  tilt?: boolean;
  compact?: boolean;
  muted?: boolean;
  aspect?: string;
  width?: number;
  className?: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const src = imageUrl(o.imageRoot, o.style, width);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || !tilt || window.matchMedia("(pointer: coarse)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1100px) rotateX(${(-py * 4).toFixed(2)}deg) rotateY(${(px * 5).toFixed(2)}deg)`;
  };
  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "perspective(1100px) rotateX(0deg) rotateY(0deg)";
  };

  return (
    <motion.div
      initial={priority ? { opacity: 0, y: 30, scale: 0.97 } : false}
      animate={priority ? { opacity: 1, y: 0, scale: 1 } : undefined}
      transition={priority ? { duration: 1, ease: EASE, delay: 0.22 } : undefined}
      className={className}
    >
      <Link
        ref={ref}
        href={`/outputs/${o.tokenId}`}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="group block overflow-hidden rounded-[22px] border shadow-[var(--shadow-doc)] transition-[box-shadow] duration-300 will-change-transform"
        style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
      >
        <div className={`relative ${aspect} w-full overflow-hidden`} style={{ background: "var(--color-cream-deep)" }}>
          <img
            src={src}
            alt={`${o.agentName} character #${o.tokenId}`}
            loading={priority ? "eager" : "lazy"}
            // LCP element: fetch the lead showpiece at high priority; decode async so it never blocks.
            fetchPriority={priority ? "high" : undefined}
            decoding="async"
            className={`h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03] ${muted ? "opacity-90" : ""}`}
          />
          {/* style chip top-left */}
          <span
            className="absolute left-3 top-3 rounded-full px-2.5 py-1 font-mono-x text-[9px] uppercase tracking-[0.1em]"
            style={{ background: "color-mix(in oklab, var(--color-ink) 82%, transparent)", color: "var(--color-cream)" }}
          >
            {o.style}
          </span>
          {/* provenance footer band on the lead card (the editorial caption) */}
          {!compact ? (
            <div
              className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-4 pb-4 pt-12"
              style={{ background: "linear-gradient(to top, color-mix(in oklab, var(--color-ink) 78%, transparent), transparent)" }}
            >
              <div>
                <div className="font-display text-[clamp(22px,2.4vw,30px)] leading-none" style={{ color: "var(--color-cream)" }}>
                  {o.agentName}
                </div>
                <div className="mt-1.5 font-mono-x text-[10px] uppercase tracking-[0.12em]" style={{ color: "color-mix(in oklab, var(--color-cream) 72%, transparent)" }}>
                  verifiable · tee-attested
                </div>
              </div>
              <span className="font-mono-x text-[11px]" style={{ color: "color-mix(in oklab, var(--color-cream) 80%, transparent)" }}>
                #{o.tokenId}
              </span>
            </div>
          ) : (
            <span
              className="absolute bottom-2.5 right-3 font-mono-x text-[10px]"
              style={{ color: "color-mix(in oklab, var(--color-cream) 86%, transparent)", textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}
            >
              {o.agentName} #{o.tokenId}
            </span>
          )}
        </div>
      </Link>
    </motion.div>
  );
}
