// AURA API client. The base URL is the Fastify backend. All types here mirror the VERIFIED response
// shapes from BUILD-SPEC.md. Fetchers fail soft (return null/empty) so a section degrades to a skeleton
// or empty state, never a crash.
//
// SSR-AWARE BASE (containerized deploy). Several pages are SERVER components that fetch during SSR, so a
// relative base would break (Node fetch has no origin). We therefore resolve the base per execution
// context:
//   - On the SERVER (Next/web container, typeof window === "undefined"): AURA_API_INTERNAL, the in-
//     cluster backend address (e.g. http://server:8787). Runtime env (NOT NEXT_PUBLIC_, not baked).
//   - In the BROWSER: NEXT_PUBLIC_AURA_API, the PUBLIC origin the user's browser can reach (e.g.
//     https://aura.topengdev.com, or "" for same-origin via nginx). Build-time inlined.
// Both default to http://localhost:8787 so the existing local dev flow (web dev server + backend on
// 8787) is unchanged. An empty NEXT_PUBLIC_AURA_API ("") is honored as same-origin (relative) in the
// browser; the SERVER branch never goes relative.
function resolveApiBase(): string {
  if (typeof window === "undefined") {
    // server-side: prefer the in-cluster address; fall back to the public value, then localhost.
    return (
      process.env.AURA_API_INTERNAL ||
      process.env.NEXT_PUBLIC_AURA_API ||
      "http://localhost:8787"
    );
  }
  // browser: the public base. "" is intentional same-origin (relative). undefined => localhost dev.
  const pub = process.env.NEXT_PUBLIC_AURA_API;
  return pub === undefined ? "http://localhost:8787" : pub;
}

export const API_BASE = resolveApiBase();

// ── Types (verified shapes) ───────────────────────────────────────────────
export type AgentStyle = "noir" | "cyberpunk" | "risograph" | "illuminated" | "custom" | string;

export interface AgentMeta {
  tagline: string;
  aesthetic: string;
  accent: string;
  signatureCharacter: string | null;
}

export interface Agent {
  agentId: number;
  name: string;
  owner: string;
  creator: string;
  royaltyBps: number;
  royaltyPct: number;
  creatorResaleBps: number;
  styleVersion: number;
  minted: boolean;
  outputCount: number;
  salesCount: number;
  royaltiesEarned: string;
  royaltiesEarnedWei: string;
  mintedAt: number;
  style: AgentStyle;
  meta: AgentMeta;
}

export interface Output {
  tokenId: number;
  owner: string;
  creatorAgentId: number;
  agentName: string;
  imageRoot: string;
  imageUrl: string;
  storageScanUrl: string;
  seed: string;
  provenanceHash: string;
  teeAttestation: string;
  mintedAt: number;
  style: AgentStyle;
}

export type ActivityKind = "mint" | "sale" | "transfer" | "listing" | "agent_mint" | string;

export interface Activity {
  id: string;
  kind: ActivityKind;
  timestamp: number;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  collection: string;
  collectionKind: "output" | "agent" | string;
  tokenId: number | null;
  agentId: number | null;
  agentName: string | null;
  actor: string;
  counterparty: string | null;
  price: string | null;
  priceWei: string | null;
  royaltyReceiver: string | null;
  royaltyPaid: string | null;
  platformFee: string | null;
  sellerProceeds: string | null;
  imageRoot: string | null;
  imageUrl: string | null;
  storageScanUrl: string | null;
}

export interface TrendingItem {
  agentId: number;
  name: string;
  owner: string;
  style: AgentStyle;
  trendingScore: number;
  window: { sales: number; mints: number; listings: number; windowSeconds: number };
  outputCount: number;
  royaltiesEarned: string;
  meta: { accent: string; tagline: string };
}

export interface Health {
  ok: boolean;
  chainId: number;
  contracts: { agentRegistry: string; outputNFT: string; marketplace: string };
  sponsor: string;
  attestor: string;
  attestorMatchesContract: boolean;
  onChainAttestor: string;
  sponsorBalance: string;
  gen: { totalGenerations: number; inFlight: number; cap: number; maxConcurrent: number };
  time: string;
}

