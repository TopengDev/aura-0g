"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Link from "next/link";
import type { Output } from "@/lib/api";
import { imageUrl, shortHex } from "@/lib/api";
import { RarityBadge } from "@/components/product/RarityBadge";
import { ZeroG } from "@/components/atoms/ZeroG";
import { Kicker } from "./Kicker";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

// Section 5 - RECENT OUTPUTS. Skeleton: horizontal-rail. Technique T10: recent minted outputs scroll
// sideways while the section is PINNED via CSS position:sticky (NOT GSAP pin:true). GSAP ScrollTrigger
// is used for the scrub ONLY (translateX of the track). Opaque full-viewport bg. Reduced-motion /
// coarse-pointer / small viewport downgrade to a native horizontal snap-scroll (no pin, no scrub).
export function OutputsRail({ outputs }: { outputs: Output[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [simple, setSimple] = useState(false);

  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.matchMedia("(max-width: 880px)").matches;
    if (coarse || reduced || small) {
      setSimple(true);
      return;
    }

    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;

    const ctx = gsap.context(() => {
      const distance = () => Math.max(0, track.scrollWidth - window.innerWidth + 120);
      const tween = gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          trigger: wrap,
          start: "top top",
          // scroll distance = the horizontal travel, so 1px scroll = 1px sideways (flick-stable)
          end: () => `+=${distance()}`,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      });
      return () => {
        tween.scrollTrigger?.kill();
        tween.kill();
      };
    }, wrap);

    return () => ctx.revert();
  }, [outputs.length]);

  if (outputs.length === 0) return null;

  if (simple) {
    // Native horizontal snap-scroll (mobile / reduced-motion / coarse pointer).
    return (
      <section className="relative overflow-hidden px-5 py-20 sm:px-8" style={{ background: "var(--color-cream)" }}>
        <RailHeader />
        <div className="mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-4" style={{ scrollbarWidth: "none" }}>
          {outputs.map((o) => (
            <div key={o.tokenId} className="w-[78vw] max-w-[320px] shrink-0 snap-start sm:w-[340px]">
              <OutputCard output={o} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  // Pinned (CSS sticky) horizontal rail. The OUTER wrapper is tall; the INNER stays sticky at 100vh.
  return (
    <section ref={wrapRef} className="relative" style={{ background: "var(--color-cream)" }}>
      <div className="sticky top-0 flex h-screen flex-col justify-center overflow-hidden">
        <div className="px-5 sm:px-8">
          <div className="mx-auto w-full max-w-[var(--container-wrap)]">
            <RailHeader />
          </div>
        </div>
        <div ref={trackRef} className="mt-10 flex gap-6 pl-5 will-change-transform sm:pl-8">
          {outputs.map((o) => (
            <div key={o.tokenId} className="w-[360px] shrink-0">
              <OutputCard output={o} />
            </div>
          ))}
          <div className="flex w-[280px] shrink-0 items-center">
            <Link href="/explore" className="font-display text-[clamp(28px,4vw,46px)] leading-none" style={{ color: "var(--color-accent)" }}>
              See the full
              <br />
              gallery -&gt;
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function RailHeader() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Kicker index="04" label="Recent relics" />
        <h2 className="font-display mt-5" style={{ fontSize: "clamp(32px, 5vw, 60px)", lineHeight: 1, letterSpacing: "-0.015em" }}>
          Each one a verifiable Relic.
        </h2>
      </div>
      <p className="max-w-[36ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        Every card carries its provenance: the Aura, the seed, the TEE attestation, the <ZeroG />
        storage root.
      </p>
    </div>
  );
}

function OutputCard({ output: o }: { output: Output }) {
  // Rail card is <=360 CSS px; 820 stays crisp on high-DPR while downscaling the 1024^2 source.
  const imgSrc = imageUrl(o.imageRoot, o.style, 820);
  return (
    <Link
      href="/explore"
      className="group block overflow-hidden rounded-[22px] border micro hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
    >
      <div className="relative aspect-square w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
        <img src={imgSrc} alt={`${o.agentName} #${o.tokenId}`} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
        <span className="tag micro absolute left-3 top-3" style={{ background: "color-mix(in oklab, var(--color-ink) 78%, transparent)", color: "var(--color-cream)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", border: "1px solid color-mix(in oklab, var(--color-cream) 16%, transparent)" }}>
          {o.style}
        </span>
        {/* rarer pulls get a corner badge (Common stays clean) - the gacha payoff at a glance */}
        <span className="absolute right-3 top-3">
          <RarityBadge rarity={o.rarity} size="sm" hideCommon />
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[22px]">{o.agentName}</span>
          <span className="font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-ink-3)" }}>#{o.tokenId}</span>
        </div>
        <dl className="mt-3.5 space-y-2">
          <Row k="seed" v={o.seed} />
          <Row k="tee" v={shortHex(o.teeAttestation)} ok />
          <Row k="root" v={shortHex(o.imageRoot)} />
        </dl>
        <div className="mt-3.5 flex items-center justify-end border-t pt-3 text-[16px] font-semibold" style={{ borderColor: "var(--color-border)", color: "var(--color-accent)" }}>
          Verify -&gt;
        </div>
      </div>
    </Link>
  );
}

function Row({ k, v, ok = false }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="label-caps shrink-0 text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.08em" }}>{k}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-ink)" }}>
        <span className="truncate">{v}</span>
        {ok && <span className="shrink-0" style={{ color: "var(--color-ok)" }}>✓</span>}
      </dd>
    </div>
  );
}
