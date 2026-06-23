"use client";

import { ZeroG } from "@/components/atoms/ZeroG";
import { useInView } from "@/lib/useInView";

// Section 2 - THESIS strip. Skeleton: centered-statement. Technique T3: oversized editorial display
// type AS layout. One architectural sentence; the load-bearing keyword "verifiable" gets the
// provenance-line underline that DRAWS on enter (T4 kinetic on the rule only).
export function Thesis() {
  const [ref, inView] = useInView<HTMLDivElement>(0.4);

  return (
    <section className="relative px-5 py-28 sm:px-8 sm:py-36">
      <div ref={ref} className="mx-auto max-w-[1000px] text-center">
        <p
          className="font-display"
          style={{ fontSize: "clamp(30px, 5.4vw, 64px)", lineHeight: 1.08, letterSpacing: "-0.018em" }}
        >
          Generative art has no proof of origin. AURA makes every piece{" "}
          <span className={`prov-underline ${inView ? "is-in" : ""}`} style={{ color: "var(--color-accent)" }}>
            verifiable
          </span>
          : an autonomous agent generates it inside a TEE, it is stored on <ZeroG />, and minted with
          provenance and royalties that travel with the work.
        </p>
      </div>
    </section>
  );
}