export interface IndexerCounts {
  ok: boolean;
  service: string;
  counts: { agents: number; outputs: number; activeListings: number; events: number };
}

// One agent, live chain read. Same as Agent plus the agent's own output tokenIds (newest-first).
// Served by GET /api/agents/:id (indexer-proxied). The on-chain DNA fields (styleFingerprint,
// modelAttestation, encBrainRoot, meta.model) come from the ROOT GET /agents/:id read and are merged
// in by the page, so the detail view has the full identity in one object.
export interface AgentDetail extends Agent {
  outputs: number[];
  styleFingerprint?: string;
  modelAttestation?: string;
  encBrainRoot?: string;
  model?: string;
}

// The ROOT GET /agents/:id shape (carries the on-chain DNA the indexer-proxied one omits).
export interface AgentChainRead {
  agentId: number;
  name: string;
  owner: string;
  royaltyBps: number;
  royaltyPct: number;
  creatorResaleBps: number;
  styleVersion: number;
  styleFingerprint: string;
  modelAttestation: string;
  encBrainRoot: string;
  outputCount: number;
  outputs: number[];
  meta: AgentMeta & { model?: string };
}

// Full provenance for one output (GET /provenance/:id, ROOT-mounted live chain read). This is also
// the payload the inline Verify action re-checks: agent existence, image-on-chain, TEE presence, and
// the dynamically-resolved royalty receiver.
export interface Provenance {
  tokenId: number;
  onChain: {
    creatorAgentId: number;
    imageRoot: string;
    provenanceHash: string;
    teeAttestation: string;
    seed: number;
  };
  agent: {
    agentId: number;
    name: string;
    owner: string;
    modelAttestation: string;
    styleFingerprint: string;
  };
  verification: {
    agentExists: boolean;
    imageOnChain: boolean;
    teeAttestationPresent: boolean;
    royaltyReceiver: string;
    summary: string;
  };
  links: { storageScan: string };
}

// Live EIP-2981 royalty for one output (GET /royalty/:id, ROOT-mounted). The receiver resolves
// dynamically to the CURRENT owner of the creating agent, so selling the agent moves the stream.
export interface RoyaltySample {
  salePrice: string;
  royaltyAmount: string;
}
export interface Royalty {
  tokenId: number;
  creatorAgentId: number;
  agentName: string;
  royaltyBps: number;
  royaltyPct: number;
  receiver: string;
  receiverIsAgentOwner: boolean;
  samples: RoyaltySample[];
  thesis: string;
}

// One active marketplace listing. collectionName tells which collection (agent iNFT or output NFT);
// price is an ether string. From GET /marketplace (indexer-first, chain-scan fallback).
export interface MarketListing {
  collection: string;
  collectionName: "agent" | "output" | string;
  tokenId: number;
  seller: string;
  price: string;
}
export interface MarketplaceView {
  activeListings: MarketListing[];
  count?: number;
  source?: string;
}

// ── Fetchers (server-side or client; fail soft) ───────────────────────────
async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchHealth(): Promise<Health | null> {
  return getJson<Health>("/health");
}

export async function fetchIndexerCounts(): Promise<IndexerCounts | null> {
  return getJson<IndexerCounts>("/api/_indexer");
}

export async function fetchAgents(): Promise<Agent[]> {
  const data = await getJson<{ agents: Agent[] }>("/agents");
  return data?.agents ?? [];
}

export async function fetchOutputs(limit = 8): Promise<Output[]> {
  const data = await getJson<{ outputs: Output[] }>(`/outputs?limit=${limit}`);
  return data?.outputs ?? [];
}

export async function fetchActivity(limit = 12): Promise<Activity[]> {
  const data = await getJson<{ items: Activity[] }>(`/api/activity?limit=${limit}`);
  return data?.items ?? [];
}

export async function fetchTrending(): Promise<TrendingItem[]> {
  const data = await getJson<{ items: TrendingItem[] }>("/api/discover?sort=trending");
  return data?.items ?? [];
}

