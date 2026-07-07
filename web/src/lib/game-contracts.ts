// On-chain wiring for the GAME LAYER (Fusion + Arena). Mirrors lib/contracts.ts: addresses are env-
// overridable and default to "" so each flow is GRACEFUL-OFF (the honest "activates at the mainnet deploy"
// state) until the Phase-4 deploy wires them, exactly like SummonEscrow/AuraINFT. The ABIs are the minimal
// verified subset of the USER-SIGNED calls, transcribed from the Phase-1 contracts
// (contracts/src/AuraFusion.sol, ArenaVote.sol) and the server ABIs in server/src/aura/game/contracts.ts.
// The server never signs these; it returns the computed call args (fn + args + value) and the client submits
// them with the wallet (non-custodial), so this file only needs the fragments viem uses to encode the write.

export const GAME_CONTRACTS = {
  // AuraFusion (FUSION). Set via NEXT_PUBLIC_AURA_FUSION at the mainnet deploy; empty => the Fusion UI shows
  // the honest deploy-gated state and the write actions are disabled.
  auraFusion: (process.env.NEXT_PUBLIC_AURA_FUSION ?? "") as `0x${string}` | "",
  // ArenaVote (the blind, staked commit-reveal battle vote). Set via NEXT_PUBLIC_ARENA_VOTE.
  arenaVote: (process.env.NEXT_PUBLIC_ARENA_VOTE ?? "") as `0x${string}` | "",
  // ArenaReputation (the season ladder Merkle anchor). Set via NEXT_PUBLIC_ARENA_REPUTATION.
  arenaReputation: (process.env.NEXT_PUBLIC_ARENA_REPUTATION ?? "") as `0x${string}` | "",
} as const;

/** Is Fusion wired on this deploy (the AuraFusion address is configured)? */
export const FUSION_ENABLED = GAME_CONTRACTS.auraFusion !== "";
/** Is the Arena wired on this deploy (the ArenaVote address is configured)? */
export const ARENA_ENABLED = GAME_CONTRACTS.arenaVote !== "";
/** Is the reputation anchor wired (needed for the on-chain ladder anchor + keyless season verify)? */
export const REPUTATION_ENABLED = GAME_CONTRACTS.arenaReputation !== "";

// ── AuraFusion (minimal user-signed subset) ────────────────────────────────
// registerGenesis(agentId, uint16[8] genome)          - owner backfills a parent's genome (one-time)
// requestFusion(parentA, parentB) payable             - commit step; value = the fusion fee
// executeFusion(requestId, ...child args) returns id  - reveal step; mints the descendant with lineage
// isFusable(agentId) view returns (bool)              - cheap read; false until a parent has an anchored genome
// The two events are parsed from the receipts to learn the new requestId (FusionRequested) and childId
// (FusionExecuted). Signatures mirror contracts/src/AuraFusion.sol exactly.
export const auraFusionAbi = [
  {
    type: "function",
    name: "registerGenesis",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "genome", type: "uint16[8]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestFusion",
    stateMutability: "payable",
    inputs: [
      { name: "parentA", type: "uint256" },
      { name: "parentB", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "uint256" }],
  },
  {
    type: "function",
    name: "executeFusion",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestId", type: "uint256" },
      { name: "childName", type: "string" },
      { name: "childStyleFingerprint", type: "bytes32" },
      { name: "childEncBrainRoot", type: "string" },
      { name: "childDataHash", type: "bytes32" },
      { name: "childModelAttestation", type: "bytes32" },
      { name: "royaltyBps", type: "uint16" },
      { name: "creatorResaleBps", type: "uint16" },
      { name: "childSealedKey", type: "bytes" },
    ],
    outputs: [{ name: "childId", type: "uint256" }],
  },
  {
    type: "event",
    name: "FusionRequested",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "fuser", type: "address", indexed: true },
      { name: "parentA", type: "uint256", indexed: true },
      { name: "parentB", type: "uint256", indexed: false },
      { name: "targetBlock", type: "uint64", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FusionExecuted",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "childId", type: "uint256", indexed: true },
      { name: "parentA", type: "uint256", indexed: false },
      { name: "parentB", type: "uint256", indexed: false },
      { name: "fuseSeed", type: "bytes32", indexed: false },
      { name: "generation", type: "uint32", indexed: false },
    ],
  },
  // Cheap public view: has this agent had its genesis genome anchored yet? False for every pre-existing agent
  // (the 30 catalog + user auras minted before AuraFusion deployed) until its one-time registerGenesis lands.
  // The Fusion UI reads this per picked parent to surface the "Register genesis" backfill BEFORE requestFusion.
  {
    type: "function",
    name: "isFusable",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  // Global fusion cooldown in seconds (owner-settable; 86400 = 24h at the mainnet deploy). requestFusion
  // reverts "A/B on cooldown" while block.timestamp < a.lastFusedAt + cooldown. The Fusion UI reads this +
  // each parent's lastFusedAt (via lineageOf) to DISABLE requestFusion with a live countdown, instead of
  // letting the user fire a tx that reverts on-chain.
  {
    type: "function",
    name: "cooldown",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  // Full lineage record for an agent. Field ORDER is load-bearing (mirrors contracts/src/AuraFusion.sol's
  // Lineage struct + the server ABI in server/src/aura/game/contracts.ts): the Fusion UI reads lastFusedAt
  // (the per-Aura cooldown anchor; 0 => never used as a parent => not on cooldown) to gate requestFusion.
  {
    type: "function",
    name: "lineageOf",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "genomeSet", type: "bool" },
          { name: "generation", type: "uint32" },
          { name: "breedCount", type: "uint32" },
          { name: "lastFusedAt", type: "uint64" },
          { name: "parentA", type: "uint256" },
          { name: "parentB", type: "uint256" },
          { name: "styleFingerprint", type: "bytes32" },
          { name: "genome", type: "uint16[8]" },
        ],
      },
    ],
  },
] as const;

// The FusionRequested + FusionExecuted events, parsed from the requestFusion / executeFusion receipts.
export const fusionRequestedEvent = auraFusionAbi[3];
export const fusionExecutedEvent = auraFusionAbi[4];

// ── ArenaVote (minimal user-signed subset) ─────────────────────────────────
// commit(battleId, commitment) payable   - blind ballot; value = the voter's stake (weight is LINEAR = stake)
// reveal(battleId, choice, salt)          - reveal the committed ballot after voting closes
// finalize(battleId)                       - anyone can finalize once the reveal window is over
// claim(battleId) returns payout           - a winning/eligible voter pulls their share of the pool
// Signatures mirror contracts/src/ArenaVote.sol exactly.
export const arenaVoteAbi = [
  {
    type: "function",
    name: "commit",
    stateMutability: "payable",
    inputs: [
      { name: "battleId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "reveal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "battleId", type: "uint256" },
      { name: "choice", type: "uint8" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "finalize",
    stateMutability: "nonpayable",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: [{ name: "payout", type: "uint256" }],
  },
] as const;
