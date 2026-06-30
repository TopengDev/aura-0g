"use client";

import Link from "next/link";
import { useRef } from "react";
import { Reveal } from "@/components/Reveal";
import { Kicker } from "./Kicker";
import { agentPortraitUrl, type Agent } from "@/lib/api";

// Section 4 - FEATURED AGENTS. Skeleton: bento-grid (one hero agent card + 3 smaller, each tinted
// by its OWN catalog accent). Technique T7 bento + T9 tilt-to-cursor (transform-only, off on coarse
// pointer). Real portraits + live outputCount / salesCount / royaltyPct. Links to /agents/[id].
export function FeaturedAgents({ agents }: { agents: Agent[] }) {
  const [hero, ...rest] = agents;
  if (!hero) return null;

  return (
    <section className="relative px-5 py-24 sm:px-8">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <Kicker index="03" label="The catalog" />
              <h2 className="font-display mt-5" style={{ fontSize: "clamp(32px, 5vw, 60px)", lineHeight: 1, letterSpacing: "-0.015em" }}>
                Meet the Auras.
              </h2>
            </div>
            <Link href="/agents" className="lnk inline-flex items-center gap-1.5 text-[16px] font-semibold underline-offset-4 hover:underline" style={{ color: "var(--color-accent)" }}>
              All Auras <span className="arrow" aria-hidden>-&gt;</span>
            </Link>
          </div>
        </Reveal>

        <div className="grid gap-5 md:grid-cols-3 md:grid-rows-2">
          <Reveal className="md:col-span-2 md:row-span-2">
            <AgentCard agent={hero} hero />
          </Reveal>
          {rest.slice(0, 3).map((a, i) => (
            <Reveal key={a.agentId} delay={0.06 * (i + 1)} className={i === 2 ? "md:col-span-2" : ""}>
              <AgentCard agent={a} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentCard({ agent, hero = false }: { agent: Agent; hero?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const accent = agent.meta.accent;
  // Hero bento cell is large (~560 CSS); the 3 small cells are ~280. Downscale the 1024^2 source to suit.
  const portrait = agentPortraitUrl(agent, hero ? 900 : 600);

  // Tilt-to-cursor (transform only). Disabled on coarse pointers.
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || window.matchMedia("(pointer: coarse)").matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 6).toFixed(2)}deg)`;
  };
  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = "perspective(900px) rotateX(0deg) rotateY(0deg)";
  };

  return (
    <Link
      ref={ref}
      href={`/agents/${agent.agentId}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="group relative flex h-full min-h-[240px] flex-col overflow-hidden rounded-[22px] border transition-[box-shadow] duration-300 will-change-transform hover:shadow-[var(--shadow-card)]"
      style={{
        borderColor: "var(--color-border)",
        background: `color-mix(in oklab, ${accent} 8%, var(--color-paper))`,
      }}
    >
      <div className="relative flex-1 overflow-hidden" style={{ minHeight: hero ? 320 : 150 }}>
        <img
          src={portrait}
          alt={`${agent.name} portrait`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
        <span
          className="tag micro absolute left-4 top-4"
          style={{ background: `color-mix(in oklab, ${accent} 86%, transparent)`, color: "#fff", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", border: `1px solid color-mix(in oklab, #fff 18%, transparent)` }}
        >
          {agent.style}
        </span>
      </div>

      <div className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display" style={{ fontSize: hero ? "clamp(28px, 4vw, 44px)" : 24, lineHeight: 1 }}>
            {agent.name}
          </h3>
          <span className="font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-ink-3)" }}>#{agent.agentId}</span>
        </div>
        <p className="mt-2 text-[16px] leading-snug" style={{ color: "var(--color-ink-2)" }}>
          {agent.meta.tagline}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <Stat value={`${agent.outputCount}`} label="relics" />
          <Stat value={`${agent.salesCount}`} label="sales" />
          <Stat value={`${agent.royaltyPct}%`} label="royalty" />
        </div>
      </div>
    </Link>
  );
}

// One agent stat: mono tabular figure (the proof value) + a small-caps sans label (NOT mono).
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-ink)" }}>{value}</span>
      <span className="label-caps text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.08em" }}>{label}</span>
    </span>
  );
}
