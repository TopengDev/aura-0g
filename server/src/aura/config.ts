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
  // chainId + rpc are env-overridable so the SAME backend runs against a local anvil for the Summon
  // watcher e2e (CHAIN_ID=31337, RPC_URL=http://127.0.0.1:8545), defaulting to 0G Galileo otherwise.
  chainId: Number(process.env.CHAIN_ID ?? 16602),
  rpc: process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai",
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

// addresses are env-overridable (same reason as GALILEO above: local anvil e2e vs live Galileo).
export const CONTRACTS = {
  agentRegistry: process.env.AGENT_REGISTRY_ADDR ?? DEPLOYED.agentRegistry,
  outputNFT: process.env.OUTPUT_NFT_ADDR ?? DEPLOYED.outputNFT,
  marketplace: process.env.MARKETPLACE_ADDR ?? DEPLOYED.marketplace,
  // net-new Summon escrow. NOT in the live deployed-v2.json yet -> set via SUMMON_ESCROW_ADDR (or a
  // future deployed-v2.json `summonEscrow` field). Empty string => the Summon watcher stays OFF.
  summonEscrow: process.env.SUMMON_ESCROW_ADDR ?? (DEPLOYED as { summonEscrow?: string }).summonEscrow ?? "",
} as const;

// EIP-712 domain the deployed OutputNFT verifies: EIP712("AuraOutputNFT","1") + chainId + verifyingContract.
// verifyingContract follows CONTRACTS.outputNFT so a local-anvil OutputNFT signs/verifies correctly.
export const EIP712_DOMAIN = {
  name: "AuraOutputNFT",
  version: "1",
  chainId: GALILEO.chainId,
  verifyingContract: CONTRACTS.outputNFT as `0x${string}`,
} as const;

// Galileo min tip is 2 gwei -> use 5 gwei for all writes the SPONSOR signs (gen funding etc).
export const GAS = { gasPrice: 5_000_000_000n } as const;

function normalizePk(pk: string): string {
  return pk.startsWith("0x") ? pk : `0x${pk}`;
}

// ── SPONSOR key (the funded .env wallet). Pays 0G Compute + Storage for generation (gas/float). Keep its
// balance LOW + refillable: it is the only key on the tx-sending path. It NEVER signs user mint/list/buy. ──
export function sponsorPrivateKey(): string {
  const pk = process.env.SPONSOR_PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.DEMO_PRIVATE_KEY;
  if (!pk) throw new Error("SPONSOR_PRIVATE_KEY (or PRIVATE_KEY) missing - set the funded sponsor/attestor wallet in .env");
  return normalizePk(pk);
}

// ── B-6 (split the hot key): distinct ATTESTOR / SPONSOR / ORACLE accessors so the three roles are no
// longer forced to be the same key. Each FALLS BACK to the sponsor key when its dedicated env is unset,
// so the current single-key testnet deploy is unchanged (zero regression) while production CAN split them.
//
//   - attestorPrivateKey(): the EIP-712 MintAuth signer. SIGN-ONLY - it is never put on a signer that sends
//     a tx (see wallet.ts: only sponsorSigner() ever calls .sendTransaction / .fulfill). Set ATTESTOR_PRIVATE_KEY
//     to a key held offline/HSM, and point the on-chain OutputNFT.attestor at its address, to keep the
//     attestor key OFF the gas-spending path entirely.
//   - oraclePrivateKey(): the de-mock sealed-key re-encryption oracle. INTEGRATION FOLLOW-UP: oracle.ts is
//     on the v2/de-mock branch (not feat/live-summon); change its `ORACLE_PRIVATE_KEY || sponsorPrivateKey()`
//     line to call this accessor (require the dedicated key) when that branch lands.
export function attestorPrivateKey(): string {
  const pk = process.env.ATTESTOR_PRIVATE_KEY;
  return pk ? normalizePk(pk) : sponsorPrivateKey();
}

export function oraclePrivateKey(): string {
  const pk = process.env.ORACLE_PRIVATE_KEY;
  return pk ? normalizePk(pk) : sponsorPrivateKey();
}

/** True when the dedicated attestor key is split off the sponsor (gas) key - the pre-mainnet target. */
export function attestorIsSplitFromSponsor(): boolean {
  return attestorPrivateKey().toLowerCase() !== sponsorPrivateKey().toLowerCase();
}

// ── runtime knobs ──
export const PORT = Number(process.env.PORT ?? 8787);
export const HOST = process.env.HOST ?? "0.0.0.0";

// B-1 (fail-closed JWT): the app must NEVER sign/verify JWTs with the publicly-known dev default in
// production - a known HS256 secret is trivially forgeable (forge {address:<victim>} => impersonate any
// wallet, including their /mint-args attestations). docker-compose.prod.yml is already fail-closed, but
// the APP LAYER must enforce it too so a bypass path (a bare `npm start`, a future compose edit) cannot
// silently boot with the forgeable default. In production: THROW on boot if JWT_SECRET is unset/blank or
// equals the default. In dev/test: fall back to the default (convenience), as before.
const DEV_DEFAULT_JWT_SECRET = "dev-only-insecure-secret-change-in-prod";
export const IS_PRODUCTION = (process.env.NODE_ENV ?? "").toLowerCase() === "production";

