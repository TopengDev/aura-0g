// SERVER-ONLY. Game-layer contract ABIs (human-readable) + provider/contract factories.
// Mirrors the shipped aura/contracts.ts pattern: the backend only ever READS the game contracts, plus the
// SPONSOR/OPERATOR signs the matchmaker + fulfill + anchor txs (createBattle, finalize, anchorSeason). User
// actions (requestFusion, executeFusion, commit, reveal, claim, registerGenesis) are NEVER signed here - they
// are returned as computed args for the user's own wallet (the same non-custodial contract as mint-args).
//
// ABIs are transcribed field-for-field from the Phase-1 contracts (contracts/src/ArenaVote.sol,
// AuraFusion.sol, ArenaReputation.sol). Addresses are env-overridable + read from deployed-v2.json, and each
// flow is GRACEFUL-OFF until the phase-4 deploy wires the address (same pattern as auraINFT/summonEscrow).
import { ethers } from "ethers";
import { GALILEO, CONTRACTS } from "../config.js";
import { readProvider } from "../contracts.js";

// ── ArenaVote: blind/staked commit-reveal battle vote (linear weight, quorum-gated, endogenous pool) ──
export const ARENA_VOTE_ABI = [
  "function createBattle(uint256 agentA,uint256 agentB,uint64 commitDur,uint64 revealDur) returns (uint256)",
  "function commit(uint256 battleId,bytes32 commitment) payable",
  "function reveal(uint256 battleId,uint8 choice,bytes32 salt)",
  "function finalize(uint256 battleId)",
  "function claim(uint256 battleId) returns (uint256)",
  "function commitmentFor(uint256 battleId,uint8 choice,bytes32 salt,address voter) pure returns (bytes32)",
  "function getBattle(uint256 battleId) view returns (tuple(uint256 agentA,uint256 agentB,uint64 commitEnd,uint64 revealEnd,bool finalized,bool rated,uint8 winner,uint256 stakeCommitted,uint256 weightA,uint256 weightB,uint256 revealCount,uint256 pool))",
  "function nextBattleId() view returns (uint256)",
  "function quorum() view returns (uint256)",
  "function registry() view returns (address)",
  "function stakeOf(uint256,address) view returns (uint256)",
  "function sideOf(uint256,address) view returns (uint8)",
  "function claimedOf(uint256,address) view returns (bool)",
  "function RHO_BPS() view returns (uint16)",
  "function F_BPS() view returns (uint16)",
  "event BattleCreated(uint256 indexed battleId,uint256 indexed agentA,uint256 indexed agentB,uint64 commitEnd,uint64 revealEnd)",
  "event Committed(uint256 indexed battleId,address indexed voter,bytes32 commitment,uint256 stake)",
  "event Revealed(uint256 indexed battleId,address indexed voter,uint8 choice,uint256 stake,uint256 weight)",
  "event Finalized(uint256 indexed battleId,uint8 winner,uint256 weightA,uint256 weightB,bool rated,uint256 pool)",
  "event Claimed(uint256 indexed battleId,address indexed voter,uint256 payout)",
] as const;

// ── AuraFusion: FUSION - hybrid child mint from two parents, commit-reveal on a future block, on-chain genome ──
export const AURA_FUSION_ABI = [
  "function registerGenesis(uint256 agentId,uint16[8] genome)",
  "function requestFusion(uint256 parentA,uint256 parentB) payable returns (uint256)",
  "function executeFusion(uint256 requestId,string childName,bytes32 childStyleFingerprint,string childEncBrainRoot,bytes32 childDataHash,bytes32 childModelAttestation,uint16 royaltyBps,uint16 creatorResaleBps,bytes childSealedKey) returns (uint256)",
  "function refundExpiredFusion(uint256 requestId)",
  "function requests(uint256) view returns (address fuser,uint256 parentA,uint256 parentB,uint64 targetBlock,uint256 fee,bool executed,bool refunded)",
  "function lineageOf(uint256 agentId) view returns (tuple(bool genomeSet,uint32 generation,uint32 breedCount,uint64 lastFusedAt,uint256 parentA,uint256 parentB,bytes32 styleFingerprint,uint16[8] genome))",
  "function genomeOf(uint256 agentId) view returns (uint16[8])",
  "function generationOf(uint256 agentId) view returns (uint32)",
  "function breedCountOf(uint256 agentId) view returns (uint32)",
  "function isFusable(uint256 agentId) view returns (bool)",
  "function fuseSeedOf(uint256 requestId) view returns (bytes32)",
  "function fusionFee() view returns (uint256)",
  "function cooldown() view returns (uint256)",
  "function nextRequestId() view returns (uint256)",
  "function auraINFT() view returns (address)",
  "function REVEAL_DELAY() view returns (uint256)",
  "function BLOCKHASH_WINDOW() view returns (uint256)",
  "event GenesisRegistered(uint256 indexed agentId,uint32 generation,bytes32 styleFingerprint)",
  "event FusionRequested(uint256 indexed requestId,address indexed fuser,uint256 indexed parentA,uint256 parentB,uint64 targetBlock,uint256 fee)",
  "event FusionExecuted(uint256 indexed requestId,uint256 indexed childId,uint256 parentA,uint256 parentB,bytes32 fuseSeed,uint32 generation)",
  "event FusionRefunded(uint256 indexed requestId,address indexed fuser,uint256 fee)",
] as const;

