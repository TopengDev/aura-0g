// AURA v2 read APIs - served from WITHIN the Ponder process (Hono + direct read-only Drizzle access to
// the indexed tables). This is the integration decision: the indexer owns the data-heavy read/discovery
// surface; the Phase-2 Fastify backend keeps the write/compute surface (generation, attestation,
// mint-args, SIWE). PGlite is embedded/single-process, so serving these here (rather than from the
// separate Fastify process) gives ONE coherent API over the indexed data with zero cross-process
// coupling. The Fastify backend proxies these under its /api surface (see server/src/routes/indexer.ts)
// so the future webapp can hit a single base URL.
//
// Endpoints:
//   GET /_indexer               - indexer liveness + indexed counts (/health,/status,/ready,/metrics,
//                                 /client are RESERVED by Ponder's internal server, so we use /_indexer)
//   GET /agents                 - re-backs the Phase-2 list (indexer, not chain scan)
//   GET /agents/:id             - one agent (indexed)
//   GET /outputs                - re-backs the Phase-2 list (indexer, not chain scan)
//   GET /outputs/:id            - one output (indexed)
//   GET /creators/:wallet       - creator dashboard
//   GET /discover               - trending | top-earners | newest | by-style (keyset paginated)
//   GET /activity               - activity feed (keyset paginated, enriched)
//   GET /marketplace            - active listings + platform info (indexed)
//   /sql/*                      - Ponder SQL-over-HTTP (for @ponder/client power users)
//   /graphql, /                 - Ponder's auto GraphQL (bonus, free)
import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { and, asc, client, count, desc, eq, graphql, gte, lt, or, sql } from "ponder";
import { formatEther, getAddress } from "viem";
import { CATALOG, styleForName, isHiddenAgent, isHiddenOutput } from "../catalog";
import { deriveRarity } from "../gacha";

const app = new Hono();

// ───────────────────────────── constants ─────────────────────────────
// Trending = weighted recent activity over a rolling window. Tunable here.
const TRENDING_WINDOW_SECONDS = 7n * 24n * 60n * 60n; // 7 days
const W_SALE = 3; // a sale is worth 3
const W_MINT = 1; // a mint is worth 1
const W_LISTING = 0.5; // a listing is worth 0.5
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// 0G Storage explorer link for a content root (matches server/src/aura/contracts.ts storageScanUrl).
// Network-aware from deployed-v2.json.chainId: 0G Aristotle MAINNET (16661) -> storagescan.0g.ai; else 0G
// Galileo TESTNET -> storagescan-galileo.0g.ai. So the mainnet cutover no longer links relics to a testnet
// storage explorer. Resolved once at module load from the SAME JSON the config/handlers read.
import { readFileSync as _readFileSync } from "node:fs";
import path0 from "node:path";
import { fileURLToPath as _fileURLToPath } from "node:url";
const _dir = path0.dirname(_fileURLToPath(import.meta.url));
const _DEPLOYED = JSON.parse(_readFileSync(path0.join(_dir, "..", "..", "..", "contracts", "deployed-v2.json"), "utf8"));
const _CHAIN_ID = Number(_DEPLOYED.chainId);
const STORAGE_SCAN = process.env.AURA_STORAGE_SCAN ?? (_CHAIN_ID === 16661 ? "https://storagescan.0g.ai" : "https://storagescan-galileo.0g.ai");
function storageScanUrl(root: string): string {
  return `${STORAGE_SCAN}/tx/${root}`;
}
// Image URL the webapp/backend resolves (the backend can stream the bytes by root via 0G Storage
// download; relative so it works behind the Fastify /api proxy or a dedicated gateway).
function imageUrl(root: string): string {
  return `/images/${root}`;
}

