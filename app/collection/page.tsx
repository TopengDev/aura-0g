"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import Nav from "../_components/Nav";
import { shortAddr } from "../_lib/format";
import type { OutputSummary } from "@/lib/aura/types";

export default function CollectionPage() {
  const [outputs, setOutputs] = useState<OutputSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/outputs")
      .then((r) => r.json())
      .then((j) => setOutputs(j.outputs ?? []))
      .catch(() => setOutputs([]));
  }, []);

  const verified = outputs?.filter((o) => o.teeVerified === true).length ?? 0;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav active="COLLECTION" />
      <section className="relative px-5 sm:px-8 pt-32 pb-28 max-w-[1240px] mx-auto">
        <div className="flex items-end justify-between flex-wrap gap-6 mb-10">
          <div>
            <p className="mono-label mb-3" style={{ color: "var(--color-cyan)" }}>
              [ 06 // THE CONTACT SHEET ]
            </p>
            <h1 className="font-display" style={{ fontSize: "clamp(2.4rem, 6vw, 4.4rem)", lineHeight: 0.92 }}>
              Every output, <span className="neon-cyan">on-chain.</span>
            </h1>
          </div>
          {outputs && (
            <div className="flex gap-8">
              <Stat n={outputs.length} l="OUTPUTS" />
              <Stat n={verified} l="TEE VERIFIED" />
            </div>
          )}
        </div>

        {!outputs ? (
          <div className="mono-label" style={{ color: "var(--color-faint)" }}>READING CHAIN…<span className="blink" /></div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {outputs.map((o, i) => (
              <motion.div
                key={o.tokenId}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-30px" }}
                transition={{ delay: (i % 4) * 0.06, duration: 0.55 }}
              >
                <Link href={`/provenance/${o.tokenId}`} className="group block">
                  <div className="relative crt-screen scanlines art-frame" style={{ boxShadow: "inset 0 0 0 1px var(--color-edge)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={o.imageUrl}
                      alt={`output #${o.tokenId}`}
                      className="block w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      style={{ aspectRatio: "1 / 1" }}
                      loading="lazy"
                    />
                    <div className="absolute top-2 left-2 flex items-center px-1.5 py-0.5" style={{ background: "rgba(6,5,13,0.82)" }}>
                      <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-ink)" }}>#{o.tokenId}</span>
                    </div>
                    {/* hover meta */}
                    <div
                      className="absolute inset-x-0 bottom-0 p-2.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "linear-gradient(0deg, rgba(6,5,13,0.95), transparent)" }}
                    >
                      <div className="mono-label" style={{ fontSize: "1rem", color: "var(--color-mag)" }}>{o.agentName}{o.label ? ` · ${o.label}` : ""}</div>
                      <div className="mono-label mt-0.5" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>{o.royalty.pct}% ROY → {shortAddr(o.royalty.receiver)}</div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        <div className="mt-12 flex flex-wrap gap-4 items-center">
          <Link href="/generate" className="btn-neon">Generate a new one →</Link>
          <span className="mono-label" style={{ color: "var(--color-faint)" }}>CLICK ANY PIECE FOR ITS PROVENANCE</span>
        </div>
      </section>
    </main>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div>
      <div className="font-display" style={{ fontSize: "2rem", color: "var(--color-ink)", lineHeight: 1 }}>{n}</div>
      <div className="mono-label mt-1" style={{ fontSize: "1rem" }}>{l}</div>
    </div>
  );
}