// ── Per-item live reads (detail pages) ─────────────────────────────────────
// /api/agents/:id carries the agent's outputs[] (indexer-enriched). provenance + royalty are the
// ROOT-mounted live chain reads (NOT /api/*, which proxies to the indexer that has no such route).
// Fetch one agent merged from BOTH reads: the indexer-proxied /api/agents/:id (outputs[], salesCount,
// royaltiesEarned) + the root /agents/:id (on-chain DNA: styleFingerprint, modelAttestation, model).
// Falls back gracefully if either is down (the base read is required; the DNA enrich is best-effort).
export async function fetchAgentById(id: number | string): Promise<AgentDetail | null> {
  const [base, chain] = await Promise.all([
    getJson<AgentDetail>(`/api/agents/${id}`),
    getJson<AgentChainRead>(`/agents/${id}`),
  ]);
  if (!base) {
    if (!chain) return null;
    // Reconstruct a usable AgentDetail purely from the chain read if the proxied one is unavailable.
    return {
      agentId: chain.agentId,
      name: chain.name,
      owner: chain.owner,
      creator: chain.owner,
      royaltyBps: chain.royaltyBps,
      royaltyPct: chain.royaltyPct,
      creatorResaleBps: chain.creatorResaleBps,
      styleVersion: chain.styleVersion,
      minted: true,
      outputCount: chain.outputCount,
      salesCount: 0,
      royaltiesEarned: "0",
      royaltiesEarnedWei: "0",
      mintedAt: 0,
      style: (chain.meta as AgentMeta & { style?: string }).style ?? "custom",
      meta: chain.meta,
      outputs: chain.outputs ?? [],
      styleFingerprint: chain.styleFingerprint,
      modelAttestation: chain.modelAttestation,
      encBrainRoot: chain.encBrainRoot,
      model: chain.meta?.model,
    };
  }
  return {
    ...base,
    styleFingerprint: chain?.styleFingerprint,
    modelAttestation: chain?.modelAttestation,
    encBrainRoot: chain?.encBrainRoot,
    model: chain?.meta?.model,
  };
}

export async function fetchProvenance(id: number | string): Promise<Provenance | null> {
  return getJson<Provenance>(`/provenance/${id}`);
}

export async function fetchRoyalty(id: number | string): Promise<Royalty | null> {
  return getJson<Royalty>(`/royalty/${id}`);
}

// IMPORTANT: the flat Output shape (owner, agentName, seed, imageRoot, style, teeAttestation,
// provenanceHash, storageScanUrl) is served by the INDEXER-PROXIED /api/outputs/:id. The ROOT
// /outputs/:id returns the full Provenance object instead (tokenId, onChain, agent, verification,
// links), which is a DIFFERENT shape. The detail page enriches with /provenance/:id + /royalty/:id
// separately, so this fetcher must return the flat Output. Falls back to deriving it from the
// provenance object if the proxied read is unavailable.
export async function fetchOutputById(id: number | string): Promise<Output | null> {
  const flat = await getJson<Output>(`/api/outputs/${id}`);
  if (flat && flat.owner) return flat;
  // Fallback: reconstruct the flat Output from the root provenance read (different shape).
  const p = await getJson<Provenance>(`/outputs/${id}`);
  if (!p) return null;
  return {
    tokenId: p.tokenId,
    owner: p.agent.owner, // best-effort: the holder is enriched elsewhere; use a known address
    creatorAgentId: p.onChain.creatorAgentId,
    agentName: p.agent.name,
    imageRoot: p.onChain.imageRoot,
    imageUrl: `/images/${encodeURIComponent(p.onChain.imageRoot)}`,
    storageScanUrl: p.links.storageScan,
    seed: String(p.onChain.seed),
    provenanceHash: p.onChain.provenanceHash,
    teeAttestation: p.onChain.teeAttestation,
    mintedAt: 0,
    style: "custom",
  };
}

export async function fetchMarketplace(): Promise<MarketListing[]> {
  const data = await getJson<MarketplaceView>("/marketplace");
  return data?.activeListings ?? [];
}