// ───────────────────────────── helpers ─────────────────────────────
function clampLimit(raw: string | undefined): number {
  const n = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

// Keyset cursor = the last row's orderKey (bigint as decimal string). Newest-first => next page is
// rows with orderKey < cursor. Opaque-ish but simple + stable (orderKey is globally monotonic).
function parseCursor(raw: string | undefined): bigint | null {
  if (!raw) return null;
  try {
    const v = BigInt(raw);
    return v >= 0n ? v : null;
  } catch {
    return null;
  }
}

function parseWallet(raw: string): `0x${string}` | null {
  try {
    return getAddress(raw).toLowerCase() as `0x${string}`; // checksum-validate then lowercase to match stored
  } catch {
    return null;
  }
}

function parseId(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  try {
    const v = BigInt(raw);
    return v >= 1n ? v : null;
  } catch {
    return null;
  }
}

function ether(wei: bigint | null | undefined): string {
  return formatEther(wei ?? 0n);
}

// Shape an indexed agent row + its stats/earnings + catalog style into the API agent object.
function shapeAgent(a: typeof schema.agents.$inferSelect, stats?: typeof schema.agentStats.$inferSelect | null, earn?: typeof schema.agentEarnings.$inferSelect | null) {
  const style = styleForName(a.name);
  // earnings: resale royalties (Sold) + PRIMARY summon commissions (Fulfilled), tracked separately, plus a
  // convenience total. Prefer the earnings table; fall back to the agent_stats mirror.
  const royWei = earn?.royaltiesEarned ?? stats?.royaltiesEarned ?? 0n;
  const summonWei = earn?.summonEarned ?? stats?.summonEarned ?? 0n;
  const totalWei = royWei + summonWei;
  return {
    agentId: Number(a.agentId),
    name: a.name,
    owner: a.owner,
    creator: a.creator,
    royaltyBps: a.royaltyBps,
    royaltyPct: a.royaltyBps / 100,
    creatorResaleBps: a.creatorResaleBps,
    styleVersion: a.styleVersion,
    minted: true,
    outputCount: stats?.outputCount ?? 0,
    salesCount: stats?.salesCount ?? 0,
    summonCount: earn?.summonCount ?? stats?.summonCount ?? 0,
    royaltiesEarned: ether(royWei),
    royaltiesEarnedWei: royWei.toString(),
    summonEarned: ether(summonWei),
    summonEarnedWei: summonWei.toString(),
    totalEarned: ether(totalWei), // royalties + summon commissions (the full "income follows the agent")
    totalEarnedWei: totalWei.toString(),
    mintedAt: Number(a.mintedAt),
    style: style.style,
    meta: {
      tagline: style.tagline,
      aesthetic: style.aesthetic,
      accent: style.accent,
      signatureCharacter: style.signatureCharacter,
      // display-only enrichment (the 20-Aura roster); undefined for the seeded 4 + user agents
      rarity: style.rarity,
      lore: style.lore,
      personality: style.personality,
    },
  };
}

function shapeOutput(o: typeof schema.outputs.$inferSelect, agentName?: string | null) {
  return {
    tokenId: Number(o.tokenId),
    owner: o.owner,
    creatorAgentId: Number(o.creatorAgentId),
    agentName: agentName ?? null,
    imageRoot: o.imageRoot,
    imageUrl: imageUrl(o.imageRoot),
    storageScanUrl: storageScanUrl(o.imageRoot),
    seed: o.seed.toString(),
    // provable-pull rarity, derived at QUERY time from the on-chain seed (no schema migration, no backfill;
    // legacy/non-pull seeds -> Common). Same derivation as the server's per-token /provenance read.
    rarity: deriveRarity(o.seed),
    provenanceHash: o.provenanceHash,
    teeAttestation: o.teeAttestation,
    mintedAt: Number(o.mintedAt),
    style: styleForName(agentName).style,
  };
}

// ───────────────────────── liveness + counts ─────────────────────────
app.get("/_indexer", async (c) => {
  const [[ag], [ou], [li], [ev]] = await Promise.all([
    db.select({ n: count() }).from(schema.agents),
    db.select({ n: count() }).from(schema.outputs),
    db.select({ n: count() }).from(schema.listings).where(eq(schema.listings.active, true)),
    db.select({ n: count() }).from(schema.events),
  ]);
  return c.json({
    ok: true,
    service: "aura-indexer",
    counts: { agents: ag?.n ?? 0, outputs: ou?.n ?? 0, activeListings: li?.n ?? 0, events: ev?.n ?? 0 },
  });
});

// ─────────────────────── re-backed list endpoints ───────────────────────
// GET /agents - indexer-backed replacement for the Phase-2 chain scan.
app.get("/agents", async (c) => {
  const allRows = await db.select().from(schema.agents).orderBy(asc(schema.agents.agentId));
  const rows = allRows.filter((r) => !isHiddenAgent(r.name)); // display curation (test/junk agents hidden)
  const ids = rows.map((r) => r.agentId);
  const [statsRows, earnRows] = await Promise.all([
    ids.length ? db.select().from(schema.agentStats) : Promise.resolve([]),
    ids.length ? db.select().from(schema.agentEarnings) : Promise.resolve([]),
  ]);
  const statsBy = new Map(statsRows.map((s) => [s.agentId, s]));
  const earnBy = new Map(earnRows.map((e) => [e.agentId, e]));
  const agents = rows.map((a) => shapeAgent(a, statsBy.get(a.agentId), earnBy.get(a.agentId)));
  return c.json({ agents, source: "indexer" });
});

app.get("/agents/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid agent id" }, 400);
  const a = await db.select().from(schema.agents).where(eq(schema.agents.agentId, id)).limit(1);
  if (a.length === 0) return c.json({ error: "agent not found" }, 404);
  const [stats] = await db.select().from(schema.agentStats).where(eq(schema.agentStats.agentId, id)).limit(1);
  const [earn] = await db.select().from(schema.agentEarnings).where(eq(schema.agentEarnings.agentId, id)).limit(1);
  // also include the agent's outputs (ids) for the detail view.
  const outs = await db
    .select({ tokenId: schema.outputs.tokenId })
    .from(schema.outputs)
    .where(eq(schema.outputs.creatorAgentId, id))
    .orderBy(desc(schema.outputs.orderKey));
  return c.json({
    ...shapeAgent(a[0]!, stats, earn),
    outputs: outs.map((o) => Number(o.tokenId)).filter((t) => !isHiddenOutput(t)),
  });
});

