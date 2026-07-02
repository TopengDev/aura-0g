// AURA v2 derived read model (Ponder 0.16 schema). Built ONLY from on-chain events indexed from the
// deploy block. Everything here is reconstructed by replaying logs; nothing is hand-seeded.
//
// Design notes:
//   - Money is bigint wei throughout (never float). The API layer formats to ether strings.
//   - Ownership is reconstructed from ERC721 Transfer (mint = from 0x0). The Mint/Output events seed
//     the row; subsequent Transfers update `owner`. Tracking both keeps a single coherent current-owner.
//   - Listings are keyed by (collection,tokenId); `active` is cleared on Sold/Cancelled. We keep the
//     row (not delete) so historic listings remain queryable; "active listings" = WHERE active.
//   - Earnings are point-in-time cumulative sums credited at each Sold (royaltyReceiver is captured in
//     the event itself, so it survives later agent resale: the receiver was whoever owned the agent at
//     sale time). agent_earnings keys by the SELLING agent's id; wallet_earnings by royaltyReceiver.
//   - agent_stats carries raw counters PLUS pre-decayed activity buckets used to compute a rolling
//     trending score at query time (see src/api - the score is recomputed against `now`, not frozen).
//   - `events` is the append-only activity log powering the feed + the trending windows + newest sort,
//     with a global monotonic ordering key (block << 16 | logIndex) for stable keyset pagination.
import { onchainTable, index, primaryKey } from "ponder";

// ───────────────────────────── agents ─────────────────────────────
export const agents = onchainTable(
  "agents",
  (t) => ({
    agentId: t.bigint().primaryKey(),
    owner: t.hex().notNull(), // CURRENT owner (follows ERC721 Transfer)
    creator: t.hex().notNull(), // original minter (pinned; resale-royalty target)
    name: t.text().notNull(),
    styleFingerprint: t.hex().notNull(),
    modelAttestation: t.hex().notNull(),
    royaltyBps: t.integer().notNull(), // OUTPUT royalty (from AgentMinted)
    creatorResaleBps: t.integer().notNull(), // AGENT-resale royalty (read once at mint)
    styleVersion: t.integer().notNull().default(1), // bumped by BrainUpdated
    encBrainRoot: t.text(), // latest brain pointer (from BrainUpdated; null at mint)
    mintedAt: t.bigint().notNull(), // block timestamp (seconds)
    mintBlock: t.bigint().notNull(),
    mintLogIndex: t.integer().notNull(),
    orderKey: t.bigint().notNull(), // block<<16 | logIndex, for newest sort / keyset
  }),
  (table) => ({
    ownerIdx: index().on(table.owner),
    creatorIdx: index().on(table.creator),
    nameIdx: index().on(table.name),
    orderIdx: index().on(table.orderKey),
  })
);

// ───────────────────────────── outputs ─────────────────────────────
export const outputs = onchainTable(
  "outputs",
  (t) => ({
    tokenId: t.bigint().primaryKey(),
    owner: t.hex().notNull(), // CURRENT owner (follows ERC721 Transfer)
    creatorAgentId: t.bigint().notNull(), // which agent made it -> royalty routing
    imageRoot: t.text().notNull(),
    provenanceHash: t.hex().notNull(),
    teeAttestation: t.hex().notNull(),
    seed: t.bigint().notNull(),
    mintedAt: t.bigint().notNull(), // block timestamp (seconds)
    mintBlock: t.bigint().notNull(),
    mintLogIndex: t.integer().notNull(),
    orderKey: t.bigint().notNull(), // block<<16 | logIndex, for newest sort / keyset
  }),
  (table) => ({
    ownerIdx: index().on(table.owner),
    agentIdx: index().on(table.creatorAgentId),
    orderIdx: index().on(table.orderKey),
  })
);

// ───────────────────────────── listings ─────────────────────────────
// One row per (collection,tokenId). `active` is the live state; cleared on Sold/Cancelled.
export const listings = onchainTable(
  "listings",
  (t) => ({
    id: t.text().primaryKey(), // `${collection}-${tokenId}` (lowercased collection)
    collection: t.hex().notNull(),
    tokenId: t.bigint().notNull(),
    collectionKind: t.text().notNull(), // "agent" | "output" | "unknown"
    seller: t.hex().notNull(),
    price: t.bigint().notNull(), // wei
    active: t.boolean().notNull(),
    listedAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
    orderKey: t.bigint().notNull(), // last state-change order key
  }),
  (table) => ({
    activeIdx: index().on(table.active),
    collectionIdx: index().on(table.collection),
    sellerIdx: index().on(table.seller),
    orderIdx: index().on(table.orderKey),
  })
);

