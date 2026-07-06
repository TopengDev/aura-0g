// AURA v2 indexing functions (Ponder 0.16). Replays AgentRegistry + OutputNFT + AuraMarketplace logs
// from the deploy block into the derived read model (ponder.schema.ts). All handlers are idempotent
// (insert ... onConflictDoUpdate) so a crash/reorg re-run never double-counts.
//
// EVENT ORDERING (verified against the contracts):
//   - Mint path: _safeMint(...) emits ERC721 `Transfer(0x0 -> to)` BEFORE the rich `AgentMinted` /
//     `OutputMinted` event (the emit is the last line of the mint fn). So a mint Transfer arrives with
//     NO row yet. We therefore IGNORE mint Transfers (from == 0x0) and let the rich Mint handler create
//     the row with the correct initial owner. Non-mint Transfers (real moves / marketplace settlement)
//     update `owner` on the existing row.
//   - Sale path: AuraMarketplace.buy() does safeTransferFrom (a `Transfer`) and THEN emits `Sold`. The
//     Transfer updates ownership; `Sold` credits earnings + clears the listing + logs the sale.
//
// 0G timestamps: log.blockTimestamp is 0x0 on this RPC, so we ALWAYS use event.block.timestamp (the
// block header), which Ponder populates correctly.
import { ponder } from "ponder:registry";
import {
  agents,
  outputs,
  listings,
  agentEarnings,
  walletEarnings,
  agentStats,
  events,
  battles,
  votes,
  lineage,
  fusionRequests,
  fusions,
  seasons,
} from "ponder:schema";

import { createPublicClient, http } from "viem";
import { AgentRegistryAbi } from "../abis/AgentRegistry";
import { AuraINFTAbi } from "../abis/AuraINFT";

const ZERO = "0x0000000000000000000000000000000000000000";

// deployed-v2 collection addresses (lowercased) for classifying marketplace events by collection.
// Read from the same JSON the config uses (one source of truth). Resolved once at module load.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEPLOYED = JSON.parse(
  readFileSync(path.join(__dirname, "..", "..", "contracts", "deployed-v2.json"), "utf8")
);
const ADDR_AGENT = String(DEPLOYED.agentRegistry).toLowerCase();
const ADDR_OUTPUT = String(DEPLOYED.outputNFT).toLowerCase();
// AuraINFT (ERC-7857 cutover) collection address. "" (pre-cutover) => a placeholder that no real event matches,
// so classification is inert until the cutover sets deployed-v2.json.auraINFT.
const ADDR_AURAINFT = /^0x[0-9a-fA-F]{40}$/.test(String(DEPLOYED.auraINFT ?? ""))
  ? String(DEPLOYED.auraINFT).toLowerCase()
  : "0x000000000000000000000000000000000000dead";

// Standalone viem client for reading IMMUTABLE agent state (creatorResaleBps) at "latest". We do NOT
// use Ponder's context.client here because it pins eth_call to the event's (historical) block, and 0G
// Galileo's public RPC PRUNES historical STATE -> a past-block eth_call returns InvalidInputRpcError.
// creatorResaleBps is set once at mint and never changes (no setter in AgentRegistry), so "latest" is
// both correct and prune-safe. A tiny in-memory cache avoids re-reading the same agent on re-index.
const RPC = process.env.PONDER_RPC_URL_16661 ?? process.env.PONDER_RPC_URL_16602 ?? String(DEPLOYED.rpcUrl);
const stateClient = createPublicClient({ transport: http(RPC) });
const creatorResaleCache = new Map<string, number>();

// creatorResaleBps is NOT in the AgentMinted event; read it (immutable post-mint -> prune-safe at "latest")
// from the registry the agent lives on. Parameterized by (address, abi) so it serves BOTH AgentRegistry and
// AuraINFT, cached by `${address}:${agentId}` so the two registries never collide on a shared numeric id.
async function readCreatorResaleBps(address: string, abi: unknown, agentId: bigint): Promise<number> {
  const key = `${address.toLowerCase()}:${agentId.toString()}`;
  const cached = creatorResaleCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const v = (await stateClient.readContract({
      abi: abi as never,
      address: address as `0x${string}`,
      functionName: "creatorResaleBpsOf",
      args: [agentId],
      // default blockTag is "latest" - prune-safe, and the value is immutable post-mint.
    })) as bigint | number;
    const n = Number(v);
    creatorResaleCache.set(key, n);
    return n;
  } catch {
    return 0; // immutable + readable at latest; 0 only on an unexpected RPC failure.
  }
}