// GET /outputs - indexer-backed replacement for the Phase-2 chain scan (newest first).
app.get("/outputs", async (c) => {
  const limit = clampLimit(c.req.query("limit"));
  const cursor = parseCursor(c.req.query("cursor"));
  const where = cursor !== null ? lt(schema.outputs.orderKey, cursor) : undefined;
  const rows = await db
    .select()
    .from(schema.outputs)
    .where(where)
    .orderBy(desc(schema.outputs.orderKey))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const nameBy = await agentNameMap(page.map((o) => o.creatorAgentId));
  const outputs = page
    .map((o) => shapeOutput(o, nameBy.get(o.creatorAgentId)))
    .filter((o) => !isHiddenAgent(o.agentName) && !isHiddenOutput(o.tokenId)); // display curation (test/junk agents + superseded relics hidden)
  const nextCursor = rows.length > limit ? page[page.length - 1]!.orderKey.toString() : null;
  return c.json({ outputs, nextCursor, source: "indexer" });
});

app.get("/outputs/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid output id" }, 400);
  const o = await db.select().from(schema.outputs).where(eq(schema.outputs.tokenId, id)).limit(1);
  if (o.length === 0) return c.json({ error: "output not found" }, 404);
  const nameBy = await agentNameMap([o[0]!.creatorAgentId]);
  return c.json(shapeOutput(o[0]!, nameBy.get(o[0]!.creatorAgentId)));
});

// ───────────────────────── creator dashboard ─────────────────────────
// GET /creators/:wallet -> { agentsOwned, outputsOwned, outputsCreatedByMyAgents, royaltiesEarned }
// royaltiesEarned = SUM(royaltyPaid) WHERE royaltyReceiver = wallet (point-in-time; survives resale,
// because the receiver is captured in the Sold event at sale time).
app.get("/creators/:wallet", async (c) => {
  const wallet = parseWallet(c.req.param("wallet"));
  if (!wallet) return c.json({ error: "invalid wallet address" }, 400);

  // agents currently owned by the wallet
  const agentsOwnedRows = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.owner, wallet))
    .orderBy(asc(schema.agents.agentId));
  const ownedAgentIds = agentsOwnedRows.map((a) => a.agentId);

  // outputs currently owned by the wallet
  const outputsOwnedRows = await db
    .select()
    .from(schema.outputs)
    .where(eq(schema.outputs.owner, wallet))
    .orderBy(desc(schema.outputs.orderKey));

  // outputs created by ANY agent the wallet currently owns (the wallet's creative output)
  let outputsCreatedByMyAgents: typeof schema.outputs.$inferSelect[] = [];
  if (ownedAgentIds.length > 0) {
    outputsCreatedByMyAgents = await db
      .select()
      .from(schema.outputs)
      .where(inArrayBigint(schema.outputs.creatorAgentId, ownedAgentIds))
      .orderBy(desc(schema.outputs.orderKey));
  }

  // royalties earned by this wallet (point-in-time, survives resale)
  const [we] = await db
    .select()
    .from(schema.walletEarnings)
    .where(eq(schema.walletEarnings.wallet, wallet))
    .limit(1);

  // enrich agents with stats/earnings
  const statsRows = ownedAgentIds.length ? await db.select().from(schema.agentStats) : [];
  const earnRows = ownedAgentIds.length ? await db.select().from(schema.agentEarnings) : [];
  const statsBy = new Map(statsRows.map((s) => [s.agentId, s]));
  const earnBy = new Map(earnRows.map((e) => [e.agentId, e]));
  const nameBy = await agentNameMap([
    ...outputsOwnedRows.map((o) => o.creatorAgentId),
    ...outputsCreatedByMyAgents.map((o) => o.creatorAgentId),
  ]);

  const weRoy = we?.royaltiesEarned ?? 0n;
  const weSummon = we?.summonEarned ?? 0n;
  return c.json({
    wallet,
    royaltiesEarned: ether(weRoy),
    royaltiesEarnedWei: weRoy.toString(),
    salesAsReceiver: we?.salesCount ?? 0,
    summonEarned: ether(weSummon), // PRIMARY summon commissions earned by this wallet (income follows the agent)
    summonEarnedWei: weSummon.toString(),
    summonsFulfilled: we?.summonCount ?? 0,
    totalEarned: ether(weRoy + weSummon), // royalties + summon commissions
    totalEarnedWei: (weRoy + weSummon).toString(),
    agentsOwned: agentsOwnedRows.map((a) => shapeAgent(a, statsBy.get(a.agentId), earnBy.get(a.agentId))),
    outputsOwned: outputsOwnedRows.map((o) => shapeOutput(o, nameBy.get(o.creatorAgentId))),
    outputsCreatedByMyAgents: outputsCreatedByMyAgents.map((o) => shapeOutput(o, nameBy.get(o.creatorAgentId))),
    counts: {
      agentsOwned: agentsOwnedRows.length,
      outputsOwned: outputsOwnedRows.length,
      outputsCreatedByMyAgents: outputsCreatedByMyAgents.length,
    },
    source: "indexer",
  });
});

