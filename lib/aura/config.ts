// AURA shared config — 0G Galileo testnet (testnet ONLY). Server-side only.
// Mirrors src/config.ts (the proven smoke-test config) for the Next monolith.

export const GALILEO = {
  // ⚠️ live RPC eth_chainId returns 0x40da = 16602 (NOT 16601 as docs say). RPC is authoritative.
  chainId: 16602,
  rpc: "https://evmrpc-testnet.0g.ai",
  explorer: "https://chainscan-galileo.0g.ai",
  faucet: "https://faucet.0g.ai",
  storageIndexerTurbo: "https://indexer-storage-testnet-turbo.0g.ai",
  storageScan: "https://storagescan-galileo.0g.ai",
} as const;

// Deployed contracts (Galileo testnet, verified — see submission-fields.md).
export const CONTRACTS = {
  agentRegistry: "0xEf948192c22957Eaa24a08782163b30037bA34bC",
  outputNFT: "0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb",
  marketplace: "0x4484071f199f16259d4a4F4b41DBa1359D5f7a8c",
} as const;

// Galileo min tip is 2 gwei → use 5 gwei for all writes.
export const GAS = { gasPrice: 5_000_000_000n } as const;

/** The DEMO wallet key — capped, dedicated, server-only. Used for all WRITE ops (gen+mint). */
export function demoPrivateKey(): string {
  const pk = process.env.DEMO_PRIVATE_KEY;
  if (!pk) throw new Error("DEMO_PRIVATE_KEY missing — set up the capped demo wallet (see scripts/setup-demo-wallet).");
  return pk;
}

/** The MAIN funded wallet key — used ONLY for funding the demo wallet (never for unbounded API writes). */
export function mainPrivateKey(): string {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing");
  return pk;
}
