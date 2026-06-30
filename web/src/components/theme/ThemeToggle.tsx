"use client";

import { motion } from "framer-motion";
import { useEffect, useId, useState } from "react";
import { useTheme, type ThemeMode } from "./ThemeProvider";

type Option = {
  value: ThemeMode;
  ariaLabel: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
};

const OPTIONS: Option[] = [
  { value: "light", ariaLabel: "Use light theme", Icon: SunIcon },
  { value: "system", ariaLabel: "Match system theme", Icon: AutoIcon },
  { value: "dark", ariaLabel: "Use dark theme", Icon: MoonIcon },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const groupId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="relative inline-flex w-fit items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-paper)] p-1"
    >
      {OPTIONS.map((opt) => {
        const isActive = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={opt.ariaLabel}
            onClick={() => setTheme(opt.value)}
            className="micro relative z-10 inline-flex items-center justify-center rounded-full p-1.5 active:scale-[0.9]"
            style={{ background: "transparent", border: "none", color: isActive ? "var(--color-cream)" : "var(--color-ink-2)" }}
          >
            {isActive ? (
              <motion.span
                layoutId={`theme-pill-${groupId}`}
                className="absolute inset-0 -z-10 rounded-full bg-[var(--color-ink)]"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            ) : null}
            <opt.Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

function SunIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.5" /><path d="M12 19.5V21" /><path d="M4.22 4.22l1.06 1.06" /><path d="M18.72 18.72l1.06 1.06" />
      <path d="M3 12h1.5" /><path d="M19.5 12H21" /><path d="M4.22 19.78l1.06-1.06" /><path d="M18.72 5.28l1.06-1.06" />
    </svg>
  );
}

function MoonIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
    </svg>
  );
}

function AutoIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="8" /><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
    </svg>
  );
}