// ─────────────────────────── discovery ───────────────────────────
// GET /discover?sort=trending|top-earners|newest|by-style&style=&limit=&cursor=
app.get("/discover", async (c) => {
  const sort = (c.req.query("sort") ?? "trending").toLowerCase();
  const limit = clampLimit(c.req.query("limit"));

  if (sort === "newest") {
    // newest outputs by (block, logIndex) desc, keyset paginated.
    const cursor = parseCursor(c.req.query("cursor"));
    const where = cursor !== null ? lt(schema.outputs.orderKey, cursor) : undefined;
    const rows = await db
      .select()
      .from(schema.outputs)
      .where(where)
      .orderBy(desc(schema.outputs.orderKey))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const nameBy = await agentNameMap(page.map((o) => o.creatorAgentId));
    return c.json({
      sort,
      items: page.map((o) => shapeOutput(o, nameBy.get(o.creatorAgentId))).filter((o) => !isHiddenOutput(o.tokenId)),
      nextCursor: rows.length > limit ? page[page.length - 1]!.orderKey.toString() : null,
      source: "indexer",
    });
  }

  if (sort === "by-style") {
    const style = (c.req.query("style") ?? "").toLowerCase();
    if (!style) return c.json({ error: "by-style requires ?style=" }, 400);
    // resolve which agent names map to this style slug, then fetch their outputs (newest first).
    const matchingNames = Object.entries(CATALOG) // CATALOG is keyed by NAME; pick names whose style === requested
      .filter(([, v]) => v.style === style)
      .map(([name]) => name.toUpperCase());
    if (matchingNames.length === 0) return c.json({ sort, style, items: [], nextCursor: null, source: "indexer" });

    // agentIds whose (uppercased) name is in matchingNames
    const agentRows = await db.select().from(schema.agents);
    const agentIds = agentRows.filter((a) => matchingNames.includes(a.name.toUpperCase())).map((a) => a.agentId);
    if (agentIds.length === 0) return c.json({ sort, style, items: [], nextCursor: null, source: "indexer" });

    const cursor = parseCursor(c.req.query("cursor"));
    const conds = [inArrayBigint(schema.outputs.creatorAgentId, agentIds)];
    if (cursor !== null) conds.push(lt(schema.outputs.orderKey, cursor));
    const rows = await db
      .select()
      .from(schema.outputs)
      .where(and(...conds))
      .orderBy(desc(schema.outputs.orderKey))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const nameBy = await agentNameMap(page.map((o) => o.creatorAgentId));
    return c.json({
      sort,
      style,
      items: page.map((o) => shapeOutput(o, nameBy.get(o.creatorAgentId))).filter((o) => !isHiddenOutput(o.tokenId)),
      nextCursor: rows.length > limit ? page[page.length - 1]!.orderKey.toString() : null,
      source: "indexer",
    });
  }

  if (sort === "top-earners") {
    // expose BOTH dimensions: by-agent (that agent's output-sale royalties + summon commissions) and
    // by-wallet (GROUP BY receiver). Rank by TOTAL income (royalties + summon): the tables are small on this
    // testnet, so fetch + sort by the computed total in JS - a single-column DB orderBy would drop a
    // summon-only earner (royalties == 0) past the royalty-ranked limit.
    const totalOf = (r: { royaltiesEarned: bigint; summonEarned: bigint }): bigint => r.royaltiesEarned + r.summonEarned;
    const byTotalDesc = (a: { royaltiesEarned: bigint; summonEarned: bigint }, b: { royaltiesEarned: bigint; summonEarned: bigint }): number => {
      const ta = totalOf(a);
      const tb = totalOf(b);
      return tb > ta ? 1 : tb < ta ? -1 : 0; // bigint-safe (avoid Number() precision loss on wei)
    };
    const [allAgentRows, allWalletRows] = await Promise.all([
      db.select().from(schema.agentEarnings),
      db.select().from(schema.walletEarnings),
    ]);
    const byAgentRows = allAgentRows.filter((r) => totalOf(r) > 0n).sort(byTotalDesc).slice(0, limit);
    const byWalletRows = allWalletRows.filter((r) => totalOf(r) > 0n).sort(byTotalDesc).slice(0, limit);
    const nameBy = await agentNameMap(byAgentRows.map((r) => r.agentId));
    const agentMetaBy = await agentRowMap(byAgentRows.map((r) => r.agentId));
    return c.json({
      sort,
      byAgent: byAgentRows.map((r) => ({
        agentId: Number(r.agentId),
        name: nameBy.get(r.agentId) ?? null,
        owner: agentMetaBy.get(r.agentId)?.owner ?? null,
        style: styleForName(nameBy.get(r.agentId)).style,
        royaltiesEarned: ether(r.royaltiesEarned),
        royaltiesEarnedWei: r.royaltiesEarned.toString(),
        summonEarned: ether(r.summonEarned),
        summonEarnedWei: r.summonEarned.toString(),
        totalEarned: ether(totalOf(r)),
        totalEarnedWei: totalOf(r).toString(),
        salesCount: r.salesCount,
        summonCount: r.summonCount,
      })),
      byWallet: byWalletRows.map((r) => ({
        wallet: r.wallet,
        royaltiesEarned: ether(r.royaltiesEarned),
        royaltiesEarnedWei: r.royaltiesEarned.toString(),
        summonEarned: ether(r.summonEarned),
        summonEarnedWei: r.summonEarned.toString(),
        totalEarned: ether(totalOf(r)),
        totalEarnedWei: totalOf(r).toString(),
        salesCount: r.salesCount,
        summonCount: r.summonCount,
      })),
      source: "indexer",
    });
  }

  // default: trending = weighted recent activity over the rolling window, computed at query time from
  // the events table so it always reflects `now` (decays as the window slides).
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const since = nowSec > TRENDING_WINDOW_SECONDS ? nowSec - TRENDING_WINDOW_SECONDS : 0n;
  // aggregate counts per agentId within the window, per kind.
  const agg = await db
    .select({
      agentId: schema.events.agentId,
      sales: sql<number>`sum(case when ${schema.events.kind} = 'sale' then 1 else 0 end)`.mapWith(Number),
      mints: sql<number>`sum(case when ${schema.events.kind} = 'mint' then 1 else 0 end)`.mapWith(Number),
      listings: sql<number>`sum(case when ${schema.events.kind} = 'listing' then 1 else 0 end)`.mapWith(Number),
    })
    .from(schema.events)
    .where(and(gte(schema.events.timestamp, since), sql`${schema.events.agentId} is not null`))
    .groupBy(schema.events.agentId);

  const scored = agg
    .map((r) => ({
      agentId: r.agentId!,
      sales: r.sales ?? 0,
      mints: r.mints ?? 0,
      listings: r.listings ?? 0,
      score: (r.sales ?? 0) * W_SALE + (r.mints ?? 0) * W_MINT + (r.listings ?? 0) * W_LISTING,
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const ids = scored.map((s) => s.agentId);
  const [agentMetaBy, statsBy, earnBy] = await Promise.all([
    agentRowMap(ids),
    agentStatsMap(ids),
    agentEarningsMap(ids),
  ]);
  const items = scored.map((s) => {
    const a = agentMetaBy.get(s.agentId);
    return {
      agentId: Number(s.agentId),
      name: a?.name ?? null,
      owner: a?.owner ?? null,
      style: styleForName(a?.name).style,
      trendingScore: s.score,
      window: { sales: s.sales, mints: s.mints, listings: s.listings, windowSeconds: Number(TRENDING_WINDOW_SECONDS) },
      outputCount: statsBy.get(s.agentId)?.outputCount ?? 0,
      royaltiesEarned: ether(earnBy.get(s.agentId)?.royaltiesEarned ?? 0n),
      meta: a ? { accent: styleForName(a.name).accent, tagline: styleForName(a.name).tagline } : null,
    };
  });
  return c.json({
    sort: "trending",
    weights: { sale: W_SALE, mint: W_MINT, listing: W_LISTING },
    windowSeconds: Number(TRENDING_WINDOW_SECONDS),
    items,
    source: "indexer",
  });
});

// ───────────────────────────── activity feed ─────────────────────────────
// GET /activity?types=mint,sale,listing&limit=&cursor=  -> recent events (block desc, logIndex desc),
// keyset paginated, enriched (agent name, image URL, price as ether, block timestamp).
app.get("/activity", async (c) => {
  const limit = clampLimit(c.req.query("limit"));
  const cursor = parseCursor(c.req.query("cursor"));
  const typesRaw = c.req.query("types");
  const types = typesRaw ? typesRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const conds = [];
  if (cursor !== null) conds.push(lt(schema.events.orderKey, cursor));
  if (types && types.length > 0) conds.push(inArrayText(schema.events.kind, types));
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select()
    .from(schema.events)
    .where(where)
    .orderBy(desc(schema.events.orderKey))
    .limit(limit + 1);
  const page = rows.slice(0, limit);

  // enrich: agent names for any event with an agentId; image roots for output-token events.
  const nameBy = await agentNameMap(page.map((e) => e.agentId).filter((x): x is bigint => x !== null));
  const outputTokenIds = page
    .filter((e) => e.collectionKind === "output" && e.tokenId !== null)
    .map((e) => e.tokenId!) as bigint[];
  const outputBy = await outputRowMap(outputTokenIds);

  const items = page.map((e) => {
    const out = e.collectionKind === "output" && e.tokenId !== null ? outputBy.get(e.tokenId) : undefined;
    return {
      id: e.id,
      kind: e.kind,
      timestamp: Number(e.timestamp),
      blockNumber: Number(e.blockNumber),
      logIndex: e.logIndex,
      txHash: e.txHash,
      collection: e.collection,
      collectionKind: e.collectionKind,
      tokenId: e.tokenId !== null ? Number(e.tokenId) : null,
      agentId: e.agentId !== null ? Number(e.agentId) : null,
      agentName: e.agentId !== null ? nameBy.get(e.agentId) ?? null : null,
      actor: e.actor,
      counterparty: e.counterparty,
      price: e.price !== null ? ether(e.price) : null,
      priceWei: e.price !== null ? e.price.toString() : null,
      royaltyReceiver: e.royaltyReceiver,
      royaltyPaid: e.royaltyPaid !== null ? ether(e.royaltyPaid) : null,
      platformFee: e.platformFee !== null ? ether(e.platformFee) : null,
      sellerProceeds: e.sellerProceeds !== null ? ether(e.sellerProceeds) : null,
      imageRoot: out?.imageRoot ?? null,
      imageUrl: out ? imageUrl(out.imageRoot) : null,
      storageScanUrl: out ? storageScanUrl(out.imageRoot) : null,
    };
  });
  return c.json({
    // display curation: drop events attributed to a hidden (test/junk) agent; non-agent events stay.
    items: items.filter((it) => !isHiddenAgent(it.agentName)),
    nextCursor: rows.length > limit ? page[page.length - 1]!.orderKey.toString() : null,
    source: "indexer",
  });
});

// ───────────────────────────── marketplace ─────────────────────────────
// GET /marketplace -> active listings + platform info (indexer-backed; replaces the chain scan).
app.get("/marketplace", async (c) => {
  const rows = await db
    .select()
    .from(schema.listings)
    .where(eq(schema.listings.active, true))
    .orderBy(desc(schema.listings.orderKey));
  // enrich output listings with agent name + image.
  const outputTokenIds = rows.filter((l) => l.collectionKind === "output").map((l) => l.tokenId);
  const outputBy = await outputRowMap(outputTokenIds);
  const nameBy = await agentNameMap([...outputBy.values()].map((o) => o.creatorAgentId));
  const activeListings = rows.map((l) => {
    const out = l.collectionKind === "output" ? outputBy.get(l.tokenId) : undefined;
    return {
      collection: l.collection,
      collectionKind: l.collectionKind,
      tokenId: Number(l.tokenId),
      seller: l.seller,
      price: ether(l.price),
      priceWei: l.price.toString(),
      listedAt: Number(l.listedAt),
      agentName: out ? nameBy.get(out.creatorAgentId) ?? null : null,
      imageRoot: out?.imageRoot ?? null,
      imageUrl: out ? imageUrl(out.imageRoot) : null,
    };
  // display curation: hide output listings created by a hidden (test/junk) agent.
  }).filter((l) => !isHiddenAgent(l.agentName));
  return c.json({ activeListings, count: activeListings.length, source: "indexer" });
});

// ═════════════════════════════ GAME LAYER (v2 mainnet cutover) ═════════════════════════════
// The Fastify backend proxies /api/* -> indexer/* (server/src/routes/indexer.ts), so these serve
// /api/arena/battles, /api/arena/ladder, /api/fusion/lineage/:id (previously a 502: the indexer had no game
// schema). They return REAL indexed data (empty arrays when nothing is created yet), NOT fake rows. The
// keyless recompute surfaces (/api/arena/tally, /api/arena/ladder/verify) stay OWNED by the Fastify backend
// (chain re-derivation), and Fastify's exact routes take precedence over its /api/* wildcard, so no collision.

function winnerLabel(w: number): "A" | "B" | "tie" {
  return w === 1 ? "A" : w === 2 ? "B" : "tie";
}

// Derive the battle phase from the on-chain windows + finalized flag (mirrors the server BattleView phase).
function battlePhase(b: typeof schema.battles.$inferSelect): string {
  if (b.finalized) return "finalized";
  const now = Math.floor(Date.now() / 1000);
  if (now < Number(b.commitEnd)) return "commit";
  if (now < Number(b.revealEnd)) return "reveal";
  return "awaiting-finalize";
}

function shapeBattle(b: typeof schema.battles.$inferSelect, nameBy: Map<bigint, string>) {
  return {
    battleId: Number(b.battleId),
    agentA: Number(b.agentA),
    agentB: Number(b.agentB),
    agentAName: nameBy.get(b.agentA) ?? null,
    agentBName: nameBy.get(b.agentB) ?? null,
    commitEnd: Number(b.commitEnd),
    revealEnd: Number(b.revealEnd),
    finalized: b.finalized,
    rated: b.rated,
    winner: b.winner,
    winnerLabel: winnerLabel(b.winner),
    weightA: ether(b.weightA),
    weightAWei: b.weightA.toString(),
    weightB: ether(b.weightB),
    weightBWei: b.weightB.toString(),
    pool: ether(b.pool),
    poolWei: b.pool.toString(),
    commitCount: b.commitCount,
    revealCount: b.revealCount,
    phase: battlePhase(b),
    createdAt: Number(b.createdAt),
  };
}

function shapeLineage(l: typeof schema.lineage.$inferSelect, nameBy: Map<bigint, string>) {
  return {
    agentId: Number(l.agentId),
    name: nameBy.get(l.agentId) ?? null,
    generation: l.generation,
    isGenesis: l.isGenesis,
    parentA: Number(l.parentA),
    parentB: Number(l.parentB),
    parentAName: l.parentA > 0n ? nameBy.get(l.parentA) ?? null : null,
    parentBName: l.parentB > 0n ? nameBy.get(l.parentB) ?? null : null,
    styleFingerprint: l.styleFingerprint,
    fuseSeed: l.fuseSeed,
    requestId: l.requestId !== null ? Number(l.requestId) : null,
    fuser: l.fuser,
    createdAt: Number(l.createdAt),
  };
}

// GET /arena/battles - the Arena feed: battles newest-first (keyset by orderKey). Empty [] until any created.
app.get("/arena/battles", async (c) => {
  const limit = clampLimit(c.req.query("limit"));
  const cursor = parseCursor(c.req.query("cursor"));
  const where = cursor !== null ? lt(schema.battles.orderKey, cursor) : undefined;
  const rows = await db
    .select()
    .from(schema.battles)
    .where(where)
    .orderBy(desc(schema.battles.orderKey))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const nameBy = await agentNameMap([...page.map((b) => b.agentA), ...page.map((b) => b.agentB)]);
  return c.json({
    battles: page.map((b) => shapeBattle(b, nameBy)),
    nextCursor: rows.length > limit ? page[page.length - 1]!.orderKey.toString() : null,
    source: "indexer",
  });
});

// GET /arena/battles/:id - one battle + its revealed ballots (the on-chain tally is re-derivable via
// /api/arena/tally; this is the indexed convenience read).
app.get("/arena/battles/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid battle id" }, 400);
  const [b] = await db.select().from(schema.battles).where(eq(schema.battles.battleId, id)).limit(1);
  if (!b) return c.json({ error: "battle not found" }, 404);
  const voteRows = await db
    .select()
    .from(schema.votes)
    .where(eq(schema.votes.battleId, id))
    .orderBy(desc(schema.votes.orderKey));
  const nameBy = await agentNameMap([b.agentA, b.agentB]);
  return c.json({
    ...shapeBattle(b, nameBy),
    votes: voteRows.map((v) => ({
      voter: v.voter,
      choice: v.choice,
      stake: ether(v.stake),
      stakeWei: v.stake.toString(),
      weight: ether(v.weight),
      weightWei: v.weight.toString(),
      revealedAt: Number(v.revealedAt),
    })),
    source: "indexer",
  });
});

