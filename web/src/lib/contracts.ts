// On-chain wiring for the trade flows. Addresses mirror the server's /health (chain 16602) and
// contracts/deployed-v2.json. The collection passed to the marketplace is the agent-registry address
// for AGENT listings and the output-NFT address for OUTPUT listings. ABIs are the minimal verified
// subset (copied from indexer/abis): the marketplace trade methods + reads, and the ERC-721 ownership
// + operator-approval calls (present on BOTH the registry and the output NFT).

export const CONTRACTS = {
  // Defaults = the INTEGRATED redeploy set (2026-06-30), mirroring contracts/deployed-v2.json. AgentRegistry
  // is KEPT (all agents); OutputNFT + Marketplace are the re-deployed (H-1) addresses; SummonEscrow is live.
  agentRegistry: (process.env.NEXT_PUBLIC_AGENT_REGISTRY ??
    "0xb5960cc08caa5195095cfb8aa270f122be09ba0a") as `0x${string}`,
  outputNFT: (process.env.NEXT_PUBLIC_OUTPUT_NFT ??
    "0xEecED1e6965f00a5f7cA459631370c886FAEFd3b") as `0x${string}`,
  marketplace: (process.env.NEXT_PUBLIC_MARKETPLACE ??
    "0x815115Eb39987d3fAdb3b373f89fa0096433f228") as `0x${string}`,
  // SummonEscrow (demand-pull commissioning) - live as of the integrated deploy. Override via
  // NEXT_PUBLIC_SUMMON_ESCROW; empty => the Summon UI shows a disabled "not available" state (graceful).
  summonEscrow: (process.env.NEXT_PUBLIC_SUMMON_ESCROW ??
    "0xa5CeFBc097d84beE09b12fc1569B6CcA56992838") as `0x${string}` | "",
} as const;

/** Is the Summon feature wired (the escrow address is configured)? */
export const SUMMON_ENABLED = CONTRACTS.summonEscrow !== "";

// The collection address for a given listing kind.
export function collectionAddress(kind: "agent" | "output"): `0x${string}` {
  return kind === "agent" ? CONTRACTS.agentRegistry : CONTRACTS.outputNFT;
}

// ── AuraMarketplace (minimal verified subset) ──────────────────────────────
// buy(collection,tokenId) is payable with value = price. list / cancelListing / updatePrice are
// nonpayable seller actions. listings(key) + listingKey(collection,tokenId) are reads.
export const marketplaceAbi = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "list",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelListing",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "updatePrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "newPrice", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "listingKey",
    stateMutability: "pure",
    inputs: [
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "listings",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "seller", type: "address" },
      { name: "price", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
] as const;

// ── OutputNFT.mintOutput (attestation-gated; the /generate flow's write) ───
// Signature mirrors the deployed contract EXACTLY (verified against server/src/aura/contracts.ts
// OUT_ABI + contracts/src/OutputNFT.sol). NONPAYABLE + permissionless: anyone may mint with a valid
// attestor EIP-712 signature. Reverts: "nonce used", "bad attestation", or if the creatorAgentId
// agent does not exist. The args (to, creatorAgentId, imageRoot, provenanceHash, teeAttestation, seed,
// nonce, attestationSig) come verbatim from the backend POST /mint-args response.
export const outputNftAbi = [
  {
    type: "function",
    name: "mintOutput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "creatorAgentId", type: "uint256" },
      { name: "imageRoot", type: "string" },
      { name: "provenanceHash", type: "bytes32" },
      { name: "teeAttestation", type: "bytes32" },
      { name: "seed", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "attestationSig", type: "bytes" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "usedNonce",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// ── AgentRegistry.mintAgent (the /create flow's write) ─────────────────────
// Signature mirrors the deployed contract EXACTLY (verified against server REG_ABI + AgentRegistry.sol).
// NONPAYABLE + permissionless. Reverts: "royalty too high" (royaltyBps > 2000) / "resale royalty too
// high" (creatorResaleBps > 2000) - both cap 20%. Returns the new agentId. The bytes32 fields + roots
// come verbatim from the backend POST /agents/create response.
export const agentRegistryAbi = [
  {
    type: "function",
    name: "mintAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "name", type: "string" },
      { name: "styleFingerprint", type: "bytes32" },
      { name: "encBrainRoot", type: "string" },
      { name: "modelAttestation", type: "bytes32" },
      { name: "royaltyBps", type: "uint16" },
      { name: "creatorResaleBps", type: "uint16" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "AgentMinted",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "styleFingerprint", type: "bytes32", indexed: false },
      { name: "royaltyBps", type: "uint16", indexed: false },
      { name: "modelAttestation", type: "bytes32", indexed: false },
    ],
  },
] as const;

// OutputMinted event (parsed from the mintOutput receipt to learn the new tokenId).
export const outputMintedEvent = {
  type: "event",
  name: "OutputMinted",
  inputs: [
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "creatorAgentId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "imageRoot", type: "string", indexed: false },
    { name: "provenanceHash", type: "bytes32", indexed: false },
    { name: "teeAttestation", type: "bytes32", indexed: false },
    { name: "seed", type: "uint256", indexed: false },
  ],
} as const;

// ── SummonEscrow (demand-pull commissioning) ──────────────────────────────
// summon(agentId, maxPrice) is PAYABLE with value = the commission price (maxPrice caps slippage vs an
// owner front-running a price hike). setSummonPrice / withdraw are the owner actions. summonPrice +
// requests + pendingWithdrawals are reads. Signature mirrors contracts/src/SummonEscrow.sol exactly.
export const summonEscrowAbi = [
  {
    type: "function",
    name: "summon",
    stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "maxPrice", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "setSummonPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "summonPrice",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "pendingWithdrawals",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "requests",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "deadline", type: "uint64" },
      { name: "settled", type: "bool" },
    ],
  },
  {
    type: "event",
    name: "Summoned",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "agentId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "fee", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
    ],
  },
] as const;

// The Summoned event, parsed from the summon() receipt to learn the new requestId (drives the status poll).
export const summonedEvent = {
  type: "event",
  name: "Summoned",
  inputs: [
    { name: "requestId", type: "uint256", indexed: true },
    { name: "agentId", type: "uint256", indexed: true },
    { name: "buyer", type: "address", indexed: true },
    { name: "fee", type: "uint256", indexed: false },
    { name: "deadline", type: "uint64", indexed: false },
  ],
} as const;

// ── ERC-721 operator-approval + ownership subset (on registry AND output NFT) ──
// Listing first requires the marketplace to be an approved operator for the seller's tokens.
export const erc721Abi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;
