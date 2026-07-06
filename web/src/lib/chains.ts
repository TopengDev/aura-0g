import { defineChain } from "viem";

// 0G Galileo Testnet - where AURA's contracts (AgentRegistry / OutputNFT / Marketplace) live.
// id 16602. The app runs on testnet; mainnet is defined for completeness so a wallet on the
// wrong network gets a clean RainbowKit switch prompt.
export const zgTestnet = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: { default: { name: "0G Scan", url: "https://chainscan-galileo.0g.ai" } },
  testnet: true,
});

export const zgMainnet = defineChain({
  id: 16661,
  name: "0G Aristotle",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc.0g.ai"] } },
  blockExplorers: { default: { name: "0G Scan", url: "https://chainscan.0g.ai" } },
});

// The single chain this deployment runs on. Auto-detected from the server's /health (it reports
// its chainId) via NEXT_PUBLIC_AURA_CHAIN_ID so the app follows the server. Mainnet 16661 today.
const CONFIGURED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_AURA_CHAIN_ID ?? "16602");
export const APP_CHAIN = CONFIGURED_CHAIN_ID === zgMainnet.id ? zgMainnet : zgTestnet;

// The block explorer follows APP_CHAIN, so a mainnet-deployed relic/agent no longer links to the testnet
// explorer (which has no record of a mainnet tx). Was hardcoded to the testnet explorer regardless of chain.
export const EXPLORER = APP_CHAIN.blockExplorers.default.url;
// 0G Storage explorer, network-aware: mainnet 16661 -> storagescan.0g.ai; else Galileo testnet ->
// storagescan-galileo.0g.ai. Parallels the server's GALILEO.storageScan seam.
export const STORAGE_SCAN =
  APP_CHAIN.id === zgMainnet.id ? "https://storagescan.0g.ai" : "https://storagescan-galileo.0g.ai";
export const FAUCET_URL = "https://faucet.0g.ai";

// ── App-chain-derived display labels ─────────────────────────────────────────────────────────────────
// Single source of truth for every "which network" string in the UI, so a deploy that flips APP_CHAIN
// (testnet -> mainnet) updates ALL network copy with no per-component edit. Post-cutover these read
// "Aristotle" / "Mainnet" / "0G Aristotle Mainnet" / 16661 instead of the stale hardcoded Galileo/16602.
const IS_MAINNET = APP_CHAIN.id === zgMainnet.id;
export const CHAIN_ID = APP_CHAIN.id; // 16661 mainnet | 16602 testnet
export const CHAIN_SHORT = IS_MAINNET ? "Aristotle" : "Galileo"; // network family (the word after "0G")
export const CHAIN_TIER = IS_MAINNET ? "Mainnet" : "Testnet";
export const CHAIN_FULL = IS_MAINNET ? "0G Aristotle Mainnet" : "0G Galileo Testnet"; // full plain-text label
