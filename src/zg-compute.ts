// Shim: @0glabs/0g-serving-broker's ESM entry (index.mjs) is BROKEN in v0.7.8/compute-sdk 0.8.4
//   (re-exports named bindings C/F/H... that the chunk doesn't provide → SyntaxError under native ESM).
// The CommonJS build is fine, so load it via createRequire. This is the build-phase workaround too.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const broker = require("@0glabs/0g-serving-broker");

export const createZGComputeNetworkBroker = broker.createZGComputeNetworkBroker;
export const createZGComputeNetworkReadOnlyBroker = broker.createZGComputeNetworkReadOnlyBroker;
export const TESTNET_CHAIN_ID = broker.TESTNET_CHAIN_ID;
export const MAINNET_CHAIN_ID = broker.MAINNET_CHAIN_ID;
export const CONTRACT_ADDRESSES = broker.CONTRACT_ADDRESSES;
