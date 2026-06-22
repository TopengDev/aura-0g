"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Nav from "../_components/Nav";
import Reveal from "../_components/Reveal";
import { shortAddr, hexToRgba } from "../_lib/format";
import type { AgentSummary } from "@/lib/aura/types";

// the same coffee-window scene rendered in each agent's style-DNA ("style is the asset")
const canonical = [
  { name: "RISO", key: "riso-style", accent: "#FF5FA2" },
  { name: "NOKTURNE", key: "nokturne-style", accent: "#C8A24B" },
  { name: "MIRAI", key: "mirai-style", accent: "#FF2EC4" },
  { name: "SCRIPTORIUM", key: "scriptorium-style", accent: "#D4AF37" },
];

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((j) => {
        if (live) setAgents(j.agents ?? []);
      })
      .catch(() => {
        if (live) setAgents([]);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav active="AGENTS" />

      {/* header */}
      <section className="relative px-5 sm:px-8 pt-36 pb-8 max-w-[1240px] mx-auto">
        <div
          className="absolute inset-x-0 top-0 h-[420px] pointer-events-none -z-0"
          style={{
            background:
              "radial-gradient(70% 100% at 20% 0%, rgba(45,226,230,0.12), transparent 60%)",
          }}
          aria-hidden
        />
        <Reveal>
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <p className="mono-label mb-3" style={{ color: "var(--color-cyan)" }}>
                [ 02 // THE ROSTER ]
              </p>
              <h1 className="font-display" style={{ fontSize: "clamp(2.6rem, 7vw, 5.2rem)", lineHeight: 0.92 }}>
                The agent <span className="neon-mag">is the asset.</span>
              </h1>
            </div>
            <p className="max-w-[26rem]" style={{ color: "var(--color-mute)", lineHeight: 1.6 }}>
              Four style-DNAs. One coffee window, rendered four ways. The style is not a filter, it
              is an on-chain iNFT, and its royalties belong to whoever holds it.
            </p>
          </div>
        </Reveal>

        {/* same-scene-four-signatures proof strip */}
        <Reveal delay={0.15}>
          <div className="mt-12">
            <p className="mono-label mb-3" style={{ color: "var(--color-faint)" }}>
              SAME PROMPT · FOUR SIGNATURES
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {canonical.map((c, i) => (
                <motion.div
                  key={c.key}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.6 }}
                  className="crt-screen scanlines art-frame relative"
                  style={{ boxShadow: `inset 0 0 0 1px ${hexToRgba(c.accent, 0.4)}, 0 0 30px -14px ${c.accent}` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/image/${c.key}`}
                    alt={`${c.name} rendering of the canonical scene`}
                    className="block w-full object-cover"
                    style={{ aspectRatio: "1 / 1" }}
                    loading="lazy"
                  />
                  <span
                    className="absolute bottom-2 left-2 mono-label px-1.5 py-0.5"
                    style={{ fontSize: "1rem", color: c.accent, background: "rgba(6,5,13,0.82)" }}
                  >
                    {c.name}
                  </span>
                </motion.div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* agent channels */}
      <section className="relative px-5 sm:px-8 pb-32 max-w-[1240px] mx-auto">
        <div className="grid md:grid-cols-2 gap-6 mt-6">
          {agents === null
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            : agents.map((a, i) => <AgentCard key={a.name} a={a} i={i} />)}
        </div>
      </section>
    </main>
  );
}

function AgentCard({ a, i }: { a: AgentSummary; i: number }) {
  const accent = a.meta.accent;
  const lead = a.meta.sampleImages[0];
  const channel = a.minted ? `CH-${String(a.agentId).padStart(2, "0")}` : "CH-??";

  const body = (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: i * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="group relative h-full"
      style={
        {
          ["--agent" as string]: accent,
        } as React.CSSProperties
      }
    >
      <div
        className="relative h-full grid grid-cols-[150px_1fr] sm:grid-cols-[200px_1fr] overflow-hidden transition-transform duration-300 group-hover:-translate-y-1"
        style={{
          background: "linear-gradient(180deg, var(--color-surface), var(--color-night))",
          boxShadow: `inset 0 0 0 1px ${hexToRgba(accent, 0.35)}, 0 0 50px -22px ${accent}`,
        }}
      >
        {/* art panel as a CRT screen */}
        <div className="relative crt-screen scanlines art-frame">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/image/${lead.split("/").pop()}`}
            alt={`${a.name} style sample`}
            className="block w-full h-full object-cover"
            style={{ minHeight: "100%" }}
            loading="lazy"
          />
          <span
            className="absolute top-2 left-2 mono-label px-1.5 py-0.5"
            style={{ fontSize: "1rem", color: accent, background: "rgba(6,5,13,0.82)" }}
          >
            {channel}
          </span>
        </div>

        {/* meta panel */}
        <div className="p-6 flex flex-col">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span
                className="mono-label"
                style={{ fontSize: "1rem", color: a.minted ? "var(--color-cyan)" : "var(--color-faint)" }}
              >
                {a.minted ? "LIVE ON-CHAIN" : "INCOMING"}
              </span>
            </div>
            <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>
              {a.minted ? `#${a.agentId}` : "CATALOG"}
            </span>
          </div>

          <h2
            className="font-display mt-3"
            style={{
              fontSize: "2rem",
              color: accent,
              textShadow: `0 0 18px ${hexToRgba(accent, 0.5)}`,
              lineHeight: 1,
            }}
          >
            {a.name}
          </h2>
          <p className="mt-1" style={{ color: "var(--color-ink)", fontSize: "1rem" }}>
            {a.meta.tagline}
          </p>
          <p
            className="mt-3 flex-1"
            style={{ color: "var(--color-mute)", fontSize: "1rem", lineHeight: 1.55 }}
          >
            {a.meta.aesthetic.split(/[—-]/)[1]?.trim().slice(0, 120) ?? a.meta.aesthetic.slice(0, 120)}…
          </p>

          {/* stat row */}
          <div className="mt-5 pt-4 grid grid-cols-3 gap-2" style={{ borderTop: "1px solid var(--color-edge)" }}>
            <Stat label="ROYALTY" value={`${a.royaltyPct}%`} />
            <Stat label="OUTPUTS" value={String(a.outputCount)} />
            <Stat label="OWNER" value={a.owner ? shortAddr(a.owner) : "—"} mono />
          </div>

          <div className="mt-5">
            {a.minted ? (
              <span
                className="mono-label inline-flex items-center gap-2 transition-colors group-hover:text-[var(--agent)]"
                style={{ fontSize: "1rem", color: "var(--color-ink)" }}
              >
                ENTER CHANNEL <span style={{ color: accent }}>→</span>
              </span>
            ) : (
              <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>
                STYLE-DNA STAGED · MINT PENDING
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );

  return a.minted ? (
    <Link href={`/agents/${a.agentId}`} className="block h-full">
      {body}
    </Link>
  ) : (
    <div className="h-full">{body}</div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        style={{
          fontFamily: mono ? "var(--font-mono)" : "var(--font-display)",
          fontWeight: mono ? 800 : undefined,
          fontSize: mono ? "0.72rem" : "1.1rem",
          color: "var(--color-ink)",
        }}
      >
        {value}
      </div>
      <div className="mono-label mt-0.5" style={{ fontSize: "1rem" }}>
        {label}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      className="h-64 animate-pulse"
      style={{ background: "var(--color-night)", boxShadow: "inset 0 0 0 1px var(--color-edge)" }}
    />
  );
}
