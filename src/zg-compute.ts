// Load the 0G Compute broker UNBUNDLED via createRequire(import.meta.url).
// We depend on @0gfoundation/0g-compute-ts-sdk@0.8.4 DIRECTLY (the deprecated @0glabs/0g-serving-broker@0.7.8
// was only a thin shim that re-exported this exact package). Its ESM entry re-exports named bindings the
// chunk does not provide, so under native ESM it SyntaxErrors; the CommonJS build is fine, so load THAT.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const broker = require("@0gfoundation/0g-compute-ts-sdk");

export const createZGComputeNetworkBroker = broker.createZGComputeNetworkBroker;
export const createZGComputeNetworkReadOnlyBroker = broker.createZGComputeNetworkReadOnlyBroker;
export const TESTNET_CHAIN_ID = broker.TESTNET_CHAIN_ID;
export const MAINNET_CHAIN_ID = broker.MAINNET_CHAIN_ID;
export const CONTRACT_ADDRESSES = broker.CONTRACT_ADDRESSES;
