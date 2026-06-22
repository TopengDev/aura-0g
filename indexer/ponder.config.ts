// AURA v2 indexer config (Ponder 0.16). Indexes the 3 deployed v2 contracts on 0G Galileo from the
// deploy block. Addresses + startBlock + chainId are read from contracts/deployed-v2.json so there is
// ONE source of truth shared with the Phase-2 backend.
//
// 0G Galileo notes baked in here (live-verified):
//   - chainId 16602 (eth_chainId returns 0x40da). RPC is authoritative.
//   - Genesis is PRUNED on Galileo -> we MUST start at the deploy block (40164233), never 0.
//   - eth_getLogs over ranges+filters works (Geth 1.15.11, 10k-result cap that self-suggests a
//     narrower range). Ponder auto-chunks getLogs + auto-detects the cap. If its auto-cap-detect
//     misfires on 0G's -32000 error format, ethGetLogsBlockRange pins the chunk explicitly.
//   - log.blockTimestamp returns 0x0 on this RPC; real time comes from the block. Ponder reads
//     event.block.timestamp (the block header), so timestamps are correct regardless.
import { createConfig } from "ponder";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentRegistryAbi } from "./abis/AgentRegistry";
import { OutputNFTAbi } from "./abis/OutputNFT";
import { AuraMarketplaceAbi } from "./abis/AuraMarketplace";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface DeployedV2 {
  agentRegistry: string;
  outputNFT: string;
  marketplace: string;
  deployBlock: number;
  chainId: number;
  rpcUrl: string;
}

function loadDeployed(): DeployedV2 {
  // indexer/ -> ../contracts/deployed-v2.json
  const p = path.join(__dirname, "..", "contracts", "deployed-v2.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  return {
    agentRegistry: j.agentRegistry,
    outputNFT: j.outputNFT,
    marketplace: j.marketplace,
    deployBlock: Number(j.deployBlock),
    chainId: Number(j.chainId),
    rpcUrl: String(j.rpcUrl),
  };
}

const D = loadDeployed();

// RPC override: PONDER_RPC_URL_16602 (Ponder's convention) > deployed-v2.json rpcUrl.
const RPC = process.env.PONDER_RPC_URL_16602 ?? D.rpcUrl;

// Optional explicit getLogs chunk. Ponder auto-detects the cap from the RPC; only set this if the
// auto-detect misfires on 0G's -32000 format (the validated fallback in the research is 5000).
const LOGS_RANGE = process.env.PONDER_ETH_GETLOGS_BLOCK_RANGE
  ? Number(process.env.PONDER_ETH_GETLOGS_BLOCK_RANGE)
  : undefined;

export default createConfig({
  chains: {
    galileo: {
      id: D.chainId, // 16602
      rpc: RPC,
      pollingInterval: 2_000, // HTTP polling cadence (no ws on this public RPC)
      ...(LOGS_RANGE ? { ethGetLogsBlockRange: LOGS_RANGE } : {}),
    },
  },
  contracts: {
    AgentRegistry: {
      abi: AgentRegistryAbi,
      chain: "galileo",
      address: D.agentRegistry as `0x${string}`,
      startBlock: D.deployBlock,
    },
    OutputNFT: {
      abi: OutputNFTAbi,
      chain: "galileo",
      address: D.outputNFT as `0x${string}`,
      startBlock: D.deployBlock,
    },
    AuraMarketplace: {
      abi: AuraMarketplaceAbi,
      chain: "galileo",
      address: D.marketplace as `0x${string}`,
      startBlock: D.deployBlock,
    },
  },
});