// ── Generate flow (authed; Bearer JWT from SIWE) ───────────────────────────
// The signature feature. Confirmed against server/src/routes/generate.ts + mint-args.ts (source-read
// + live-tested). EVERY call is authed: generation is sponsored (the SPONSOR wallet pays 0G Compute +
// Storage) but still owner-scoped to the SIWE address, so a wallet connect + sign is required even to
// generate. Flow: POST /generate -> 202 { jobId } -> poll GET /generate/:jobId until status==="done" ->
// preview the authed PNG -> POST /mint-args -> wallet-signs OutputNFT.mintOutput with those exact args.

export type JobStatus = "pending" | "generating" | "verifying" | "storing" | "done" | "error";

// The terminal result of a DONE generation job (server GenerateJobResult).
export interface GenerateJobResult {
  imageRoot: string;
  imageUrl: string;
  provenanceHash: string;
  teeAttestation: string;
  teeVerified: boolean | string;
  teeSigner: string;
  model: string;
  verifiability: string;
  chatId: string | null;
  latencyMs: number;
  seed: number;
  mintable: boolean;
  usedBrain: boolean;
}

export interface GenerateJob {
  jobId: string;
  owner: string;
  status: JobStatus;
  agentId: number;
  agentName: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  progress: string;
  result: GenerateJobResult | null;
  error: string | null;
}

// Everything the user needs to submit OutputNFT.mintOutput themselves. The attestationSig is the
// attestor's EIP-712 MintAuth signature the deployed contract verifies (recovered signer must ==
// attestor, nonce single-use). seed is a decimal string (uint256-safe); nonce is bytes32 hex.
export interface MintArgs {
  contract: string;
  chainId: number;
  to: string;
  creatorAgentId: number;
  imageRoot: string;
  provenanceHash: string;
  teeAttestation: string;
  seed: string;
  nonce: string;
  attestationSig: string;
  eip712: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}

// Authed JSON helper (Bearer token). Returns the parsed body on 2xx; throws a clean message otherwise so
// the calling flow can surface it. Used by the generate + create write flows (NOT the soft READ fetchers).
async function authedJson<T>(
  path: string,
  token: string,
  init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    body: init.body,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; retryInMs?: number };
    throw new Error(err.error ?? `request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

// POST /generate -> 202 { jobId, status }. Kicks off the background generation owned by the JWT address.
export async function startGeneration(
  token: string,
  agentId: number,
  prompt: string,
): Promise<{ jobId: string; status: JobStatus }> {
  return authedJson("/generate", token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId, prompt }),
  });
}

// GET /generate/:jobId -> the owner-scoped job (poll this until status is done|error).
export async function fetchJob(token: string, jobId: string): Promise<GenerateJob> {
  return authedJson(`/generate/${jobId}`, token);
}

// GET /generate/:jobId/image -> the preview PNG. This route is owner-scoped (401 without auth), so the
// browser CANNOT use a plain <img src>; it must blob-fetch with the Bearer header and createObjectURL.
// Returns an object URL the caller is responsible for revoking.
export async function fetchJobImageObjectUrl(token: string, jobId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/generate/${jobId}/image`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

// POST /mint-args { jobId } -> the exact mintOutput args + the attestor signature.
export async function fetchMintArgs(token: string, jobId: string, to?: string): Promise<MintArgs> {
  return authedJson("/mint-args", token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(to ? { jobId, to } : { jobId }),
  });
}

// ── Create-agent flow (authed, multipart) ──────────────────────────────────
// POST /agents/create (multipart: file `image` + text fields) -> the computed mintAgent args for the
// USER to submit (mintAgent is permissionless + user-signed). Confirmed against server/src/routes/
// agents-create.ts + aura/create-agent.ts. Then the user wallet-signs AgentRegistry.mintAgent, then
// POST /agents/confirm-mint promotes the server-staged brain key to the new agentId.
export interface CreateAgentArgs {
  contract: string;
  chainId: number;
  to: string;
  name: string;
  styleFingerprint: string;
  encBrainRoot: string;
  modelAttestation: string;
  royaltyBps: number;
  creatorResaleBps: number;
  canonicalBaseRoot: string;
  publicStyle: Record<string, unknown>;
  styleVersionHint: number;
}

