"use client";

import type { ReactNode } from "react";

// Segmented control to compare the raw-hash font (Toper picks the winner).
export function FontToggle({
  mode,
  setMode,
}: {
  mode: "block" | "mono";
  setMode: (m: "block" | "mono") => void;
}) {
  return (
    <div className="inline-flex items-center" style={{ boxShadow: "inset 0 0 0 1px var(--color-edge)" }}>
      <span className="mono-label px-2.5 py-1.5" style={{ fontSize: "1rem", color: "var(--color-faint)" }}>
        HASH FONT
      </span>
      {(["block", "mono"] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className="mono-label px-3 py-1.5 transition-colors"
          style={{
            fontSize: "1rem",
            color: mode === m ? "var(--color-void)" : "var(--color-mute)",
            background: mode === m ? "var(--color-cyan)" : "transparent",
          }}
        >
          {m === "block" ? "BLOCKBLUEPRINT" : "MONO"}
        </button>
      ))}
    </div>
  );
}

// A labelled hash/address row. `value` renders in .raw-hash (font controlled by the
// nearest `.mono-true` ancestor when the toggle is in MONO mode).
export function HashLine({
  label,
  value,
  href,
  accent = "var(--color-cyan)",
}: {
  label: string;
  value: string;
  href?: string | null;
  accent?: string;
}) {
  const val = (
    <span className="raw-hash" style={{ color: "var(--color-ink)", fontSize: "1rem" }}>
      {value}
    </span>
  );
  return (
    <div className="py-2.5" style={{ borderBottom: "1px solid var(--color-edge)" }}>
      <div className="mono-label mb-1" style={{ fontSize: "1rem", color: accent }}>
        {label}
      </div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="hover:underline" style={{ textDecorationColor: accent }}>
          {val}
        </a>
      ) : (
        val
      )}
    </div>
  );
}

// The VERIFIED / FAILED stamp.
export function VerifiedStamp({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5"
      style={{
        boxShadow: `inset 0 0 0 1.5px ${ok ? "var(--color-cyan)" : "var(--color-sunset)"}`,
        background: ok ? "color-mix(in oklch, var(--color-cyan) 12%, transparent)" : "transparent",
      }}
    >
      <span className="mono-label" style={{ fontSize: "1rem", color: ok ? "var(--color-cyan)" : "var(--color-sunset)" }}>
        {label ?? (ok ? "TEE VERIFIED" : "UNVERIFIED")}
      </span>
    </span>
  );
}

// A pass/fail check line for the verification breakdown.
export function CheckLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span
        className="mono-label"
        style={{ fontSize: "1rem", color: ok ? "var(--color-cyan)" : "var(--color-faint)", width: "1rem" }}
      >
        {ok ? "[x]" : "[ ]"}
      </span>
      <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-mute)" }}>
        {children}
      </span>
    </div>
  );
}
