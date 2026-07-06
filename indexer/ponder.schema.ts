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

// ═════════════════════════════ GAME LAYER (v2 mainnet cutover) ═════════════════════════════
// The 3 game contracts (ArenaVote / AuraFusion / ArenaReputation) deployed on 0G mainnet 16661 at
// gameDeployBlock. Everything below is reconstructed by replaying their events from that block, exactly
// like the economy read-model above (nothing hand-seeded). These power the /arena/* + /fusion/* read
// APIs the Fastify backend proxies under /api/* (server/src/routes/indexer.ts passthrough), so the Arena
// feed, the ladder standings, and fusion lineage return REAL indexed data instead of a 502.

// ───────────────────────────── battles (ArenaVote) ─────────────────────────────
// One row per BattleCreated; mutated by Committed (count), Revealed (count), Finalized (verdict). The
// winner + weights are the contract's ENFORCED tally (from Finalized); the keyless /api/arena/tally
// server endpoint independently recomputes them from the Revealed log (that is the trust root, not this row).
export const battles = onchainTable(
  "battles",
  (t) => ({
    battleId: t.bigint().primaryKey(),
    agentA: t.bigint().notNull(),
    agentB: t.bigint().notNull(),
    commitEnd: t.bigint().notNull(), // unix seconds (commit window close)
    revealEnd: t.bigint().notNull(), // unix seconds (reveal window close)
    finalized: t.boolean().notNull().default(false),
    rated: t.boolean().notNull().default(false), // did it clear quorum -> feed the ladder
    winner: t.integer().notNull().default(0), // 0 = tie/none, 1 = A, 2 = B (from Finalized)
    weightA: t.bigint().notNull().default(0n), // enforced tally weight for A (wei-scaled stake)
    weightB: t.bigint().notNull().default(0n),
    pool: t.bigint().notNull().default(0n), // total staked pool (wei)
    commitCount: t.integer().notNull().default(0),
    revealCount: t.integer().notNull().default(0),
    createdAt: t.bigint().notNull(), // block timestamp (seconds)
    createdBlock: t.bigint().notNull(),
    finalizedAt: t.bigint(), // null until Finalized
    orderKey: t.bigint().notNull(), // block<<16 | logIndex (newest sort / keyset)
  }),
  (table) => ({
    agentAIdx: index().on(table.agentA),
    agentBIdx: index().on(table.agentB),
    finalizedIdx: index().on(table.finalized),
    orderIdx: index().on(table.orderKey),
  })
);

// ───────────────────────────── votes (ArenaVote Revealed) ─────────────────────────────
// One row per revealed ballot. Blind commits are NOT stored as votes (they carry no side until reveal).
export const votes = onchainTable(
  "votes",
  (t) => ({
    id: t.text().primaryKey(), // `${battleId}-${voter}`
    battleId: t.bigint().notNull(),
    voter: t.hex().notNull(),
    choice: t.integer().notNull(), // 1 = A, 2 = B
    stake: t.bigint().notNull(), // wei locked at commit
    weight: t.bigint().notNull(), // LINEAR weight the contract emitted (== stake)
    revealedAt: t.bigint().notNull(),
    orderKey: t.bigint().notNull(),
  }),
  (table) => ({
    battleIdx: index().on(table.battleId),
    voterIdx: index().on(table.voter),
    orderIdx: index().on(table.orderKey),
  })
);

// ───────────────────────────── lineage (AuraFusion) ─────────────────────────────
// Per-agent genome/lineage anchor: a GENESIS agent (GenesisRegistered) or a FUSED child (FusionExecuted).
// Children point at their two parents + carry the derived generation + per-fusion seed. `/fusion/lineage/:id`
// returns this row plus the agent's children (rows whose parentA/parentB == :id).
export const lineage = onchainTable(
  "lineage",
  (t) => ({
    agentId: t.bigint().primaryKey(),
    generation: t.integer().notNull().default(1), // 1 for genesis; max(parentGen)+1 for a fused child
    parentA: t.bigint().notNull().default(0n), // 0 for a genesis agent
    parentB: t.bigint().notNull().default(0n),
    isGenesis: t.boolean().notNull().default(true),
    styleFingerprint: t.hex(), // from GenesisRegistered (null for a fused child)
    fuseSeed: t.hex(), // from FusionExecuted (null for a genesis agent)
    requestId: t.bigint(), // the fusion request that produced this child (null for genesis)
    fuser: t.hex(), // who fused this child (null for genesis; resolved from the matching request)
    createdAt: t.bigint().notNull(),
    orderKey: t.bigint().notNull(),
  }),
  (table) => ({
    parentAIdx: index().on(table.parentA),
    parentBIdx: index().on(table.parentB),
    generationIdx: index().on(table.generation),
    orderIdx: index().on(table.orderKey),
  })
);

// ───────────────────────────── fusion_requests (AuraFusion) ─────────────────────────────
// One row per FusionRequested (the commit half of the future-block commit-reveal). Marked executed on
// FusionExecuted, refunded on FusionRefunded. Carries the `fuser` the FusionExecuted event omits.
export const fusionRequests = onchainTable(
  "fusion_requests",
  (t) => ({
    requestId: t.bigint().primaryKey(),
    fuser: t.hex().notNull(),
    parentA: t.bigint().notNull(),
    parentB: t.bigint().notNull(),
    targetBlock: t.bigint().notNull(),
    fee: t.bigint().notNull(), // wei escrowed
    executed: t.boolean().notNull().default(false),
    refunded: t.boolean().notNull().default(false),
    childId: t.bigint(), // set on execute
    requestedAt: t.bigint().notNull(),
    orderKey: t.bigint().notNull(),
  }),
  (table) => ({
    fuserIdx: index().on(table.fuser),
    orderIdx: index().on(table.orderKey),
  })
);

// ───────────────────────────── fusions (AuraFusion FusionExecuted) ─────────────────────────────
// One row per executed fusion (the minted child + its provenance). Powers a fusion activity feed.
export const fusions = onchainTable(
  "fusions",
  (t) => ({
    requestId: t.bigint().primaryKey(),
    childId: t.bigint().notNull(),
    parentA: t.bigint().notNull(),
    parentB: t.bigint().notNull(),
    fuseSeed: t.hex().notNull(),
    generation: t.integer().notNull(),
    fuser: t.hex(), // resolved from the matching request (null if the request row was missed)
    executedAt: t.bigint().notNull(),
    executedBlock: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    orderKey: t.bigint().notNull(),
  }),
  (table) => ({
    childIdx: index().on(table.childId),
    parentAIdx: index().on(table.parentA),
    parentBIdx: index().on(table.parentB),
    orderIdx: index().on(table.orderKey),
  })
);

// ───────────────────────────── seasons (ArenaReputation SeasonAnchored) ─────────────────────────────
// One row per anchored season (a Merkle commitment to the whole { agentId -> (rating, RD) } ladder). The
// per-agent ratings live in the off-chain tree (keyless-recomputable via /api/arena/ladder/verify); the
// chain stores only the root, so this is all ArenaReputation emits. The ladder API surfaces the latest root.
export const seasons = onchainTable(
  "seasons",
  (t) => ({
    seasonEpoch: t.bigint().primaryKey(),
    ladderRoot: t.hex().notNull(),
    anchoredAt: t.bigint().notNull(),
    anchoredBlock: t.bigint().notNull(),
    txHash: t.hex().notNull(),
    orderKey: t.bigint().notNull(),
  }),
  (table) => ({
    orderIdx: index().on(table.orderKey),
  })
);
