"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Reveal } from "@/components/Reveal";
import {
  PageHeader,
  Panel,
  ProvLine,
  Chip,
  StatFigure,
  ActionButton,
  ConnectGate,
  TextInput,
} from "@/components/product/primitives";
import { EXPLORER } from "@/lib/chains";
import { useTrade } from "@/lib/useTrade";
import {
  activityForAddress,
  agentPortraitUrl,
  fetchActivityFeed,
  fetchCreatorDashboard,
  fetchMarketplace,
  shortHex,
  type Activity,
  type Agent,
  type CreatorDashboard,
  type MarketListing,
  type Output,
} from "@/lib/api";

type Tab = "agents" | "outputs" | "listings" | "activity";

const TABS: { key: Tab; label: string }[] = [
  { key: "agents", label: "My agents" },
  { key: "outputs", label: "My outputs" },
  { key: "listings", label: "My listings" },
  { key: "activity", label: "Activity" },
];

// The wallet-gated portfolio. On connect it loads the wallet's full holdings from the indexer
// (/api/creators/:wallet) plus the active listings (filtered to seller) plus the activity feed (filtered
// to the address). The four tabs reuse the existing card vocabulary; My Listings gets an inline trade
// control (cancel / update price) backed by the same useTrade hook the detail pages use.
export function DashboardView() {
  const { address, isConnected } = useAccount();

  const [data, setData] = useState<CreatorDashboard | null>(null);
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("agents");
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (addr: string) => {
    setLoading(true);
    const [dash, market, feed] = await Promise.all([
      fetchCreatorDashboard(addr),
      fetchMarketplace(),
      fetchActivityFeed(80),
    ]);
    setData(dash);
    setListings(market.filter((l) => l.seller?.toLowerCase() === addr.toLowerCase()));
    setActivity(activityForAddress(feed, addr));
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isConnected && address) void load(address);
    else {
      setData(null);
      setListings([]);
      setActivity([]);
    }
  }, [isConnected, address, load, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  if (!isConnected || !address) {
    return (
      <section className="px-5 py-16 sm:px-8 sm:py-20">
        <div className="mx-auto w-full max-w-[var(--container-wrap)]">
          <Reveal>
            <PageHeader kicker="Dashboard" title={<>Your studio.</>} lede="Every agent you own, every output you hold, your listings, and the royalties your work earns. Connect a wallet to open it." />
          </Reveal>
          <Reveal delay={0.05}>
            <ConnectGate
              title="Connect your wallet"
              body="Your portfolio is keyed to your address on the 0G Galileo testnet. Connect to see your agents, outputs, listings, and earnings."
            >
              <ConnectButton.Custom>
                {({ openConnectModal }) => <ActionButton onClick={openConnectModal}>Connect wallet</ActionButton>}
              </ConnectButton.Custom>
            </ConnectGate>
          </Reveal>
        </div>
      </section>
    );
  }

  const counts = data?.counts;

  return (
    <section className="relative px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <PageHeader
            kicker="Dashboard"
            marker={shortHex(address)}
            title={<>Your studio.</>}
            lede="Everything you own on AURA, and what it earns."
          />
        </Reveal>

        {/* Earnings ledger */}
        <Reveal delay={0.04}>
          <div className="mt-10">
            <ProvLine />
            <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <StatFigure value={counts?.agentsOwned ?? 0} label="Agents owned" />
              <StatFigure value={counts?.outputsOwned ?? 0} label="Outputs held" />
              <StatFigure
                value={<>{data?.royaltiesEarned ?? "0"} <span className="font-mono-x text-[14px]" style={{ color: "var(--color-ink-3)" }}>0G</span></>}
                label="Royalties earned"
              />
              <StatFigure value={data?.salesAsReceiver ?? 0} label="Royalty payouts" />
            </div>
          </div>
        </Reveal>

        {/* Tabs */}
        <Reveal delay={0.06}>
          <div className="mt-12 flex flex-wrap items-center gap-1.5">
            {TABS.map((t) => {
              const n =
                t.key === "agents"
                  ? counts?.agentsOwned ?? 0
                  : t.key === "outputs"
                    ? counts?.outputsOwned ?? 0
                    : t.key === "listings"
                      ? listings.length
                      : activity.length;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className="flex items-center gap-2 rounded-full px-4 py-2 font-mono-x text-[11px] uppercase tracking-[0.08em] transition-colors"
                  style={
                    tab === t.key
                      ? { background: "var(--color-ink)", color: "var(--color-cream)" }
                      : { border: "1px solid var(--color-border-strong)", color: "var(--color-ink-2)", background: "var(--color-paper)" }
                  }
                >
                  {t.label}
                  <span style={{ opacity: 0.6 }}>{n}</span>
                </button>
              );
            })}
            <button type="button" onClick={refresh} className="ml-auto font-mono-x text-[11px] underline underline-offset-4" style={{ color: "var(--color-ink-3)" }}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <ProvLine className="mt-4" />
        </Reveal>

        {/* Tab content */}
        <div className="mt-8">
          {loading && !data ? (
            <LoadingGrid />
          ) : tab === "agents" ? (
            <AgentsTab agents={data?.agentsOwned ?? []} />
          ) : tab === "outputs" ? (
            <OutputsTab outputs={data?.outputsOwned ?? []} />
          ) : tab === "listings" ? (
            <ListingsTab listings={listings} onChanged={refresh} />
          ) : (
            <ActivityTab items={activity} address={address} />
          )}
        </div>
      </div>
    </section>
  );
}