function collectionKind(collection: string): "agent" | "output" | "unknown" {
  const c = collection.toLowerCase();
  if (c === ADDR_AGENT) return "agent";
  if (c === ADDR_AURAINFT) return "agent"; // AuraINFT agents are the same read-model "agent" kind
  if (c === ADDR_OUTPUT) return "output";
  return "unknown";
}

// Global monotonic ordering key for stable keyset pagination + newest sort: block << 16 | logIndex.
// logIndex < 65536 per block is a safe assumption on this low-traffic testnet.
function orderKey(blockNumber: bigint, logIndex: number): bigint {
  return (blockNumber << 16n) | BigInt(logIndex);
}

function listingId(collection: string, tokenId: bigint): string {
  return `${collection.toLowerCase()}-${tokenId.toString()}`;
}

function eventId(blockNumber: bigint, logIndex: number): string {
  return `${blockNumber.toString()}-${logIndex}`;
}

// A defensive `context.db.update(...)` may target a row that is not indexed yet (an out-of-order event) or
// was reverted (reorg): Ponder throws RecordNotFoundError ("No existing record found in table ...") for that,
// which is EXPECTED and safe to swallow. But the previous bare `.catch(() => {})` also swallowed REAL DB
// failures (connection, constraint, type) - hiding them. Log everything EXCEPT the benign missing-row case.
function onUpdateError(where: string, e: unknown): void {
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);
  if (name === "RecordNotFoundError" || /no existing record found/i.test(msg)) return; // benign: row not indexed yet / reverted
  console.error(`[indexer] db.update failed (${where}): ${msg}`);
}

// ─────────────────────────── AgentRegistry ───────────────────────────

ponder.on("AgentRegistry:AgentMinted", async ({ event, context }) => {
  const { agentId, owner, name, styleFingerprint, royaltyBps, modelAttestation } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);

  // creatorResaleBps is NOT in the AgentMinted event; read it (immutable, at "latest") via the
  // prune-safe standalone client (see readCreatorResaleBps above for why not context.client).
  const creatorResaleBps = await readCreatorResaleBps(DEPLOYED.agentRegistry, AgentRegistryAbi, agentId);

  await context.db
    .insert(agents)
    .values({
      agentId,
      owner: owner.toLowerCase() as `0x${string}`,
      creator: owner.toLowerCase() as `0x${string}`, // minter == original creator (resale-royalty target)
      name,
      styleFingerprint,
      modelAttestation,
      royaltyBps: Number(royaltyBps),
      creatorResaleBps,
      styleVersion: 1,
      encBrainRoot: null,
      mintedAt: ts,
      mintBlock: event.block.number,
      mintLogIndex: event.log.logIndex,
      orderKey: ok,
    })
    .onConflictDoUpdate((row) => ({
      // re-index idempotency: keep the row authoritative to the mint event.
      owner: row.owner, // owner may have moved via later Transfers; don't clobber on re-mint replay
      name,
      styleFingerprint,
      modelAttestation,
      royaltyBps: Number(royaltyBps),
      creatorResaleBps,
    }));

  // seed agent_stats + agent_earnings rows so later upserts have a base.
  await context.db
    .insert(agentStats)
    .values({ agentId, name, lastActivityAt: ts })
    .onConflictDoUpdate({ name });
  await context.db
    .insert(agentEarnings)
    .values({ agentId })
    .onConflictDoNothing();

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "agent_mint",
    orderKey: ok,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: context.contracts.AgentRegistry.address.toLowerCase() as `0x${string}`,
    collectionKind: "agent",
    tokenId: agentId,
    agentId,
    actor: owner.toLowerCase() as `0x${string}`,
  });
});

ponder.on("AgentRegistry:BrainUpdated", async ({ event, context }) => {
  const { agentId, encBrainRoot, styleVersion } = event.args;
  const ts = event.block.timestamp;
  // Update the agent's brain pointer + styleVersion. Defensive upsert in case ordering surprises us.
  await context.db
    .update(agents, { agentId })
    .set({ encBrainRoot, styleVersion: Number(styleVersion) })
    .catch((e) => onUpdateError("AgentRegistry:BrainUpdated agents", e));

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "brain_update",
    orderKey: orderKey(event.block.number, event.log.logIndex),
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: context.contracts.AgentRegistry.address.toLowerCase() as `0x${string}`,
    collectionKind: "agent",
    tokenId: agentId,
    agentId,
  });
});

