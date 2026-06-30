// Shared loading + empty states (on-brand: warm surface shimmer, the provenance line motif).

export function SkeletonCard({ className = "" }: { className?: string }) {
  return (
    <div
      className={`aura-skeleton rounded-[22px] border border-[var(--color-border)] ${className}`}
      style={{ minHeight: 200 }}
      aria-hidden
    />
  );
}

export function SkeletonRow({ count = 4, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`grid gap-5 ${className}`} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonLine({ w = "100%" }: { w?: string }) {
  return <div className="aura-skeleton h-3 rounded-full" style={{ width: w }} aria-hidden />;
}

// On-brand empty state: a mono note with the provenance line, used when a live section returns no
// rows (e.g. the backend is down). Never a crash, never a broken layout.
export function EmptyState({ label = "Nothing here yet." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="prov-rule h-px w-16" />
      <p className="label-caps text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.14em" }}>
        {label}
      </p>
    </div>
  );
}
