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

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const broker = require("@0gfoundation/0g-compute-ts-sdk");

export const createZGComputeNetworkBroker = broker.createZGComputeNetworkBroker;
export const createZGComputeNetworkReadOnlyBroker = broker.createZGComputeNetworkReadOnlyBroker;
export const TESTNET_CHAIN_ID = broker.TESTNET_CHAIN_ID;
export const MAINNET_CHAIN_ID = broker.MAINNET_CHAIN_ID;
export const CONTRACT_ADDRESSES = broker.CONTRACT_ADDRESSES;
