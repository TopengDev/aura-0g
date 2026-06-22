// SERVER-ONLY. Contract ABIs (human-readable) + provider/contract factories.
// ABIs mirror demo/run-aura.ts (the proven pipeline). Addresses in config.ts.
import { ethers } from "ethers";
import { GALILEO, CONTRACTS } from "./config";

export const REG_ABI = [
  "function mintAgent(address to,string name,bytes32 styleFingerprint,string encBrainRoot,bytes32 modelAttestation,uint16 royaltyBps) returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function getAgent(uint256) view returns (tuple(string name,bytes32 styleFingerprint,string encBrainRoot,bytes32 modelAttestation,uint16 royaltyBps,uint16 styleVersion))",
  "function royaltyBpsOf(uint256) view returns (uint16)",
  "function safeTransferFrom(address,address,uint256)",
  "function nextAgentId() view returns (uint256)",
  "event AgentMinted(uint256 indexed agentId,address indexed owner,string name,bytes32 styleFingerprint)",
];

export const OUT_ABI = [
  "function mintOutput(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed) returns (uint256)",
  "function provenanceOf(uint256) view returns (tuple(uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed))",
  "function royaltyInfo(uint256,uint256) view returns (address,uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function setApprovalForAll(address,bool)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function nextTokenId() view returns (uint256)",
  "event OutputMinted(uint256 indexed tokenId,uint256 indexed creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation)",
];

export const MKT_ABI = [
  "function list(uint256 tokenId,uint256 price)",
  "function buy(uint256 tokenId) payable",
  "function listings(uint256) view returns (address seller,uint256 price,bool active)",
  "function platform() view returns (address)",
  "function platformBps() view returns (uint16)",
  "event Listed(uint256 indexed tokenId,address indexed seller,uint256 price)",
  "event Sold(uint256 indexed tokenId,address indexed buyer,address indexed seller,uint256 price,address royaltyReceiver,uint256 royaltyPaid,uint256 platformFee,uint256 sellerProceeds)",
];

let _provider: ethers.JsonRpcProvider | null = null;
/** Shared read-only provider (no signer, no key). */
export function readProvider(): ethers.JsonRpcProvider {
  if (!_provider) _provider = new ethers.JsonRpcProvider(GALILEO.rpc);
  return _provider;
}

export function registryRead() {
  return new ethers.Contract(CONTRACTS.agentRegistry, REG_ABI, readProvider());
}
export function outputRead() {
  return new ethers.Contract(CONTRACTS.outputNFT, OUT_ABI, readProvider());
}
export function marketRead() {
  return new ethers.Contract(CONTRACTS.marketplace, MKT_ABI, readProvider());
}

export function registryWrite(signer: ethers.Wallet) {
  return new ethers.Contract(CONTRACTS.agentRegistry, REG_ABI, signer);
}
export function outputWrite(signer: ethers.Wallet) {
  return new ethers.Contract(CONTRACTS.outputNFT, OUT_ABI, signer);
}
export function marketWrite(signer: ethers.Wallet) {
  return new ethers.Contract(CONTRACTS.marketplace, MKT_ABI, signer);
}

export function txUrl(hash: string): string {
  return `${GALILEO.explorer}/tx/${hash}`;
}

/** 0G storagescan link for a content root. */
export function storageScanUrl(root: string): string {
  return `${GALILEO.storageScan}/tx/${root}`;
}

/** Parse a named event from a receipt. */
export function parseEvent(rcpt: any, iface: ethers.Interface, name: string): any | null {
  for (const log of rcpt.logs) {
    try {
      const p = iface.parseLog(log);
      if (p?.name === name) return p.args;
    } catch {
      /* not our event */
    }
  }
  return null;
}