// ── ArenaReputation: Tier-2 rating-ladder Merkle anchor (keyless verifier; no float math on-chain) ──
export const ARENA_REPUTATION_ABI = [
  "function anchorSeason(uint256 seasonEpoch,bytes32 ladderRoot)",
  "function verifyRating(uint256 seasonEpoch,uint256 agentId,uint32 rating,uint32 rd,bytes32[] proof) view returns (bool)",
  "function leafOf(uint256 agentId,uint32 rating,uint32 rd) view returns (bytes32)",
  "function seasonRoot(uint256) view returns (bytes32)",
  "function currentSeason() view returns (uint256)",
  "function currentHolderOf(uint256 agentId) view returns (address)",
  "function anchorer() view returns (address)",
  "function registry() view returns (address)",
  "event SeasonAnchored(uint256 indexed seasonEpoch,bytes32 ladderRoot)",
  "event AnchorerUpdated(address indexed anchorer)",
] as const;

// ── configured-gates (each flow is graceful-off until its address is wired at the phase-4 deploy) ──
function isAddr(v: string | undefined): boolean {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}
export function arenaVoteConfigured(): boolean {
  return isAddr(CONTRACTS.arenaVote);
}
export function auraFusionConfigured(): boolean {
  return isAddr(CONTRACTS.auraFusion);
}
export function arenaReputationConfigured(): boolean {
  return isAddr(CONTRACTS.arenaReputation);
}

// ── read factories (no signer, no key) ──
export function arenaVoteRead(): ethers.Contract {
  if (!arenaVoteConfigured()) throw new Error("ArenaVote not configured (set ARENA_VOTE_ADDR or deployed-v2.json arenaVote)");
  return new ethers.Contract(CONTRACTS.arenaVote, ARENA_VOTE_ABI as unknown as string[], readProvider());
}
export function auraFusionRead(): ethers.Contract {
  if (!auraFusionConfigured()) throw new Error("AuraFusion not configured (set AURA_FUSION_ADDR or deployed-v2.json auraFusion)");
  return new ethers.Contract(CONTRACTS.auraFusion, AURA_FUSION_ABI as unknown as string[], readProvider());
}
export function arenaReputationRead(): ethers.Contract {
  if (!arenaReputationConfigured()) throw new Error("ArenaReputation not configured (set ARENA_REPUTATION_ADDR or deployed-v2.json arenaReputation)");
  return new ethers.Contract(CONTRACTS.arenaReputation, ARENA_REPUTATION_ABI as unknown as string[], readProvider());
}

// ── write factories (bound to a SIGNER: the sponsor/operator for createBattle/finalize, or the anchorer for
//    anchorSeason - the ONLY game txs the server signs; user actions are returned as args, never signed here) ──
export function arenaVoteWrite(signer: ethers.Signer): ethers.Contract {
  if (!arenaVoteConfigured()) throw new Error("ArenaVote not configured");
  return new ethers.Contract(CONTRACTS.arenaVote, ARENA_VOTE_ABI as unknown as string[], signer);
}
export function auraFusionWrite(signer: ethers.Signer): ethers.Contract {
  if (!auraFusionConfigured()) throw new Error("AuraFusion not configured");
  return new ethers.Contract(CONTRACTS.auraFusion, AURA_FUSION_ABI as unknown as string[], signer);
}
export function arenaReputationWrite(signer: ethers.Signer): ethers.Contract {
  if (!arenaReputationConfigured()) throw new Error("ArenaReputation not configured");
  return new ethers.Contract(CONTRACTS.arenaReputation, ARENA_REPUTATION_ABI as unknown as string[], signer);
}

/** The chainId every game-layer arg block is pinned to (the client submits on this chain). */
export const GAME_CHAIN_ID = GALILEO.chainId;
