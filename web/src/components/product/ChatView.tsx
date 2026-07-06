"use client";

// The dedicated /chat surface (Claude-AI layout): a LEFT SIDEBAR of the user's Auras-as-conversations and
// a MAIN AREA that is the selected Aura's full-height chat. Sessions are LEAN per-Aura: there is no new
// backend "session" concept - each Aura IS one persistent, owner-scoped thread (the existing per-(agent,
// owner) sealed memory). The sidebar lists the Auras you can talk to and surfaces the ones you already
// have a relationship with (last-message snippet, most-recent first) by reading GET /chat/:id/history.
//
// The main area reuses the chat engine + renderers wholesale via AuraChatThread (bubbles, the per-reply
// TEE-verified badge, tool cards, the non-custodial RelicMintCard, the SIWE gate, the composer). Deep-link
// via ?agent=<id> preselects an Aura (the Aura detail page links here). Mobile collapses to a list <-> chat
// view (the sidebar is the list; opening an Aura shows the chat with a back affordance).
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAuth } from "@/components/web3/AuthProvider";
import { AuraChatThread } from "@/components/product/AuraChat";
import { ActionButton, ConnectGate } from "@/components/product/primitives";
import { CHAIN_FULL } from "@/lib/chains";
import { agentPortraitUrl, fetchChatHistory, type Agent } from "@/lib/api";

type HistEntry = { snippet: string; ts: string };