ponder.on("AgentRegistry:Transfer", async ({ event, context }) => {
  const { from, to, tokenId } = event.args; // tokenId == agentId for this collection
  if (from === ZERO) return; // mint Transfer: AgentMinted creates the row with the right owner.
  const ts = event.block.timestamp;
  await context.db
    .update(agents, { agentId: tokenId })
    .set({ owner: to.toLowerCase() as `0x${string}` })
    .catch((e) => onUpdateError("AgentRegistry:Transfer agents", e));

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "transfer",
    orderKey: orderKey(event.block.number, event.log.logIndex),
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: context.contracts.AgentRegistry.address.toLowerCase() as `0x${string}`,
    collectionKind: "agent",
    tokenId,
    agentId: tokenId,
    actor: from.toLowerCase() as `0x${string}`,
    counterparty: to.toLowerCase() as `0x${string}`,
  });
});

// ───────────────────────────── AuraINFT ─────────────────────────────
// The REAL ERC-7857 registry (post-cutover). Feeds the SAME agents read-model as AgentRegistry, so a migrated
// or newly-created iNFT agent is visible via the indexer. Inert (burn address) until deployed-v2.json.auraINFT
// is set. AuraINFT.AgentMinted carries an extra bytes32 dataHash vs AgentRegistry's (not destructured here);
// ownership moves via the proof-gated transfer(), whose internal _transfer still emits ERC721 Transfer + BrainRekeyed.

ponder.on("AuraINFT:AgentMinted", async ({ event, context }) => {
  const { agentId, owner, name, styleFingerprint, royaltyBps, modelAttestation } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  const creatorResaleBps = await readCreatorResaleBps(context.contracts.AuraINFT.address, AuraINFTAbi, agentId);

  await context.db
    .insert(agents)
    .values({
      agentId,
      owner: owner.toLowerCase() as `0x${string}`,
      creator: owner.toLowerCase() as `0x${string}`, // minter == original creator (resale-royalty target)
      name,
      styleFingerprint,
      modelAttestation,
      royaltyBps: Number(royaltyBps),
      creatorResaleBps,
      styleVersion: 1,
      encBrainRoot: null,
      mintedAt: ts,
      mintBlock: event.block.number,
      mintLogIndex: event.log.logIndex,
      orderKey: ok,
    })
    .onConflictDoUpdate((row) => ({
      owner: row.owner, // don't clobber a later Transfer on a re-index replay
      name,
      styleFingerprint,
      modelAttestation,
      royaltyBps: Number(royaltyBps),
      creatorResaleBps,
    }));

  await context.db.insert(agentStats).values({ agentId, name, lastActivityAt: ts }).onConflictDoUpdate({ name });
  await context.db.insert(agentEarnings).values({ agentId }).onConflictDoNothing();

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "agent_mint",
    orderKey: ok,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: context.contracts.AuraINFT.address.toLowerCase() as `0x${string}`,
    collectionKind: "agent",
    tokenId: agentId,
    agentId,
    actor: owner.toLowerCase() as `0x${string}`,
  });
});

ponder.on("AuraINFT:Transfer", async ({ event, context }) => {
  const { from, to, tokenId } = event.args; // tokenId == agentId
  if (from === ZERO) return; // mint Transfer: AgentMinted creates the row with the right owner.
  await context.db
    .update(agents, { agentId: tokenId })
    .set({ owner: to.toLowerCase() as `0x${string}` })
    .catch((e) => onUpdateError("AuraINFT:Transfer agents", e));

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "transfer",
    orderKey: orderKey(event.block.number, event.log.logIndex),
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    collection: context.contracts.AuraINFT.address.toLowerCase() as `0x${string}`,
    collectionKind: "agent",
    tokenId,
    agentId: tokenId,
    actor: from.toLowerCase() as `0x${string}`,
    counterparty: to.toLowerCase() as `0x${string}`,
  });
});

