// AURA v2 API contract - shared types. Ported from lib/aura/types.ts, extended for the
// user-wallet-signed v2 flow (SIWE auth, mint-args, create-agent args).

export interface AgentPublicMeta {
  name: string;
  tagline: string;
  aesthetic: string;
  signatureCharacter: string | null;
  model: string;
  accent: string; // hex color for UI theming
  sampleImages: string[];
}

export interface AgentSummary {
  agentId: number; // -1 if catalog-only (not yet minted on-chain)
  name: string;
  owner: string | null;
  royaltyBps: number;
  royaltyPct: number;
  creatorResaleBps: number;
  styleVersion: number;
  minted: boolean;
  outputCount: number;
  meta: AgentPublicMeta;
}

export interface AgentDetail extends AgentSummary {
  styleFingerprint: string | null;
  modelAttestation: string | null;
  encBrainRoot: string | null;
  outputs: number[];
}

export interface RoyaltyBlock {
  receiver: string;
  bps: number;
  pct: number;
}

export interface ListingBlock {
  active: boolean;
  price: string | null;
  seller: string | null;
}

export interface OutputSummary {
  tokenId: number;
  creatorAgentId: number;
  agentName: string;
  owner: string;
  imageRoot: string;
  imageUrl: string;
  storageScanUrl: string;
  seed: number;
  teeAttestation: string;
  provenanceHash: string;
  royalty: RoyaltyBlock;
  listing: ListingBlock;
}

export interface ProvenanceResponse {
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
  links: {
    storageScan: string;
  };
}

export interface RoyaltyResponse {
  tokenId: number;
  creatorAgentId: number;
  agentName: string;
  royaltyBps: number;
  royaltyPct: number;
  receiver: string;
  receiverIsAgentOwner: boolean;
  samples: { salePrice: string; royaltyAmount: string }[];
  thesis: string;
}

export type JobStatus = "pending" | "generating" | "verifying" | "storing" | "done" | "error";

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
  usedBrain: boolean; // true if the gen used the agent's decrypted brain (not the catalog fallback)
}

export interface GenerateJob {
  jobId: string;
  owner: string; // lowercased JWT address that owns this job
  status: JobStatus;
  agentId: number;
  agentName: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  progress: string;
  result: GenerateJobResult | null;
  error: string | null;
  provenanceRecord: unknown | null;
}

// ── v2 user-wallet-signed shapes ──

/** Everything the user needs to submit mintOutput themselves (backend supplies args + attestation sig). */
export interface MintArgsResponse {
  contract: string; // OutputNFT address
  chainId: number;
  // exact args, in mintOutput parameter order:
  to: string;
  creatorAgentId: number;
  imageRoot: string;
  provenanceHash: string;
  teeAttestation: string;
  seed: string; // uint256 as decimal string (safe for JSON / bigint)
  nonce: string; // bytes32 hex (single-use)
  attestationSig: string; // EIP-712 MintAuth signature by the attestor - the contract verifies this
  // convenience for clients that want to verify locally:
  eip712: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  };
}

/** Computed mintAgent args for the USER to submit (mintAgent is permissionless, user-signed). */
export interface CreateAgentResponse {
  contract: string; // AgentRegistry address
  chainId: number;
  to: string;
  name: string;
  styleFingerprint: string;
  encBrainRoot: string;
  modelAttestation: string;
  royaltyBps: number;
  creatorResaleBps: number;
  // diagnostics (NOT consumed by mintAgent, but useful to the client / for verify):
  canonicalBaseRoot: string;
  publicStyle: Record<string, unknown>;
  styleVersionHint: number;
}

export interface MarketplaceView {
  contract: string;
  platform: string;
  platformBps: number;
  platformPct: number;
  collections: { agentRegistry: string; outputNFT: string };
  activeListings: {
    collection: string;
    collectionName: "agent" | "output";
    tokenId: number;
    seller: string;
    price: string;
  }[];
}
