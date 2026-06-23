"use client";

import { motion } from "framer-motion";
import { RECALL_OUTPUT } from "@/lib/scene";
import { ZeroG } from "@/components/atoms/ZeroG";
import { AuraMark } from "./logos";

// The "recall / browse" phase: AURA's own Explore surface inside the browser window. The just-minted
// output appears as a gallery card with its full provenance chip (agent, seed, TEE attestation,
// storage root) and a Verify affordance. A light editorial surface (the product's real UI), not a
// third-party app clone.
export function BrowserGallery({ play, startDelay = 0 }: { play: boolean; startDelay?: number }) {
  const o = RECALL_OUTPUT;
  const imgSrc = `/images/${encodeURIComponent(o.imageRoot.replace(/^0g:\/\//, ""))}?style=${o.style}`;

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-cream)", color: "var(--color-ink)", fontFamily: "var(--font-body)" }}>
      {/* explore toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2">
          <AuraMark size={16} color="var(--color-ink)" />
          <span className="font-display text-[15px]" style={{ letterSpacing: "0.12em" }}>AURA</span>
          <span className="font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>· explore</span>
        </div>
        <span className="rounded-full border px-2.5 py-0.5 font-mono-x text-[10px] uppercase tracking-[0.1em]" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-3)" }}>
          newest
        </span>
      </div>

      {/* gallery card */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-5">
        <motion.article
          initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
          animate={play ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: startDelay / 1000 }}
          className="w-full max-w-[300px] overflow-hidden rounded-[18px] border shadow-[var(--shadow-card)]"
          style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
        >
          <div className="relative aspect-square w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
            <img src={imgSrc} alt={`${o.agentName} #${o.tokenId}`} className="h-full w-full object-cover" />
            <span
              className="absolute left-3 top-3 rounded-full px-2.5 py-1 font-mono-x text-[9px] uppercase tracking-[0.1em]"
              style={{ background: "color-mix(in oklab, var(--color-ink) 80%, transparent)", color: "var(--color-cream)" }}
            >
              {o.style}
            </span>
          </div>
          <div className="p-3.5">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[18px]">{o.agentName}</span>
              <span className="font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>#{o.tokenId}</span>
            </div>

            <dl className="mt-3 space-y-1.5">
              <ChipRow k="seed" v={o.seed} />
              <ChipRow k="tee" v="0x9b22…d419" ok />
              <ChipRow k="root" v="0xe3cd…b6f3" />
            </dl>

            <div className="mt-3.5 flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
              <span className="font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>
                royalty 7%
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 font-mono-x text-[10px]"
                style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}
              >
                Verify <span aria-hidden>-&gt;</span>
              </span>
            </div>
          </div>
        </motion.article>
      </div>

      <div className="shrink-0 px-4 pb-3 pt-1 font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>
        recalled from <ZeroG /> Storage. every field checkable on-chain.
      </div>
    </div>
  );
}

function ChipRow({ k, v, ok = false }: { k: string; v: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="font-mono-x text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--color-ink-3)" }}>{k}</dt>
      <dd className="flex items-center gap-1.5 font-mono-x text-[11px]" style={{ color: "var(--color-ink)" }}>
        {v}
        {ok && <span style={{ color: "var(--color-ok)" }}>✓</span>}
      </dd>
    </div>
  );
}
