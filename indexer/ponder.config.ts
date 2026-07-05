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
import { AuraINFTAbi } from "./abis/AuraINFT";
import { OutputNFTAbi } from "./abis/OutputNFT";
import { AuraMarketplaceAbi } from "./abis/AuraMarketplace";
import { SummonEscrowAbi } from "./abis/SummonEscrow";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// AuraINFT (ERC-7857 cutover). When deployed-v2.json.auraINFT is a real address, index it from its deploy
// block so migrated/created agents are visible via the indexer (the audit's atomic tripwire: reads must see
// AuraINFT). When it is unset (pre-cutover), register an INERT placeholder (a burn address at a far-future
// startBlock) so the config + Ponder-generated types stay STABLE (the AuraINFT handlers always typecheck) yet
// NOTHING is indexed. The cutover just sets auraINFT + auraInftDeployBlock in deployed-v2.json to light it up.
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const AURAINFT_DISABLED_ADDR = "0x000000000000000000000000000000000000dEaD";
const AURAINFT_DISABLED_BLOCK = 999_999_999; // far beyond the chain head -> never scanned, never indexed

interface DeployedV2 {
  agentRegistry: string;
  auraINFT: string;
  auraInftDeployBlock: number;
  outputNFT: string;
  marketplace: string;
  summonEscrow: string;
  deployBlock: number;
  summonStartBlock: number;
  chainId: number;
  rpcUrl: string;
}

function loadDeployed(): DeployedV2 {
  // indexer/ -> ../contracts/deployed-v2.json
  const p = path.join(__dirname, "..", "contracts", "deployed-v2.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  const auraRaw = typeof j.auraINFT === "string" ? j.auraINFT : "";
  const auraEnabled = ADDR_RE.test(auraRaw);
  return {
    agentRegistry: j.agentRegistry,
    // AuraINFT cutover slot: real address + deploy block when set, else the inert placeholder (see above).
    auraINFT: auraEnabled ? auraRaw : AURAINFT_DISABLED_ADDR,
    auraInftDeployBlock: auraEnabled ? Number(j.auraInftDeployBlock ?? j.deployBlock) : AURAINFT_DISABLED_BLOCK,
    outputNFT: j.outputNFT,
    marketplace: j.marketplace,
    summonEscrow: j.summonEscrow ?? "",
    deployBlock: Number(j.deployBlock),
    // The SummonEscrow was deployed AFTER the registry (its own start block); scan from there, not the
    // registry deploy block, to avoid a long empty pre-escrow range. Falls back to deployBlock if unset.
    summonStartBlock: Number(j.summonStartBlock ?? j.deployBlock),
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
    // AuraINFT (the REAL ERC-7857 registry, post-cutover). Its AgentMinted / Transfer / BrainRekeyed /
    // BrainUpdated feed the SAME agents read-model as AgentRegistry, so a migrated or newly-created iNFT agent
    // is visible via the indexer. Inert (burn address, far-future block) until deployed-v2.json.auraINFT is set.
    AuraINFT: {
      abi: AuraINFTAbi,
      chain: "galileo",
      address: D.auraINFT as `0x${string}`,
      startBlock: D.auraInftDeployBlock,
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
    // SummonEscrow (demand-pull commissioning). Indexed so the summon fee income (Fulfilled -> ownerCut to
    // the agent's CURRENT owner + platformFee) lands in the read model - otherwise creator earnings under-
    // report and "income follows the agent" is invisible. startBlock = its own (later) deploy block.
    SummonEscrow: {
      abi: SummonEscrowAbi,
      chain: "galileo",
      address: D.summonEscrow as `0x${string}`,
      startBlock: D.summonStartBlock,
    },
  },
});
