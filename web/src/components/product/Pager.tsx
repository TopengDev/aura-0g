"use client";

// Shared pagination control + helper for the growing discovery grids (/agents catalog, /explore recent
// outputs). Client-side paging over an already-fetched list (the grids are SSR-fetched in full, then
// filtered/sorted/searched client-side, so paging is a slice). Styling matches the Technical-Editorial
// control bar: mono-x uppercase pills, ink/cream active state, paper/border idle state.

export const AGENTS_PAGE_SIZE = 9; // 3 rows of the 3-col agent grid
export const OUTPUTS_PAGE_SIZE = 12; // 3 rows of the 4-col output grid (2 rows at sm)

/** Slice a list to a page (1-indexed). Clamps the page into range. Returns the slice + the page count. */
export function paginate<T>(list: T[], page: number, pageSize: number): { items: T[]; pageCount: number; page: number } {
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const clamped = Math.min(Math.max(1, page), pageCount);
  const start = (clamped - 1) * pageSize;
  return { items: list.slice(start, start + pageSize), pageCount, page: clamped };
}

// Build a compact page list with ellipses: 1 … (p-1) p (p+1) … N. -1 entries render as a gap.
function pageList(page: number, pageCount: number): number[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: number[] = [1];
  const lo = Math.max(2, page - 1);
  const hi = Math.min(pageCount - 1, page + 1);
  if (lo > 2) out.push(-1);
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pageCount - 1) out.push(-1);
  out.push(pageCount);
  return out;
}

export function Pager({
  page,
  pageCount,
  onPage,
  className = "",
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const pages = pageList(page, pageCount);
  return (
    <nav className={`flex flex-wrap items-center justify-center gap-1.5 ${className}`} aria-label="Pagination">
      <PagerButton disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        ‹ Prev
      </PagerButton>
      {pages.map((p, i) =>
        p === -1 ? (
          <span key={`gap-${i}`} className="px-1.5 font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }} aria-hidden>
            …
          </span>
        ) : (
          <PagerButton key={p} active={p === page} onClick={() => onPage(p)} aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined}>
            {p}
          </PagerButton>
        ),
      )}
      <PagerButton disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page">
        Next ›
      </PagerButton>
    </nav>
  );
}

function PagerButton({
  children,
  onClick,
  active = false,
  disabled = false,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-w-[34px] rounded-full px-3 py-2 font-mono-x text-[11px] uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={
        active
          ? { background: "var(--color-ink)", color: "var(--color-cream)" }
          : { border: "1px solid var(--color-border-strong)", color: "var(--color-ink-2)", background: "var(--color-paper)" }
      }
      {...rest}
    >
      {children}
    </button>
  );
}
