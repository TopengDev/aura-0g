// GAME-LAYER API client (Fusion + Arena + Ladder). Talks to the Phase-2 backend routes. Unlike the fail-
// soft READ fetchers in lib/api.ts (which collapse every non-200 to null), these return a DISCRIMINATED
// result so the UI can tell the three cases apart HONESTLY:
//   - "ok"       200: real data
//   - "gated"    501: the contract is not configured on this deploy -> render the "activates at the mainnet
//                     deploy" state, NEVER fake data (the same graceful gate the backend enforces)
//   - "notfound" 404: configured, but this id/battle/agent does not exist yet
//   - "down"     5xx / network / parse: a genuine backend problem (surface it, do not pretend it is gated)
// This mirrors the Proof page's erc7857 pattern: the deploy-gated state is read from the LIVE backend signal
// (a 501), not hardcoded.
import { API_BASE } from "@/lib/api";
import { absoluteUrl } from "@/lib/share";

// The public API origin a juror curls for the ROOT-mounted (/game/*) endpoints (not proxied same-origin in
// prod, unlike /api/*). Same origin the Proof page uses for its copy-paste commands.
export const PUBLIC_API = "https://api-aura.topengdev.com";

export type GameResult<T> =
  | { state: "ok"; data: T }
  | { state: "gated"; error: string }
  | { state: "notfound"; error: string }
  | { state: "down"; error: string };

async function gameGet<T>(path: string): Promise<GameResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
    if (res.status === 501) return { state: "gated", error: await errText(res) };
    if (res.status === 404) return { state: "notfound", error: await errText(res) };
    if (!res.ok) return { state: "down", error: await errText(res) };
    return { state: "ok", data: (await res.json()) as T };
  } catch (e) {
    return { state: "down", error: (e as Error)?.message ?? "network error" };
  }
}

async function gameAuthedPost<T>(path: string, token: string, body: unknown): Promise<GameResult<T>> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    if (res.status === 501) return { state: "gated", error: await errText(res) };
    if (res.status === 404) return { state: "notfound", error: await errText(res) };
    if (!res.ok) return { state: "down", error: await errText(res) };
    return { state: "ok", data: (await res.json()) as T };
  } catch (e) {
    return { state: "down", error: (e as Error)?.message ?? "network error" };
  }
}

