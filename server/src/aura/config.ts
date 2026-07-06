// AURA v2 shared config - 0G Galileo testnet (testnet ONLY). Server-side only.
// Ported from lib/aura/config.ts; addresses updated to the deployed v2 set (contracts/deployed-v2.json).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// repo root = server/src/aura -> ../../.. (server/ -> repo/)
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// Resolve the economy chainId ONCE so the network-aware explorer below can key off it (a self-referencing
// object literal can't read its own `chainId` property mid-definition).
const ECONOMY_CHAIN_ID = Number(process.env.CHAIN_ID ?? 16602);

export const GALILEO = {
  // live RPC eth_chainId returns 0x40da = 16602 (NOT 16601 as some docs say). RPC is authoritative.
  // chainId + rpc are env-overridable so the SAME backend runs against a local anvil for the Summon
  // watcher e2e (CHAIN_ID=31337, RPC_URL=http://127.0.0.1:8545), defaulting to 0G Galileo otherwise.
  chainId: ECONOMY_CHAIN_ID,
  rpc: process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai",
  // Network-aware block explorer: 0G Aristotle MAINNET (16661) -> chainscan.0g.ai; else Galileo TESTNET ->
  // chainscan-galileo.0g.ai. Env-overridable (AURA_EXPLORER_URL) so a custom/rotated explorer is a config
  // flip, not a code edit. This is the SOURCE of the explorer for /api/verify (network.explorer + selfCheck)
  // and any web surface that consumes the API response, so the mainnet cutover no longer links to a testnet
  // explorer that has no record of a mainnet tx.
  explorer:
    process.env.AURA_EXPLORER_URL ??
    (ECONOMY_CHAIN_ID === 16661 ? "https://chainscan.0g.ai" : "https://chainscan-galileo.0g.ai"),
  faucet: "https://faucet.0g.ai",
  // The ONLY hardcoded 0G-storage endpoint. Env-overridable so the mainnet flip is a config change, not a
  // code edit (mirrors the RPC seam above + the IMAGE/CHAT dual-network pattern). Mainnet turbo indexer =
  // https://indexer-storage-turbo.0g.ai (the SDK auto-discovers the Flow+Market contracts from it, so no
  // address change is needed). STORAGE_FILE_INFO_BASE derives from this, so the proof link follows it.
  storageIndexerTurbo: process.env.AURA_STORAGE_INDEXER_TURBO ?? "https://indexer-storage-testnet-turbo.0g.ai",
  // Network-aware 0G Storage explorer (parallels `explorer` above): 0G MAINNET (16661) -> storagescan.0g.ai;
  // else Galileo TESTNET -> storagescan-galileo.0g.ai. Env-overridable (AURA_STORAGE_SCAN). This backs
  // storageScanUrl() (server/src/aura/contracts.ts), so a mainnet-minted relic no longer links to a testnet
  // storage explorer that has no record of it.
  storageScan:
    process.env.AURA_STORAGE_SCAN ??
    (ECONOMY_CHAIN_ID === 16661 ? "https://storagescan.0g.ai" : "https://storagescan-galileo.0g.ai"),
} as const;

// ── deployed v2 contracts (read from contracts/deployed-v2.json so there is ONE source of truth) ──
interface DeployedV2 {
  agentRegistry: string;
  auraINFT: string; // ERC-7857 de-mock: proof-gated secure-transfer iNFT. "" until deployed/wired (additive).
  outputNFT: string;
  marketplace: string;
  summonEscrow: string; // integrated deploy: the demand-pull commissioning escrow ("" if not deployed)
  // ── game layer (phase 1 contracts; "" until the phase-4 deploy wires them; all graceful-off) ──
  arenaVote: string; // Creative Arena blind/staked commit-reveal battle vote (ArenaVote.sol)
  auraFusion: string; // FUSION: hybrid-child mint from two parents + on-chain genome (AuraFusion.sol)
  arenaReputation: string; // Tier-2 rating-ladder Merkle anchor (ArenaReputation.sol)
  attestor: string;
  platform: string;
  platformBps: number;
  deployBlock: number;
  // The block the game contracts (ArenaVote/AuraFusion/ArenaReputation) were deployed at (mainnet cutover).
  // Floors every game eth_getLogs scan (tally, ladder verify) so they never scan from genesis. Falls back
  // to deployBlock when unset.
  gameDeployBlock: number;
  chainId: number;
}

