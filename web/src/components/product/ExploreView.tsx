"use client";

import Link from "next/link";
import { useState } from "react";
import { Reveal } from "@/components/Reveal";
import { ActivityTicker } from "@/components/home/ActivityTicker";
import { PageHeader, Panel, ProvLine, Chip } from "@/components/product/primitives";
import { RarityBadge } from "@/components/product/RarityBadge";
import { Pager, paginate, OUTPUTS_PAGE_SIZE } from "@/components/product/Pager";
import { ZeroG } from "@/components/atoms/ZeroG";
import { EXPLORER, CHAIN_SHORT, CHAIN_ID } from "@/lib/chains";
import {
  agentPortraitUrl,
  imageUrl,
  shortHex,
  FEATURED_OUTPUT_IDS,
  type Activity,
  type Agent,
  type CreatorRollup,
  type Output,
  type TrendingItem,
} from "@/lib/api";
import { describeActivity, kindLabel, timeAgo } from "@/lib/format";

// /explore - the discovery hub. The "pulse of AURA": a live activity marquee, the trending agents, a
// recent-outputs gallery (the outputs' own discovery surface, since elsewhere they're only reachable via
// an agent), a top-creators royalties leaderboard, and a full live activity feed (the #activity anchor
// the Footer links to). DISTINCT from /agents (which is the sort/filter catalog): this is alive, ranked,
// editorial. All data is server-fetched live and handed in; the test agent is already excluded upstream.
export interface ExploreData {
  trending: { item: TrendingItem; agent: Agent }[];
  outputs: Output[];
  creators: CreatorRollup[];
  activity: Activity[];
  totalAgents: number;
  totalOutputs: number;
}

