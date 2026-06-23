"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Reveal } from "@/components/Reveal";
import { PageHeader, ProvLine, Chip } from "@/components/product/primitives";
import { Pager, paginate, AGENTS_PAGE_SIZE } from "@/components/product/Pager";
import { agentPortraitUrl } from "@/lib/api";
import type { Agent, MarketListing } from "@/lib/api";

export interface AgentRow {
  agent: Agent;
  listing: MarketListing | null;
  trendingScore: number;
}

type SortKey = "trending" | "top-earning" | "newest" | "for-sale" | "by-style";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "top-earning", label: "Top earning" },
  { key: "newest", label: "Newest" },
  { key: "for-sale", label: "For sale" },
  { key: "by-style", label: "By style" },
];

// The public agent marketplace browser. A control bar (search + sort + style filter) over a grid of
// agent cards. Each card carries the agent's name, style, owner, output count, volume (sales),
// royalty %, and a for-sale badge + price when its iNFT is listed. Cards link to /agents/[id].
export function AgentsBrowse({ rows, totalCount }: { rows: AgentRow[]; totalCount: number }) {
  const [sort, setSort] = useState<SortKey>("trending");
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<string | null>(null);

  const styles = useMemo(
    () => Array.from(new Set(rows.map((r) => r.agent.style))).sort(),
    [rows],
  );

  const visible = useMemo(() => {
    let list = rows.slice();
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.agent.name.toLowerCase().includes(q) ||
          r.agent.style.toLowerCase().includes(q) ||
          r.agent.meta.tagline.toLowerCase().includes(q),
      );
    }
    if (style) list = list.filter((r) => r.agent.style === style);
    if (sort === "for-sale") list = list.filter((r) => !!r.listing);

    switch (sort) {
      case "trending":
        list.sort((a, b) => b.trendingScore - a.trendingScore || b.agent.outputCount - a.agent.outputCount);
        break;
      case "top-earning":
        list.sort((a, b) => Number(b.agent.royaltiesEarnedWei) - Number(a.agent.royaltiesEarnedWei) || b.agent.salesCount - a.agent.salesCount);
        break;
      case "newest":
        list.sort((a, b) => b.agent.mintedAt - a.agent.mintedAt);
        break;
      case "for-sale":
        list.sort((a, b) => Number(a.listing?.price ?? 0) - Number(b.listing?.price ?? 0));
        break;
      case "by-style":
        list.sort((a, b) => a.agent.style.localeCompare(b.agent.style) || b.agent.outputCount - a.agent.outputCount);
        break;
    }
    return list;
  }, [rows, query, style, sort]);

  // Pagination over the filtered/sorted list. Reset to page 1 whenever the result set changes
  // (search / style / sort), so the user never lands on an out-of-range page.
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
  }, [query, style, sort]);
  const { items: pageRows, pageCount, page: curPage } = paginate(visible, page, AGENTS_PAGE_SIZE);

  const forSaleCount = rows.filter((r) => r.listing).length;

  return (
    <section className="relative px-5 py-16 sm:px-8 sm:py-20">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <PageHeader
            kicker="The catalog"
            marker={`${rows.length} agents`}
            title={<>Autonomous creative agents.</>}
            lede={
              <>
                Every agent is an on-chain iNFT with a fixed style DNA, a model attestation, and a
                royalty that follows it. Buy an agent and you own its entire future royalty stream.
                {forSaleCount > 0 ? ` ${forSaleCount} listed for sale.` : ""}
              </>
            }
          />
        </Reveal>

        {/* Control bar */}
        <Reveal delay={0.05}>
          <div className="mt-10 flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex w-full items-center rounded-full border px-4 sm:max-w-[340px]" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)" }}>
                <SearchIcon />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search agents, styles..."
                  className="w-full bg-transparent py-2.5 pl-2 font-mono-x text-[12px] outline-none"
                  style={{ color: "var(--color-ink)" }}
                  aria-label="Search agents"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSort(s.key)}
                    className="rounded-full px-3.5 py-2 font-mono-x text-[11px] uppercase tracking-[0.08em] transition-colors"
                    style={
                      sort === s.key
                        ? { background: "var(--color-ink)", color: "var(--color-cream)" }
                        : { border: "1px solid var(--color-border-strong)", color: "var(--color-ink-2)", background: "var(--color-paper)" }
                    }
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Style filter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterChip active={style === null} onClick={() => setStyle(null)}>All styles</FilterChip>
              {styles.map((st) => (
                <FilterChip key={st} active={style === st} onClick={() => setStyle(style === st ? null : st)}>
                  {st}
                </FilterChip>
              ))}
            </div>
            <ProvLine className="mt-2" />
          </div>
        </Reveal>

        {/* Grid */}
        {visible.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="font-display" style={{ fontSize: "clamp(24px,4vw,36px)" }}>No agents match.</p>
            <p className="mt-2 font-mono-x text-[12px]" style={{ color: "var(--color-ink-3)" }}>
              Try clearing the filters or the search.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {pageRows.map((row, i) => (
              <Reveal key={row.agent.agentId} delay={Math.min(0.04 * i, 0.3)}>
                <AgentCard row={row} />
              </Reveal>
            ))}
          </div>
        )}

        <Pager page={curPage} pageCount={pageCount} onPage={setPage} className="mt-12" />

        <p className="mt-8 font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>
          Showing {pageRows.length} of {visible.length} catalog agents
          {visible.length !== rows.length ? ` (filtered from ${rows.length})` : ""}. {totalCount} agents minted on-chain (chain 16602).
        </p>
      </div>
    </section>
  );
}

