"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import Nav from "../../_components/Nav";
import { FontToggle, HashLine, VerifiedStamp, CheckLine } from "../../_components/Verify";
import { shortAddr } from "../../_lib/format";
import type { ProvenanceResponse } from "@/lib/aura/types";

export default function ProvenancePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<ProvenanceResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");
  const [fontMode, setFontMode] = useState<"block" | "mono">("block");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/provenance/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        setData(j);
        setStatus("ok");
      })
      .catch(() => setStatus("missing"));
  }, [id]);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav active="HOME" />
      <section className="relative px-5 sm:px-8 pt-32 pb-24 max-w-[1240px] mx-auto">
        <div className="mb-8">
          <p className="mono-label mb-3" style={{ color: "var(--color-mag)" }}>
            [ 04 // THE VERIFY ]
          </p>
          <h1 className="font-display" style={{ fontSize: "clamp(2.4rem, 6vw, 4.4rem)", lineHeight: 0.92 }}>
            Provenance, <span className="neon-mag">recomputed.</span>
          </h1>
          <p className="mt-4 max-w-[42rem]" style={{ color: "var(--color-mute)", lineHeight: 1.6 }}>
            Read live from the OutputNFT contract on 0G Galileo, enriched with the generation record,
            and self-checked. The provenance hash is recomputed from the stored record and matched
            against the chain. Nothing here is asserted, all of it is verified.
          </p>
        </div>

        {status === "loading" && (
          <div className="mono-label" style={{ color: "var(--color-faint)" }}>READING CHAIN…<span className="blink" /></div>
        )}
        {status === "missing" && (
          <div className="glow-panel p-8">
            <VerifiedStamp ok={false} label={`TOKEN #${id} NOT ON-CHAIN`} />
            <p className="mt-4" style={{ color: "var(--color-mute)" }}>
              No OutputNFT with this id exists. <Link href="/collection" className="neon-cyan">Browse the collection →</Link>
            </p>
          </div>
        )}

        {status === "ok" && data && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className={`grid lg:grid-cols-[0.8fr_1.2fr] gap-6 ${fontMode === "mono" ? "mono-true" : ""}`}
          >
            {/* ---- left: the artifact + checks ---- */}
            <div className="self-start">
              <div className="crt-monitor scanlines">
                <div className="crt-screen vignette art-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.links.image} alt={`output #${data.tokenId}`} className="block w-full" style={{ aspectRatio: "1 / 1", objectFit: "cover" }} />
                  <span className="absolute top-3 left-3 mono-label px-2 py-1" style={{ fontSize: "1rem", color: "var(--color-mag)", background: "rgba(6,5,13,0.82)" }}>
                    OUTPUT #{data.tokenId} · {data.agent.name}
                  </span>
                </div>
              </div>

              <div className="glow-panel-cyan p-5 mt-5" style={{ background: "var(--color-night)" }}>
                <VerifiedStamp ok={data.verification.teeVerifiedByProvider === true} />
                <p className="mt-3 mb-4" style={{ color: "var(--color-ink)", fontSize: "1rem", lineHeight: 1.5 }}>
                  {data.verification.summary}
                </p>
                <CheckLine ok={data.verification.agentExists}>agent exists in registry</CheckLine>
                <CheckLine ok={data.verification.imageOnChain}>image root committed on-chain</CheckLine>
                <CheckLine ok={data.verification.teeAttestationPresent}>TEE attestation present</CheckLine>
                <CheckLine ok={data.verification.provenanceHashMatches === true}>provenance hash recomputes + matches</CheckLine>
                <CheckLine ok={data.verification.teeVerifiedByProvider === true}>TEE verified by 0G provider</CheckLine>
              </div>
            </div>

            {/* ---- right: the manifest ---- */}
            <div className="glow-panel p-6 sm:p-8 self-start">
              <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
                <p className="mono-label" style={{ color: "var(--color-cyan)" }}>
                  ON-CHAIN MANIFEST
                </p>
                <FontToggle mode={fontMode} setMode={setFontMode} />
              </div>

              <p className="mono-label mb-1 mt-2" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>OUTPUTNFT</p>
              <HashLine label="0G STORAGE ROOT (IMAGE)" value={data.onChain.imageRoot} href={data.links.storageScan} accent="var(--color-amber)" />
              <HashLine label="PROVENANCE HASH" value={data.onChain.provenanceHash} accent="var(--color-mag)" />
              <HashLine label="TEE ATTESTATION" value={data.onChain.teeAttestation} accent="var(--color-cyan)" />

              <p className="mono-label mb-1 mt-5" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>CREATOR AGENT · {data.agent.name} #{data.agent.agentId}</p>
              <HashLine label="MODEL ATTESTATION" value={data.agent.modelAttestation} accent="var(--color-cyan)" />
              <HashLine label="STYLE FINGERPRINT" value={data.agent.styleFingerprint} accent="var(--color-mag)" />
              <HashLine label="ROYALTY RECEIVER (LIVE)" value={data.agent.owner} accent="var(--color-amber)" />

              {data.generation && (
                <>
                  <p className="mono-label mb-1 mt-5" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>GENERATION RECORD</p>
                  <div className="grid grid-cols-2 gap-x-6">
                    <HashLine label="MODEL" value={data.generation.model} accent="var(--color-cyan)" />
                    <HashLine label="VERIFIABILITY" value={String(data.generation.teeVerifiability)} accent="var(--color-cyan)" />
                  </div>
                  <HashLine label="TEE SIGNER" value={data.generation.teeSigner} accent="var(--color-cyan)" />
                  {data.generation.prompt && (
                    <div className="py-2.5">
                      <div className="mono-label mb-1" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>PROMPT</div>
                      <span style={{ color: "var(--color-mute)", fontSize: "1rem", fontFamily: "var(--font-body)" }}>{data.generation.prompt}</span>
                    </div>
                  )}
                </>
              )}

              <div className="flex flex-wrap gap-3 mt-6">
                {data.links.mintTx && (
                  <a href={data.links.mintTx} target="_blank" rel="noreferrer" className="btn-ghost">Mint tx ↗</a>
                )}
                <a href={data.links.storageScan} target="_blank" rel="noreferrer" className="btn-ghost">0G storage ↗</a>
                <Link href={`/royalty/${data.tokenId}`} className="btn-neon">Royalty stream →</Link>
              </div>
            </div>
          </motion.div>
        )}
      </section>
    </main>
  );
}