export interface CreateAgentFields {
  name: string;
  royaltyBps: number;
  creatorResaleBps: number;
  styleDescriptor: string;
  identityLock?: string;
  negative?: string;
  signatureCharacter?: string;
}

// POST /agents/create. Builds the multipart form (image + fields) and returns the mintAgent args.
export async function createAgentDraft(
  token: string,
  image: File,
  fields: CreateAgentFields,
): Promise<CreateAgentArgs> {
  const form = new FormData();
  form.append("image", image);
  form.append("name", fields.name);
  form.append("royaltyBps", String(fields.royaltyBps));
  form.append("creatorResaleBps", String(fields.creatorResaleBps));
  form.append("styleDescriptor", fields.styleDescriptor);
  if (fields.identityLock) form.append("identityLock", fields.identityLock);
  if (fields.negative) form.append("negative", fields.negative);
  if (fields.signatureCharacter) form.append("signatureCharacter", fields.signatureCharacter);
  // NOTE: do not set content-type; the browser sets the multipart boundary itself.
  return authedJson("/agents/create", token, { method: "POST", body: form });
}

// POST /agents/confirm-mint { encBrainRoot, agentId } -> promotes the staged brain key to the agentId
// (the server verifies the on-chain agent has this encBrainRoot AND is owned by the caller).
export async function confirmAgentMint(
  token: string,
  encBrainRoot: string,
  agentId: number,
): Promise<{ ok: boolean; promoted: boolean; agentId: number }> {
  return authedJson("/agents/confirm-mint", token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ encBrainRoot, agentId }),
  });
}

// ── Dashboard (owned-by-address; indexer-proxied) ──────────────────────────
// GET /api/creators/:wallet -> the wallet's full portfolio (agents + outputs owned + royalties).
// Confirmed against indexer/src/api/index.ts (the /creators/:wallet route) + live-tested. agentsOwned
// uses the Agent shape; outputsOwned/outputsCreatedByMyAgents use the Output shape. A fresh wallet 200s
// with zero counts (clean empty state).
export interface CreatorDashboard {
  wallet: string;
  royaltiesEarned: string;
  royaltiesEarnedWei: string;
  salesAsReceiver: number;
  agentsOwned: Agent[];
  outputsOwned: Output[];
  outputsCreatedByMyAgents: Output[];
  counts: { agentsOwned: number; outputsOwned: number; outputsCreatedByMyAgents: number };
}

export async function fetchCreatorDashboard(address: string): Promise<CreatorDashboard | null> {
  return getJson<CreatorDashboard>(`/api/creators/${address}`);
}

// One enriched activity-feed item (GET /api/activity). The dashboard filters these to the connected
// address (actor | counterparty | royaltyReceiver) for the wallet's on-chain history.
export interface ActivityItem extends Activity {
  priceWei: string | null;
}

export async function fetchActivityFeed(limit = 60): Promise<Activity[]> {
  const data = await getJson<{ items: Activity[] }>(`/api/activity?limit=${limit}`);
  return data?.items ?? [];
}

// The events that touch a given address (as actor, counterparty, or royalty receiver), newest-first.
export function activityForAddress(items: Activity[], address: string): Activity[] {
  const a = address.toLowerCase();
  return items.filter(
    (e) =>
      e.actor?.toLowerCase() === a ||
      e.counterparty?.toLowerCase() === a ||
      e.royaltyReceiver?.toLowerCase() === a,
  );
}

// Find the active listing for a given collection-kind + tokenId (null if not listed).
export function findListing(
  listings: MarketListing[],
  kind: "agent" | "output",
  tokenId: number,
): MarketListing | null {
  return listings.find((l) => l.collectionName === kind && l.tokenId === tokenId) ?? null;
}

