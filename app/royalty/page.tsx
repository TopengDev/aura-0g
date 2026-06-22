"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import Nav from "../_components/Nav";
import SynthGrid from "../_components/SynthGrid";
import Reveal from "../_components/Reveal";
import { shortAddr } from "../_lib/format";

interface RoyaltyDemo {
  marketTokenId: number;
  price: string;
  royaltyFollowsAgent: {
    receiverBeforeTransfer: string;
    receiverAfterTransfer: string;
    agentTransferTx: string;
    backToMainTx: string;
  };
  sale: {
    split: {
      price: string;
      royaltyPaid: string;
      royaltyReceiver: string;
      platformFee: string;
      sellerProceeds: string;
      seller: string;
      buyer: string;
    };
  };
}
interface RoyaltyResp {
  agentName: string;
  royaltyPct: number;
  samples: { salePrice: string; royaltyAmount: string }[];
  thesis: string;
}

export default function RoyaltyPage() {
  const [demo, setDemo] = useState<RoyaltyDemo | null>(null);
  const [roy, setRoy] = useState<RoyaltyResp | null>(null);
  const [transferred, setTransferred] = useState(false);

  useEffect(() => {
    fetch("/api/marketplace").then((r) => r.json()).then((j) => setDemo(j.royaltyDemo)).catch(() => {});
    fetch("/api/royalty/4").then((r) => r.json()).then(setRoy).catch(() => {});
  }, []);

  const fa = demo?.royaltyFollowsAgent;
  const receiver = transferred ? fa?.receiverAfterTransfer : fa?.receiverBeforeTransfer;
  const owner = transferred ? "NEW HOLDER" : "GENESIS HOLDER";

  return (
    <main className="relative min-h-screen overflow-hidden">
      <Nav active="ROYALTY" />
      <SynthGrid className="opacity-30" />
      <section className="relative px-5 sm:px-8 pt-32 pb-28 max-w-[1240px] mx-auto">
        <div className="mb-12">
          <p className="mono-label mb-3" style={{ color: "var(--color-amber)" }}>
            [ 05 // THE MONEY SHOT ]
          </p>
          <h1 className="font-display" style={{ fontSize: "clamp(2.4rem, 6.5vw, 4.8rem)", lineHeight: 0.92 }}>
            The royalty <span className="neon-amber">follows the agent.</span>
          </h1>
          <p className="mt-4 max-w-[44rem]" style={{ color: "var(--color-mute)", lineHeight: 1.6 }}>
            EIP-2981 royaltyInfo resolves live to ownerOf(agent). Transfer the agent iNFT and its
            entire future royalty stream re-routes to the new holder. Not a database row, a property
            of the chain. Proven on 0G with real transactions below.
          </p>
        </div>

        {/* ---- the interactive re-route ---- */}
        <Reveal>
          <div className="glow-panel p-6 sm:p-10 scanlines">
            <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
              <p className="mono-label" style={{ color: "var(--color-cyan)" }}>EIP-2981 · ROYALTYINFO → OWNEROF(AGENT #2)</p>
              <button onClick={() => setTransferred((v) => !v)} className="btn-neon">
                ⇄ {transferred ? "RETURN AGENT" : "TRANSFER AGENT"}
              </button>
            </div>

            <div className="grid md:grid-cols-[1fr_auto_1fr] items-center gap-6">
              {/* agent */}
              <div className="glow-panel-cyan p-5 text-center" style={{ background: "var(--color-night)" }}>
                <div className="mono-label mb-2" style={{ fontSize: "1rem", color: "var(--color-cyan)" }}>THE AGENT iNFT</div>
                <div className="font-display neon-mag" style={{ fontSize: "2rem" }}>RISO #2</div>
                <div className="mono-label mt-2" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>{owner}</div>
              </div>

              {/* flow arrow */}
              <div className="flex flex-col items-center px-2">
                <motion.div
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1.6, repeat: Infinity }}
                  className="mono-label"
                  style={{ fontSize: "1rem", color: "var(--color-amber)", letterSpacing: "0.2em" }}
                >
                  ROYALTY
                </motion.div>
                <div style={{ width: 90, height: 2, background: "linear-gradient(90deg, var(--color-mag), var(--color-amber))", boxShadow: "0 0 10px var(--color-amber)" }} />
                <div className="mono-label" style={{ fontSize: "1.2rem", color: "var(--color-amber)" }}>→</div>
              </div>

              {/* receiver (re-routes) */}
              <div className="p-5 text-center" style={{ background: "var(--color-night)", boxShadow: `inset 0 0 0 1px ${transferred ? "var(--color-amber)" : "var(--color-edge)"}`, transition: "box-shadow .4s" }}>
                <div className="mono-label mb-2" style={{ fontSize: "1rem", color: "var(--color-amber)" }}>ROYALTY RECEIVER (LIVE)</div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={receiver}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4 }}
                    className="raw-hash"
                    style={{ fontSize: "1.1rem", color: "var(--color-ink)" }}
                  >
                    {shortAddr(receiver)}
                  </motion.div>
                </AnimatePresence>
                <div className="mono-label mt-2" style={{ fontSize: "1rem", color: transferred ? "var(--color-amber)" : "var(--color-faint)" }}>
                  {transferred ? "RE-ROUTED ✓" : "GENESIS OWNER"}
                </div>
              </div>
            </div>

            {fa && (
              <div className="flex flex-wrap gap-3 mt-7 justify-center">
                <a href={fa.agentTransferTx} target="_blank" rel="noreferrer" className="btn-ghost">Agent transfer tx ↗</a>
                <a href={fa.backToMainTx} target="_blank" rel="noreferrer" className="btn-ghost">Return tx ↗</a>
              </div>
            )}
          </div>
        </Reveal>

        {/* ---- the sale split ---- */}
        {demo && (
          <Reveal delay={0.1}>
            <div className="mt-6 glow-panel p-6 sm:p-10">
              <p className="mono-label mb-2" style={{ color: "var(--color-mag)" }}>A REAL SALE · OUTPUT #{demo.marketTokenId} · {demo.sale.split.price}</p>
              <h2 className="font-display mb-8" style={{ fontSize: "clamp(1.4rem, 3vw, 2.2rem)" }}>
                Where {demo.sale.split.price} goes.
              </h2>
              <SplitBar label="CREATOR ROYALTY" amount={demo.sale.split.royaltyPaid} pctOfPrice={7} to={demo.sale.split.royaltyReceiver} color="var(--color-amber)" highlight />
              <SplitBar label="PLATFORM FEE" amount={demo.sale.split.platformFee} pctOfPrice={2.5} to={demo.sale.split.seller} color="var(--color-mag)" />
              <SplitBar label="SELLER PROCEEDS" amount={demo.sale.split.sellerProceeds} pctOfPrice={90.5} to={demo.sale.split.seller} color="var(--color-cyan)" />
              <p className="mono-label mt-5" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>
                ROYALTY PAID TO THE CURRENT AGENT OWNER {shortAddr(demo.sale.split.royaltyReceiver)} · ENFORCED IN THE MARKETPLACE CONTRACT
              </p>
            </div>
          </Reveal>
        )}

        {/* ---- royalty calculator ---- */}
        {roy && (
          <Reveal delay={0.15}>
            <div className="mt-6 grid sm:grid-cols-3 gap-4">
              {roy.samples.map((s) => (
                <div key={s.salePrice} className="glow-panel-cyan p-6 text-center" style={{ background: "var(--color-night)" }}>
                  <div className="mono-label" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>SALE {s.salePrice}</div>
                  <div className="font-display neon-amber mt-2" style={{ fontSize: "2.2rem" }}>{s.royaltyAmount.replace(" 0G", "")}</div>
                  <div className="mono-label mt-1" style={{ fontSize: "1rem", color: "var(--color-amber)" }}>0G TO THE AGENT OWNER · {roy.royaltyPct}%</div>
                </div>
              ))}
            </div>
          </Reveal>
        )}

        <Reveal delay={0.2}>
          <div className="mt-10 flex flex-wrap gap-4 items-center">
            <Link href="/collection" className="btn-neon">See the collection →</Link>
            <span className="mono-label" style={{ color: "var(--color-faint)" }}>EVERY OUTPUT OF AGENT #2 SHARES THIS ROYALTY STREAM</span>
          </div>
        </Reveal>
      </section>
    </main>
  );
}

function SplitBar({ label, amount, pctOfPrice, to, color, highlight }: { label: string; amount: string; pctOfPrice: number; to: string; color: string; highlight?: boolean }) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-1.5">
        <span className="mono-label" style={{ fontSize: "1rem", color: highlight ? color : "var(--color-mute)" }}>{label}</span>
        <span className="raw-hash" style={{ fontSize: "1rem", color: "var(--color-ink)" }}>{amount}</span>
      </div>
      <div style={{ height: 10, background: "var(--color-void)", boxShadow: "inset 0 0 0 1px var(--color-edge)" }}>
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${pctOfPrice}%` }}
          viewport={{ once: true }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          style={{ height: "100%", background: color, boxShadow: highlight ? `0 0 14px ${color}` : "none" }}
        />
      </div>
      <div className="mono-label mt-1" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>→ {shortAddr(to)}</div>
    </div>
  );
}
