"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Entrance primitive - fade + rise + de-blur as the element scrolls into view. One ease, once per element,
// matching the AURA motion language (ported from arca).
//
// FAIL-SAFE + FIRST-PAINT-SAFE (2026-07 hardening): content renders VISIBLE by default. The previous version
// used framer-motion `whileInView` with `initial={{ opacity: 0 }}`, which framer SSR-renders as an inline
// opacity:0 -- so before hydration (and forever, if the JS bundle failed to load or hydration threw) every
// Reveal-wrapped element was invisible, leaving a large empty void on first paint / fast scroll (seen on the
// /agents grid). Here the element is opacity:1 unless the client has CONFIRMED it is below the fold, so:
//   - SSR / no-JS / a missing or failed IntersectionObserver / a hydration error  -> content stays VISIBLE.
//   - an element in (or near) the viewport at mount                               -> revealed immediately, no flash.
//   - only an element genuinely below the fold                                    -> hidden off-screen, then it
//     animates in on scroll (the scroll-reveal motion is preserved, never at the cost of a first-paint void).
// A belt-and-suspenders timeout reveals anything still hidden after 1.6s so nothing can ever stay invisible.
// Look at rest is identical (opacity 1, no transform/blur); the `aura-deblur` class + html.low-motion /
// prefers-reduced-motion drop the per-frame blur exactly as before.

const EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)"; // == EASE [0.22, 1, 0.36, 1] from @/lib/motion
type Phase = "ready" | "hidden" | "revealed"; // "ready" and "revealed" both render visible

export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Default visible. SSR renders this, and a no-JS / observer-failure client keeps it, so content is never
  // trapped invisible.
  const [phase, setPhase] = useState<Phase>("ready");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old engine / disabled) -> just stay visible.
    if (typeof IntersectionObserver === "undefined") {
      setPhase("revealed");
      return;
    }
    // In or near the viewport at mount -> reveal immediately, never hide (no first-paint void, no flash).
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (rect.top < vh * 1.1 && rect.bottom > 0) {
      setPhase("revealed");
      return;
    }
    // Genuinely below the fold -> hide (off-screen, no visible flash), then reveal when it scrolls in. The
    // positive bottom rootMargin reveals it just BEFORE it enters view, so a fast scroll never shows a gap.
    setPhase("hidden");
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setPhase("revealed");
            obs.disconnect();
          }
        }
      },
      { threshold: 0, rootMargin: "0px 0px 12% 0px" },
    );
    obs.observe(el);
    // Belt-and-suspenders: if the observer never fires for any reason, reveal so content can never stay hidden.
    const failSafe = window.setTimeout(() => setPhase("revealed"), 1600);
    return () => {
      obs.disconnect();
      window.clearTimeout(failSafe);
    };
  }, []);

  const hidden = phase === "hidden";
  return (
    <div
      ref={ref}
      data-reveal={phase}
      className={className ? `aura-deblur ${className}` : "aura-deblur"}
      style={{
        opacity: hidden ? 0 : 1,
        transform: hidden ? `translateY(${y}px)` : "none",
        filter: hidden ? "blur(6px)" : "blur(0px)",
        transition: `opacity 0.7s ${EASE_CSS} ${delay}s, transform 0.7s ${EASE_CSS} ${delay}s, filter 0.7s ${EASE_CSS} ${delay}s`,
        willChange: hidden ? "opacity, transform, filter" : undefined,
      }}
    >
      {children}
    </div>
  );
}
