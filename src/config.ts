// Shared config for the 0G smoke-test. Testnet (Galileo) ONLY.
// Sources: zerog-research + zerog-followup-research reports.
import "dotenv/config";

export const GALILEO = {
  // ⚠️ GOTCHA: live RPC eth_chainId returns 0x40da = 16602, NOT 16601 as docs/research state.
  // The live RPC is authoritative. Foundry + wallet MUST use 16602 or txs fail (chain-id mismatch).
  chainId: 16602,
  rpc: "https://evmrpc-testnet.0g.ai",
  explorer: "https://chainscan-galileo.0g.ai",
  faucet: "https://faucet.0g.ai",
  // Turbo storage (SSD, default tier) - testnet indexer
  storageIndexerTurbo: "https://indexer-storage-testnet-turbo.0g.ai",
  storageScan: "https://storagescan-galileo.0g.ai",
};

export function privateKey(): string {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("PRIVATE_KEY missing - run `pnpm wallet` first and fund via faucet.0g.ai");
  return pk;
}