// ───────────────────────── agent_earnings ─────────────────────────
// Per SELLING-agent cumulative royalty earned (sum of royaltyPaid over Sold of that agent's outputs).
export const agentEarnings = onchainTable("agent_earnings", (t) => ({
  agentId: t.bigint().primaryKey(),
  royaltiesEarned: t.bigint().notNull().default(0n), // wei - resale royalties (EIP-2981 on Sold)
  salesCount: t.integer().notNull().default(0),
  summonEarned: t.bigint().notNull().default(0n), // wei - PRIMARY summon commissions (ownerCut on Fulfilled)
  summonCount: t.integer().notNull().default(0), // number of fulfilled summons of this agent
  lastSaleAt: t.bigint(),
}));

// ───────────────────────── wallet_earnings ────────────────────────
// Per royaltyReceiver cumulative royalty earned (point-in-time; survives agent resale).
export const walletEarnings = onchainTable(
  "wallet_earnings",
  (t) => ({
    wallet: t.hex().primaryKey(),
    royaltiesEarned: t.bigint().notNull().default(0n), // wei - resale royalties (point-in-time; survives resale)
    salesCount: t.integer().notNull().default(0),
    summonEarned: t.bigint().notNull().default(0n), // wei - PRIMARY summon commissions credited to this wallet
    summonCount: t.integer().notNull().default(0), // number of summons where this wallet was the agent owner
    lastSaleAt: t.bigint(),
  }),
  (table) => ({
    earnedIdx: index().on(table.royaltiesEarned),
  })
);

// ─────────────────────────── agent_stats ──────────────────────────
// Counters + decayed activity buckets. The rolling trending score is computed at QUERY time from the
// windowed `events` table (so it always reflects `now`), but we keep cheap counters here for top sorts.
export const agentStats = onchainTable(
  "agent_stats",
  (t) => ({
    agentId: t.bigint().primaryKey(),
    name: t.text().notNull(),
    outputCount: t.integer().notNull().default(0), // outputs created by this agent
    salesCount: t.integer().notNull().default(0), // sales of this agent's outputs
    listingsCount: t.integer().notNull().default(0), // listings opened for this agent's outputs
    summonCount: t.integer().notNull().default(0), // fulfilled summons of this agent (primary commissions)
    royaltiesEarned: t.bigint().notNull().default(0n), // mirror of agent_earnings for one-shot sorts
    summonEarned: t.bigint().notNull().default(0n), // mirror of agent_earnings.summonEarned for one-shot sorts
    lastActivityAt: t.bigint(),
  }),
  (table) => ({
    outputsIdx: index().on(table.outputCount),
    salesIdx: index().on(table.salesCount),
  })
);

// ─────────────────────────────── events ───────────────────────────
// Append-only activity log. Powers: the activity feed (keyset by orderKey desc), the trending window
// query (filter ts >= now-window, weight by kind), and is the canonical event audit. One row per log.
export const events = onchainTable(
  "events",
  (t) => ({
    id: t.text().primaryKey(), // `${block}-${logIndex}` (globally unique per chain)
    kind: t.text().notNull(), // "mint" | "sale" | "listing" | "listing_cancel" | "price_update" | "agent_mint" | "brain_update" | "transfer" | "withdrawal"
    orderKey: t.bigint().notNull(), // block<<16 | logIndex (monotonic; keyset pagination)
    blockNumber: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    timestamp: t.bigint().notNull(), // block timestamp (seconds) - log.blockTimestamp is 0x0 on 0G
    txHash: t.hex().notNull(),
    // denormalized subjects (nullable; depend on kind):
    collection: t.hex(),
    collectionKind: t.text(), // "agent" | "output"
    tokenId: t.bigint(), // output tokenId or agent id, per collection
    agentId: t.bigint(), // the creating/selling agent (for outputs/sales/mints)
    actor: t.hex(), // primary actor: minter/buyer/seller
    counterparty: t.hex(), // secondary actor (seller on a sale, recipient on a transfer)
    price: t.bigint(), // wei (listing/sale)
    royaltyReceiver: t.hex(),
    royaltyPaid: t.bigint(), // wei
    platformFee: t.bigint(), // wei
    sellerProceeds: t.bigint(), // wei
  }),
  (table) => ({
    orderIdx: index().on(table.orderKey),
    kindIdx: index().on(table.kind),
    kindOrderIdx: index().on(table.kind, table.orderKey),
    tsIdx: index().on(table.timestamp),
    agentIdx: index().on(table.agentId),
  })
);
