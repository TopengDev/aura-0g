// Instant skeleton for /outputs/[id]. Streamed the moment navigation starts so opening a Relic feels
// immediate. Mirrors the real layout: artwork on the left, identity + trade on the right, then the
// generative direction + provenance panels.
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
          <Block className="h-3 w-28" />
          <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_1fr]">
            <Block className="aspect-square w-full rounded-[24px]" />
            <div className="space-y-6">
              <Block className="h-9 w-2/3" />
              <Block className="h-16 w-full rounded-[18px]" />
              <Block className="h-64 w-full rounded-[18px]" />
            </div>
          </div>
          <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Block className="h-56 w-full rounded-[18px]" />
            <Block className="h-56 w-full rounded-[18px]" />
          </div>
        </div>
      </section>
    </main>
  );
}
