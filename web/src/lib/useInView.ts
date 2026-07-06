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