// ── Shown-agent filter ──
// Every REAL agent is first-class: the 4 curated catalog agents AND user-created agents (which are
// style "custom" with 0 outputs until they generate). Hidden ONLY: the metadata-less test stubs
// (TESTAGENT_* and BRAINTEST_* e2e-proof agents) -- they still count in raw on-chain totals. Real
// same-named agents are NOT deduped (e.g. two distinct CHILLDAWG agents both show -- intended).
export const CATALOG_NAMES = new Set(["NOKTURNE", "MIRAI", "RISO", "SCRIPTORIUM"]);

export function isFeatured(a: Agent): boolean {
  return !/^(TESTAGENT|BRAINTEST)/i.test(a.name);
}

export function featuredAgents(agents: Agent[]): Agent[] {
  return agents
    .filter(isFeatured)
    .sort((a, b) => b.outputCount - a.outputCount || a.agentId - b.agentId);
}

// ── Featured CHARACTER outputs (the showpiece art that now LEADS the app) ───
// The 9 character pieces (tokenIds 7-15) are the real minted artworks; tokens 1-4 are the showcase
// pseudo-outputs (0g://showcase-*). These 5 are the strongest, in deliberate display order: #12 and
// #15 are the showpieces (street-samurai + illuminated knight), then the raven, the netrunner fox-girl,
// and the detective fox. The Home hero + explore surfaces lead with these by tokenId. The order here is
// the curatorial order (NOT recency), so the two showpieces always land first/largest.
export const FEATURED_OUTPUT_IDS: number[] = [12, 15, 9, 13, 7];

// Return the curated featured outputs from a fetched batch, in FEATURED_OUTPUT_IDS order (skipping any
// not present in the batch). A character-art gallery on top of the recency feed. The caller must fetch a
// batch large enough to include these ids (fetchOutputs(20) covers tokens 1-15+).
export function featuredOutputs(outputs: Output[]): Output[] {
  const byId = new Map<number, Output>(outputs.map((o) => [o.tokenId, o]));
  return FEATURED_OUTPUT_IDS.map((id) => byId.get(id)).filter((o): o is Output => !!o);
}

// The remaining outputs (not in the featured set), newest-first as fetched. Used to fill the rest of a
// gallery after the curated showpieces lead. Excludes the showcase pseudo-outputs so the recency feed is
// all real minted art (the showcase roots already surface as the agent portraits).
export function nonFeaturedOutputs(outputs: Output[]): Output[] {
  const featured = new Set(FEATURED_OUTPUT_IDS);
  return outputs.filter((o) => !featured.has(o.tokenId) && !o.imageRoot.startsWith("0g://showcase-"));
}

// ── Image URL (single source of truth) ─────────────────────────────────────
// Both agent portraits and output art resolve through the Next /images/[root] route, which proxies the
// authed backend image and caches it. Defined once here so every surface (hero, rails, galleries, detail)
// builds the same URL. style is a hint the route forwards (deterministic placeholder when a root is a
// showcase pseudo-root).
//
// Path-segment slug for the /images/[root] route. The showcase pseudo-root arrives (from the backend,
// for the curated outputs tokens 1-4) as "0g://showcase-<name>"; its "://" encodes to "%3A%2F%2F", and
// the "%2F" encoded-slash inside the path segment 404s behind nginx + Next-standalone (it worked under
// `next dev` only). Hex output roots have no slash and are fine. So we strip the "0g://" scheme to a
// slash-free "showcase-<name>" slug before it becomes a path segment; the route map keys match this
// slash-free form. encodeURIComponent still runs (harmless: nothing left to encode for the slug).
export function imageRootSlug(imageRoot: string): string {
  return imageRoot.startsWith("0g://") ? imageRoot.slice("0g://".length) : imageRoot;
}

export function imageUrl(imageRoot: string, style?: AgentStyle): string {
  const q = style ? `?style=${encodeURIComponent(style)}` : "";
  return `/images/${encodeURIComponent(imageRootSlug(imageRoot))}${q}`;
}