// GET /arena/ladder - the reputation-ladder STANDINGS derived from FINALIZED, RATED battles (win/loss/tie
// record per agent). The authoritative fixed-point Glicko rating + its Merkle root are keyless-recomputable
// via the server's /api/arena/ladder/verify (that is the trust root); this endpoint exposes the raw record +
// the latest anchored season. Empty [] until any rated battle finalizes.
app.get("/arena/ladder", async (c) => {
  const finals = await db.select().from(schema.battles).where(eq(schema.battles.finalized, true));
  interface Rec { agentId: bigint; wins: number; losses: number; ties: number; battles: number }
  const rec = new Map<bigint, Rec>();
  const bump = (id: bigint): Rec => {
    let r = rec.get(id);
    if (!r) { r = { agentId: id, wins: 0, losses: 0, ties: 0, battles: 0 }; rec.set(id, r); }
    return r;
  };
  for (const b of finals) {
    if (!b.rated) continue; // only rated (quorum-cleared) battles feed the ladder
    const a = bump(b.agentA);
    const d = bump(b.agentB);
    a.battles++; d.battles++;
    if (b.winner === 1) { a.wins++; d.losses++; }
    else if (b.winner === 2) { d.wins++; a.losses++; }
    else { a.ties++; d.ties++; }
  }
  const ranked = [...rec.values()].sort((x, y) => (y.wins - x.wins) || (y.battles - x.battles) || Number(x.agentId - y.agentId));
  const nameBy = await agentNameMap(ranked.map((r) => r.agentId));
  const [season] = await db.select().from(schema.seasons).orderBy(desc(schema.seasons.seasonEpoch)).limit(1);
  return c.json({
    standings: ranked.map((r, i) => ({
      rank: i + 1,
      agentId: Number(r.agentId),
      name: nameBy.get(r.agentId) ?? null,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      battles: r.battles,
    })),
    season: season
      ? { seasonEpoch: Number(season.seasonEpoch), ladderRoot: season.ladderRoot, anchoredAt: Number(season.anchoredAt) }
      : null,
    ratedBattles: finals.filter((b) => b.rated).length,
    note: "Standings are the raw win/loss record from finalized, rated battles. The authoritative fixed-point Glicko rating and its anchored Merkle root are keyless-recomputable via /api/arena/ladder/verify.",
    source: "indexer",
  });
});

