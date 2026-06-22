// AURA API contract — shared types. These are the request/response shapes the UI worker consumes.
// (Mirrored in human-readable form in notes/aura-backend-build-2026-06-22/api-contract.md.)

export interface AgentPublicMeta {
  name: string;
  tagline: string;
  aesthetic: string;
  signatureCharacter: string | null;
  model: string;
  accent: string;        // hex color for UI theming
  sampleImages: string[]; // API image URLs (/api/image/<key>)
}

export interface AgentSummary {
  agentId: number;        // -1 if catalog-only (not yet minted on-chain)
  name: string;
  owner: string | null;
  royaltyBps: number;
  royaltyPct: number;
  styleVersion: number;
  minted: boolean;        // true => exists on-chain in AgentRegistry
  outputCount: number;    // how many OutputNFTs this agent created
  meta: AgentPublicMeta;
}

export interface AgentDetail extends AgentSummary {
  styleFingerprint: string | null;
  modelAttestation: string | null;
  encBrainRoot: string | null;
  outputs: number[];      // tokenIds created by this agent
}

export interface RoyaltyBlock {
  receiver: string;       // current agent owner — the live royalty beneficiary
  bps: number;
  pct: number;
}

export interface ListingBlock {
  active: boolean;
  price: string | null;   // 0G, human units
  seller: string | null;
}

export interface OutputSummary {
  tokenId: number;
  creatorAgentId: number;
  agentName: string;
  owner: string;
  imageRoot: string;          // 0G Storage content address
  imageUrl: string;           // /api/image/output-<tokenId>
  storageScanUrl: string;     // 0G storagescan link for the root
  seed: number;
  label: string | null;       // e.g. "pirate", "hero"
  teeVerified: boolean | string;
  model: string;
  royalty: RoyaltyBlock;
  listing: ListingBlock;
  mintTx: string | null;
  explorerUrl: string | null;
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
  generation: {
    model: string;
    prompt: string | null;
    teeVerifiability: string;
    teeSigner: string;
    teeVerified: boolean | string;
    chatId: string | null;
  } | null;
  verification: {
    agentExists: boolean;
    imageOnChain: boolean;
    teeAttestationPresent: boolean;
    provenanceHashMatches: boolean | null;  // null if the stored record isn't available to recompute
    teeVerifiedByProvider: boolean | string;
    royaltyReceiver: string;
    summary: string;
  };
  links: {
    image: string;
    storageScan: string;
    mintTx: string | null;
  };
}

export interface RoyaltyResponse {
  tokenId: number;
  creatorAgentId: number;
  agentName: string;
  royaltyBps: number;
  royaltyPct: number;
  receiver: string;             // current agent owner (live)
  receiverIsAgentOwner: boolean;
  samples: { salePrice: string; royaltyAmount: string }[];
  thesis: string;
}

export type JobStatus = "pending" | "generating" | "verifying" | "storing" | "done" | "error";

export interface GenerateJobResult {
  imageRoot: string;
  imageUrl: string;             // /api/generate/<jobId>/image
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
}

export interface GenerateJob {
  jobId: string;
  status: JobStatus;
  agentId: number;
  agentName: string;
  prompt: string;
  basePreset: string | null;
  createdAt: string;
  updatedAt: string;
  progress: string;
  result: GenerateJobResult | null;
  error: string | null;
  provenanceRecord: unknown | null; // exact stored provenance object — lets mint + verify recompute the hash
}

export interface MintResponse {
  tokenId: number;
  txHash: string;
  explorerUrl: string;
  creatorAgentId: number;
  imageRoot: string;
  owner: string;
  output: OutputSummary;
}