function loadDeployed(): DeployedV2 {
  const p = path.join(REPO_ROOT, "contracts", "deployed-v2.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  return {
    agentRegistry: j.agentRegistry,
    // OPTIONAL + additive: the live demo does not read auraINFT, so a missing field never breaks it. Present
    // once a fresh AuraINFT is deployed on Galileo for the secure-transfer + create wiring.
    auraINFT: j.auraINFT ?? "",
    outputNFT: j.outputNFT,
    marketplace: j.marketplace,
    summonEscrow: j.summonEscrow ?? "",
    // OPTIONAL + additive (same graceful pattern as auraINFT/summonEscrow): the game-layer contracts are
    // "" until the phase-4 deploy wires them, so a missing field never breaks the live demo. Present once
    // ArenaVote / AuraFusion / ArenaReputation are deployed on Galileo (folded into the DeployCutover).
    arenaVote: j.arenaVote ?? "",
    auraFusion: j.auraFusion ?? "",
    arenaReputation: j.arenaReputation ?? "",
    attestor: j.attestor,
    platform: j.platform,
    platformBps: Number(j.platformBps),
    deployBlock: Number(j.deployBlock),
    gameDeployBlock: Number(j.gameDeployBlock ?? j.deployBlock),
    chainId: Number(j.chainId),
  };
}

export const DEPLOYED = loadDeployed();

// The floor block for every GAME eth_getLogs scan (arena tally recompute, ladder verdict scan). Precedence:
// ARENA_DEPLOY_BLOCK env override > deployed-v2.json gameDeployBlock > deployBlock. This stops the keyless
// /api/arena/tally + /api/arena/ladder/verify endpoints from scanning ~19k chunks from genesis (the mainnet
// hang the audit found: with no ARENA_DEPLOY_BLOCK env, fromBlock defaulted to 0).
export const GAME_DEPLOY_BLOCK = Number(process.env.ARENA_DEPLOY_BLOCK ?? DEPLOYED.gameDeployBlock);

