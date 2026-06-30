// Confident technical-editorial section kicker. Replaces the old timid mono micro-eyebrow
// (font-mono-x text-[11px], the artifex A2 tell) everywhere on the home page. The "technical"
// precision now reads from an oversized index marker (display face, accent) + a tracked small-caps
// label in the BODY sans (.label-caps) sitting on a short hairline tick - NOT a mono face
// (feedback_no_monospace_unless_archetype: Technical-Editorial is reworked off mono). The index
// numbers thread a numbered-provenance motif down the page.
export function Kicker({
  index,
  label,
  className = "",
}: {
  index?: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3.5 ${className}`}>
      {index ? (
        <span
          className="font-display leading-none tabular-nums"
          style={{ fontSize: "clamp(30px, 3.4vw, 46px)", letterSpacing: "-0.02em", color: "var(--color-accent)" }}
          aria-hidden
        >
          {index}
        </span>
      ) : null}
      <span className="h-px w-7 shrink-0" style={{ background: "var(--color-border-strong)" }} aria-hidden />
      <span className="label-caps" style={{ fontSize: 13, lineHeight: 1.1, color: "var(--color-ink-2)" }}>
        {label}
      </span>
    </div>
  );
}
