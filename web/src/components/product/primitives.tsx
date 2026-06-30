"use client";

import Link from "next/link";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";

// Shared product-page primitives. These apply the Technical Editorial system CONSISTENTLY (the per-
// section variance is Home-only): one display + mono + body type system, the warm token palette, the
// provenance-line motif rendered as section rules, rounded-[22px] panels, warm shadows.

// The page header used at the top of every product page: a confident mono kicker (NOT a timid
// eyebrow stack: it sits inline with an oversized index/id marker), an architectural display title,
// the provenance rule, and an optional lede. Contained in w-full so big display type never overflows.
export function PageHeader({
  kicker,
  marker,
  title,
  lede,
  children,
}: {
  kicker: string;
  marker?: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="w-full">
      <div className="flex items-center gap-3 font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
        <span>{kicker}</span>
        {marker ? (
          <>
            <span className="prov-rule h-px flex-1" style={{ opacity: 0.5 }} />
            <span style={{ color: "var(--color-accent)" }}>{marker}</span>
          </>
        ) : null}
      </div>
      <h1
        className="font-display mt-4"
        style={{ fontSize: "clamp(40px, 7vw, 92px)", lineHeight: 0.98, letterSpacing: "-0.02em" }}
      >
        {title}
      </h1>
      {lede ? (
        <p className="mt-5 max-w-[58ch] text-[15px] leading-relaxed sm:text-[16px]" style={{ color: "var(--color-ink-2)" }}>
          {lede}
        </p>
      ) : null}
      {children}
    </header>
  );
}

// A thin provenance rule (the motif). Static here (product pages are calm); it carries coherence
// across sections as a hairline baseline.
export function ProvLine({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`prov-rule h-px w-full ${className}`} style={{ opacity: 0.7, ...style }} />;
}

// A small mono chip, optionally tinted by an agent accent. Used for style tags and statuses.
export function Chip({
  children,
  accent,
  tone = "default",
}: {
  children: ReactNode;
  accent?: string;
  tone?: "default" | "solid" | "ok" | "accent";
}) {
  const style: CSSProperties =
    tone === "solid"
      ? { background: accent ?? "var(--color-ink)", color: "#fff" }
      : tone === "ok"
        ? { background: "color-mix(in oklab, var(--color-ok) 16%, transparent)", color: "var(--color-ok)" }
        : tone === "accent"
          ? { background: "color-mix(in oklab, var(--color-accent) 14%, transparent)", color: "var(--color-accent)" }
          : {
              border: "1px solid var(--color-border-strong)",
              color: "var(--color-ink-2)",
              background: accent ? `color-mix(in oklab, ${accent} 10%, var(--color-paper))` : "var(--color-paper)",
            };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono-x text-[10px] uppercase tracking-[0.1em]" style={style}>
      {children}
    </span>
  );
}

// A mono key/value row (the provenance metadata line). Value can be monospace hashes, optionally a
// link to the explorer / storage scan, with an optional ok-check.
export function MetaRow({
  k,
  v,
  href,
  ok = false,
  mono = true,
}: {
  k: string;
  v: ReactNode;
  href?: string;
  ok?: boolean;
  mono?: boolean;
}) {
  const valueClass = `flex min-w-0 items-center justify-end gap-1.5 ${mono ? "font-mono-x text-[12px]" : "text-[13px]"}`;
  const value = (
    <span className={valueClass} style={{ color: "var(--color-ink)" }}>
      {v}
      {ok ? <span className="shrink-0" style={{ color: "var(--color-ok)" }}>✓</span> : null}
    </span>
  );
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <dt className="shrink-0 font-mono-x text-[10px] uppercase tracking-[0.1em]" style={{ color: "var(--color-ink-3)" }}>
        {k}
      </dt>
      <dd className="min-w-0 text-right">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline" style={{ color: "var(--color-accent)" }}>
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

// A long provenance value (a full uint256 seed, a hash) shown truncated so it never overflows its row,
// with a copy-to-clipboard control that yields the COMPLETE value. The full string stays recoverable
// + verifiable (the seed is the Provable-Pulls recompute anchor) - we only shorten what is rendered.
// `display` is the truncated label (e.g. shortHex(seed)); `full` is the untouched value that gets copied.
export function CopyValue({
  full,
  display,
}: {
  full: string;
  display?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (insecure context / denied) - the full value still lives in the title.
    }
  };
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate" title={full}>
        {display ?? full}
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy full value"}
        title={copied ? "Copied" : "Copy full value"}
        className="inline-flex shrink-0 items-center justify-center rounded-md p-0.5 transition-opacity hover:opacity-100"
        style={{ color: copied ? "var(--color-ok)" : "var(--color-ink-3)", opacity: 0.8 }}
      >
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </button>
    </span>
  );
}

