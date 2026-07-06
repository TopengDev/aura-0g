"use client";

import { useEffect, useRef, useState } from "react";

// Minimal IntersectionObserver hook for the provenance-line draws + count-ups. Fires once when the
// element enters the viewport (matches arca's Reveal viewport-once pattern).
export function useInView<T extends HTMLElement = HTMLDivElement>(amount = 0.3): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null) as React.RefObject<T>;
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            obs.disconnect();
          }
        }
      },
      { threshold: amount },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [amount]);

  return [ref, inView];
}

// Live on-screen hook. UNLIKE useInView (which fires once then disconnects), this stays connected and
// reports the element's CURRENT viewport state, so it can drive a REPEATING trigger -- exactly what an
// infinite-scroll sentinel needs: it must re-fire every time it re-enters the viewport as freshly appended
// content pushes it back down. `rootMargin` pre-arms the trigger before the sentinel is fully visible (e.g.
// "600px" loads the next page one viewport ahead of the scroll edge, so the feed feels seamless). SSR-safe:
// reports false until mounted; in a no-IntersectionObserver environment it reports true (degrade to load).
export function useOnScreen<T extends HTMLElement = HTMLDivElement>(rootMargin = "0px"): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null) as React.RefObject<T>;
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setOnScreen(e.isIntersecting);
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);

  return [ref, onScreen];
}