// ── My Agents ───────────────────────────────────────────────────────────────
function AgentsTab({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <EmptyState
        title="No agents yet."
        body="Mint a creative agent to start earning royalties on everything it makes."
        cta={{ href: "/create", label: "Create an agent ->" }}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((a, i) => (
        <Reveal key={a.agentId} delay={Math.min(0.04 * i, 0.24)}>
          <Link
            href={`/agents/${a.agentId}`}
            className="group flex h-full flex-col overflow-hidden rounded-[22px] border transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]"
            style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${a.meta.accent} 7%, var(--color-paper))` }}
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
              <img src={agentPortraitUrl(a)} alt={a.name} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
              <span className="absolute left-3 top-3"><Chip tone="solid" accent={a.meta.accent}>{a.style}</Chip></span>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-display" style={{ fontSize: 24, lineHeight: 1 }}>{a.name}</h3>
                <span className="font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>#{a.agentId}</span>
              </div>
              <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-4 font-mono-x text-[11px]" style={{ borderColor: "var(--color-border)" }}>
                <MiniStat n={a.outputCount} l="outputs" />
                <MiniStat n={a.salesCount} l="sales" />
                <MiniStat n={`${a.royaltiesEarned}`} l="0G earned" />
              </div>
            </div>
          </Link>
        </Reveal>
      ))}
    </div>
  );
}

// ── My Outputs ────────────────────────────────────────────────────────────
function OutputsTab({ outputs }: { outputs: Output[] }) {
  if (outputs.length === 0) {
    return (
      <EmptyState
        title="No outputs yet."
        body="Generate a verifiable piece with any agent. Generation is sponsored; you only pay gas to mint."
        cta={{ href: "/generate", label: "Generate ->" }}
      />
    );
  }
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
      {outputs.map((o, i) => (
        <Reveal key={o.tokenId} delay={Math.min(0.04 * i, 0.24)}>
          <Link
            href={`/outputs/${o.tokenId}`}
            className="group block overflow-hidden rounded-[18px] border transition-shadow duration-300 hover:shadow-[var(--shadow-card)]"
            style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
          >
            <div className="relative aspect-square w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
              <img src={`/images/${encodeURIComponent(o.imageRoot.replace(/^0g:\/\//, ""))}?style=${o.style}`} alt={`${o.agentName} #${o.tokenId}`} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
            </div>
            <div className="flex items-center justify-between p-3 font-mono-x text-[11px]">
              <span style={{ color: "var(--color-ink-2)" }}>{o.agentName} #{o.tokenId}</span>
              <span style={{ color: "var(--color-accent)" }}>-&gt;</span>
            </div>
          </Link>
        </Reveal>
      ))}
    </div>
  );
}

// ── My Listings (inline cancel / update price) ──────────────────────────────
function ListingsTab({ listings, onChanged }: { listings: MarketListing[]; onChanged: () => void }) {
  if (listings.length === 0) {
    return (
      <EmptyState
        title="No active listings."
        body="List an agent or an output for sale from its detail page. Active listings appear here with inline controls to update the price or cancel."
        cta={{ href: "/agents", label: "Browse the catalog ->" }}
      />
    );
  }
  return (
    <div className="space-y-4">
      {listings.map((l, i) => (
        <Reveal key={`${l.collection}-${l.tokenId}`} delay={Math.min(0.04 * i, 0.2)}>
          <ListingRow listing={l} onChanged={onChanged} />
        </Reveal>
      ))}
    </div>
  );
}

// One listing row with an inline trade control. Reuses useTrade (the same hook + manual receipt poll the
// detail-page TradePanel uses) for cancel + update-price. On success it refreshes the dashboard.
function ListingRow({ listing: l, onChanged }: { listing: MarketListing; onChanged: () => void }) {
  const { state, busy, cancel, updatePrice, reset } = useTrade();
  const [price, setPrice] = useState("");
  const kind = (l.collectionName === "agent" ? "agent" : "output") as "agent" | "output";
  const validPrice = /^\d*\.?\d+$/.test(price) && Number(price) > 0;

  // when a trade settles, refresh the dashboard list (the row will fall away if cancelled/sold).
  useEffect(() => {
    if (state.phase === "success") {
      const t = setTimeout(() => {
        reset();
        onChanged();
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [state.phase, reset, onChanged]);

  const href = kind === "agent" ? `/agents/${l.tokenId}` : `/outputs/${l.tokenId}`;

  return (
    <Panel className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Chip tone="accent">{kind}</Chip>
          <Link href={href} className="font-display hover:underline" style={{ fontSize: 20, lineHeight: 1 }}>
            #{l.tokenId}
          </Link>
          <span className="font-mono-x text-[13px]" style={{ color: "var(--color-ink)" }}>
            {l.price} <span style={{ color: "var(--color-ink-3)" }}>0G</span>
          </span>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <div className="flex items-center rounded-full border px-3 sm:w-[180px]" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)" }}>
            <input
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={`New price (now ${l.price})`}
              className="w-full bg-transparent py-2 font-mono-x text-[12px] outline-none"
              style={{ color: "var(--color-ink)" }}
            />
            <span className="font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>0G</span>
          </div>
          <button
            type="button"
            onClick={() => updatePrice(kind, l.tokenId, price)}
            disabled={busy || !validPrice}
            className="rounded-full px-4 py-2 font-mono-x text-[12px] transition-opacity hover:opacity-85 disabled:opacity-40"
            style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}
          >
            {busy && state.action === "updatePrice" ? "..." : "Update"}
          </button>
          <button
            type="button"
            onClick={() => cancel(kind, l.tokenId)}
            disabled={busy}
            className="rounded-full px-4 py-2 font-mono-x text-[12px] transition-opacity hover:opacity-85 disabled:opacity-40"
            style={{ background: "transparent", color: "var(--color-warn)", border: "1px solid var(--color-warn)" }}
          >
            {busy && state.action === "cancel" ? "..." : "Cancel"}
          </button>
        </div>
      </div>

      {state.phase !== "idle" ? (
        <div className="mt-3 font-mono-x text-[11px]" style={{ color: state.phase === "error" ? "var(--color-warn)" : state.phase === "success" ? "var(--color-ok)" : "var(--color-ink-2)" }}>
          {state.phase === "error" ? state.error : state.phase === "success" ? `${state.step ?? "Done"} ✓` : state.step}
          {state.txHash ? (
            <a href={`${EXPLORER}/tx/${state.txHash}`} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
              {shortHex(state.txHash)}
            </a>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

// ── Activity ────────────────────────────────────────────────────────────────
function ActivityTab({ items, address }: { items: Activity[]; address: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="No activity yet."
        body="Your mints, sales, listings, and royalty payouts appear here as they happen on-chain."
        cta={{ href: "/generate", label: "Generate your first piece ->" }}
      />
    );
  }
  const a = address.toLowerCase();
  return (
    <Panel className="overflow-hidden">
      <ul>
        {items.map((e, i) => (
          <li key={e.id} className="flex items-center gap-4 border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
            <span className="font-mono-x text-[11px] tabular-nums" style={{ color: "var(--color-ink-3)" }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <Chip tone={e.kind === "sale" ? "accent" : "default"}>{labelForKind(e.kind)}</Chip>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono-x text-[12px]" style={{ color: "var(--color-ink)" }}>
                {describeEvent(e, a)}
              </div>
              <div className="mt-0.5 font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>
                {timeAgo(e.timestamp)}
                {e.txHash ? (
                  <>
                    {" · "}
                    <a href={`${EXPLORER}/tx/${e.txHash}`} target="_blank" rel="noreferrer" className="underline underline-offset-2" style={{ color: "var(--color-accent)" }}>
                      {shortHex(e.txHash)}
                    </a>
                  </>
                ) : null}
              </div>
            </div>
            {e.price ? (
              <span className="shrink-0 font-mono-x text-[12px]" style={{ color: "var(--color-ink)" }}>
                {e.price} <span style={{ color: "var(--color-ink-3)" }}>0G</span>
              </span>
            ) : e.royaltyPaid && e.royaltyReceiver?.toLowerCase() === a ? (
              <span className="shrink-0 font-mono-x text-[12px]" style={{ color: "var(--color-ok)" }}>
                +{e.royaltyPaid} <span style={{ color: "var(--color-ink-3)" }}>0G</span>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────
function EmptyState({ title, body, cta }: { title: string; body: string; cta: { href: string; label: string } }) {
  return (
    <Panel className="mx-auto max-w-[560px] p-10 text-center">
      <p className="font-display" style={{ fontSize: "clamp(24px,4vw,34px)" }}>{title}</p>
      <p className="mx-auto mt-3 max-w-[44ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{body}</p>
      <div className="mx-auto mt-6 max-w-[260px]">
        <ActionButton href={cta.href}>{cta.label}</ActionButton>
      </div>
    </Panel>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="aura-skeleton h-[260px] rounded-[22px]" />
      ))}
    </div>
  );
}

function MiniStat({ n, l }: { n: number | string; l: string }) {
  return (
    <div>
      <div style={{ color: "var(--color-ink)", fontSize: 15 }}>{n}</div>
      <div className="mt-0.5 uppercase tracking-[0.08em]" style={{ color: "var(--color-ink-3)" }}>{l}</div>
    </div>
  );
}

function labelForKind(kind: string): string {
  switch (kind) {
    case "mint":
      return "mint";
    case "agent_mint":
      return "agent";
    case "sale":
      return "sale";
    case "listing":
      return "listed";
    case "listing_cancel":
      return "cancelled";
    case "price_update":
      return "repriced";
    case "transfer":
      return "transfer";
    case "withdrawal":
      return "withdraw";
    default:
      return kind;
  }
}

// A short human description of an event from the wallet's point of view.
function describeEvent(e: Activity, addr: string): string {
  const name = e.agentName ? e.agentName : e.collectionKind === "agent" ? "an agent" : "an output";
  const tok = e.tokenId !== null ? ` #${e.tokenId}` : "";
  switch (e.kind) {
    case "mint":
      return `Minted ${name}${tok}`;
    case "agent_mint":
      return `Created ${name}${tok}`;
    case "sale":
      if (e.royaltyReceiver?.toLowerCase() === addr && e.actor?.toLowerCase() !== addr && e.counterparty?.toLowerCase() !== addr) {
        return `Royalty from a sale of ${name}${tok}`;
      }
      return e.counterparty?.toLowerCase() === addr ? `Bought ${name}${tok}` : `Sold ${name}${tok}`;
    case "listing":
      return `Listed ${name}${tok}`;
    case "listing_cancel":
      return `Cancelled the listing for ${name}${tok}`;
    case "price_update":
      return `Updated the price of ${name}${tok}`;
    case "transfer":
      return `Transferred ${name}${tok}`;
    case "withdrawal":
      return "Withdrew proceeds";
    default:
      return `${e.kind} ${name}${tok}`;
  }
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
