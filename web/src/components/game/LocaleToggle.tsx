"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { useLocale } from "next-intl";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/i18n/config";

// A compact ID / EN segmented control, styled to match the app's ThemeToggle (bordered pill track, the
// active option is a sliding ink fill). Switching writes the AURA_LOCALE cookie and refreshes the route so
// the SERVER re-renders the (game) subtree in the new locale (no client-only string swap, no FOUC).
const LABEL: Record<Locale, string> = { id: "ID", en: "EN" };
const ARIA: Record<Locale, string> = { id: "Ganti ke Bahasa Indonesia", en: "Switch to English" };

export function LocaleToggle() {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Locale | null>(null);
  const shown = optimistic ?? active;

  const pick = (next: Locale) => {
    if (next === active) return;
    setOptimistic(next);
    // 1 year, lax, root path so every route (including the rest of the app, if it later opts in) sees it.
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <div
      role="radiogroup"
      aria-label="Language"
      aria-busy={pending || undefined}
      className="relative inline-flex w-fit items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-paper)] p-1"
    >
      {LOCALES.map((loc) => {
        const isActive = shown === loc;
        return (
          <button
            key={loc}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={ARIA[loc]}
            onClick={() => pick(loc)}
            className="micro relative z-10 inline-flex min-w-[34px] items-center justify-center rounded-full px-2.5 py-1 text-[13px] font-semibold active:scale-[0.94]"
            style={{ background: "transparent", border: "none", color: isActive ? "var(--color-cream)" : "var(--color-ink-2)", letterSpacing: "0.06em" }}
          >
            {isActive ? (
              <motion.span
                layoutId="game-locale-pill"
                className="absolute inset-0 -z-10 rounded-full bg-[var(--color-ink)]"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            ) : null}
            {LABEL[loc]}
          </button>
        );
      })}
    </div>
  );
}
