"use client";

import { Reveal } from "@/components/Reveal";
import { ZeroG } from "@/components/atoms/ZeroG";
import { OsScene } from "@/components/hero/os/OsScene";

// Section - AGENT THEATRE. The faux-OS scene, REPOSITIONED. It used to anchor the hero (arca's
// signature was a faux-OS window under a centered word-swap headline); here it is demoted to a
// supporting mid-page beat framed as "watch an agent work", so the page leads with the character art
// instead. The owner likes the faux-OS, so it is kept verbatim (same OsScene); only its POSITION and
// framing change. An editorial header sits left; the live machine sits below at full width.
export function AgentTheatre() {
  return (
    <section className="relative px-5 py-24 sm:px-8 sm:py-28">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <div className="mb-12 max-w-[44ch]">
            <span className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
              Watch an Aura work
            </span>
            <h2 className="font-display mt-3" style={{ fontSize: "clamp(30px, 5vw, 60px)", lineHeight: 1.0, letterSpacing: "-0.015em" }}>
              One machine, the whole pipeline.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              An Aura generates in the terminal while the side panel runs the real on-chain pipeline:
              sign, generate, attest in a TEE, store on <ZeroG />, mint. Then the gallery recalls the
              Relic with its provenance, ready to verify.
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <OsScene />
        </Reveal>
      </div>
    </section>
  );
}
