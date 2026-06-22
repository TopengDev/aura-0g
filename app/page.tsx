"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Nav from "./_components/Nav";
import SynthGrid from "./_components/SynthGrid";
import Reveal from "./_components/Reveal";

const tickerItems = [
  "RISO · AGENT #2",
  "7% CREATOR ROYALTY",
  "qwen/qwen-image-edit-2511",
  "TEE-ML ATTESTED",
  "0G STORAGE ROOTED",
  "PROVENANCE ON-CHAIN",
  "ROYALTY FOLLOWS THE AGENT",
  "NOKTURNE · AGENT #1",
];

const word = {
  hidden: { opacity: 0, y: "0.4em", filter: "blur(6px)" },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { delay: 0.15 + i * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function Home() {
  const [stat, setStat] = useState<{ outputs: number; agents: number }>({ outputs: 12, agents: 2 });

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/outputs").then((r) => r.json()).catch(() => null),
      fetch("/api/agents").then((r) => r.json()).catch(() => null),
    ]).then(([o, a]) => {
      if (!live) return;
      setStat({
        outputs: o?.count ?? 12,
        agents: (a?.agents ?? []).filter((x: { minted: boolean }) => x.minted).length || 2,
      });
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav active="HOME" />

      {/* ===================== HERO ===================== */}
      <section className="relative min-h-screen flex items-center">
        <SynthGrid />
        {/* magenta horizon glow behind everything */}
        <div
          className="absolute inset-x-0 bottom-0 h-[55%] pointer-events-none"
          style={{
            background:
              "radial-gradient(80% 60% at 50% 100%, rgba(255,46,151,0.22), transparent 70%)",
          }}
          aria-hidden
        />

        <div className="relative z-10 w-full max-w-[1240px] mx-auto px-5 sm:px-8 pt-28 pb-24 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-8 items-center">
          {/* ---- left: the thesis ---- */}
          <div>
            <motion.p
              className="mono-label mb-7"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.05, duration: 0.8 }}
              style={{ color: "var(--color-cyan)" }}
            >
              VERIFIABLE CREATIVE-AGENT MARKETPLACE
            </motion.p>

            <h1 className="font-display leading-[0.9]" style={{ fontSize: "clamp(3.2rem, 8.5vw, 7rem)" }}>
              {["PROVABLE", "AI ART."].map((w, i) => (
                <motion.span
                  key={w}
                  custom={i}
                  variants={word}
                  initial="hidden"
                  animate="show"
                  className="block"
                  style={i === 1 ? undefined : { color: "var(--color-ink)" }}
                >
                  {i === 1 ? <span className="neon-mag">{w}</span> : w}
                </motion.span>
              ))}
            </h1>

            <motion.p
              custom={2}
              variants={word}
              initial="hidden"
              animate="show"
              className="font-display mt-4"
              style={{ fontSize: "clamp(1.3rem, 3.2vw, 2.1rem)", color: "var(--color-ink)", lineHeight: 1.05 }}
            >
              Royalties that <span className="neon-cyan">follow the agent.</span>
            </motion.p>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.9 }}
              className="mt-7 max-w-[34rem]"
              style={{ color: "var(--color-mute)", fontSize: "1.02rem", lineHeight: 1.65 }}
            >
              Creative agents are iNFTs. They generate art inside a TEE on 0G Compute, so every
              piece ships with provenance you can verify on-chain and a creator royalty that
              travels with the agent on every future sale.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.85, duration: 0.7 }}
              className="mt-10 flex flex-wrap items-center gap-4"
            >
              <Link href="/generate" className="btn-neon">
                Watch it generate
              </Link>
              <Link href="/agents" className="btn-ghost">
                Browse agents
              </Link>
            </motion.div>

            {/* live counters */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.05, duration: 0.8 }}
              className="mt-12 flex gap-10"
            >
              {[
                { n: stat.agents, l: "MINTED AGENTS" },
                { n: stat.outputs, l: "VERIFIED OUTPUTS" },
                { n: "7%", l: "ROYALTY / SALE" },
              ].map((s) => (
                <div key={s.l}>
                  <div
                    className="font-display"
                    style={{ fontSize: "2.2rem", color: "var(--color-ink)", lineHeight: 1 }}
                  >
                    {s.n}
                  </div>
                  <div className="mono-label mt-1" style={{ fontSize: "1rem" }}>
                    {s.l}
                  </div>
                </div>
              ))}
            </motion.div>
          </div>

          {/* ---- right: the CRT showcase ---- */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, filter: "brightness(2.5)" }}
            animate={{ opacity: 1, scale: 1, filter: "brightness(1)" }}
            transition={{ delay: 0.35, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto w-full max-w-[440px]"
          >
            <div className="crt-monitor bob crt-flicker">
              <div className="crt-screen scanlines vignette art-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/api/image/riso-hero"
                  alt="RISO genesis output, the Fennec mascot"
                  className="block w-full h-full object-cover"
                  style={{ aspectRatio: "1 / 1" }}
                />
                {/* corner attestation tag */}
                <div
                  className="absolute top-3 left-3 px-2 py-1 flex items-center"
                  style={{ background: "rgba(6,5,13,0.78)", boxShadow: "inset 0 0 0 1px var(--color-cyan)" }}
                >
                  <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-cyan)" }}>
                    TEE VERIFIED
                  </span>
                </div>
                <div
                  className="absolute bottom-3 right-3 px-2 py-1"
                  style={{ background: "rgba(6,5,13,0.78)", boxShadow: "inset 0 0 0 1px var(--color-mag)" }}
                >
                  <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-mag)" }}>
                    OUTPUT #3 · RISO
                  </span>
                </div>
              </div>
              {/* monitor base label */}
              <div className="flex items-center justify-between px-1 pt-3">
                <span className="mono-label" style={{ fontSize: "1rem" }}>
                  0G COMPUTE · TeeML
                </span>
                <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-mute)" }}>
                  qwen-image-edit
                </span>
              </div>
            </div>
            {/* floating provenance chip */}
            <div
              className="absolute -left-4 sm:-left-10 top-1/2 hidden sm:block glow-panel-cyan px-3 py-2"
              style={{ background: "var(--color-night)" }}
            >
              <div className="mono-label" style={{ fontSize: "1rem", color: "var(--color-cyan)" }}>
                PROVENANCE HASH
              </div>
              <div className="mono-data" style={{ fontSize: "1rem", color: "var(--color-ink)" }}>
                0x56cef5a4…
              </div>
            </div>
          </motion.div>
        </div>

        {/* ---- bottom broadcast ticker ---- */}
        <div
          className="absolute bottom-0 inset-x-0 z-20 border-t overflow-hidden py-3"
          style={{ background: "rgba(6,5,13,0.7)", backdropFilter: "blur(4px)" }}
        >
          <div className="marquee">
            {[...tickerItems, ...tickerItems].map((t, i) => (
              <span
                key={i}
                className="mono-label px-6 flex items-center gap-6"
                style={{ fontSize: "1rem", color: "var(--color-mute)" }}
              >
                {t}
                <span style={{ color: "var(--color-mag)" }}>◆</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ===================== THE WEDGE (thesis strip) ===================== */}
      <section className="relative py-28 px-5 sm:px-8">
        <div className="max-w-[1240px] mx-auto">
          <Reveal>
            <p className="mono-label mb-4" style={{ color: "var(--color-mag)" }}>
              [ THE WEDGE ]
            </p>
            <h2 className="font-display max-w-[20ch]" style={{ fontSize: "clamp(2rem, 5vw, 3.6rem)" }}>
              Three guarantees, <span className="neon-cyan">welded on-chain.</span>
            </h2>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-5 mt-14">
            {[
              {
                i: "01",
                t: "GENERATE",
                accent: "var(--color-cyan)",
                d: "Pick an agent, write a subject. It generates inside a TEE on 0G Compute, and the hardware attests the result. Not a promise, an attestation.",
              },
              {
                i: "02",
                t: "VERIFY",
                accent: "var(--color-mag)",
                d: "Every output is minted with its provenance hash, model attestation, and 0G storage root baked on-chain. Recompute it yourself. It matches.",
              },
              {
                i: "03",
                t: "ROYALTY",
                accent: "var(--color-amber)",
                d: "The creator royalty resolves live to whoever owns the agent. Transfer the agent and the entire future royalty stream follows it. EIP-2981, enforced.",
              },
            ].map((c, idx) => (
              <Reveal key={c.t} delay={idx * 0.12}>
                <div
                  className="glow-panel h-full p-7 scanlines"
                  style={{ minHeight: "16rem" }}
                >
                  <div className="flex items-start justify-between">
                    <span className="index-marker" style={{ color: c.accent }}>
                      {c.i}
                    </span>
                    <span
                      className="mono-label"
                      style={{ fontSize: "1rem", color: c.accent }}
                    >
                      {c.t}
                    </span>
                  </div>
                  <p
                    className="mt-6"
                    style={{ color: "var(--color-mute)", fontSize: "1rem", lineHeight: 1.6 }}
                  >
                    {c.d}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <div className="mt-16 flex flex-wrap items-center gap-4">
              <Link href="/generate" className="btn-neon">
                Run the pipeline
              </Link>
              <span className="mono-label" style={{ color: "var(--color-faint)" }}>
                LIVE ON 0G GALILEO TESTNET · CHAIN 16602
              </span>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
