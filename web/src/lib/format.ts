// Shared activity/formatting helpers. These were hand-duplicated (and had drifted) across ExploreView,
// DashboardView, and ActivityTicker: a relative-time formatter, an event-kind label map, and a per-event
// description. Consolidated here so all three read the SAME vocabulary + logic, and so a new on-chain
// event kind gets a label in one place.
import type { Activity } from "./api";

// Relative "N{s,m,h,d} ago" from a unix-seconds timestamp.
export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// A deterministic absolute timestamp for hydration-safe rendering: identical on the server and the client
// (pure UTC from the unix seconds - no Date.now, no locale), so a client component can render THIS during SSR
// + first paint, then switch to the Date.now-relative timeAgo after mount. Prevents the SSR/client mismatch.
export function absTime(ts: number): string {
  return `${new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// Canonical short label for an activity kind (lowercase; callers uppercase where their style needs it).
// Covers the kinds the indexer emits, including ones the old per-file maps missed (brain_update, summon,
// cancel/reprice/withdraw). Falls back to the raw kind so an unknown future kind still renders.
const KIND_LABELS: Record<string, string> = {
  mint: "mint",
  agent_mint: "aura",
  sale: "sale",
  listing: "listed",
  listing_cancel: "cancelled",
  price_update: "repriced",
  transfer: "transfer",
  withdrawal: "withdraw",
  brain_update: "brain",
  summon: "summon",
  summon_fulfilled: "summon",
};
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

// A short human description of an event. When `addr` is provided (the dashboard's wallet view) it is
// PERSPECTIVE-AWARE: a sale reads as Bought / Sold / "Royalty from a sale" from that wallet's point of view.
// Without `addr` (a public feed / global ticker, where there is no viewer) a sale reads neutrally as "Sold".
//
// FIELD MAPPING (source of truth: indexer/src/index.ts AuraMarketplace:Sold -> actor=BUYER, counterparty=
// SELLER). So the viewer is the BUYER when addr === e.actor, and the SELLER when addr === e.counterparty.
// (A previous version tested counterparty for "Bought", which inverted it: the buyer saw "Sold".)
export function describeActivity(e: Activity, addr?: string): string {
  const name = e.agentName ? e.agentName : e.collectionKind === "agent" ? "an Aura" : "a Relic";
  const tok = e.tokenId !== null ? ` #${e.tokenId}` : "";
  const a = addr?.toLowerCase();
  switch (e.kind) {
    case "mint":
      return `Minted ${name}${tok}`;
    case "agent_mint":
      return `Created ${name}${tok}`;
    case "sale":
      // Royalty payout: the viewer is the royalty receiver but was neither the buyer (actor) nor the seller
      // (counterparty) -- a creator/owner earning the resale royalty on someone else's trade.
      if (a && e.royaltyReceiver?.toLowerCase() === a && e.actor?.toLowerCase() !== a && e.counterparty?.toLowerCase() !== a) {
        return `Royalty from a sale of ${name}${tok}`;
      }
      // Viewer === buyer (actor) -> Bought; viewer === seller (counterparty) -> Sold. Neutral "Sold" when no viewer.
      if (a) return e.actor?.toLowerCase() === a ? `Bought ${name}${tok}` : `Sold ${name}${tok}`;
      return `Sold ${name}${tok}`;
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
    case "brain_update":
      return `Updated ${name}${tok}'s brain`;
    default:
      return `${e.kind} ${name}${tok}`;
  }
}
