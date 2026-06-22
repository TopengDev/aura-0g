// SERVER-ONLY. Shim: @0glabs/0g-serving-broker's ESM entry (index.mjs) is BROKEN in v0.7.8
//   (re-exports named bindings the chunk doesn't provide → SyntaxError under native ESM).
// The CommonJS build is fine, so load it via createRequire. The package is listed in
// next.config `serverExternalPackages` so Next leaves it external (loaded at runtime, not bundled).
import { createRequire } from "node:module";

// In a Next server bundle, import.meta.url resolves to the emitted server file; createRequire
// off it resolves node_modules normally. (Verified working in the Gate 0 smoke-test.)
const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const broker = require("@0glabs/0g-serving-broker");

export const createZGComputeNetworkBroker = broker.createZGComputeNetworkBroker;
export const createZGComputeNetworkReadOnlyBroker = broker.createZGComputeNetworkReadOnlyBroker;
export const TESTNET_CHAIN_ID = broker.TESTNET_CHAIN_ID;
export const MAINNET_CHAIN_ID = broker.MAINNET_CHAIN_ID;
export const CONTRACT_ADDRESSES = broker.CONTRACT_ADDRESSES;
