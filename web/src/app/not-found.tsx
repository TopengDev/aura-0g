import Link from "next/link";

// On-brand 404 with the provenance-line motif.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="label-caps text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.18em" }}>
        404. Off-chain
      </span>
      <h1 className="font-display mt-5" style={{ fontSize: "clamp(48px, 12vw, 120px)", lineHeight: 0.95, letterSpacing: "-0.02em" }}>
        No provenance here.
      </h1>
      <div className="prov-rule prov-rule-draw is-in mt-8 h-px w-40" />
      <p className="mt-8 max-w-[42ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        This page was never minted. Head back to the gallery and follow a verifiable trail instead.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-[16px] font-semibold transition-opacity hover:opacity-85"
        style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}
      >
        Back to AURA <span aria-hidden>-&gt;</span>
      </Link>
    </main>
  );
}