// GET /fusion/lineage/:id - an agent's lineage (genesis or fused-child provenance) + its descendants (rows
// whose parentA/parentB == :id). Empty/null until any genesis is registered or a fusion executes.
app.get("/fusion/lineage/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid agent id" }, 400);
  const [lin] = await db.select().from(schema.lineage).where(eq(schema.lineage.agentId, id)).limit(1);
  const children = await db
    .select()
    .from(schema.lineage)
    .where(or(eq(schema.lineage.parentA, id), eq(schema.lineage.parentB, id)))
    .orderBy(desc(schema.lineage.orderKey));
  // names for the agent, its parents, and its children
  const ids: bigint[] = [id];
  if (lin) { if (lin.parentA > 0n) ids.push(lin.parentA); if (lin.parentB > 0n) ids.push(lin.parentB); }
  for (const ch of children) ids.push(ch.agentId);
  const nameBy = await agentNameMap(ids);
  return c.json({
    agentId: Number(id),
    lineage: lin ? shapeLineage(lin, nameBy) : null,
    children: children.map((ch) => shapeLineage(ch, nameBy)),
    childCount: children.length,
    source: "indexer",
  });
});

// GET /fusion/feed - recent executed fusions (newest-first, keyset). A fusion activity feed for the Fuse page.
app.get("/fusion/feed", async (c) => {
  const limit = clampLimit(c.req.query("limit"));
  const cursor = parseCursor(c.req.query("cursor"));
  const where = cursor !== null ? lt(schema.fusions.orderKey, cursor) : undefined;
  const rows = await db
    .select()
    .from(schema.fusions)
    .where(where)
    .orderBy(desc(schema.fusions.orderKey))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const nameBy = await agentNameMap([
    ...page.map((f) => f.childId),
    ...page.map((f) => f.parentA),
    ...page.map((f) => f.parentB),
  ]);
  return c.json({
    fusions: page.map((f) => ({
      requestId: Number(f.requestId),
      childId: Number(f.childId),
      childName: nameBy.get(f.childId) ?? null,
      parentA: Number(f.parentA),
      parentAName: nameBy.get(f.parentA) ?? null,
      parentB: Number(f.parentB),
      parentBName: nameBy.get(f.parentB) ?? null,
      generation: f.generation,
      fuseSeed: f.fuseSeed,
      fuser: f.fuser,
      executedAt: Number(f.executedAt),
      txHash: f.txHash,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1]!.orderKey.toString() : null,
    source: "indexer",
  });
});

// ───────────── SQL-over-HTTP + GraphQL (free extras for @ponder/client / power users) ─────────────
app.use("/sql/*", client({ db, schema }));
app.use("/graphql", graphql({ db, schema }));
app.use("/", graphql({ db, schema }));

// ───────────────────────────── small query helpers ─────────────────────────────
// drizzle `inArray` needs a non-empty array; these wrap it safely for bigint/text id sets.
function inArrayBigint(col: any, ids: bigint[]) {
  if (ids.length === 0) return sql`false`;
  return sql`${col} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
}
function inArrayText(col: any, vals: string[]) {
  if (vals.length === 0) return sql`false`;
  return sql`${col} in (${sql.join(vals.map((v) => sql`${v}`), sql`, `)})`;
}

// Shared shape of the by-id row maps: dedup the ids, `select * from <table> where <keyCol> in (ids)`
// (empty-safe), then key the rows by `keyOf`. Collapses five near-identical helpers into one.
async function selectByIds<R>(table: any, keyCol: any, ids: bigint[], keyOf: (r: R) => bigint): Promise<Map<bigint, R>> {
  const uniq = [...new Set(ids.map((i) => i.toString()))].map((s) => BigInt(s));
  if (uniq.length === 0) return new Map();
  const rows = (await db.select().from(table).where(inArrayBigint(keyCol, uniq))) as R[];
  return new Map(rows.map((r) => [keyOf(r), r]));
}

async function agentRowMap(ids: bigint[]): Promise<Map<bigint, typeof schema.agents.$inferSelect>> {
  return selectByIds<typeof schema.agents.$inferSelect>(schema.agents, schema.agents.agentId, ids, (r) => r.agentId);
}
async function agentStatsMap(ids: bigint[]): Promise<Map<bigint, typeof schema.agentStats.$inferSelect>> {
  return selectByIds<typeof schema.agentStats.$inferSelect>(schema.agentStats, schema.agentStats.agentId, ids, (r) => r.agentId);
}
async function agentEarningsMap(ids: bigint[]): Promise<Map<bigint, typeof schema.agentEarnings.$inferSelect>> {
  return selectByIds<typeof schema.agentEarnings.$inferSelect>(schema.agentEarnings, schema.agentEarnings.agentId, ids, (r) => r.agentId);
}
async function outputRowMap(ids: bigint[]): Promise<Map<bigint, typeof schema.outputs.$inferSelect>> {
  return selectByIds<typeof schema.outputs.$inferSelect>(schema.outputs, schema.outputs.tokenId, ids, (r) => r.tokenId);
}
// name-only view derived from the full agent row map (agents table is tiny; fetching all cols is fine).
async function agentNameMap(ids: bigint[]): Promise<Map<bigint, string>> {
  const rows = await agentRowMap(ids);
  return new Map([...rows].map(([id, r]) => [id, r.name]));
}

export default app;