export function ChatView({ agents, initialAgentId }: { agents: Agent[]; initialAgentId?: string }) {
  const { token } = useAuth();
  const { isConnected } = useAccount();

  // Selection is client-only; the URL reflects it via replaceState (no server round-trip per click). The
  // initial value comes from the server-resolved deep-link, validated against the real agent list.
  const initialId = useMemo(() => {
    const n = Number(initialAgentId);
    if (!Number.isInteger(n)) return null;
    return agents.some((a) => a.agentId === n) ? n : null;
  }, [initialAgentId, agents]);

  const [selectedId, setSelectedId] = useState<number | null>(initialId);
  const [query, setQuery] = useState("");
  const [histMap, setHistMap] = useState<Record<number, HistEntry>>({});
  // Desktop sidebar collapse (Claude-AI style). On mobile the list<->chat swap already handles space.
  const [collapsed, setCollapsed] = useState(false);

  // Detect existing conversations once signed in: read each Aura's owner-scoped history (cheap sealed-
  // memory reads, parallel + fail-soft) to populate last-message snippets + recency. Until sign-in the
  // sidebar still lists every Aura (no snippets) so the user sees who they can talk to.
  useEffect(() => {
    if (!token) {
      setHistMap({});
      return;
    }
    let alive = true;
    (async () => {
      const entries = await Promise.all(
        agents.map(async (a) => {
          try {
            const turns = await fetchChatHistory(token, a.agentId);
            if (!turns.length) return null;
            const last = turns[turns.length - 1];
            const snippet = (last.auraText || last.ownerText || "").trim();
            return [a.agentId, { snippet, ts: last.ts }] as const;
          } catch {
            return null;
          }
        }),
      );
      if (!alive) return;
      const map: Record<number, HistEntry> = {};
      for (const e of entries) if (e) map[e[0]] = e[1];
      setHistMap(map);
    })();
    return () => {
      alive = false;
    };
  }, [token, agents]);

  // Keep the URL in sync so a conversation is shareable / refresh-stable, without a Next navigation
  // (which would re-run the server fetch + remount). Pure URL reflection of client state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = selectedId != null ? `/chat?agent=${selectedId}` : "/chat";
    window.history.replaceState(window.history.state, "", url);
  }, [selectedId]);

  // Conversations-with-history first (most recent), then the rest in the catalog order the server sent.
  const ordered = useMemo(() => {
    const ts = (a: Agent) => histMap[a.agentId]?.ts;
    return [...agents].sort((x, y) => {
      const tx = ts(x);
      const ty = ts(y);
      if (tx && ty) return ty.localeCompare(tx); // ISO desc = newest first
      if (tx) return -1;
      if (ty) return 1;
      return 0; // stable: preserve the server's featured order
    });
  }, [agents, histMap]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((a) => a.name.toLowerCase().includes(q));
  }, [ordered, query]);

  const selected = useMemo(() => agents.find((a) => a.agentId === selectedId) ?? null, [agents, selectedId]);

  return (
    <main className="h-[100dvh] overflow-hidden" style={{ background: "var(--color-cream)" }}>
      <div className="flex h-full w-full overflow-hidden">
        {/* ── Sidebar (the conversations) ── smooth width collapse on desktop (.chat-sidebar) ── */}
        <aside
          data-collapsed={collapsed}
          // When collapsed (desktop, width:0) the list is still in the DOM: `inert` takes its links out of
          // the tab order + a11y tree so keyboard/SR users don't land in an invisible zero-width panel.
          inert={collapsed}
          aria-hidden={collapsed || undefined}
          className={`${selected ? "hidden md:flex" : "flex"} chat-sidebar shrink-0 overflow-hidden border-r`}
          style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
        >
          {/* fixed-width inner: stays md:w-[320px] so it clips cleanly as the aside width animates to 0 */}
          <div className="flex h-full w-full flex-col md:w-[320px]">
          <div className="border-b px-4 py-3.5" style={{ borderColor: "var(--color-border)" }}>
            {/* top row: back to the main site + collapse toggle (the global nav is hidden on /chat) */}
            <div className="flex items-center justify-between">
              <Link
                href="/"
                className="micro inline-flex items-center gap-2 text-[16px] font-semibold hover:opacity-70 active:scale-[0.97]"
                style={{ color: "var(--color-ink-2)" }}
                aria-label="Back to AURA"
              >
                <ArrowLeft />
                <span className="font-display" style={{ fontSize: 20, letterSpacing: "0.18em", color: "var(--color-ink)" }}>AURA</span>
              </Link>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="hidden h-8 w-8 items-center justify-center rounded-[10px] border micro active:scale-[0.92] hover:bg-[color-mix(in_oklab,var(--color-ink)_5%,transparent)] md:inline-flex"
                style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}
              >
                <PanelIcon />
              </button>
            </div>

            <div className="mt-3.5 flex items-baseline justify-between">
              <h1 className="font-display" style={{ fontSize: "20px", lineHeight: 1 }}>
                Your Auras
              </h1>
              <span className="font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                {agents.length}
              </span>
            </div>
            <p className="mt-1 label-caps text-[12px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.14em" }}>
              One thread per Aura
            </p>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Auras..."
              aria-label="Search your Auras"
              className="mt-3 w-full rounded-[12px] border border-[var(--color-border-strong)] px-3 py-2 text-[16px] font-medium outline-none micro focus:border-[var(--color-accent)]"
              style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}
            />
          </div>

          {/* data-lenis-prevent: the global Lenis smooth-scroll otherwise swallows the wheel here, so the
              list never scrolls with the wheel. This hands wheel/touch back to native scroll for the list. */}
          <div data-lenis-prevent className="scroll-affordance min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                {agents.length === 0 ? "No Auras yet." : "No Auras match that search."}
              </p>
            ) : (
              filtered.map((a) => (
                <ConversationRow
                  key={a.agentId}
                  agent={a}
                  active={a.agentId === selectedId}
                  hist={histMap[a.agentId] ?? null}
                  onSelect={() => setSelectedId(a.agentId)}
                />
              ))
            )}
          </div>

          <div className="border-t px-4 py-3" style={{ borderColor: "var(--color-border)" }}>
            <Link href="/agents" className="lnk inline-flex items-center gap-1.5 text-[16px] font-semibold tracking-[0.005em] hover:underline" style={{ color: "var(--color-ink-2)" }}>
              Browse all Auras <span className="arrow" aria-hidden>-&gt;</span>
            </Link>
          </div>
          </div>
        </aside>

        {/* ── Main area (the selected Aura's chat) ── */}
        <section className={`${selected ? "flex" : "hidden md:flex"} relative min-w-0 flex-1 flex-col`} style={{ background: "var(--color-cream)" }}>
          {/* re-open button when the sidebar is collapsed (desktop). Always mounted so it can fade in as
              the sidebar finishes collapsing (delay in) and fade out instantly when it re-opens. */}
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            aria-label="Open sidebar"
            title="Open sidebar"
            className={`micro absolute left-4 top-4 z-20 hidden h-9 w-9 items-center justify-center rounded-[10px] border shadow-[var(--shadow-card)] active:scale-[0.92] hover:bg-[color-mix(in_oklab,var(--color-ink)_5%,transparent)] md:inline-flex ${collapsed ? "opacity-100" : "pointer-events-none opacity-0"}`}
            style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)", color: "var(--color-ink-2)", transitionDelay: collapsed ? "240ms" : "0ms" }}
            tabIndex={collapsed ? 0 : -1}
            aria-hidden={!collapsed}
          >
            <PanelIcon />
          </button>
          {!selected ? (
            <EmptyMain hasAgents={agents.length > 0} />
          ) : !isConnected ? (
            <div className="flex h-full flex-col">
              <MobileBackBar agentName={selected.name} onBack={() => setSelectedId(null)} />
              <div className="flex flex-1 items-center justify-center px-5">
                <ConnectGate
                  title="Connect to chat"
                  body={`Conversations with ${selected.name} are keyed to your wallet on the ${CHAIN_FULL}. Connect, then sign in once to talk.`}
                >
                  <ConnectButton.Custom>
                    {({ openConnectModal }) => <ActionButton onClick={openConnectModal}>Connect wallet</ActionButton>}
                  </ConnectButton.Custom>
                </ConnectGate>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <MobileBackBar agentName={selected.name} onBack={() => setSelectedId(null)} />
              {/* keyed by agentId: a clean per-Aura reset (no stale transcript flash on switch) */}
              <div className="min-h-0 flex-1">
                <AuraChatThread key={selected.agentId} agentId={selected.agentId} agentName={selected.name} accent={selected.meta.accent} />
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

// ── icons ────────────────────────────────────────────────────────────────────
function ArrowLeft() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  );
}
function PanelIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

