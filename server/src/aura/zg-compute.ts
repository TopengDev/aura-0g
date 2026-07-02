// SERVER-ONLY. Load the 0G Compute broker UNBUNDLED via createRequire(import.meta.url).
//
// We pin @0gfoundation/0g-compute-ts-sdk@0.8.4 DIRECTLY (the deprecated @0glabs/0g-serving-broker@0.7.8
// is only a thin shim that re-exports this exact package - verified during recon). Its ESM entry
// (lib.esm/index.mjs) re-exports named bindings the chunk does not provide, so under native ESM it
// SyntaxErrors. The CommonJS build (lib.commonjs/index.js) is fine, so we load THAT via createRequire.
//
// This service is intentionally UNBUNDLED (tsx in dev, tsc -> node dist/ in prod). No webpack/esbuild,
// so createRequire resolves node_modules at runtime exactly like a normal CJS require. (Smoke-confirmed.)
import { createRequire } from "node:module";
import type { Wallet } from "ethers";

const require = createRequire(import.meta.url);

// ── Minimal broker typing (the 0G Compute seam) ──────────────────────────────────────────────────────
// The SDK is loaded via createRequire (untyped CommonJS), so at this boundary the broker is `any`. Describe
// ONLY the shape our compute/chat hot path actually reads/calls (image gen: compute.ts; chat: chat-compute.ts)
// so downstream code is typed instead of `any`-threaded. Fields are optional/loose where the SDK is; the
// nested ledger internal (MIN_LEDGER_BALANCE_OG) stays untyped in compute.ts (a documented runtime hack).

/** One 0G Compute inference service as returned by broker.inference.listService(). */
export interface ZgService {
  provider: string;
  serviceType?: string;
  model: string;
  verifiability?: string;
  teeSignerAddress?: string;
  teeSignerAcknowledged?: boolean;
}

/** Endpoint + model resolved for a provider via broker.inference.getServiceMetadata(). */
export interface ZgServiceMetadata {
  endpoint: string;
  model: string;
}

/** The inference facet of the broker (service discovery + signed request/verify). */
export interface ZgInference {
  listService(offset?: number, limit?: number, includeUnacknowledged?: boolean): Promise<ZgService[]>;
  getServiceMetadata(provider: string): Promise<ZgServiceMetadata>;
  getRequestHeaders(provider: string, content: string): Promise<Record<string, string>>;
  processResponse(provider: string, chatId: string | null, content: string): Promise<boolean | string>;
  acknowledgeProviderSigner(provider: string): Promise<void>;
}

/** The ledger facet (funding ritual). `ledger` is the SDK-internal nested object we poke for the min-balance hack. */
export interface ZgLedger {
  depositFund(amountOg: number): Promise<unknown>;
  transferFund(provider: string, kind: string, amount: bigint): Promise<unknown>;
  ledger?: unknown;
}

/** The 0G Compute broker (only the surface AURA uses). */
export interface ZgBroker {
  inference: ZgInference;
  ledger: ZgLedger;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const broker = require("@0gfoundation/0g-compute-ts-sdk");

export const createZGComputeNetworkBroker: (signer: Wallet) => Promise<ZgBroker> =
  broker.createZGComputeNetworkBroker;
export const createZGComputeNetworkReadOnlyBroker = broker.createZGComputeNetworkReadOnlyBroker;
export const TESTNET_CHAIN_ID = broker.TESTNET_CHAIN_ID;
export const MAINNET_CHAIN_ID = broker.MAINNET_CHAIN_ID;
export const CONTRACT_ADDRESSES = broker.CONTRACT_ADDRESSES;