ponder.on("AuraINFT:BrainRekeyed", async ({ event, context }) => {
  // Sealed re-key transfer: rotate the on-chain brain pointer + (defensively) the owner. The paired ERC721
  // Transfer already logged the "transfer" event + moved owner; this keeps encBrainRoot current (idempotent).
  const { agentId, newEncRoot, newOwner } = event.args;
  await context.db
    .update(agents, { agentId })
    .set({ encBrainRoot: newEncRoot, owner: newOwner.toLowerCase() as `0x${string}` })
    .catch((e) => onUpdateError("AuraINFT:BrainRekeyed agents", e));
});

ponder.on("AuraINFT:BrainUpdated", async ({ event, context }) => {
  const { agentId, encBrainRoot, styleVersion } = event.args;
  await context.db
    .update(agents, { agentId })
    .set({ encBrainRoot, styleVersion: Number(styleVersion) })
    .catch((e) => onUpdateError("AuraINFT:BrainUpdated agents", e));

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "brain_update",
    orderKey: orderKey(event.block.number, event.log.logIndex),
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: event.block.timestamp,
    txHash: event.transaction.hash,
    collection: context.contracts.AuraINFT.address.toLowerCase() as `0x${string}`,
    collectionKind: "agent",
    tokenId: agentId,
    agentId,
  });
});

// ──────────────────────────── OutputNFT ────────────────────────────

ponder.on("OutputNFT:OutputMinted", async ({ event, context }) => {
  const { tokenId, creatorAgentId, owner, imageRoot, provenanceHash, teeAttestation, seed } =
    event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);

  await context.db
    .insert(outputs)
    .values({
      tokenId,
      owner: owner.toLowerCase() as `0x${string}`,
      creatorAgentId,
      imageRoot,
      provenanceHash,
      teeAttestation,
      seed,
      mintedAt: ts,
      mintBlock: event.block.number,
      mintLogIndex: event.log.logIndex,
      orderKey: ok,
    })
    .onConflictDoUpdate((row) => ({
      owner: row.owner, // don't clobber a later transfer on re-mint replay
      creatorAgentId,
      imageRoot,
      provenanceHash,
      teeAttestation,
      seed,
    }));

  // bump the creating agent's output count (+ ensure a stats row exists).
  await context.db
    .insert(agentStats)
    .values({ agentId: creatorAgentId, name: "", outputCount: 1, lastActivityAt: ts })
    .onConflictDoUpdate((row) => ({
      outputCount: row.outputCount + 1,
      lastActivityAt: ts,
    }));

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "mint",
    orderKey: ok,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: context.contracts.OutputNFT.address.toLowerCase() as `0x${string}`,
    collectionKind: "output",
    tokenId,
    agentId: creatorAgentId,
    actor: owner.toLowerCase() as `0x${string}`,
  });
});

ponder.on("OutputNFT:Transfer", async ({ event, context }) => {
  const { from, to, tokenId } = event.args;
  if (from === ZERO) return; // mint Transfer: OutputMinted creates the row with the right owner.
  const ts = event.block.timestamp;
  await context.db
    .update(outputs, { tokenId })
    .set({ owner: to.toLowerCase() as `0x${string}` })
    .catch((e) => onUpdateError("OutputNFT:Transfer outputs", e));

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "transfer",
    orderKey: orderKey(event.block.number, event.log.logIndex),
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: context.contracts.OutputNFT.address.toLowerCase() as `0x${string}`,
    collectionKind: "output",
    tokenId,
    actor: from.toLowerCase() as `0x${string}`,
    counterparty: to.toLowerCase() as `0x${string}`,
  });
});

// ───────────────────────── AuraMarketplace ─────────────────────────