// The agent's portrait URL. Built one way everywhere (slash-free so it survives nginx + Next-standalone).
//   - CATALOG agent (NOKTURNE/MIRAI/RISO/SCRIPTORIUM): the baked "showcase-<name>" portrait shipped in
//     the web image -> real curated art.
//   - USER agent (everything else): "agent-<agentId>", which the /images route proxies to the backend
//     GET /agent-portrait/<id> (the agent's reference image from the durable local cache) -> real art,
//     not the placeholder. Falls back to the placeholder only if the backend has no bytes.
export function agentPortraitUrl(agent: Pick<Agent, "name" | "style" | "agentId">): string {
  const isCatalog = CATALOG_NAMES.has(agent.name.toUpperCase());
  if (isCatalog) return imageUrl(`showcase-${agent.name.toLowerCase()}`, agent.style);
  const id = (agent as { agentId?: number }).agentId;
  if (typeof id === "number" && id > 0) return imageUrl(`agent-${id}`, agent.style);
  // no agentId (unminted/catalog-only placeholder rows) -> the showcase slug (placeholder if not baked).
  return imageUrl(`showcase-${agent.name.toLowerCase()}`, agent.style);
}

// A creator (agent owner) aggregated across all the agents they own: total royalties earned, output +
// sales counts, and the agents themselves (newest royalty-stream first). Used by the /explore creators
// leaderboard. There is no list endpoint for creators (only GET /api/creators/:wallet for one wallet),
// so the leaderboard is DERIVED from the agent catalog by grouping on owner. Royalties are summed from
// the wei field for exactness (the formatted string is for display only).
export interface CreatorRollup {
  owner: string;
  royaltiesEarnedWei: bigint;
  royaltiesEarned: string;
  outputCount: number;
  salesCount: number;
  agents: Agent[];
}

// Group featured agents by owner into a royalties-ranked leaderboard. Excludes the metadata-less test
// agent the same way the rest of the app does (isFeatured). Royalty totals are summed in wei (bigint)
// then formatted back to a short 0G string; ties break on output volume then sales.
export function creatorsLeaderboard(agents: Agent[]): CreatorRollup[] {
  const byOwner = new Map<string, CreatorRollup>();
  for (const a of agents.filter(isFeatured)) {
    const key = a.owner.toLowerCase();
    const existing = byOwner.get(key);
    const wei = (() => {
      try {
        return BigInt(a.royaltiesEarnedWei || "0");
      } catch {
        return 0n;
      }
    })();
    if (existing) {
      existing.royaltiesEarnedWei += wei;
      existing.outputCount += a.outputCount;
      existing.salesCount += a.salesCount;
      existing.agents.push(a);
    } else {
      byOwner.set(key, {
        owner: a.owner,
        royaltiesEarnedWei: wei,
        royaltiesEarned: "0",
        outputCount: a.outputCount,
        salesCount: a.salesCount,
        agents: [a],
      });
    }
  }
  const rows = Array.from(byOwner.values());
  for (const r of rows) {
    // 18-decimal 0G, trimmed: enough precision to distinguish testnet royalties without noise.
    const whole = r.royaltiesEarnedWei / 10n ** 18n;
    const frac = r.royaltiesEarnedWei % 10n ** 18n;
    const fracStr = frac === 0n ? "" : `.${(frac + 10n ** 18n).toString().slice(1).replace(/0+$/, "")}`;
    r.royaltiesEarned = `${whole}${fracStr}`;
  }
  return rows.sort(
    (a, b) =>
      (b.royaltiesEarnedWei > a.royaltiesEarnedWei ? 1 : b.royaltiesEarnedWei < a.royaltiesEarnedWei ? -1 : 0) ||
      b.outputCount - a.outputCount ||
      b.salesCount - a.salesCount,
  );
}

// ── Formatting helpers ─────────────────────────────────────────────────────
export function shortHex(hex: string | null | undefined, head = 6, tail = 4): string {
  if (!hex) return "";
  if (hex.startsWith("0g://")) return hex; // showcase pseudo-roots read as-is
  if (hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function shortAddr(addr: string | null | undefined): string {
  return shortHex(addr, 6, 4);
}