// One Aura row in the sidebar: portrait + name + the last-message snippet (or its tagline before any
// conversation exists). Active state tints with the Aura's accent.
function ConversationRow({ agent: a, active, hist, onSelect }: { agent: Agent; active: boolean; hist: HistEntry | null; onSelect: () => void }) {
  const accent = a.meta.accent;
  const portrait = agentPortraitUrl(a, 96);
  const secondary = hist?.snippet || a.meta.tagline || "";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`group relative mb-1 flex w-full items-center gap-3 rounded-[14px] py-2.5 pl-4 pr-3 text-left micro ${active ? "" : "hover:bg-[color-mix(in_oklab,var(--color-ink)_5%,transparent)]"}`}
      style={active ? { background: `color-mix(in oklab, ${accent} 13%, var(--color-paper))` } : undefined}
    >
      {/* clean active indicator: a short rounded accent bar, fully inside the rounded card (no clipped border) */}
      {active ? (
        <span className="absolute left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full" style={{ background: accent }} aria-hidden />
      ) : null}
      <span
        className="relative block h-10 w-10 shrink-0 overflow-hidden rounded-[10px] border"
        style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 12%, var(--color-paper))` }}
      >
        <img src={portrait} alt="" className="h-full w-full object-cover" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-display" style={{ fontSize: "15px", lineHeight: 1.2, color: "var(--color-ink)" }}>
            {a.name}
          </span>
          {hist ? <span className="h-3 w-px shrink-0" style={{ background: accent }} title="You have a conversation with this Aura" /> : null}
        </span>
        <span className="mt-0.5 block truncate text-[16px] leading-snug" style={{ color: "var(--color-ink-3)" }}>
          {secondary}
        </span>
      </span>
    </button>
  );
}

// Mobile-only top bar to return to the conversation list (the sidebar is hidden once a chat opens on small
// screens). Hidden on md+ where both panes are visible.
function MobileBackBar({ agentName, onBack }: { agentName: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b px-4 py-3 md:hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}>
      <button type="button" onClick={onBack} className="micro inline-flex items-center gap-1.5 text-[16px] font-semibold hover:underline active:scale-[0.97]" style={{ color: "var(--color-ink-2)" }}>
        <ArrowLeft /> Auras
      </button>
      <span className="truncate label-caps text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
        {agentName}
      </span>
    </div>
  );
}

// The pre-selection empty state on desktop (the sidebar is the focus until an Aura is chosen).
function EmptyMain({ hasAgents }: { hasAgents: boolean }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-[42ch] text-center">
        <div className="label-caps text-[12px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          Chat with an Aura
        </div>
        <h2 className="font-display mt-3" style={{ fontSize: "clamp(26px,4vw,38px)", lineHeight: 1.04 }}>
          {hasAgents ? "Pick an Aura to start talking." : "No Auras to talk to yet."}
        </h2>
        <p className="mx-auto mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          Each Aura is in character, remembers your past conversations, knows its own on-chain record, and can create a Relic on request. Replies served by 0G are TEE-attested per reply.
        </p>
      </div>
    </div>
  );
}
