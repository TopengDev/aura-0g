// SERVER-ONLY. ARENA battle orchestration against ArenaVote.sol: create-battle (2 gens on ONE shared
// seed-derived theme, each in its OWN style), the vote commit/reveal helpers, and the battle lifecycle
// (open -> voting -> finalize). The keyless tally re-compute lives in arena-tally.ts.
//
// SEED-BLIND, SELF-MATCH-SAFE: matchmaking is an OPERATOR action (ArenaVote.createBattle is onlyOwner) so a
// voter is never a matchmaker; the contract reverts a self-match (same agent) and a same-owner pairing (when
// a registry is set). The battle THEME is derived from the createBattle block's hash (learned only AFTER the
// pairing is committed), so neither the operator nor a voter can grind a favourable theme. Both agents render
// the SAME subject (the shared theme) but keep their OWN style (generateAndProve resolves each agent's brain/
// catalog), so the battle is a like-for-like STYLE contest, not a subject lottery.
import { ethers } from "ethers";
import { generateAndProve, type GenProof } from "../generate.js";
import { mapSubject } from "../gacha.js";
import { CONTRACTS } from "../config.js";
import { arenaVoteConfigured, GAME_CHAIN_ID } from "./contracts.js";

const abi = ethers.AbiCoder.defaultAbiCoder();

// Domain tag for the shared battle theme (keccak of a static label; versioned like every AURA domain tag).
export const DOMAIN_ARENA_THEME = ethers.keccak256(ethers.toUtf8Bytes("AURA-ARENA-theme-v1"));
const TAG_AGENT_SEED = ethers.keccak256(ethers.toUtf8Bytes("AURA-ARENA-agentseed-v1"));

/**
 * The shared battle-theme seed: keccak(DOMAIN_ARENA_THEME, battleId, agentA, agentB, blockHash). Bound to the
 * createBattle block's hash so it is seed-blind + un-grindable (learned only after the pairing is committed).
 */
export function battleThemeSeed(battleId: number | bigint, agentA: number | bigint, agentB: number | bigint, blockHash: string): string {
  return ethers.keccak256(
    abi.encode(["bytes32", "uint256", "uint256", "uint256", "bytes32"], [DOMAIN_ARENA_THEME, BigInt(battleId), BigInt(agentA), BigInt(agentB), blockHash]),
  );
}

/** Per-agent provenance seed for a battle gen: keccak(themeSeed, TAG_AGENT_SEED, agentId) -> uint256. Distinct
 *  per side (unique provenance) while the SUBJECT (from themeSeed) is shared. Always >= 2^64 (a real keccak). */
export function perAgentSeed(themeSeed: string, agentId: number | bigint): bigint {
  return BigInt(ethers.keccak256(abi.encode(["bytes32", "bytes32", "uint256"], [themeSeed, TAG_AGENT_SEED, BigInt(agentId)])));
}

export interface BattleTheme {
  themeSeed: string;
  subjectProse: string; // the ONE shared subject both agents render (from mapSubject over the theme seed)
  perAgentSeedA: bigint;
  perAgentSeedB: bigint;
}

/**
 * Derive the shared battle theme + per-agent provenance seeds. Pure + deterministic: the same (battleId,
 * agents, blockHash) always yields the same theme; a different blockHash yields a different theme (seed-blind).
 */
export function deriveBattleTheme(battleId: number, agentA: number, agentB: number, blockHash: string): BattleTheme {
  const themeSeed = battleThemeSeed(battleId, agentA, agentB, blockHash);
  const { prose } = mapSubject(BigInt(themeSeed)); // reuse the SHIPPED gacha subject composer over the theme seed
  return {
    themeSeed,
    subjectProse: prose,
    perAgentSeedA: perAgentSeed(themeSeed, agentA),
    perAgentSeedB: perAgentSeed(themeSeed, agentB),
  };
}

// ─────────────────────────────── vote helpers (blind commit-reveal) ───────────────────────────────

/**
 * The blinded commitment a voter submits: keccak256(abi.encode(battleId, choice, salt, voter)). BYTE-IDENTICAL
 * to ArenaVote.commitmentFor - a mismatch would make reveal revert on-chain. The salt is client-secret (kept
 * to reveal); we never store it server-side, so the ballot stays blind until reveal.
 */
export function buildCommitment(battleId: number, choice: number, salt: string, voter: string): string {
  if (choice !== 1 && choice !== 2) throw new Error("choice must be 1 (A) or 2 (B)");
  return ethers.keccak256(abi.encode(["uint256", "uint8", "bytes32", "address"], [BigInt(battleId), choice, salt, ethers.getAddress(voter)]));
}

/** A fresh 32-byte salt for a blind commitment (the client keeps it to reveal). */
export function randomSalt(): string {
  return ethers.hexlify(ethers.randomBytes(32));
}

export interface VotePrep {
  battleId: number;
  choice: number;
  salt: string; // the client MUST store this to reveal; losing it = a non-reveal (forfeits f of the stake)
  commitment: string;
  commitCall: { contract: string; chainId: number; fn: "commit"; args: [number, string]; valueNote: string };
  revealCall: { contract: string; chainId: number; fn: "reveal"; args: [number, number, string] };
}