ponder.on("AuraMarketplace:Listed", async ({ event, context }) => {
  const { collection, tokenId, seller, price } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  const kind = collectionKind(collection);

  await context.db
    .insert(listings)
    .values({
      id: listingId(collection, tokenId),
      collection: collection.toLowerCase() as `0x${string}`,
      tokenId,
      collectionKind: kind,
      seller: seller.toLowerCase() as `0x${string}`,
      price,
      active: true,
      listedAt: ts,
      updatedAt: ts,
      orderKey: ok,
    })
    .onConflictDoUpdate({
      // re-listing the same token (after a prior cancel/sale) reactivates with the new seller+price.
      seller: seller.toLowerCase() as `0x${string}`,
      price,
      active: true,
      updatedAt: ts,
      orderKey: ok,
    });

  // a listing of an OUTPUT counts toward its creating agent's listing activity. Resolve the output row ONCE
  // and reuse its creatorAgentId when logging the event below (previously found twice for the same event).
  let listingAgentId: bigint | null = null;
  if (kind === "output") {
    const out = await context.db.find(outputs, { tokenId });
    if (out) {
      listingAgentId = out.creatorAgentId;
      await context.db
        .insert(agentStats)
        .values({ agentId: out.creatorAgentId, name: "", listingsCount: 1, lastActivityAt: ts })
        .onConflictDoUpdate((row) => ({
          listingsCount: row.listingsCount + 1,
          lastActivityAt: ts,
        }));
    }
  }

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "listing",
    orderKey: ok,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: collection.toLowerCase() as `0x${string}`,
    collectionKind: kind === "unknown" ? null : kind,
    tokenId,
    agentId: listingAgentId, // reuse the single find above (no second lookup for the same output)
    actor: seller.toLowerCase() as `0x${string}`,
    price,
  });
});

ponder.on("AuraMarketplace:PriceUpdated", async ({ event, context }) => {
  const { collection, tokenId, newPrice } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  await context.db
    .update(listings, { id: listingId(collection, tokenId) })
    .set({ price: newPrice, updatedAt: ts, orderKey: ok })
    .catch((e) => onUpdateError("AuraMarketplace:PriceUpdated listings", e));

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "price_update",
    orderKey: ok,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: collection.toLowerCase() as `0x${string}`,
    collectionKind: collectionKind(collection) === "unknown" ? null : collectionKind(collection),
    tokenId,
    price: newPrice,
  });
});

ponder.on("AuraMarketplace:ListingCancelled", async ({ event, context }) => {
  const { collection, tokenId } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  await context.db
    .update(listings, { id: listingId(collection, tokenId) })
    .set({ active: false, updatedAt: ts, orderKey: ok })
    .catch((e) => onUpdateError("AuraMarketplace:ListingCancelled listings", e));

  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "listing_cancel",
    orderKey: ok,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: collection.toLowerCase() as `0x${string}`,
    collectionKind: collectionKind(collection) === "unknown" ? null : collectionKind(collection),
    tokenId,
  });
});

ponder.on("AuraMarketplace:Sold", async ({ event, context }) => {
  const {
    collection,
    tokenId,
    buyer,
    seller,
    price,
    royaltyReceiver,
    royaltyPaid,
    platformFee,
    sellerProceeds,
  } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  const kind = collectionKind(collection);

  // 1. clear the listing (Sold deactivates it).
  await context.db
    .update(listings, { id: listingId(collection, tokenId) })
    .set({ active: false, updatedAt: ts, orderKey: ok })
    .catch((e) => onUpdateError("AuraMarketplace:Sold listings", e));

  // 2. resolve the SELLING agent for earnings routing:
  //    - output sale  -> the output's creatorAgentId
  //    - agent sale   -> the agent (tokenId) itself
  let sellingAgentId: bigint | null = null;
  if (kind === "output") {
    const out = await context.db.find(outputs, { tokenId });
    sellingAgentId = out?.creatorAgentId ?? null;
  } else if (kind === "agent") {
    sellingAgentId = tokenId;
  }

  // 3. credit wallet_earnings for the royalty receiver (point-in-time; survives later resale).
  if (royaltyPaid > 0n && royaltyReceiver.toLowerCase() !== ZERO) {
    await context.db
      .insert(walletEarnings)
      .values({
        wallet: royaltyReceiver.toLowerCase() as `0x${string}`,
        royaltiesEarned: royaltyPaid,
        salesCount: 1,
        lastSaleAt: ts,
      })
      .onConflictDoUpdate((row) => ({
        royaltiesEarned: row.royaltiesEarned + royaltyPaid,
        salesCount: row.salesCount + 1,
        lastSaleAt: ts,
      }));
  }

  // 4. credit agent_earnings + agent_stats for the selling agent.
  if (sellingAgentId !== null) {
    await context.db
      .insert(agentEarnings)
      .values({
        agentId: sellingAgentId,
        royaltiesEarned: royaltyPaid,
        salesCount: 1,
        lastSaleAt: ts,
      })
      .onConflictDoUpdate((row) => ({
        royaltiesEarned: row.royaltiesEarned + royaltyPaid,
        salesCount: row.salesCount + 1,
        lastSaleAt: ts,
      }));
    await context.db
      .insert(agentStats)
      .values({
        agentId: sellingAgentId,
        name: "",
        salesCount: 1,
        royaltiesEarned: royaltyPaid,
        lastActivityAt: ts,
      })
      .onConflictDoUpdate((row) => ({
        salesCount: row.salesCount + 1,
        royaltiesEarned: row.royaltiesEarned + royaltyPaid,
        lastActivityAt: ts,
      }));
  }

  // 5. log the sale activity (rich, for the feed + top-earners + trending).
  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "sale",
    orderKey: ok,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: collection.toLowerCase() as `0x${string}`,
    collectionKind: kind === "unknown" ? null : kind,
    tokenId,
    agentId: sellingAgentId,
    actor: buyer.toLowerCase() as `0x${string}`,
    counterparty: seller.toLowerCase() as `0x${string}`,
    price,
    royaltyReceiver: royaltyReceiver.toLowerCase() as `0x${string}`,
    royaltyPaid,
    platformFee,
    sellerProceeds,
  });
});

