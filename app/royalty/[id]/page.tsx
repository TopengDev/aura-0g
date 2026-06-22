"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import Nav from "../../_components/Nav";
import { shortAddr } from "../../_lib/format";
import type { RoyaltyResponse } from "@/lib/aura/types";

export default function TokenRoyaltyPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [r, setR] = useState<RoyaltyResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing">("loading");

  useEffect(() => {
    if (!id) return;
    fetch(`/api/royalty/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((j) => {
        setR(j);
        setStatus("ok");
      })
      .catch(() => setStatus("missing"));
  }, [id]);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav active="ROYALTY" />
      <section className="relative px-5 sm:px-8 pt-32 pb-24 max-w-[1000px] mx-auto">
        <Link href={`/provenance/${id}`} className="mono-label" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>
          ← OUTPUT #{id} PROVENANCE
        </Link>

        {status === "loading" && <div className="mono-label mt-8" style={{ color: "var(--color-faint)" }}>READING ROYALTY…<span className="blink" /></div>}
        {status === "missing" && <div className="mono-label mt-8" style={{ color: "var(--color-sunset)" }}>NO ROYALTY DATA FOR #{id}</div>}

        {status === "ok" && r && (
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="mt-6">
            <p className="mono-label mb-3" style={{ color: "var(--color-amber)" }}>[ 05 // ROYALTY STREAM · OUTPUT #{r.tokenId} ]</p>
            <h1 className="font-display" style={{ fontSize: "clamp(2rem, 5vw, 3.6rem)", lineHeight: 0.95 }}>
              {r.royaltyPct}% to <span className="neon-amber">{r.agentName}&apos;s</span> owner, forever.
            </h1>

            <div className="glow-panel p-6 mt-7">
              <div className="flex items-center justify-between py-2.5" style={{ borderBottom: "1px solid var(--color-edge)" }}>
                <span className="mono-label" style={{ color: "var(--color-cyan)" }}>LIVE RECEIVER (EIP-2981)</span>
                <span className="raw-hash" style={{ color: "var(--color-ink)", fontSize: "1rem" }}>{shortAddr(r.receiver)}</span>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <span className="mono-label" style={{ color: "var(--color-faint)" }}>RECEIVER IS THE AGENT OWNER</span>
                <span className="mono-label" style={{ color: r.receiverIsAgentOwner ? "var(--color-cyan)" : "var(--color-sunset)" }}>{r.receiverIsAgentOwner ? "[x] YES" : "[ ] NO"}</span>
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-4 mt-6">
              {r.samples.map((s) => (
                <div key={s.salePrice} className="glow-panel-cyan p-5 text-center" style={{ background: "var(--color-night)" }}>
                  <div className="mono-label" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>SALE {s.salePrice}</div>
                  <div className="font-display neon-amber mt-2" style={{ fontSize: "1.8rem" }}>{s.royaltyAmount.replace(" 0G", "")}</div>
                  <div className="mono-label mt-1" style={{ fontSize: "1rem", color: "var(--color-amber)" }}>0G ROYALTY</div>
                </div>
              ))}
            </div>

            <p className="mt-7 max-w-[44rem]" style={{ color: "var(--color-mute)", lineHeight: 1.65, fontSize: "1rem" }}>{r.thesis}</p>

            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/royalty" className="btn-neon">See the money shot →</Link>
              <Link href="/collection" className="btn-ghost">The collection</Link>
            </div>
          </motion.div>
        )}
      </section>
    </main>
  );
}