// A panel surface (the consistent card language across product pages).
export function Panel({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`rounded-[22px] border ${className}`}
      style={{ borderColor: "var(--color-border)", background: "var(--color-paper)", ...style }}
    >
      {children}
    </div>
  );
}

// A big-figure stat (display number + mono label), contained so the clamp never overflows.
export function StatFigure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="w-full">
      <div className="font-display" style={{ fontSize: "clamp(30px, 5vw, 52px)", lineHeight: 1, letterSpacing: "-0.01em" }}>
        {value}
      </div>
      <div className="mt-2 font-mono-x text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
        {label}
      </div>
    </div>
  );
}

// The shared primary action button (ink solid). Used for CTAs + trade actions.
export function ActionButton({
  children,
  onClick,
  href,
  disabled = false,
  variant = "solid",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  variant?: "solid" | "outline" | "warn";
  type?: "button" | "submit";
}) {
  const style: CSSProperties =
    variant === "outline"
      ? { background: "transparent", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)" }
      : variant === "warn"
        ? { background: "transparent", color: "var(--color-warn)", border: "1px solid var(--color-warn)" }
        : { background: "var(--color-ink)", color: "var(--color-cream)", border: "1px solid var(--color-ink)" };
  const cls =
    "inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 font-mono-x text-[13px] transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40";
  if (href) {
    return (
      <Link href={href} className={cls} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls} style={style}>
      {children}
    </button>
  );
}

// A labelled form field shell (the consistent input language for the create + generate forms). Wraps a
// mono label + an optional hint over a rounded bordered surface that matches PriceField/TradePanel.
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono-x text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
          {label}
        </span>
        {hint ? (
          <span className="font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </label>
  );
}

// A single-line text input on the warm bordered surface. Controlled.
export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  disabled = false,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number";
  inputMode?: "text" | "decimal" | "numeric";
  disabled?: boolean;
  maxLength?: number;
}) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      value={value}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      // Resting border color lives in the className (not inline style) so the focus: variant can actually
      // win (an inline borderColor would override focus:border-* by specificity and kill the focus ring).
      className="w-full rounded-[14px] border border-[var(--color-border-strong)] px-4 py-3 font-mono-x text-[13px] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-50"
      style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}
    />
  );
}

// A multi-line text area on the same surface. Controlled.
export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled = false,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  maxLength?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      disabled={disabled}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      // Resting border color in className (not inline) so focus:border-* is not overridden by inline style.
      className="w-full resize-none rounded-[14px] border border-[var(--color-border-strong)] px-4 py-3 text-[14px] leading-relaxed outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-50"
      style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}
    />
  );
}

// The flow-step rail: an ordered list of phase labels with a live cursor. Renders done (filled), active
// (pulsing accent), and pending (hairline) states. Used by the generate + mint progress UI so the user
// always sees where they are in generating -> attesting -> sign -> pending -> minted.
export type StepStatus = "done" | "active" | "pending" | "error";
export function StepRail({ steps }: { steps: { label: string; status: StepStatus }[] }) {
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const color =
          s.status === "done"
            ? "var(--color-ok)"
            : s.status === "active"
              ? "var(--color-accent)"
              : s.status === "error"
                ? "var(--color-warn)"
                : "var(--color-ink-3)";
        return (
          <li key={s.label} className="flex items-center gap-3 py-2">
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
              <span
                className="relative inline-flex h-2.5 w-2.5 items-center justify-center rounded-full"
                style={{
                  background: s.status === "pending" ? "transparent" : color,
                  border: s.status === "pending" ? "1.5px solid var(--color-border-strong)" : `1.5px solid ${color}`,
                }}
              />
            </span>
            <span
              className="font-mono-x text-[12px] tracking-[0.02em]"
              style={{ color: s.status === "pending" ? "var(--color-ink-3)" : "var(--color-ink)" }}
            >
              {s.label}
            </span>
            {s.status === "done" ? <span className="font-mono-x text-[11px]" style={{ color: "var(--color-ok)" }}>done</span> : null}
            <span className="ml-auto font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// The wallet-gate empty state shared by pages that REQUIRE a connection (dashboard, the mint step). A
// calm centered panel with the page's lede + a connect CTA (RainbowKit), in the consistent panel language.
export function ConnectGate({
  title,
  body,
  children,
}: {
  title: ReactNode;
  body: ReactNode;
  children: ReactNode;
}) {
  return (
    <Panel className="mx-auto mt-10 max-w-[560px] p-10 text-center">
      <h2 className="font-display" style={{ fontSize: "clamp(26px,4vw,38px)", lineHeight: 1.02 }}>
        {title}
      </h2>
      <p className="mx-auto mt-4 max-w-[44ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {body}
      </p>
      <div className="mx-auto mt-7 max-w-[280px]">{children}</div>
    </Panel>
  );
}