/** Resolve the JWT secret, fail-closed in production. Pure (takes env) so it is unit-testable. */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const isProd = (env.NODE_ENV ?? "").toLowerCase() === "production";
  const fromEnv = env.JWT_SECRET;
  if (isProd) {
    if (!fromEnv || fromEnv.trim().length === 0) {
      throw new Error(
        "JWT_SECRET is unset/blank in production - refusing to boot with the forgeable dev default (B-1 fail-closed). Set JWT_SECRET to a strong random value (e.g. `openssl rand -hex 32`).",
      );
    }
    if (fromEnv === DEV_DEFAULT_JWT_SECRET) {
      throw new Error(
        "JWT_SECRET equals the public dev default in production - refusing to boot (B-1 fail-closed). Set JWT_SECRET to a strong random value (e.g. `openssl rand -hex 32`).",
      );
    }
    return fromEnv;
  }
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEV_DEFAULT_JWT_SECRET;
}

// Evaluated at module load = on boot. In production with a missing/default secret this THROWS, aborting
// startup (fail-closed) before any route can verify a forged token.
export const JWT_SECRET = resolveJwtSecret();
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
// B-2 (Sybil gen-cap DoS): a per-address LIFETIME generation quota so a single Sybil swarm cannot drain
// the shared GLOBAL_GEN_CAP - draining the global pool now requires ceil(cap/quota) distinct SIWE
// addresses instead of one. The global counter is ALSO persisted (ratelimit.ts) so a restart is not a
// reset-and-replay. Default quota = 10 (knob).
export const PER_ADDRESS_GEN_QUOTA = Number(process.env.AURA_PER_ADDRESS_GEN_QUOTA ?? 10);

// B-3 (create-agent sponsor drain): create-agent makes the SPONSOR pay for TWO 0G Storage uploads but was
// guarded ONLY per-user (no global cap). Give it its own global LIFETIME cost cap + per-address lifetime
// quota + a concurrency ceiling, analogous to the generation guard. Defaults are knobs.
export const GLOBAL_CREATE_CAP = Number(process.env.AURA_MAX_CREATES ?? 40);
export const PER_ADDRESS_CREATE_QUOTA = Number(process.env.AURA_PER_ADDRESS_CREATE_QUOTA ?? 5);
export const MAX_CONCURRENT_CREATE = Number(process.env.AURA_MAX_CONCURRENT_CREATE ?? 2);

// B-4 (watcher regen amplifier): cap how many times the Summon watcher will run a full sponsor-paid TEE
// generation for one request before giving up (it used to retry every poll forever until the deadline).
// On a persistent settled-elsewhere / "nonce used" revert the request is marked TERMINAL instead. Default 3.
export const MAX_SUMMON_ATTEMPTS = Number(process.env.AURA_MAX_SUMMON_ATTEMPTS ?? 3);
// Min backoff (ms) before a 'failed' summon request is retried, so a reverting request is not re-generated
// every single poll. Default 60s.
export const SUMMON_RETRY_BACKOFF_MS = Number(process.env.AURA_SUMMON_RETRY_BACKOFF_MS ?? 60_000);

// B-5 (TEE best-effort -> enforced): when ON (the secure default), a generation whose TEE verification did
// not pass (verified !== true: false / "n/a" / "err:...") is a HARD error - the image is NOT made mintable
// and NO signing attestation is produced, so "verifiable TEE provenance" is true and not best-effort. The
// real verdict is still recorded in provenance. Set AURA_ENFORCE_TEE=0 only as a deliberate, logged escape
// hatch for a known-flaky testnet TEE; it MUST be on for mainnet / real value.
export const ENFORCE_TEE_VERIFICATION = (process.env.AURA_ENFORCE_TEE ?? "1") !== "0";

// ── Summon fulfillment watcher (CP2) ── OFF by default; the real entrypoint opts in via SUMMON_WATCHER=1.
// (buildApp() never starts it, so app.inject() verification scripts don't spawn a poller.)
export const SUMMON_WATCHER_ENABLED = (process.env.SUMMON_WATCHER ?? "0") === "1";
export const SUMMON_POLL_MS = Number(process.env.SUMMON_POLL_MS ?? 5000);
// where to begin scanning Summoned events when there is no persisted cursor (defaults to the deploy block).
export const SUMMON_START_BLOCK = process.env.SUMMON_START_BLOCK ? Number(process.env.SUMMON_START_BLOCK) : undefined;
// the prompt the runner generates with for a summon (the buyer commissions the agent's signature style).
export const SUMMON_PROMPT = process.env.SUMMON_PROMPT ?? "a signature original piece in your iconic style";

// ── Phase-3 indexer (Ponder) ──
// The data-heavy read/discovery/feed APIs are served from the Ponder process (PGlite-backed, in-process
// Drizzle access). The Fastify backend PROXIES them under /api/* so the webapp has ONE base URL. The
// per-item reads + the chain-scan list endpoints stay here as a fallback when the indexer is offline.
export const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:42069";
// How long the backend waits on the indexer before falling back (ms).
export const INDEXER_TIMEOUT_MS = Number(process.env.INDEXER_TIMEOUT_MS ?? 4000);
