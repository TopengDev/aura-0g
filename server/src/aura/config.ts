// AURA v2 shared config - 0G Galileo testnet (testnet ONLY). Server-side only.
// Ported from lib/aura/config.ts; addresses updated to the deployed v2 set (contracts/deployed-v2.json).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// repo root = server/src/aura -> ../../.. (server/ -> repo/)
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export const GALILEO = {
  // live RPC eth_chainId returns 0x40da = 16602 (NOT 16601 as some docs say). RPC is authoritative.
  chainId: 16602,
  rpc: "https://evmrpc-testnet.0g.ai",
  explorer: "https://chainscan-galileo.0g.ai",
  faucet: "https://faucet.0g.ai",
  storageIndexerTurbo: "https://indexer-storage-testnet-turbo.0g.ai",
  storageScan: "https://storagescan-galileo.0g.ai",
} as const;

// ── deployed v2 contracts (read from contracts/deployed-v2.json so there is ONE source of truth) ──
interface DeployedV2 {
  agentRegistry: string;
  outputNFT: string;
  marketplace: string;
  attestor: string;
  platform: string;
  platformBps: number;
  deployBlock: number;
  chainId: number;
}

function loadDeployed(): DeployedV2 {
  const p = path.join(REPO_ROOT, "contracts", "deployed-v2.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  return {
    agentRegistry: j.agentRegistry,
    outputNFT: j.outputNFT,
    marketplace: j.marketplace,
    attestor: j.attestor,
    platform: j.platform,
    platformBps: Number(j.platformBps),
    deployBlock: Number(j.deployBlock),
    chainId: Number(j.chainId),
  };
}

export const DEPLOYED = loadDeployed();

export const CONTRACTS = {
  agentRegistry: DEPLOYED.agentRegistry,
  outputNFT: DEPLOYED.outputNFT,
  marketplace: DEPLOYED.marketplace,
} as const;

// EIP-712 domain the deployed OutputNFT verifies: EIP712("AuraOutputNFT","1") + chainId + verifyingContract.
export const EIP712_DOMAIN = {
  name: "AuraOutputNFT",
  version: "1",
  chainId: GALILEO.chainId,
  verifyingContract: DEPLOYED.outputNFT as `0x${string}`,
} as const;

// Galileo min tip is 2 gwei -> use 5 gwei for all writes the SPONSOR signs (gen funding etc).
export const GAS = { gasPrice: 5_000_000_000n } as const;

// ── SPONSOR key (the funded .env wallet). Pays 0G Compute + Storage for generation ONLY, and signs
// the EIP-712 mint attestation (it IS the contract's attestor). It NEVER signs user mint/list/buy. ──
export function sponsorPrivateKey(): string {
  const pk = process.env.SPONSOR_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.DEMO_PRIVATE_KEY;
  if (!pk) throw new Error("SPONSOR_PRIVATE_KEY (or PRIVATE_KEY) missing - set the funded sponsor/attestor wallet in .env");
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

// ── runtime knobs ──
export const PORT = Number(process.env.PORT ?? 8787);
export const HOST = process.env.HOST ?? "0.0.0.0";
export const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-in-prod";
export const JWT_TTL = process.env.JWT_TTL ?? "1h";
// Explicit CORS origin (NOT "*", because we use a Bearer token; still pin it). Comma-separated list ok.
export const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((s) => s.trim());
export const SQLITE_PATH = process.env.SQLITE_PATH ?? path.join(REPO_ROOT, "server", "data", "aura.db");
export const GEN_DIR = process.env.GEN_DIR ?? path.join(REPO_ROOT, "server", "data", "generated");
export const SIWE_DOMAIN = process.env.SIWE_DOMAIN ?? "localhost:3000";
export const SIWE_URI = process.env.SIWE_URI ?? "http://localhost:3000";

// cost guards (protect the funded sponsor wallet)
export const GLOBAL_GEN_CAP = Number(process.env.AURA_MAX_GENERATIONS ?? 40);
export const MAX_CONCURRENT_GEN = Number(process.env.AURA_MAX_CONCURRENT_GEN ?? 2);

// ── Phase-3 indexer (Ponder) ──
// The data-heavy read/discovery/feed APIs are served from the Ponder process (PGlite-backed, in-process
// Drizzle access). The Fastify backend PROXIES them under /api/* so the webapp has ONE base URL. The
// per-item reads + the chain-scan list endpoints stay here as a fallback when the indexer is offline.
export const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:42069";
// How long the backend waits on the indexer before falling back (ms).
export const INDEXER_TIMEOUT_MS = Number(process.env.INDEXER_TIMEOUT_MS ?? 4000);
