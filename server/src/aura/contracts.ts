// SERVER-ONLY. v2 contract ABIs (human-readable) + provider/contract factories.
// Ported from lib/aura/contracts.ts; ABIs UPDATED to the deployed v2 set (read from contracts/src/*.sol
// + verified against contracts/out/*.json during recon). The backend only ever READS, plus the SPONSOR
// signs gen-funding txs. User mint/list/buy are NEVER signed here (returned as args for the user wallet).
import { ethers } from "ethers";
import { GALILEO, CONTRACTS } from "./config.js";

// AgentRegistry v2: mintAgent gains creatorResaleBps; getAgent tuple gains creatorResaleBps.
export const REG_ABI = [
  "function mintAgent(address to,string name,bytes32 styleFingerprint,string encBrainRoot,bytes32 modelAttestation,uint16 royaltyBps,uint16 creatorResaleBps) returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function getAgent(uint256) view returns (tuple(string name,bytes32 styleFingerprint,string encBrainRoot,bytes32 modelAttestation,uint16 royaltyBps,uint16 styleVersion,uint16 creatorResaleBps))",
  "function royaltyBpsOf(uint256) view returns (uint16)",
  "function creatorResaleBpsOf(uint256) view returns (uint16)",
  "function agentCreator(uint256) view returns (address)",
  "function nextAgentId() view returns (uint256)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function getApproved(uint256) view returns (address)",
  "event AgentMinted(uint256 indexed agentId,address indexed owner,string name,bytes32 styleFingerprint,uint16 royaltyBps,bytes32 modelAttestation)",
] as const;

// OutputNFT v2: mintOutput gains bytes32 nonce + bytes attestationSig; provenanceOf tuple unchanged;
// NEW: authDigest (compute the EIP-712 digest), attestor, usedNonce.
export const OUT_ABI = [
  "function mintOutput(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,bytes32 nonce,bytes attestationSig) returns (uint256)",
  "function authDigest(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,bytes32 nonce) view returns (bytes32)",
  "function provenanceOf(uint256) view returns (tuple(uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed))",
  "function royaltyInfo(uint256,uint256) view returns (address,uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function attestor() view returns (address)",
  "function usedNonce(bytes32) view returns (bool)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function getApproved(uint256) view returns (address)",
  "function nextTokenId() view returns (uint256)",
  "event OutputMinted(uint256 indexed tokenId,uint256 indexed creatorAgentId,address indexed owner,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed)",
] as const;

// AuraMarketplace v2: generalized multi-collection. ONE buy() entrypoint keyed by (collection,tokenId).
export const MKT_ABI = [
  "function list(address collection,uint256 tokenId,uint256 price)",
  "function buy(address collection,uint256 tokenId) payable",
  "function listingKey(address collection,uint256 tokenId) pure returns (bytes32)",
  "function listings(bytes32) view returns (address seller,uint256 price,bool active)",
  "function allowedCollection(address) view returns (bool)",
  "function platform() view returns (address)",
  "function platformBps() view returns (uint16)",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function withdraw()",
  "event Listed(address indexed collection,uint256 indexed tokenId,address indexed seller,uint256 price)",
  "event Sold(address indexed collection,uint256 indexed tokenId,address indexed buyer,address seller,uint256 price,address royaltyReceiver,uint256 royaltyPaid,uint256 platformFee,uint256 sellerProceeds)",
] as const;

let _provider: ethers.JsonRpcProvider | null = null;
/** Shared read-only provider (no signer, no key). */
export function readProvider(): ethers.JsonRpcProvider {
  if (!_provider) _provider = new ethers.JsonRpcProvider(GALILEO.rpc);
  return _provider;
}

export function registryRead() {
  return new ethers.Contract(CONTRACTS.agentRegistry, REG_ABI as unknown as string[], readProvider());
}
export function outputRead() {
  return new ethers.Contract(CONTRACTS.outputNFT, OUT_ABI as unknown as string[], readProvider());
}
export function marketRead() {
  return new ethers.Contract(CONTRACTS.marketplace, MKT_ABI as unknown as string[], readProvider());
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