ponder.on("AuraMarketplace:Withdrawal", async ({ event, context }) => {
  const { who, amount } = event.args;
  const ts = event.block.timestamp;
  await context.db.insert(events).values({
    id: eventId(event.block.number, event.log.logIndex),
    kind: "withdrawal",
    orderKey: orderKey(event.block.number, event.log.logIndex),
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    actor: who.toLowerCase() as `0x${string}`,
    price: amount,
  });
});

// ───────────────────────── SummonEscrow ─────────────────────────
// Demand-pull commissioning. On Fulfilled, the escrow minted an OutputNFT to the buyer and SPLIT the fee:
// ownerCut -> the agent's CURRENT owner (agentOwner, resolved on-chain at fulfill time = "income follows the
// agent"), platformFee -> the platform. We credit BOTH the selling agent's earnings and the current-owner
// wallet's earnings under DEDICATED summon fields (kept separate from resale royalties), and log a 'summon'
// activity event, consistent with the Sold handler. Without this, summon income never reaches the read model:
// creator earnings under-report and the ownership thesis ("income follows the agent") is invisible.
//
// IDEMPOTENCY: the aggregate credits are read-modify-write increments (like Sold). Beyond Ponder's own
// reorg-revert, we additionally guard against a replay/re-index over existing PGlite state by no-op'ing if
// this exact log (id = block-logIndex) was already ingested - so the increments can never double-count.
ponder.on("SummonEscrow:Fulfilled", async ({ event, context }) => {
  const { agentId, buyer, tokenId, agentOwner, ownerCut, platformFee } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  const id = eventId(event.block.number, event.log.logIndex);

  // idempotency guard: if this log was already ingested, do NOT re-apply the aggregate increments below.
  const already = await context.db.find(events, { id });
  if (already) return;

  const ownerAddr = agentOwner.toLowerCase() as `0x${string}`;

  // 1. credit the selling agent's summon earnings (dedicated fields; a base row exists from AgentMinted).
  await context.db
    .insert(agentEarnings)
    .values({ agentId, summonEarned: ownerCut, summonCount: 1, lastSaleAt: ts })
    .onConflictDoUpdate((row) => ({
      summonEarned: row.summonEarned + ownerCut,
      summonCount: row.summonCount + 1,
      lastSaleAt: ts,
    }));

  // 2. credit the agent's CURRENT owner wallet (income follows the agent to whoever owns it now).
  await context.db
    .insert(walletEarnings)
    .values({ wallet: ownerAddr, summonEarned: ownerCut, summonCount: 1, lastSaleAt: ts })
    .onConflictDoUpdate((row) => ({
      summonEarned: row.summonEarned + ownerCut,
      summonCount: row.summonCount + 1,
      lastSaleAt: ts,
    }));

  // 3. mirror onto agent_stats for one-shot sorts + activity recency.
  await context.db
    .insert(agentStats)
    .values({ agentId, name: "", summonEarned: ownerCut, summonCount: 1, lastActivityAt: ts })
    .onConflictDoUpdate((row) => ({
      summonEarned: row.summonEarned + ownerCut,
      summonCount: row.summonCount + 1,
      lastActivityAt: ts,
    }));

  // 4. log the summon activity (feed + audit). The minted Relic lives on OutputNFT; agentOwner earned
  //    ownerCut (point-in-time), platform earned platformFee, buyer paid ownerCut + platformFee.
  await context.db.insert(events).values({
    id,
    kind: "summon",
    orderKey: ok,
    blockNumber: event.block.number,
    logIndex: event.log.logIndex,
    timestamp: ts,
    txHash: event.transaction.hash,
    collection: ADDR_OUTPUT as `0x${string}`,
    collectionKind: "output",
    tokenId,
    agentId,
    actor: buyer.toLowerCase() as `0x${string}`,
    counterparty: ownerAddr,
    price: ownerCut + platformFee, // the gross summon fee the buyer paid
    royaltyReceiver: ownerAddr, // who earned from this summon (the agent's current owner)
    royaltyPaid: ownerCut, // the owner's take (dedicated accounting lives in *_earnings.summonEarned)
    platformFee,
  });
});

