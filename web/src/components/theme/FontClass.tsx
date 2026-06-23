"use client";

import { useEffect } from "react";

// Runtime display-face switch. Reads ?font=playfair (or NEXT_PUBLIC_DISPLAY_FONT default) and stamps
// html.font-playfair so the WHOLE page's --font-display-active swaps to Playfair Display without a
// rebuild. Default = Ethereal Glamour. Lets the same Home be screenshotted in both faces.
export function FontClass() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("font");
    const envDefault = (process.env.NEXT_PUBLIC_DISPLAY_FONT || "ethereal").toLowerCase();
    const face = (q || envDefault).toLowerCase();
    const root = document.documentElement;
    if (face === "playfair") root.classList.add("font-playfair");
    else root.classList.remove("font-playfair");
  }, []);
  return null;
}
