// Instant skeleton for /agents/[id]. Next streams this the moment navigation starts, so clicking into an
// Aura feels immediate instead of waiting on the full SSR data read (the old "slow redirect"). Mirrors the
// real layout: portrait + identity on the left, trade panel on the right, then the Relic collection grid.
function Block({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse rounded-[14px] ${className}`}
      style={{ background: "var(--color-cream-deep)", ...style }}
    />
  );
}

export default function Loading() {
  return (
    <main className="min-h-screen pt-14">
      <section className="relative px-5 py-12 sm:px-8 sm:py-16">
        <div className="mx-auto w-full max-w-[var(--container-wrap)]">
          <Block className="h-3 w-24" />
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <Block className="aspect-[16/10] w-full rounded-[24px]" />
              <Block className="mt-6 h-9 w-2/3" />
              <Block className="mt-4 h-4 w-full" />
              <Block className="mt-2 h-4 w-4/5" />
              <Block className="mt-7 h-44 w-full rounded-[18px]" />
            </div>
            <div>
              <Block className="h-64 w-full rounded-[18px]" />
              <Block className="mt-4 h-40 w-full rounded-[18px]" />
            </div>
          </div>
          <div className="mt-16 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Block key={i} className="aspect-square w-full rounded-[18px]" />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