// ═════════════════════════════ GAME LAYER (v2 mainnet cutover) ═════════════════════════════
// ArenaVote / AuraFusion / ArenaReputation event handlers. Deployed at gameDeployBlock on 0G mainnet 16661;
// their logs build the battles/votes/lineage/fusions/seasons read model that /api/arena/* + /api/fusion/*
// serve (indexer api/index.ts). All idempotent (insert...onConflict / existence-guarded increments) so a
// re-index or reorg never double-counts. Inert until deployed-v2.json wires the game addresses (config
// registers a burn address at a far-future block otherwise), so a testnet rollback indexes nothing here.

// ─────────────────────────── ArenaVote ───────────────────────────

ponder.on("ArenaVote:BattleCreated", async ({ event, context }) => {
  const { battleId, agentA, agentB, commitEnd, revealEnd } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  await context.db
    .insert(battles)
    .values({
      battleId,
      agentA,
      agentB,
      commitEnd: BigInt(commitEnd),
      revealEnd: BigInt(revealEnd),
      finalized: false,
      rated: false,
      winner: 0,
      weightA: 0n,
      weightB: 0n,
      pool: 0n,
      commitCount: 0,
      revealCount: 0,
      createdAt: ts,
      createdBlock: event.block.number,
      finalizedAt: null,
      orderKey: ok,
    })
    .onConflictDoUpdate({ agentA, agentB, commitEnd: BigInt(commitEnd), revealEnd: BigInt(revealEnd) });
});

ponder.on("ArenaVote:Committed", async ({ event, context }) => {
  const { battleId } = event.args;
  // count blind commits (they carry no side yet). Defensive: the battle row exists from BattleCreated.
  await context.db
    .update(battles, { battleId })
    .set((row) => ({ commitCount: row.commitCount + 1 }))
    .catch((e) => onUpdateError("ArenaVote:Committed battles", e));
});

ponder.on("ArenaVote:Revealed", async ({ event, context }) => {
  const { battleId, voter, choice, stake, weight } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  const id = `${battleId.toString()}-${voter.toLowerCase()}`;
  // idempotency: one reveal per voter per battle. If already indexed, do NOT re-increment revealCount.
  const already = await context.db.find(votes, { id });
  if (already) return;
  await context.db.insert(votes).values({
    id,
    battleId,
    voter: voter.toLowerCase() as `0x${string}`,
    choice: Number(choice),
    stake: BigInt(stake),
    weight: BigInt(weight),
    revealedAt: ts,
    orderKey: ok,
  });
  await context.db
    .update(battles, { battleId })
    .set((row) => ({ revealCount: row.revealCount + 1 }))
    .catch((e) => onUpdateError("ArenaVote:Revealed battles", e));
});

ponder.on("ArenaVote:Finalized", async ({ event, context }) => {
  const { battleId, winner, weightA, weightB, rated, pool } = event.args;
  const ts = event.block.timestamp;
  // record the contract's ENFORCED tally. The keyless /api/arena/tally endpoint independently recomputes
  // this from the Revealed log (that recompute is the trust root; this row is a convenience read).
  await context.db
    .update(battles, { battleId })
    .set({
      finalized: true,
      rated: Boolean(rated),
      winner: Number(winner),
      weightA: BigInt(weightA),
      weightB: BigInt(weightB),
      pool: BigInt(pool),
      finalizedAt: ts,
    })
    .catch((e) => onUpdateError("ArenaVote:Finalized battles", e));
});