/** Build everything a voter needs to commit + later reveal a blind staked vote. Returns the salt (client-kept). */
export function prepareVote(battleId: number, choice: number, voter: string, salt = randomSalt()): VotePrep {
  const commitment = buildCommitment(battleId, choice, salt, voter);
  return {
    battleId,
    choice,
    salt,
    commitment,
    commitCall: { contract: CONTRACTS.arenaVote, chainId: GAME_CHAIN_ID, fn: "commit", args: [battleId, commitment], valueNote: "send your stake as msg.value (wei); stake is locked at commit, weight is LINEAR = stake" },
    revealCall: { contract: CONTRACTS.arenaVote, chainId: GAME_CHAIN_ID, fn: "reveal", args: [battleId, choice, salt] },
  };
}

export function finalizeArgs(battleId: number): { contract: string; chainId: number; fn: "finalize"; args: [number] } {
  return { contract: CONTRACTS.arenaVote, chainId: GAME_CHAIN_ID, fn: "finalize", args: [battleId] };
}
export function claimArgs(battleId: number): { contract: string; chainId: number; fn: "claim"; args: [number] } {
  return { contract: CONTRACTS.arenaVote, chainId: GAME_CHAIN_ID, fn: "claim", args: [battleId] };
}

// ─────────────────────────────── create-battle flow (operator) ───────────────────────────────

export interface BattleAgent {
  id: number;
  name: string;
  encBrainRoot: string; // "" for a catalog-seeded agent (style still resolves from the catalog)
}

/** The injectable operator/chain/gen seams (mocked in tests; real defaults sign with the sponsor operator). */
export interface CreateBattleDeps {
  createBattleOnChain(agentA: number, agentB: number, commitDur: number, revealDur: number): Promise<{ battleId: number; blockNumber: number; blockHash: string }>;
  ownerOf?(agentId: number): Promise<string>; // optional same-owner precheck (the contract also reverts)
  generate: typeof generateAndProve;
}

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
  images: BattleImage[]; // [A, B], both rendered on the SAME theme, each in its OWN style
  seedBlind: true;
}

export class ArenaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ArenaError";
  }
}

/**
 * Create a battle between two agents and generate both portraits on ONE shared seed-derived theme, each in its
 * own style. Operator-only (createBattle is onlyOwner). Seed-blind: the theme is derived from the createBattle
 * block hash (post-commit). Both gens go through the SAME TEE-attested generateAndProve path as every Aura.
 */
export async function createBattleFlow(
  a: BattleAgent,
  b: BattleAgent,
  opts: { commitDur?: number; revealDur?: number; deps: CreateBattleDeps },
): Promise<CreateBattleResult> {
  if (a.id === b.id) throw new ArenaError(400, "self-match: a battle's two agents must differ");
  const commitDur = opts.commitDur ?? 3600; // 1h commit window (default; operator-tunable)
  const revealDur = opts.revealDur ?? 3600; // 1h reveal window
  const { deps } = opts;

  // optional same-owner precheck (the contract enforces it too; this gives a clean 400 before spending gas).
  if (deps.ownerOf) {
    try {
      const [oa, ob] = await Promise.all([deps.ownerOf(a.id), deps.ownerOf(b.id)]);
      if (oa && ob && oa.toLowerCase() === ob.toLowerCase()) throw new ArenaError(400, "same-owner self-match: the two agents share an owner");
    } catch (e) {
      if (e instanceof ArenaError) throw e;
      /* owner unresolved (registry not set / agent off-registry) -> rely on the on-chain revert */
    }
  }

  // 1. create the battle on-chain (operator signs) -> battleId + the block whose hash seeds the theme.
  const { battleId, blockHash } = await deps.createBattleOnChain(a.id, b.id, commitDur, revealDur);

  // 2. derive the ONE shared theme from the createBattle block hash (seed-blind), then generate BOTH agents on
  //    that same subject, each in its OWN style (generateAndProve resolves each agent's brain/catalog style).
  const theme = deriveBattleTheme(battleId, a.id, b.id, blockHash);
  const genFor = async (agent: BattleAgent, seed: bigint): Promise<BattleImage> => {
    const g: GenProof = await deps.generate(
      { agentId: agent.id, agentName: agent.name, encBrainRoot: agent.encBrainRoot, userPrompt: "arena battle piece", label: `battle-${battleId}-agent-${agent.id}`, pull: { seedRoot: seed, subjectProse: theme.subjectProse } },
      {},
    );
    return { agentId: agent.id, imageRoot: g.imageRoot, seed: g.seed.toString(), provenanceHash: g.provenanceHash, teeAttestation: g.teeAttestation, teeVerified: g.verified, model: g.model };
  };
  // generate sequentially (the sponsor gen guard bounds concurrency elsewhere; a battle is only 2 gens).
  const imgA = await genFor(a, theme.perAgentSeedA);
  const imgB = await genFor(b, theme.perAgentSeedB);

  return {
    battleId,
    agentA: a.id,
    agentB: b.id,
    theme: { seed: theme.themeSeed, subjectProse: theme.subjectProse },
    commitDur,
    revealDur,
    images: [imgA, imgB],
    seedBlind: true,
  };
}

export { arenaVoteConfigured };
