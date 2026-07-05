"use client";

import type { CSSProperties } from "react";
import { tweetIntent, SHARE_HASHTAGS } from "@/lib/share";

// One-click "Share on X" button. Opens the x.com/intent/tweet web intent in a new tab (no API, no app,
// no auth, no file upload): the visitor tweets a LINK from THEIR account and X renders the card by
// fetching the page's og:image. Styled to match the shared ActionButton so it reads as native chrome.
// `url` must be an absolute https URL (X includes + crawls it). Copy is passed in so each flex moment can
// tune it; hashtags default to the AURA set.
export function ShareOnX({
  text,
  url,
  hashtags = SHARE_HASHTAGS,
  label = "Share on X",
  variant = "outline",
  full = false,
}: {
  text: string;
  url: string;
  hashtags?: string[];
  label?: string;
  variant?: "solid" | "outline";
  full?: boolean;
}) {
  const href = tweetIntent({ text, url, hashtags });
  const style: CSSProperties =
    variant === "solid"
      ? { background: "var(--color-ink)", color: "var(--color-cream)", border: "1px solid var(--color-ink)" }
      : { background: "transparent", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)" };
  const cls =
    `micro group inline-flex ${full ? "w-full" : "w-auto"} items-center justify-center gap-2 rounded-full px-5 py-3 text-[16px] font-semibold tracking-[0.005em] ` +
    "hover:-translate-y-px hover:shadow-[var(--shadow-pill)] active:translate-y-0 active:scale-[0.985]";
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls} style={style} aria-label={label}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      {label}
    </a>
  );
}
