"use client";

import { Reveal } from "@/components/Reveal";
import { ZeroG } from "@/components/atoms/ZeroG";
import { Kicker } from "./Kicker";
import { useInView } from "@/lib/useInView";

// Section 7 - HOW IT WORKS. Skeleton: index-numbered vertical timeline (left/center spine, oversized
// 01-04 markers, alternating L/R content). Technique T8: index-numbered case panels on the
// provenance spine (the hero's line, now the literal backbone). "Sponsored generation, you only pay
// gas to mint" is called out explicitly.
const STEPS = [
  {
    n: "01",
    title: "Pick an Aura",
    body: <>Each Aura is an autonomous on-chain creator with its own style: noir, cyberpunk, risograph, illuminated. Browse the catalog and choose a voice.</>,
  },
  {
    n: "02",
    title: "Sign in and generate",
    body: <>Connect your wallet and sign in once, then type a prompt and generate. The platform sponsors it: no compute cost, no gas to make the art. You only pay gas later, to mint.</>,
  },
  {
    n: "03",
    title: "Attested and stored on 0G",
    body: <>Generation runs inside a TEE on <ZeroG /> Compute and is signed by the TeeML attestor. The result is stored on <ZeroG /> Storage with a content root anyone can resolve.</>,
  },
  {
    n: "04",
    title: "Mint when ready",
    body: <>Sign once more, only when you want to OWN a Relic. Minting writes it on-chain with full provenance and a creator royalty that follows every resale.</>,
  },
];

export function HowItWorks() {
  const [ref, inView] = useInView<HTMLDivElement>(0.15);

  return (
    <section id="how" className="relative px-5 py-28 sm:px-8 sm:py-36">
      <div className="mx-auto w-full max-w-[940px]">
        <Reveal>
          <div className="mb-16 flex flex-col items-center text-center">
            <Kicker label="The pipeline" />
            <h2 className="font-display mt-5" style={{ fontSize: "clamp(32px, 5.4vw, 64px)", lineHeight: 1, letterSpacing: "-0.015em" }}>
              How it works.
            </h2>
          </div>
        </Reveal>

        <div ref={ref} className="relative">
          {/* the provenance spine */}
          <div className="absolute left-[28px] top-2 bottom-2 w-px md:left-1/2" style={{ background: "var(--color-border)" }} aria-hidden />
          <div
            className="prov-rule absolute left-[28px] top-2 w-px md:left-1/2"
            style={{
              background: "var(--color-accent)",
              transformOrigin: "top center",
              transform: inView ? "scaleY(1)" : "scaleY(0)",
              transition: "transform 1.4s cubic-bezier(0.22,1,0.36,1)",
              bottom: 8,
            }}
            aria-hidden
          />

          <div className="space-y-14">
            {STEPS.map((s, i) => {
              const right = i % 2 === 1;
              return (
                <Reveal key={s.n} delay={i * 0.05}>
                  <div className={`relative flex items-start gap-6 pl-16 md:pl-0 ${right ? "md:flex-row-reverse md:text-right" : ""}`}>
                    {/* marker */}
                    <div className="absolute left-0 top-0 flex h-14 w-14 items-center justify-center md:static md:h-auto md:w-1/2">
                      <span
                        className={`font-display leading-none ${right ? "md:pl-10" : "md:pr-10 md:text-right md:w-full"}`}
                        style={{ fontSize: "clamp(48px, 9vw, 120px)", color: "var(--color-accent)", letterSpacing: "-0.02em" }}
                      >
                        {s.n}
                      </span>
                    </div>
                    {/* node on the spine: a short hairline tick (not a dot - Christopher bans decorative dots) */}
                    <span
                      className="absolute left-[18px] top-[14px] z-10 h-px w-[18px] md:left-1/2 md:-translate-x-1/2"
                      style={{ background: "var(--color-accent)" }}
                      aria-hidden
                    />
                    <div className="md:w-1/2">
                      <h3 className="font-display" style={{ fontSize: "clamp(22px, 3vw, 30px)", lineHeight: 1.1 }}>
                        {s.title}
                      </h3>
                      <p className="mt-3 max-w-[42ch] text-[16px] leading-relaxed md:inline-block" style={{ color: "var(--color-ink-2)" }}>
                        {s.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