// addresses are env-overridable (same reason as GALILEO above: local anvil e2e vs live Galileo).
export const CONTRACTS = {
  agentRegistry: process.env.AGENT_REGISTRY_ADDR ?? DEPLOYED.agentRegistry,
  // AuraINFT (ERC-7857 secure-transfer target). Env-overridable (AURA_INFT_ADDR) for the Galileo e2e; "" =>
  // the secure-transfer + INFT-mint flows are OFF (graceful), the app keeps reading agentRegistry.
  auraINFT: process.env.AURA_INFT_ADDR ?? DEPLOYED.auraINFT ?? "",
  outputNFT: process.env.OUTPUT_NFT_ADDR ?? DEPLOYED.outputNFT,
  marketplace: process.env.MARKETPLACE_ADDR ?? DEPLOYED.marketplace,
  // Summon escrow: from deployed-v2.json (the integrated deploy populates it), env-overridable for local
  // anvil e2e. Empty string => the Summon feature/watcher stays OFF (graceful).
  summonEscrow: process.env.SUMMON_ESCROW_ADDR ?? DEPLOYED.summonEscrow ?? "",
  // ── game layer (ArenaVote / AuraFusion / ArenaReputation). Env-overridable for the local-anvil game e2e,
  // else read from deployed-v2.json. Empty string => that game flow stays OFF (graceful), same as auraINFT. ──
  arenaVote: process.env.ARENA_VOTE_ADDR ?? DEPLOYED.arenaVote ?? "",
  auraFusion: process.env.AURA_FUSION_ADDR ?? DEPLOYED.auraFusion ?? "",
  arenaReputation: process.env.ARENA_REPUTATION_ADDR ?? DEPLOYED.arenaReputation ?? "",
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
//   - oraclePrivateKey(): the ERC-7857 de-mock sealed-key re-encryption oracle key (oracle.ts). Dedicated
//     ORACLE_PRIVATE_KEY, falling back to the sponsor key only for local/dev convenience.
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

// ── CHAT dual-network (mainnet GLM-5.1) ─────────────────────────────────────────────────────────────
// The CHAT inference path can run on 0G MAINNET (chainId 16661) while EVERYTHING ELSE (image generation,
// the deployed v2 contracts, the Summon watcher, mint, the indexer) stays on 0G TESTNET Galileo (16602).
// This is a DELIBERATE split: 0G MAINNET serves a genuinely stronger in-enclave TeeML chat model (GLM-5.1,
// validated live 2026-07-01: verified=true 4/4, a large quality jump over testnet qwen2.5-omni-7b), while
// the on-chain economy is not yet mainnet. The mainnet chat broker is built from a DEDICATED key + RPC
// (chat-compute.ts chatSigner()), fully ISOLATED from the testnet sponsor/image broker (different key,
// provider, chain). Toggle with AURA_CHAT_MAINNET=1. UNSET (default) => today's EXACT testnet-qwen behavior,
// so enabling/disabling mainnet chat is a pure env flip - no code change, fully reversible. The toggle is
// read LIVE per-request in chat-compute.ts chatNetwork() (not frozen at boot), so it is unit-observable and,
// because the brokers/services/models caches are network-keyed, a flip is safe. RPC/chainId below are
// deploy-time and read only when a mainnet broker is built.
export const CHAT_MAINNET_RPC = process.env.AURA_CHAT_MAINNET_RPC ?? "https://evmrpc.0g.ai";
export const CHAT_MAINNET_CHAIN_ID = Number(process.env.AURA_CHAT_MAINNET_CHAIN_ID ?? 16661);

// The dedicated MAINNET chat signer key. It pays ONLY the mainnet chat compute ledger (isolated from the
// testnet SPONSOR key that funds image gen / storage). It is ENV-INJECTED AT DEPLOY - NEVER hardcoded,
// NEVER read from a file in shipped code. Consulted ONLY when AURA_CHAT_MAINNET=1. If the toggle is on but
// the key is missing it THROWS rather than build a mainnet broker without a key - so the chat path can never
// SILENTLY run on the wrong network. The runtime seam (chat-llm.ts) catches that throw and degrades to the
// HONEST testnet qwen rung (served model + /chat/health both truthfully report testnet, never mislabeling
// qwen as mainnet GLM). When the toggle is off this is never called, so a testnet deploy needs no mainnet key.
export function chatMainnetKey(): string {
  const pk = process.env.AURA_CHAT_MAINNET_KEY;
  if (!pk || !pk.trim()) {
    throw new Error(
      "AURA_CHAT_MAINNET=1 but AURA_CHAT_MAINNET_KEY is unset - set the dedicated mainnet chat signer key in the deploy env (injected at deploy, never committed).",
    );
  }
  return normalizePk(pk);
}

// ── IMAGE dual-network (mainnet z-image-turbo text-to-image) ─────────────────────────────────────────
// The IMAGE-GEN path can run on 0G MAINNET (chainId 16661) while the on-chain economy + storage stay on
// TESTNET Galileo - the exact same dual-network shape as CHAT above. 0G mainnet serves ONE genuine in-enclave
// TeeML image provider (z-image-turbo, provider 0xE29a..cdF974, signer 0x592056..; verified live 2026-07-05),
// which lets a mint's provenance be verified ON-CHAIN by OutputNFT.mintOutputVerified. Toggle with
// AURA_IMAGE_MAINNET=1. UNSET (default) => today's EXACT testnet image-editing behavior, zero regression. The
// mainnet image broker is built from a DEDICATED key (compute.ts imageSigner), ISOLATED from the testnet sponsor.
export const IMAGE_MAINNET_RPC = process.env.AURA_IMAGE_MAINNET_RPC ?? "https://evmrpc.0g.ai";
export const IMAGE_MAINNET_CHAIN_ID = Number(process.env.AURA_IMAGE_MAINNET_CHAIN_ID ?? 16661);
// The pinned mainnet z-image provider + its 0G-published enclave signer (verified live). Env-overridable so a
// 0G provider/enclave rotation is a config flip, not a code change. The on-chain teeSigner (OutputNFT) must be
// set to IMAGE_MAINNET_TEE_SIGNER for the verified mint to recover.
export const IMAGE_MAINNET_PROVIDER = process.env.AURA_IMAGE_MAINNET_PROVIDER ?? "0xE29a72c7629815Eb480aE5b1F2dfA06f06cdF974";
export const IMAGE_MAINNET_TEE_SIGNER = process.env.AURA_IMAGE_MAINNET_TEE_SIGNER ?? "0x592056E413aB456646a50441e52D5BA89527877D";

// The dedicated MAINNET image signer key. Pays ONLY the mainnet z-image compute ledger (isolated from the
// testnet SPONSOR key). ENV-INJECTED at deploy, NEVER committed. Consulted ONLY when AURA_IMAGE_MAINNET=1;
// if the toggle is on but the key is missing it THROWS rather than build a mainnet broker without a key.
export function imageMainnetKey(): string {
  const pk = process.env.AURA_IMAGE_MAINNET_KEY;
  if (!pk || !pk.trim()) {
    throw new Error(
      "AURA_IMAGE_MAINNET=1 but AURA_IMAGE_MAINNET_KEY is unset - set the dedicated mainnet image signer key in the deploy env (injected at deploy, never committed).",
    );
  }
  return normalizePk(pk);
}

// ── IMAGE testnet seam (decouple image-compute from the economy chain) ───────────────────────────────
// When the ECONOMY runs on a non-testnet chain (0G mainnet 16661) but image-gen must stay on 0G Compute
// TESTNET (qwen-image-edit, the edit-based fusion model), the testnet image path can no longer reuse the
// economy sponsor signer: the sponsor now points at the mainnet RPC, so 0G Compute listService() would
// return MAINNET providers (z-image-turbo) instead of the testnet qwen editor. This dedicated seam pins
// the image broker to the testnet compute RPC with a testnet-funded key. UNSET => the image-testnet path
// reuses the sponsor signer (a pure-testnet deploy, today's EXACT behavior, zero regression). Non-secret
// RPC/chainId; the key is env-injected at deploy, NEVER committed.
export const IMAGE_TESTNET_RPC = process.env.AURA_IMAGE_TESTNET_RPC ?? "https://evmrpc-testnet.0g.ai";
export const IMAGE_TESTNET_CHAIN_ID = Number(process.env.AURA_IMAGE_TESTNET_CHAIN_ID ?? 16602);
// Optional dedicated key that pays the TESTNET image-compute ledger, ISOLATED from the (now mainnet)
// economy sponsor. Returns null when unset so imageSigner() falls back to the sponsor signer unchanged.
export function imageTestnetKey(): string | null {
  const pk = process.env.AURA_IMAGE_TESTNET_KEY;
  return pk && pk.trim() ? normalizePk(pk) : null;
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

// ── Public keyless verify endpoint (GET /api/verify) presentation config ─────────────────────────────
// Config that shapes the shareable self-check curl + the image URL the keyless /api/verify surface hands a
// skeptic. EVERY value derives from GALILEO/CONTRACTS or is env-overridable, so the SAME backend flips
// testnet -> mainnet (and localhost) with NO code edit: never hardcode a network-specific URL/signer.
// Defaults are prod-correct for the live testnet deploy.
export const PUBLIC_WEB_ORIGIN = (process.env.PUBLIC_WEB_ORIGIN ?? "https://aura.topengdev.com").replace(/\/+$/, "");
export const PUBLIC_API_ORIGIN = (process.env.PUBLIC_API_ORIGIN ?? "https://api-aura.topengdev.com").replace(/\/+$/, "");

// Human network name, DERIVED from chainId so it flips with the deploy (16661 -> mainnet, else Galileo testnet).
export const NETWORK_NAME = GALILEO.chainId === 16661 ? "0G Aristotle Mainnet" : "0G Galileo Testnet";

// The WORKING 0G Storage proof base (the indexer file/info route -> {finalized,size,...}). The storagescan
// `/tx/<root>` route expects a submission TX hash, NOT a data merkle root, so it never resolves a root; this
// one does. Testnet-specific today; env-overridable so a mainnet storage indexer is a config flip.
export const STORAGE_FILE_INFO_BASE =
  process.env.AURA_STORAGE_FILE_INFO_BASE ?? `${GALILEO.storageIndexerTurbo}/file/info`;

// The 0G image-gen enclave facts, network-aware. Option A default = image-editing on 0G TESTNET; the opt-in
// mainnet z-image path is AURA_IMAGE_MAINNET=1. `VERIFY_IMAGE_TEE_SIGNER_EXPECTED` is the 0G-PUBLISHED enclave
// signer OutputNFT.teeSigner() must equal once the verified-mint path is armed (setTeeSigner). All non-secret,
// published addresses. Env-overridable so a 0G enclave rotation / the mainnet flip is config, not a code change.
const IMAGE_ON_MAINNET = (process.env.AURA_IMAGE_MAINNET ?? "0") === "1";
export const IMAGE_TESTNET_TEE_SIGNER =
  process.env.AURA_IMAGE_TESTNET_TEE_SIGNER ?? "0x2A94D671f1A5e080f75A8164087Cdd35c8442e69";
export const VERIFY_IMAGE_MODEL = IMAGE_ON_MAINNET ? "z-image-turbo" : "qwen/qwen-image-edit-2511";
export const VERIFY_IMAGE_COMPUTE_NETWORK = IMAGE_ON_MAINNET
  ? "0G Aristotle mainnet (16661)"
  : "0G Galileo testnet (16602)";
export const VERIFY_IMAGE_TEE_SIGNER_EXPECTED = IMAGE_ON_MAINNET ? IMAGE_MAINNET_TEE_SIGNER : IMAGE_TESTNET_TEE_SIGNER;
