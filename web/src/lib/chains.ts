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
// its chainId) so the app follows the server with no rebuild. Testnet today.
const CONFIGURED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_AURA_CHAIN_ID ?? "16602");
export const APP_CHAIN = CONFIGURED_CHAIN_ID === zgMainnet.id ? zgMainnet : zgTestnet;

export const EXPLORER = zgTestnet.blockExplorers.default.url;
export const STORAGE_SCAN = "https://storagescan-galileo.0g.ai";
export const FAUCET_URL = "https://faucet.0g.ai";
