"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { zeroG } from "@/components/atoms/ZeroG";

// The "behind the scenes" of one AURA op. Generate = the full provenance pipeline (sign the mint
// auth, generate inside a TEE on 0G Compute, attest with the TeeML signer, store on 0G Storage,
// mint the OutputNFT). Verify = the recall side (resolve root, check attestation, confirm royalty).
// Steps light up in sequence, synced to the terminal's generate / the browser's recall. Real values.
const STEPS = {
  generate: [
    { label: "sign", detail: "EIP-712 mint auth · sponsor" },
    { label: "generate", detail: "0G Compute · TEE (qwen-image)" },
    { label: "attest", detail: "TeeML signer 0x2A94…2e69" },
    { label: "store", detail: "0G Storage · root 0xe3cd…b6f3" },
    { label: "mint", detail: "OutputNFT · tx 0x9f40…0bc6" },
  ],
  verify: [
    { label: "resolve", detail: "0G Storage · root 0xe3cd…b6f3" },
    { label: "attestation", detail: "TeeML · 0x9b22…d419 ✓" },
    { label: "provenance", detail: "hash 0x66f2…f1ae" },
    { label: "royalty", detail: "creator 7% · follows resale" },
    { label: "verified", detail: "NOKTURNE #6 · authentic" },
  ],
} as const;

const FOOTER = {
  generate: "generated in a TEE and stored on 0G as a verifiable Relic, minted with provenance and a creator royalty.",
  verify: "every field is checkable on-chain. provenance and royalties follow the work forever.",
};

const STEP_MS = 1050;

export function ProcessPanel({
  play,
  variant = "generate",
  startDelay = 0,
}: {
  play: boolean;
  variant?: "generate" | "verify";
  startDelay?: number;
}) {
  const steps = STEPS[variant];
  const [done, setDone] = useState(0);

  useEffect(() => {
    if (!play) {
      setDone(0);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < steps.length; i++) {
      const n = i + 1;
      timers.push(setTimeout(() => setDone(n), startDelay + i * STEP_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [play, variant, startDelay, steps.length]);

  return (
    <div
      className="flex h-full flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-paper)] p-4 shadow-[var(--shadow-card)]"
      style={{ fontFamily: "var(--font-body)" }}
    >
      <div className="mb-3 flex items-center gap-2 font-mono-x text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-3)]">
        <span className="h-2 w-2 rounded-[2px]" style={{ background: "var(--color-accent)" }} />
        behind the scenes · {variant === "generate" ? "minting" : "verifying"}
      </div>

      <div className="flex-1">
        {steps.map((s, i) => {
          const isDone = i < done;
          const isLast = i === steps.length - 1;
          return (
            <div key={s.label} className="relative flex gap-3 pb-3 last:pb-0">
              {!isLast && (
                <span
                  className="absolute left-[7px] top-4 bottom-0 w-px"
                  style={{ background: isDone ? "var(--color-accent)" : "var(--color-border)" }}
                />
              )}
              <motion.span
                className="relative z-10 mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border text-[8px]"
                animate={{
                  borderColor: isDone ? "var(--color-accent)" : "var(--color-border-strong)",
                  backgroundColor: isDone ? "var(--color-accent)" : "rgba(0,0,0,0)",
                }}
                transition={{ duration: 0.3 }}
              >
                {isDone && <span style={{ color: "var(--color-cream)" }}>✓</span>}
              </motion.span>
              <div className="min-w-0">
                <div className="text-[12px]" style={{ color: isDone ? "var(--color-ink)" : "var(--color-ink-3)", fontWeight: isDone ? 600 : 400 }}>
                  {s.label}
                </div>
                <div className="font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>
                  {zeroG(s.detail)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 border-t border-[var(--color-border)] pt-2 font-mono-x text-[9.5px] leading-[1.45]" style={{ color: "var(--color-ink-3)" }}>
        {zeroG(FOOTER[variant])}
      </div>
    </div>
  );
}
