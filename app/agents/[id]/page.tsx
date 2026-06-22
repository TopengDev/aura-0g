"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import Nav from "../../_components/Nav";
import { FontToggle, HashLine, VerifiedStamp } from "../../_components/Verify";
import { shortAddr, hexToRgba } from "../../_lib/format";
import type { AgentDetail } from "@/lib/aura/types";

export default function AgentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [a, setA] = useState<AgentDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");
  const [fontMode, setFontMode] = useState<"block" | "mono">("block");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/agents/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        setA(j);
        setStatus("ok");
      })
      .catch(() => setStatus("missing"));
  }, [id]);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav active="AGENTS" />
      <section className="relative px-5 sm:px-8 pt-32 pb-24 max-w-[1240px] mx-auto">
        <Link href="/agents" className="mono-label" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>
          ← ALL AGENTS
        </Link>

        {status === "loading" && <div className="mono-label mt-8" style={{ color: "var(--color-faint)" }}>READING REGISTRY…<span className="blink" /></div>}
        {status === "missing" && (
          <div className="glow-panel p-8 mt-8">
            <VerifiedStamp ok={false} label={`AGENT #${id} NOT MINTED`} />
            <p className="mt-4" style={{ color: "var(--color-mute)" }}>This agent is catalog-only. <Link href="/agents" className="neon-cyan">Back to the roster →</Link></p>
          </div>
        )}

        {status === "ok" && a && (
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className={fontMode === "mono" ? "mono-true" : ""}>
            <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-8 mt-6">
              {/* identity */}
              <div className="self-start">
                <div className="crt-monitor scanlines">
                  <div className="crt-screen vignette art-frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/image/${a.meta.sampleImages[0].split("/").pop()}`} alt={a.name} className="block w-full" style={{ aspectRatio: "1 / 1", objectFit: "cover" }} />
                    <span className="absolute top-3 left-3 mono-label px-2 py-1" style={{ fontSize: "1rem", color: a.meta.accent, background: "rgba(6,5,13,0.82)" }}>
                      CH-{String(a.agentId).padStart(2, "0")}
                    </span>
                  </div>
                </div>
                {/* sample row */}
                <div className="grid grid-cols-4 gap-2 mt-3">
                  {a.meta.sampleImages.slice(1, 5).map((s) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={s} src={`/api/image/${s.split("/").pop()}`} alt="sample" className="block w-full art-frame" style={{ aspectRatio: "1 / 1", objectFit: "cover" }} loading="lazy" />
                  ))}
                </div>
              </div>

              {/* dossier */}
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <VerifiedStamp ok label={`LIVE · #${a.agentId}`} />
                  <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-mute)" }}>{a.royaltyPct}% ROYALTY</span>
                </div>
                <h1 className="font-display" style={{ fontSize: "clamp(3rem, 8vw, 6rem)", color: a.meta.accent, textShadow: `0 0 28px ${hexToRgba(a.meta.accent, 0.5)}`, lineHeight: 0.9 }}>
                  {a.name}
                </h1>
                <p className="mt-2" style={{ color: "var(--color-ink)", fontSize: "1.05rem" }}>{a.meta.tagline}</p>
                <p className="mt-4 max-w-[42rem]" style={{ color: "var(--color-mute)", lineHeight: 1.6, fontSize: "1rem" }}>{a.meta.aesthetic}</p>
                {a.meta.signatureCharacter && (
                  <p className="mt-3 max-w-[42rem]" style={{ color: "var(--color-mute)", lineHeight: 1.6, fontSize: "1rem" }}>
                    <span className="mono-label" style={{ color: a.meta.accent }}>CHARACTER · </span>{a.meta.signatureCharacter}
                  </p>
                )}

                {/* style-DNA */}
                <div className="glow-panel p-5 sm:p-6 mt-7">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                    <p className="mono-label" style={{ color: "var(--color-cyan)" }}>STYLE-DNA · ON-CHAIN</p>
                    <FontToggle mode={fontMode} setMode={setFontMode} />
                  </div>
                  <HashLine label="STYLE FINGERPRINT" value={a.styleFingerprint ?? "n/a"} accent="var(--color-mag)" />
                  <HashLine label="MODEL ATTESTATION" value={a.modelAttestation ?? "n/a"} accent="var(--color-cyan)" />
                  <HashLine label="ENCRYPTED BRAIN ROOT (0G)" value={a.encBrainRoot ?? "n/a"} accent="var(--color-amber)" />
                  <HashLine label="OWNER · ROYALTY RECEIVER" value={a.owner ?? "n/a"} accent="var(--color-amber)" />
                  <div className="py-2.5">
                    <div className="mono-label mb-1" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>MODEL</div>
                    <span className="raw-hash" style={{ color: "var(--color-ink)", fontSize: "1rem" }}>{a.meta.model}</span>
                  </div>
                  <div className="flex gap-3 mt-4">
                    <Link href="/generate" className="btn-neon">Generate with {a.name} →</Link>
                  </div>
                </div>
              </div>
            </div>

            {/* its outputs */}
            <div className="mt-12">
              <p className="mono-label mb-4" style={{ color: "var(--color-faint)" }}>{a.outputs.length} OUTPUTS BY {a.name}</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-3">
                {a.outputs.map((t) => (
                  <Link key={t} href={`/provenance/${t}`} className="group block">
                    <div className="relative crt-screen scanlines art-frame" style={{ boxShadow: "inset 0 0 0 1px var(--color-edge)" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/image/output-${t}`} alt={`output #${t}`} className="block w-full object-cover transition-transform duration-500 group-hover:scale-105" style={{ aspectRatio: "1 / 1" }} loading="lazy" />
                      <span className="absolute top-1.5 left-1.5 mono-label px-1 py-0.5" style={{ fontSize: "1rem", color: "var(--color-ink)", background: "rgba(6,5,13,0.82)" }}>#{t}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </section>
    </main>
  );
}