function AgentCard({ row }: { row: AgentRow }) {
  const { agent: a, listing } = row;
  const accent = a.meta.accent;
  const portrait = agentPortraitUrl(a);

  return (
    <Link
      href={`/agents/${a.agentId}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-[22px] border transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
      style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 7%, var(--color-paper))` }}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
        <img src={portrait} alt={`${a.name} portrait`} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
        <span className="absolute left-3 top-3">
          <Chip tone="solid" accent={accent}>{a.style}</Chip>
        </span>
        {listing ? (
          <span className="absolute right-3 top-3 rounded-full px-3 py-1 font-mono-x text-[10px] uppercase tracking-[0.08em]" style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}>
            {listing.price} 0G
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display" style={{ fontSize: 26, lineHeight: 1 }}>{a.name}</h3>
          <span className="font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>#{a.agentId}</span>
        </div>
        <p className="mt-2 text-[13px] leading-snug" style={{ color: "var(--color-ink-2)" }}>{a.meta.tagline}</p>
        <div className="mt-4 flex items-center gap-1.5 font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>
          <span>owner</span>
          <span style={{ color: "var(--color-ink-2)" }}>{a.owner.slice(0, 6)}…{a.owner.slice(-4)}</span>
        </div>
        <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-4 font-mono-x text-[11px]" style={{ borderColor: "var(--color-border)" }}>
          <Stat n={a.outputCount} l="outputs" />
          <Stat n={a.salesCount} l="sales" />
          <Stat n={`${a.royaltyPct}%`} l="royalty" />
        </div>
      </div>
    </Link>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return (
    <div>
      <div style={{ color: "var(--color-ink)", fontSize: 15 }}>{n}</div>
      <div className="mt-0.5 uppercase tracking-[0.08em]" style={{ color: "var(--color-ink-3)" }}>{l}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 font-mono-x text-[10px] uppercase tracking-[0.1em] transition-colors"
      style={
        active
          ? { background: "color-mix(in oklab, var(--color-accent) 16%, transparent)", color: "var(--color-accent)", border: "1px solid color-mix(in oklab, var(--color-accent) 40%, transparent)" }
          : { border: "1px solid var(--color-border)", color: "var(--color-ink-3)", background: "transparent" }
      }
    >
      {children}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden style={{ color: "var(--color-ink-3)" }}>
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3 3" strokeLinecap="round" />
    </svg>
  );
}