export function ExploreView({ data }: { data: ExploreData }) {
  const { trending, outputs, creators, activity } = data;

  // Paginate the recent-outputs gallery (it grows with every mint). The two curated showpieces only get
  // the 2x emphasis on page 1 (where they lead); deeper pages tile evenly.
  const [outPage, setOutPage] = useState(1);
  const { items: pageOutputs, pageCount: outPageCount, page: curOutPage } = paginate(outputs, outPage, OUTPUTS_PAGE_SIZE);

  return (
    <>
      <section className="relative px-5 pb-10 pt-16 sm:px-8 sm:pt-20">
        <div className="mx-auto w-full max-w-[var(--container-wrap)]">
          <Reveal>
            <PageHeader
              kicker="Explore"
              marker="the pulse"
              title={<>Everything happening on AURA.</>}
              lede={
                <>
                  The Auras people are minting from, the Relics landing on-chain right now, and the
                  creators earning royalties as their work resells. Every item here links to its full,
                  verifiable provenance.
                </>
              }
            />
          </Reveal>

          {/* At-a-glance counts */}
          <Reveal delay={0.05}>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3">
              <Glance n={data.totalAgents} label="Auras on-chain" />
              <span className="h-8 w-px" style={{ background: "var(--color-border)" }} />
              <Glance n={data.totalOutputs} label="Relics minted" />
              <span className="h-8 w-px" style={{ background: "var(--color-border)" }} />
              <Glance n={creators.length} label="creators earning" />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Live activity marquee (the provenance line, in motion) */}
      {activity.length > 0 ? <ActivityTicker activity={activity} /> : null}

      {/* Trending agents */}
      <section className="relative px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto w-full max-w-[var(--container-wrap)]">
          <SectionHead
            kicker="Trending now"
            title="Auras on the rise."
            note="Ranked by a 7-day window of mints, sales, and listings."
            href="/agents"
            hrefLabel="All Auras"
          />
          {trending.length === 0 ? (
            <EmptyRow label="No trending Auras yet. Check back as activity picks up." />
          ) : (
            <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {trending.slice(0, 6).map(({ item, agent }, i) => (
                <Reveal key={item.agentId} delay={Math.min(0.05 * i, 0.3)}>
                  <TrendingCard rank={i + 1} item={item} agent={agent} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Recent outputs gallery (the outputs' own discovery surface) */}
      <section className="relative px-5 py-16 sm:px-8 sm:py-20" style={{ background: "color-mix(in oklab, var(--color-cream-deep) 50%, transparent)" }}>
        <div className="mx-auto w-full max-w-[var(--container-wrap)]">
          <SectionHead
            kicker="Featured Relics"
            title="The strongest Relics, first."
            note="Curated character work leads, then the freshest mints. Each is generated, TEE-attested, and stored on-chain. Tap any to verify."
            href="/verify"
            hrefLabel="Verify a Relic"
          />
          {outputs.length === 0 ? (
            <EmptyRow label="No Relics minted yet. Generate the first one." />
          ) : (
            <>
              <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
                {pageOutputs.map((o, i) => {
                  // The two curated showpieces lead the gallery at 2x size (an editorial featured emphasis),
                  // but ONLY on page 1 where they actually lead; deeper pages tile evenly. featured order is
                  // set upstream so index 0/1 are the showpieces.
                  const featured = FEATURED_OUTPUT_IDS.indexOf(o.tokenId);
                  const big = curOutPage === 1 && (featured === 0 || featured === 1);
                  return (
                    <Reveal key={o.tokenId} delay={Math.min(0.04 * i, 0.3)} className={big ? "col-span-2 row-span-2" : ""}>
                      <OutputCard output={o} big={big} />
                    </Reveal>
                  );
                })}
              </div>
              <Pager page={curOutPage} pageCount={outPageCount} onPage={setOutPage} className="mt-12" />
            </>
          )}
        </div>
      </section>

      {/* Top creators leaderboard */}
      <section className="relative px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto w-full max-w-[var(--container-wrap)]">
          <SectionHead
            kicker="Top creators"
            title="Who the royalties flow to."
            note="Aggregated across every Aura a creator owns. Royalties resolve live to the current owner."
          />
          {creators.length === 0 ? (
            <EmptyRow label="No creators yet." />
          ) : (
            <Reveal delay={0.05}>
              <Panel className="mt-10 overflow-hidden">
                <ul>
                  {creators.slice(0, 8).map((c, i) => (
                    <CreatorRow key={c.owner} rank={i + 1} creator={c} />
                  ))}
                </ul>
              </Panel>
            </Reveal>
          )}
        </div>
      </section>

      {/* Full live activity feed (the #activity anchor) */}
      <section id="activity" className="relative scroll-mt-20 px-5 py-16 sm:px-8 sm:py-20" style={{ background: "color-mix(in oklab, var(--color-cream-deep) 50%, transparent)" }}>
        <div className="mx-auto w-full max-w-[var(--container-wrap)]">
          <SectionHead
            kicker="Live activity"
            title="Every move, on-chain."
            note={`Mints, sales, listings, and transfers as they settle on 0G ${CHAIN_SHORT}.`}
          />
          {activity.length === 0 ? (
            <EmptyRow label="No on-chain activity yet." />
          ) : (
            <Reveal delay={0.05}>
              <Panel className="mt-10 overflow-hidden">
                <ul>
                  {activity.slice(0, 20).map((e, i) => (
                    <ActivityRow key={e.id} index={i + 1} e={e} />
                  ))}
                </ul>
              </Panel>
            </Reveal>
          )}
          <p className="mt-6 text-[16px]" style={{ color: "var(--color-ink-3)" }}>
            Reads live from the indexer over <ZeroG /> {CHAIN_SHORT} (chain <span className="font-mono-x tabular-nums">{CHAIN_ID}</span>).
          </p>
        </div>
      </section>
    </>
  );
}

// ── section header (shared rhythm) ──────────────────────────────────────────
function SectionHead({
  kicker,
  title,
  note,
  href,
  hrefLabel,
}: {
  kicker: string;
  title: string;
  note: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <Reveal>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            {kicker}
          </span>
          <h2 className="font-display mt-3" style={{ fontSize: "clamp(30px, 4.6vw, 54px)", lineHeight: 1, letterSpacing: "-0.015em" }}>
            {title}
          </h2>
          <p className="mt-3 max-w-[52ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
            {note}
          </p>
        </div>
        {href && hrefLabel ? (
          <Link href={href} className="text-[16px] font-semibold underline-offset-4 hover:underline" style={{ color: "var(--color-accent)" }}>
            {hrefLabel} -&gt;
          </Link>
        ) : null}
      </div>
      <ProvLine className="mt-6" />
    </Reveal>
  );
}

function Glance({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="font-display" style={{ fontSize: "clamp(26px,4vw,40px)", lineHeight: 1, letterSpacing: "-0.01em" }}>{n}</div>
      <div className="mt-1.5 label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>{label}</div>
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <p className="mt-10 text-[16px]" style={{ color: "var(--color-ink-3)" }}>
      {label}
    </p>
  );
}

// ── trending agent card (ranked; reuses the catalog card vocabulary) ─────────
function TrendingCard({ rank, item, agent }: { rank: number; item: TrendingItem; agent: Agent }) {
  const accent = agent.meta.accent;
  // 700px covers the 4/3 card at retina without the full-res source (see AgentsBrowse).
  const portrait = agentPortraitUrl(agent, 700);
  const w = item.window;
  return (
    <Link
      href={`/agents/${agent.agentId}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-[22px] border transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
      style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 7%, var(--color-paper))` }}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
        <img src={portrait} alt={`${agent.name} portrait`} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
        <span className="absolute left-3 top-3 flex h-7 w-7 items-center justify-center rounded-full font-mono-x text-[16px]" style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}>
          {rank}
        </span>
        <span className="absolute right-3 top-3"><Chip tone="solid" accent={accent}>{agent.style}</Chip></span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display" style={{ fontSize: 26, lineHeight: 1 }}>{agent.name}</h3>
          <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>#{agent.agentId}</span>
        </div>
        <p className="mt-2 text-[16px] leading-snug" style={{ color: "var(--color-ink-2)" }}>{agent.meta.tagline}</p>
        <div className="mt-auto flex items-center justify-between border-t pt-4 font-mono-x text-[16px]" style={{ borderColor: "var(--color-border)" }}>
          <span style={{ color: "var(--color-ink-3)" }}>
            <span style={{ color: "var(--color-accent)" }}>{item.trendingScore}</span> score
          </span>
          <span style={{ color: "var(--color-ink-3)" }}>
            {w.sales}s · {w.mints}m · {w.listings}l / 7d
          </span>
        </div>
      </div>
    </Link>
  );
}

// ── recent output card (links to the output's own page; carries provenance teaser) ──
// `big` is the featured-showpiece emphasis: a 2x cell whose art carries an overlaid caption (the lead
// pieces read as a gallery wall), vs the compact tile for the rest of the feed.
function OutputCard({ output: o, big = false }: { output: Output; big?: boolean }) {
  // The compact relic tile renders ~260-300 CSS px (square); the `big` showpiece is a 2x cell. Request a
  // retina-appropriate width per case rather than the full 1024^2 source -- smaller encode + fewer bytes.
  const imgSrc = imageUrl(o.imageRoot, o.style, big ? 900 : 600);
  if (big) {
    return (
      <Link
        href={`/outputs/${o.tokenId}`}
        className="group relative flex h-full min-h-[260px] flex-col overflow-hidden rounded-[18px] border micro hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
        style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
      >
        <div className="relative w-full flex-1 overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
          <img src={imgSrc} alt={`${o.agentName} #${o.tokenId}`} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
          <span className="tag micro absolute left-3 top-3" style={{ background: "color-mix(in oklab, var(--color-ink) 78%, transparent)", color: "var(--color-cream)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", border: "1px solid color-mix(in oklab, var(--color-cream) 16%, transparent)" }}>
            {o.style}
          </span>
          <span className="absolute right-3 top-3"><RarityBadge rarity={o.rarity} size="sm" hideCommon /></span>
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-4 pb-4 pt-14" style={{ background: "linear-gradient(to top, color-mix(in oklab, var(--color-ink) 78%, transparent), transparent)" }}>
            <div>
              <div className="font-display text-[clamp(24px,2.6vw,34px)] leading-none" style={{ color: "var(--color-cream)" }}>{o.agentName}</div>
              <div className="mt-1.5 label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "color-mix(in oklab, var(--color-cream) 72%, transparent)" }}>verifiable · tee-attested</div>
            </div>
            <span className="font-mono-x text-[16px]" style={{ color: "color-mix(in oklab, var(--color-cream) 80%, transparent)" }}>#{o.tokenId}</span>
          </div>
        </div>
      </Link>
    );
  }
  return (
    <Link
      href={`/outputs/${o.tokenId}`}
      className="group block overflow-hidden rounded-[18px] border micro hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
    >
      <div className="relative aspect-square w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
        <img src={imgSrc} alt={`${o.agentName} #${o.tokenId}`} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
        <span className="tag micro absolute left-3 top-3" style={{ background: "color-mix(in oklab, var(--color-ink) 78%, transparent)", color: "var(--color-cream)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", border: "1px solid color-mix(in oklab, var(--color-cream) 16%, transparent)" }}>
          {o.style}
        </span>
        <span className="absolute right-3 top-3"><RarityBadge rarity={o.rarity} size="sm" hideCommon /></span>
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[19px]">{o.agentName}</span>
          <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>#{o.tokenId}</span>
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[16px]" style={{ color: "var(--color-ink-3)" }}>
          <span className="label-caps inline-flex items-center gap-1" style={{ letterSpacing: "0.08em" }}>
            tee <span style={{ color: "var(--color-ok)" }}>✓</span>
          </span>
          <span className="font-semibold" style={{ color: "var(--color-accent)" }}>Verify -&gt;</span>
        </div>
      </div>
    </Link>
  );
}

// ── creator leaderboard row ─────────────────────────────────────────────────
function CreatorRow({ rank, creator: c }: { rank: number; creator: CreatorRollup }) {
  // Link through to the creator's top agent (no public per-wallet page; the agent is the closest entity).
  const topAgent = c.agents.slice().sort((a, b) => b.outputCount - a.outputCount)[0];
  const href = topAgent ? `/agents/${topAgent.agentId}` : "/agents";
  return (
    <li className="flex items-center gap-4 border-b px-5 py-4 last:border-b-0 sm:px-6" style={{ borderColor: "var(--color-border)" }}>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono-x text-[16px]" style={{ background: rank <= 3 ? "var(--color-ink)" : "transparent", color: rank <= 3 ? "var(--color-cream)" : "var(--color-ink-3)", border: rank <= 3 ? "none" : "1px solid var(--color-border-strong)" }}>
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <Link href={href} className="font-mono-x text-[16px] underline-offset-4 hover:underline" style={{ color: "var(--color-ink)" }}>
          {shortHex(c.owner)}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[16px]" style={{ color: "var(--color-ink-3)" }}>
          {c.agents.slice(0, 3).map((a, i) => (
            <span key={a.agentId}>
              {i > 0 ? <span className="mr-2" style={{ color: "var(--color-border-strong)" }}>·</span> : null}
              {a.name}
            </span>
          ))}
          {c.agents.length > 3 ? <span>+{c.agents.length - 3}</span> : null}
        </div>
      </div>
      <div className="hidden shrink-0 text-right sm:block">
        <div className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>{c.outputCount} relics · {c.salesCount} sales</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono-x text-[16px]" style={{ color: "var(--color-ink)" }}>
          {c.royaltiesEarned} <span style={{ color: "var(--color-ink-3)" }}>0G</span>
        </div>
        <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>royalties</div>
      </div>
    </li>
  );
}

// ── activity feed row ───────────────────────────────────────────────────────
function ActivityRow({ index, e }: { index: number; e: Activity }) {
  const isSale = e.kind === "sale";
  const href = e.tokenId !== null ? (e.collectionKind === "agent" ? `/agents/${e.tokenId}` : `/outputs/${e.tokenId}`) : null;
  const label = describeActivity(e);

  // The row is a plain container (NOT an anchor) so the entity link and the explorer txHash link are
  // SIBLINGS, never nested anchors (nesting <a> in <a> is invalid HTML and triggers a hydration error).
  // The label itself is the navigational link; the txHash is its own external link beside it.
  return (
    <li
      className="group flex items-center gap-4 border-b px-5 py-4 transition-colors last:border-b-0 hover:bg-[color-mix(in_oklab,var(--color-ink)_4%,transparent)] sm:px-6"
      style={{ borderColor: "var(--color-border)" }}
    >
      <span className="font-mono-x text-[16px] tabular-nums" style={{ color: "var(--color-ink-3)" }}>
        {String(index).padStart(2, "0")}
      </span>
      <Chip tone={isSale ? "accent" : "default"}>{kindLabel(e.kind)}</Chip>
      <div className="min-w-0 flex-1">
        {href ? (
          <Link href={href} className="block truncate text-[16px] font-medium underline-offset-2 group-hover:underline" style={{ color: "var(--color-ink)" }}>
            {label}
          </Link>
        ) : (
          <div className="truncate text-[16px] font-medium" style={{ color: "var(--color-ink)" }}>{label}</div>
        )}
        <div className="mt-0.5 text-[16px]" style={{ color: "var(--color-ink-3)" }}>
          {timeAgo(e.timestamp)}
          {e.txHash ? (
            <>
              {" · "}
              <a href={`${EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer" className="font-mono-x underline underline-offset-2" style={{ color: "var(--color-accent)" }}>
                {shortHex(e.txHash)}
              </a>
            </>
          ) : null}
        </div>
      </div>
      {e.price ? (
        <span className="shrink-0 font-mono-x text-[16px]" style={{ color: "var(--color-ink)" }}>
          {e.price} <span style={{ color: "var(--color-ink-3)" }}>0G</span>
        </span>
      ) : null}
    </li>
  );
}

// timeAgo / kindLabel / describeActivity now live in @/lib/format (shared with Dashboard + ActivityTicker).
