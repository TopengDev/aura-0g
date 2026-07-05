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
  // Display-only enrichment (the 20-Aura starter roster). OPTIONAL so the original seeded agents +
  // user-created agents (which never set these) keep working unchanged. No on-chain dependency.
  rarity?: string; // Legendary | Epic | Rare | Uncommon (rarityRoyaltyMap drives the on-chain royalty at mint)
  lore?: string; // the Aura's origin myth (a few sentences)
  personality?: string; // how the Aura speaks / behaves
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
  seed: string; // uint256 as a decimal string (a SUMMON pull seed is a full keccak; precision-safe)
  rarity: string; // Common | Rare | Epic | Legendary (derived from seed; absent/legacy seed -> Common)
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
    seed: string; // uint256 as a decimal string (precision-safe for full-keccak summon seeds)
  };
  // Provable-pull rarity, derived from the on-chain seed (Common when the seed is legacy/non-pull). The
  // `verify` block carries the recompute inputs so a juror can re-derive it client-side from public data.
  rarity: string; // Common | Rare | Epic | Legendary
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
  seed: string; // uint256 as a decimal string (JSON/bigint-safe)
  mintable: boolean;
  usedBrain: boolean; // true if the gen used the agent's decrypted brain (not the catalog fallback)
  // NEW (feat/onchain-verify-mint): 0G's raw TeeML envelope for the on-chain verified mint. Present only when a
  // genuine, image-bound envelope was captured + off-chain-verified; absent => the mint falls back to mintOutput.
  teeText?: string | null;
  teeSig?: string | null;
  dataHash?: string | null; // 0x + sha256(imageBytes)
  teeSignerVerified?: string | null; // the 0G enclave signer the on-chain mint is pinned to
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
  // NEW (feat/onchain-verify-mint): 0G's raw signed envelope. When BOTH teeText + teeSig are present, the client
  // calls OutputNFT.mintOutputVerified (which ecrecovers 0G's enclave signature on-chain); else it uses mintOutput.
  teeText?: string; // 0G's signed "<sha256(req)>:<sha256(img)>" (== keccak preimage of teeAttestation on this path)
  teeSig?: string; // 0G's 65-byte enclave signature
  teeSigner?: string; // the 0G enclave signer the on-chain teeSigner must equal
  dataHash?: string; // 0x + sha256(imageBytes) 0G attested (the contract re-derives + binds this)
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
  contract: string; // the mint target: AuraINFT when wired (standard "erc7857"), else AgentRegistry ("erc721")
  standard: "erc7857" | "erc721"; // which mintAgent shape the client must build (9-arg sealed vs 7-arg)
  chainId: number;
  to: string;
  name: string;
  styleFingerprint: string;
  encBrainRoot: string;
  modelAttestation: string;
  royaltyBps: number;
  creatorResaleBps: number;
  // ERC-7857 per-owner mint inputs. Present + REQUIRED when standard === "erc7857" (AuraINFT.mintAgent needs
  // them); the AgentRegistry path leaves sealedKey null (legacy server-custody-only).
  dataHash: string; // sha256 of the encrypted brain envelope (the contract's dataHash commitment)
  sealedKey: string | null; // ECIES seal of the AES data-key to the owner's secp256k1 pubkey (0x-hex)
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