async function errText(res: Response): Promise<string> {
  try {
    const b = (await res.json()) as { error?: string };
    return b?.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

// ── Arena reads (public) ───────────────────────────────────────────────────
export interface BattleView {
  battleId: number;
  agentA: number;
  agentB: number;
  commitEnd: number;
  revealEnd: number;
  finalized: boolean;
  rated: boolean;
  winner: number; // 0 tie | 1 A | 2 B
  weightA: string;
  weightB: string;
  revealCount: number;
  pool: string;
  phase: "commit" | "reveal" | "finalized" | "awaiting-finalize" | string;
  // Present when the backend journaled the battle's blind art at createBattle (phase-4 close of the read gap):
  // a BROWSED battle then renders the two pieces + shared theme, not just the on-chain tally. Absent (a battle
  // created on another instance / after a DB reset) => the UI degrades to the on-chain state only.
  theme?: { seed: string; subjectProse: string };
  images?: BattleImage[]; // [A, B]
}

export interface TallyReport {
  battleId: number;
  found: boolean;
  network: { chainId: number; name: string; explorer: string; rpc: string };
  contract: string;
  recompute: { weightA: string; weightB: string; winner: number; winnerLabel: "A" | "B" | "tie"; revealCount: number; weightTampered: boolean };
  onchain: { finalized: boolean; rated: boolean; winner: number; weightA: string; weightB: string; revealCount: number; pool: string };
  agree: { winnerMatches: boolean; weightAMatches: boolean; weightBMatches: boolean; revealCountMatches: boolean; weightingIsLinear: boolean; ok: boolean };
  selfCheck: Record<string, string>;
  trustBoundary: string;
  generatedAt: string;
}

export function fetchBattle(battleId: number): Promise<GameResult<BattleView>> {
  return gameGet<BattleView>(`/game/arena/battles/${battleId}`);
}
export function fetchTally(battleId: number): Promise<GameResult<TallyReport>> {
  return gameGet<TallyReport>(`/api/arena/tally?battleId=${battleId}`);
}

// One battle art piece (both agents render the SAME shared theme, each in its OWN style). Blind: the UI must
// not reveal which agentId maps to which piece until the battle finalizes.
export interface BattleImage {
  agentId: number;
  imageRoot: string;
  seed: string;
  provenanceHash: string;
  teeAttestation: string;
  teeVerified: boolean | string;
  model: string;
}
export interface CreateBattleResult {
  battleId: number;
  agentA: number;
  agentB: number;
  theme: { seed: string; subjectProse: string };
  commitDur: number;
  revealDur: number;
  images: BattleImage[]; // [A, B]
  seedBlind: true;
}

// POST /game/arena/battles (authed). The OPERATOR (server) signs createBattle + generates both portraits on a
// shared, operator-un-grindable theme; the caller only authenticates + picks the two agents. Heavy (two TEE gens).
export function createBattle(token: string, agentA: number, agentB: number): Promise<GameResult<CreateBattleResult>> {
  return gameAuthedPost<CreateBattleResult>("/game/arena/battles", token, { agentA, agentB });
}

// ── Ladder reads (public) ──────────────────────────────────────────────────
export interface RatingSurface {
  agentId: number;
  rating: number;
  rd: number;
  conservative: number;
  rank: number;
  provisional: boolean;
  eligibleField: number;
  battlesCounted: number;
  note: string;
}

export interface LadderRow {
  agentId: number;
  rating: number;
  rd: number;
}
export interface LadderVerifyReport {
  season: number;
  agents: number;
  recomputedRoot: string;
  anchoredRoot: string;
  match: boolean;
  rows: LadderRow[];
  note: string;
  generatedAt: string;
  selfCheck?: Record<string, string>;
}

export function fetchRating(agentId: number): Promise<GameResult<RatingSurface>> {
  return gameGet<RatingSurface>(`/game/arena/rating/${agentId}`);
}
export function fetchLadderVerify(season: number): Promise<GameResult<LadderVerifyReport>> {
  return gameGet<LadderVerifyReport>(`/api/arena/ladder/verify?season=${season}`);
}

// ── Fusion reads (public) ──────────────────────────────────────────────────
export interface FuseVerifyResult {
  requestId: number;
  fuser: string;
  parentA: number;
  parentB: number;
  fuseSeed: string;
  parentAGenome: number[];
  parentBGenome: number[];
  childGenome: number[];
  recomputeNote: string;
}
export function fetchFuseVerify(requestId: number): Promise<GameResult<FuseVerifyResult>> {
  return gameGet<FuseVerifyResult>(`/game/fuse/verify?requestId=${requestId}`);
}

// ── Fusion action-args (authed; the server computes call args, the wallet signs) ───────────────────────────
export interface GenesisArgs {
  contract: string;
  chainId: number;
  agentId: number;
  genome: number[];
  call: { fn: "registerGenesis"; args: [number, number[]] };
  note: string;
}
export interface RequestFusionArgs {
  contract: string;
  chainId: number;
  fuser: string;
  parentA: number;
  parentB: number;
  fee: string; // wei decimal string
  call: { fn: "requestFusion"; args: [number, number]; value: string };
}
export interface FuseExecuteResult {
  requestId: number;
  childName: string;
  generation: number;
  childGenome: number[];
  fuseSeed: string;
  blendedStyleDescriptor: string;
  publicStyle: Record<string, unknown>;
  portrait: { imageRoot: string; prompt: string; seed: string; provenanceHash: string; teeAttestation: string; teeVerified: boolean | string; model: string };
  memory: { inheritedL1Count: number; l1Reset: false; l2Reset: boolean; l1SegRoot: string } | null;
  executeArgs: {
    contract: string;
    chainId: number;
    call: {
      fn: "executeFusion";
      requestId: number;
      childName: string;
      childStyleFingerprint: string;
      childEncBrainRoot: string;
      childDataHash: string;
      childModelAttestation: string;
      royaltyBps: number;
      creatorResaleBps: number;
      childSealedKey: string;
    };
  };
}

export function fetchGenesisArgs(token: string, agentId: number): Promise<GameResult<GenesisArgs>> {
  return gameAuthedPost<GenesisArgs>("/game/fuse/genesis-args", token, { agentId });
}
export function fetchRequestFusionArgs(token: string, parentA: number, parentB: number): Promise<GameResult<RequestFusionArgs>> {
  return gameAuthedPost<RequestFusionArgs>("/game/fuse/request-args", token, { parentA, parentB });
}
export function fetchExecuteFusion(token: string, requestId: number, childName?: string): Promise<GameResult<FuseExecuteResult>> {
  return gameAuthedPost<FuseExecuteResult>("/game/fuse/execute", token, childName ? { requestId, childName } : { requestId });
}

export interface FinalizeFusionResult {
  ok: boolean;
  promoted: boolean;
  personaPromoted: boolean;
  agentId: number;
}
// POST /game/fuse/finalize (authed). After the child mint tx confirms, promote the staged child brain to the
// minted childId so its portrait resolves (the FUSION analog of /agents/confirm-mint). Best-effort from the UI.
export function fetchFinalizeFusion(token: string, childEncBrainRoot: string, agentId: number): Promise<GameResult<FinalizeFusionResult>> {
  return gameAuthedPost<FinalizeFusionResult>("/game/fuse/finalize", token, { childEncBrainRoot, agentId });
}

// ── Arena vote-args (authed) ───────────────────────────────────────────────
export interface VotePrep {
  battleId: number;
  choice: number;
  salt: string;
  commitment: string;
  commitCall: { contract: string; chainId: number; fn: "commit"; args: [number, string]; valueNote: string };
  revealCall: { contract: string; chainId: number; fn: "reveal"; args: [number, number, string] };
  keepSalt?: string;
}
export function prepareVote(token: string, battleId: number, choice: 1 | 2, salt?: string): Promise<GameResult<VotePrep>> {
  return gameAuthedPost<VotePrep>("/game/arena/vote/prepare", token, salt ? { battleId, choice, salt } : { battleId, choice });
}

// ── Copy-paste "verify it yourself" commands (jury-facing; work post-deploy) ───────────────────────────────
// /api/* is same-origin in prod (nginx proxies it to the backend), so those use absoluteUrl. The root-mounted
// /game/* endpoints are curled against the public API origin.
export function tallyCurl(battleId: number): string {
  return `curl -s ${absoluteUrl(`/api/arena/tally?battleId=${battleId}`)}`;
}
export function ladderVerifyCurl(season = 0): string {
  return `curl -s ${absoluteUrl(`/api/arena/ladder/verify?season=${season}`)}`;
}
export function fuseVerifyCurl(requestId: number): string {
  return `curl -s ${PUBLIC_API}/game/fuse/verify?requestId=${requestId}`;
}
export function ratingCurl(agentId: number): string {
  return `curl -s ${PUBLIC_API}/game/arena/rating/${agentId}`;
}
