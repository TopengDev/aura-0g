"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import Nav from "../_components/Nav";
import SynthGrid from "../_components/SynthGrid";
import { FontToggle, HashLine, VerifiedStamp } from "../_components/Verify";
import type { AgentSummary, GenerateJob, MintResponse } from "@/lib/aura/types";

type Phase = "idle" | "submitting" | "polling" | "done" | "minting" | "minted" | "error";

const STAGE_LINE: Record<string, string> = {
  pending: "QUEUEING JOB ON 0G COMPUTE",
  generating: "GENERATING INSIDE THE TEE",
  verifying: "VERIFYING HARDWARE ATTESTATION",
  storing: "ROOTING IMAGE ON 0G STORAGE",
  done: "TRANSMISSION COMPLETE",
  error: "TRANSMISSION FAULT",
};
const STAGES = ["pending", "generating", "verifying", "storing", "done"];

export default function GeneratePage() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agent, setAgent] = useState<string>("RISO");
  const [prompt, setPrompt] = useState("wearing a tiny detective trench coat, noir mood");
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<GenerateJob | null>(null);
  const [mint, setMint] = useState<MintResponse | null>(null);
  const [err, setErr] = useState<string>("");
  const [elapsed, setElapsed] = useState(0);
  const [fontMode, setFontMode] = useState<"block" | "mono">("block");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((j) => setAgents((j.agents ?? []).filter((a: AgentSummary) => a.minted)))
      .catch(() => {});
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // elapsed timer while polling
  useEffect(() => {
    if (phase !== "polling") return;
    const t = setInterval(() => setElapsed((Date.now() - startRef.current) / 1000), 200);
    return () => clearInterval(t);
  }, [phase]);

  async function transmit() {
    setErr("");
    setMint(null);
    setJob(null);
    setPhase("submitting");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent, prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || `generate failed (${res.status})`);
        setPhase("error");
        return;
      }
      startRef.current = Date.now();
      setElapsed(0);
      setPhase("polling");
      pollRef.current = setInterval(() => poll(data.jobId), 2200);
      poll(data.jobId);
    } catch (e) {
      setErr(String(e));
      setPhase("error");
    }
  }

  async function poll(jobId: string) {
    try {
      const res = await fetch(`/api/generate/${jobId}`);
      const data: GenerateJob = await res.json();
      setJob(data);
      if (data.status === "done") {
        if (pollRef.current) clearInterval(pollRef.current);
        setPhase("done");
      } else if (data.status === "error") {
        if (pollRef.current) clearInterval(pollRef.current);
        setErr(data.error || "generation error");
        setPhase("error");
      }
    } catch {
      /* keep polling through transient errors */
    }
  }

  async function doMint() {
    if (!job) return;
    setPhase("minting");
    try {
      const res = await fetch("/api/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.jobId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || `mint failed (${res.status})`);
        setPhase("error");
        return;
      }
      setMint(data);
      setPhase("minted");
    } catch (e) {
      setErr(String(e));
      setPhase("error");
    }
  }

  const busy = phase === "polling" || phase === "submitting";
  const result = job?.result ?? null;
  const stageIdx = job ? STAGES.indexOf(job.status) : 0;

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav active="GENERATE" />

      <section className="relative px-5 sm:px-8 pt-32 pb-24 max-w-[1240px] mx-auto">
        <div className="mb-10">
          <p className="mono-label mb-3" style={{ color: "var(--color-cyan)" }}>
            [ 03 // THE TRANSMISSION ]
          </p>
          <h1 className="font-display" style={{ fontSize: "clamp(2.4rem, 6vw, 4.4rem)", lineHeight: 0.92 }}>
            Watch it generate <span className="neon-cyan">inside the TEE.</span>
          </h1>
          <p className="mt-4 max-w-[40rem]" style={{ color: "var(--color-mute)", lineHeight: 1.6 }}>
            Generation runs on 0G Compute inside a Trusted Execution Environment. The ~50 seconds is
            not a loading screen, it is the hardware producing an attestation you can verify.
          </p>
        </div>

        <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-6">
          {/* ---- control panel ---- */}
          <div className="glow-panel p-6 scanlines self-start">
            <p className="mono-label mb-4" style={{ color: "var(--color-mag)" }}>
              CONTROL // SELECT AGENT
            </p>
            <div className="grid grid-cols-2 gap-2 mb-6">
              {agents.map((a) => {
                const on = agent === a.name;
                return (
                  <button
                    key={a.name}
                    onClick={() => setAgent(a.name)}
                    disabled={busy}
                    className="text-left p-3 transition-all"
                    style={{
                      background: on ? "color-mix(in oklch, var(--color-mag) 14%, transparent)" : "var(--color-night)",
                      boxShadow: `inset 0 0 0 1px ${on ? a.meta.accent : "var(--color-edge)"}`,
                    }}
                  >
                    <div className="font-display" style={{ fontSize: "1.1rem", color: on ? a.meta.accent : "var(--color-ink)" }}>
                      {a.name}
                    </div>
                    <div className="mono-label mt-0.5" style={{ fontSize: "1rem" }}>
                      #{a.agentId} · {a.royaltyPct}% ROY
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mono-label mb-2" style={{ color: "var(--color-mag)" }}>
              PROMPT // SUBJECT
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value.slice(0, 600))}
              disabled={busy}
              rows={3}
              className="w-full p-3 resize-none outline-none"
              style={{
                background: "var(--color-void)",
                color: "var(--color-ink)",
                fontFamily: "var(--font-body)",
                fontSize: "1rem",
                boxShadow: "inset 0 0 0 1px var(--color-edge)",
              }}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>
                {prompt.length}/600
              </span>
            </div>

            <button onClick={transmit} disabled={busy || !prompt.trim()} className="btn-neon w-full mt-5" style={{ opacity: busy ? 0.6 : 1 }}>
              {busy ? "TRANSMITTING…" : "▶ TRANSMIT"}
            </button>
            {phase === "error" && (
              <p className="mono-data mt-3" style={{ color: "var(--color-sunset)", fontSize: "1rem" }}>
                FAULT: {err}
              </p>
            )}
          </div>

          {/* ---- broadcast monitor ---- */}
          <div className="relative">
            <div className="crt-monitor scanlines">
              <div className="crt-screen vignette art-frame relative" style={{ aspectRatio: "1 / 1", minHeight: 320 }}>
                {/* the live image (preview when done) or the broadcast field */}
                {result ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={result.imageUrl} alt="generated preview" className="block w-full h-full object-cover" />
                ) : (
                  <BroadcastField active={busy} stageIdx={stageIdx} />
                )}

                {/* status overlay */}
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                  <span
                    className="mono-label px-2 py-1 flex items-center"
                    style={{ fontSize: "1rem", color: "var(--color-cyan)", background: "rgba(6,5,13,0.8)" }}
                  >
                    {phase === "idle" ? "STANDBY" : (STAGE_LINE[job?.status ?? "pending"] ?? "WORKING")}
                  </span>
                  {busy && (
                    <span className="mono-label px-2 py-1" style={{ fontSize: "1rem", color: "var(--color-ink)", background: "rgba(6,5,13,0.8)" }}>
                      {elapsed.toFixed(1)}s
                    </span>
                  )}
                </div>
              </div>

              {/* stage rail */}
              <div className="flex items-center gap-1 px-1 pt-3">
                {STAGES.slice(0, 4).map((s, i) => (
                  <div key={s} className="flex-1">
                    <div
                      className="h-0.5"
                      style={{
                        background: i <= stageIdx && busy ? "var(--color-cyan)" : i < stageIdx || phase === "done" || phase === "minted" ? "var(--color-cyan)" : "var(--color-edge)",
                        boxShadow: i <= stageIdx && busy ? "0 0 8px var(--color-cyan)" : "none",
                      }}
                    />
                    <div className="mono-label mt-1" style={{ fontSize: "1rem", color: i <= stageIdx ? "var(--color-mute)" : "var(--color-faint)" }}>
                      {s.toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ---- the VERIFY reveal ---- */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className={`mt-8 glow-panel-cyan ${fontMode === "mono" ? "mono-true" : ""}`}
              style={{ background: "var(--color-night)" }}
            >
              <div className="p-6 sm:p-8">
                <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
                  <div>
                    <p className="mono-label mb-2" style={{ color: "var(--color-cyan)" }}>
                      THE VERIFY // HARDWARE ATTESTATION
                    </p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <VerifiedStamp ok={result.teeVerified === true} />
                      <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-mute)" }}>
                        {result.model} · {result.verifiability} · {result.latencyMs}ms
                      </span>
                    </div>
                  </div>
                  <FontToggle mode={fontMode} setMode={setFontMode} />
                </div>

                <div className="grid sm:grid-cols-2 gap-x-8">
                  <div>
                    <HashLine label="TEE SIGNER" value={result.teeSigner} accent="var(--color-cyan)" />
                    <HashLine label="PROVENANCE HASH" value={result.provenanceHash} accent="var(--color-mag)" />
                    <HashLine label="TEE ATTESTATION" value={result.teeAttestation} accent="var(--color-cyan)" />
                  </div>
                  <div>
                    <HashLine label="0G STORAGE ROOT" value={result.imageRoot} accent="var(--color-amber)" />
                    <div className="grid grid-cols-2 gap-4 py-2.5">
                      <div>
                        <div className="mono-label mb-1" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>SEED</div>
                        <span className="raw-hash" style={{ color: "var(--color-ink)", fontSize: "1rem" }}>{result.seed}</span>
                      </div>
                      <div>
                        <div className="mono-label mb-1" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>AGENT</div>
                        <span className="raw-hash" style={{ color: "var(--color-ink)", fontSize: "1rem" }}>{job?.agentName} #{job?.agentId}</span>
                      </div>
                    </div>

                    {/* mint action */}
                    <div className="mt-4">
                      {phase === "minted" && mint ? (
                        <div>
                          <VerifiedStamp ok label={`MINTED · OUTPUT #${mint.tokenId}`} />
                          <div className="flex flex-wrap gap-3 mt-4">
                            <Link href={`/provenance/${mint.tokenId}`} className="btn-neon">
                              View provenance →
                            </Link>
                            <a href={mint.explorerUrl} target="_blank" rel="noreferrer" className="btn-ghost">
                              On-chain tx
                            </a>
                          </div>
                        </div>
                      ) : (
                        <button onClick={doMint} disabled={phase === "minting"} className="btn-neon w-full">
                          {phase === "minting" ? "MINTING ON-CHAIN…" : "⊕ MINT THIS OUTPUT"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
      <SynthGrid className="opacity-40" />
    </main>
  );
}

// The animated "generating inside the TEE" field shown while polling.
function BroadcastField({ active, stageIdx }: { active: boolean; stageIdx: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "radial-gradient(circle at 50% 50%, #0c0a18, #050409)" }}>
      <div className="halftone absolute inset-0" style={{ opacity: 0.12 }} />
      {/* concentric pulse rings */}
      {active &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{ border: "1px solid var(--color-mag)" }}
            initial={{ width: 60, height: 60, opacity: 0.6 }}
            animate={{ width: 360, height: 360, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
          />
        ))}
      <div className="relative text-center">
        <div className="font-display neon-mag" style={{ fontSize: "2.6rem" }}>
          {active ? "TEE" : "▶"}
        </div>
        <div className="mono-label mt-2 blink" style={{ fontSize: "1rem", color: "var(--color-cyan)" }}>
          {active ? `STAGE ${Math.max(1, stageIdx + 1)}/4` : "READY TO TRANSMIT"}
        </div>
      </div>
    </div>
  );
}