// ─────────────────────────── AuraFusion ───────────────────────────

ponder.on("AuraFusion:GenesisRegistered", async ({ event, context }) => {
  const { agentId, generation, styleFingerprint } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  await context.db
    .insert(lineage)
    .values({
      agentId,
      generation: Number(generation),
      parentA: 0n,
      parentB: 0n,
      isGenesis: true,
      styleFingerprint,
      fuseSeed: null,
      requestId: null,
      fuser: null,
      createdAt: ts,
      orderKey: ok,
    })
    // a child row (from FusionExecuted) must never be clobbered back to genesis; only fill genesis fields.
    .onConflictDoUpdate((row) =>
      row.isGenesis ? { generation: Number(generation), styleFingerprint } : {},
    );
});

ponder.on("AuraFusion:FusionRequested", async ({ event, context }) => {
  const { requestId, fuser, parentA, parentB, targetBlock, fee } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  await context.db
    .insert(fusionRequests)
    .values({
      requestId,
      fuser: fuser.toLowerCase() as `0x${string}`,
      parentA,
      parentB,
      targetBlock: BigInt(targetBlock),
      fee: BigInt(fee),
      executed: false,
      refunded: false,
      childId: null,
      requestedAt: ts,
      orderKey: ok,
    })
    .onConflictDoNothing();
});

ponder.on("AuraFusion:FusionExecuted", async ({ event, context }) => {
  const { requestId, childId, parentA, parentB, fuseSeed, generation } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  // resolve the fuser from the matching request (FusionExecuted omits it). Null if the request row was missed.
  const req = await context.db.find(fusionRequests, { requestId });
  const fuser = req?.fuser ?? null;

  await context.db
    .insert(fusions)
    .values({
      requestId,
      childId,
      parentA,
      parentB,
      fuseSeed,
      generation: Number(generation),
      fuser,
      executedAt: ts,
      executedBlock: event.block.number,
      txHash: event.transaction.hash,
      orderKey: ok,
    })
    .onConflictDoUpdate({ childId, fuseSeed, generation: Number(generation), fuser });

  // record the child's lineage (parents + generation + seed). Authoritative over any prior genesis stub.
  await context.db
    .insert(lineage)
    .values({
      agentId: childId,
      generation: Number(generation),
      parentA,
      parentB,
      isGenesis: false,
      styleFingerprint: null,
      fuseSeed,
      requestId,
      fuser,
      createdAt: ts,
      orderKey: ok,
    })
    .onConflictDoUpdate({ generation: Number(generation), parentA, parentB, isGenesis: false, fuseSeed, requestId, fuser });

  // mark the request executed (+ link the child). Defensive: the request row exists from FusionRequested.
  await context.db
    .update(fusionRequests, { requestId })
    .set({ executed: true, childId })
    .catch((e) => onUpdateError("AuraFusion:FusionExecuted fusionRequests", e));
});

ponder.on("AuraFusion:FusionRefunded", async ({ event, context }) => {
  const { requestId } = event.args;
  await context.db
    .update(fusionRequests, { requestId })
    .set({ refunded: true })
    .catch((e) => onUpdateError("AuraFusion:FusionRefunded fusionRequests", e));
});

// ─────────────────────────── ArenaReputation ───────────────────────────

ponder.on("ArenaReputation:SeasonAnchored", async ({ event, context }) => {
  const { seasonEpoch, ladderRoot } = event.args;
  const ts = event.block.timestamp;
  const ok = orderKey(event.block.number, event.log.logIndex);
  // the per-agent ratings live in the off-chain Merkle tree (keyless-recomputable via /api/arena/ladder/
  // verify); the chain stores only the root commitment, which is all this contract emits.
  await context.db
    .insert(seasons)
    .values({
      seasonEpoch,
      ladderRoot,
      anchoredAt: ts,
      anchoredBlock: event.block.number,
      txHash: event.transaction.hash,
      orderKey: ok,
    })
    .onConflictDoUpdate({ ladderRoot, anchoredAt: ts, anchoredBlock: event.block.number, txHash: event.transaction.hash });
});
