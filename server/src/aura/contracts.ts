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

// AuraINFT (ERC-7857 de-mock): the proof-gated secure-transfer successor to AgentRegistry. Superset of
// REG_ABI: mintAgent gains bytes32 dataHash + bytes sealedKey; getAgent tuple gains bytes32 dataHash at
// index 3 (all readers here decode by NAMED field, so they are safe across the shift); adds the real
// oracle-verified transfer() + transferProofDigest + sealedKeyOf + oracle + usedProof; raw
// transferFrom/safeTransferFrom REVERT on-chain (spec-strict). Beneficiary-dynamic royaltyInfo (ERC2981).
export const INFT_ABI = [
  "function mintAgent(address to,string name,bytes32 styleFingerprint,string encBrainRoot,bytes32 dataHash,bytes32 modelAttestation,uint16 royaltyBps,uint16 creatorResaleBps,bytes sealedKey) returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function getAgent(uint256) view returns (tuple(string name,bytes32 styleFingerprint,string encBrainRoot,bytes32 dataHash,bytes32 modelAttestation,uint16 royaltyBps,uint16 styleVersion,uint16 creatorResaleBps))",
  "function royaltyBpsOf(uint256) view returns (uint16)",
  "function creatorResaleBpsOf(uint256) view returns (uint16)",
  "function agentCreator(uint256) view returns (address)",
  "function nextAgentId() view returns (uint256)",
  "function sealedKeyOf(uint256) view returns (bytes)",
  "function oracle() view returns (address)",
  "function usedProof(bytes32) view returns (bool)",
  "function royaltyInfo(uint256,uint256) view returns (address,uint256)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function getApproved(uint256) view returns (address)",
  "function setOracle(address)",
  "function transfer(address from,address to,uint256 tokenId,bytes newSealedKey,string newEncBrainRoot,bytes32 newDataHash,uint256 deadline,bytes proof)",
  "function transferProofDigest(address from,address to,uint256 tokenId,bytes newSealedKey,bytes32 newDataHash,uint256 deadline) view returns (bytes32)",
  "function updateBrain(uint256 agentId,string encBrainRoot,bytes32 dataHash,bytes sealedKey)",
  "event AgentMinted(uint256 indexed agentId,address indexed owner,string name,bytes32 styleFingerprint,uint16 royaltyBps,bytes32 modelAttestation,bytes32 dataHash)",
  "event BrainRekeyed(uint256 indexed agentId,string newEncRoot,bytes32 newDataHash,address indexed newOwner)",
  "event SealedKeyDelivered(uint256 indexed agentId,address indexed newOwner,bytes sealedKey,bytes32 sealedKeyHash)",
  "event OracleUpdated(address indexed oracle)",
] as const;

// OutputNFT v2: mintOutput gains bytes32 nonce + bytes attestationSig; provenanceOf tuple unchanged;
// NEW: authDigest (compute the EIP-712 digest), attestor, usedNonce.
export const OUT_ABI = [
  "function mintOutput(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,bytes32 nonce,bytes attestationSig) returns (uint256)",
  "function mintOutputVerified(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,bytes32 nonce,bytes attestationSig,string teeText,bytes teeSig) returns (uint256)",
  "function teeSigner() view returns (address)",
  "function setTeeSigner(address newSigner)",
  "function dataHashOf(uint256) view returns (bytes32)",
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
  "event OutputTeeVerified(uint256 indexed tokenId,uint256 indexed creatorAgentId,address teeSigner,bytes32 dataHash)",
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

// SummonEscrow (net-new): demand-pull commissioning. The runner (sponsor=attestor) watches Summoned,
// generates the TEE-attested output, then calls fulfill() to mint to the buyer + split the fee.
export const SUMMON_ABI = [
  "function summonPrice(uint256) view returns (uint256)",
  "function requests(uint256) view returns (address buyer,uint256 agentId,uint256 fee,uint64 deadline,bool settled)",
  "function nextRequestId() view returns (uint256)",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function platform() view returns (address)",
  "function platformBps() view returns (uint16)",
  "function FULFILL_WINDOW() view returns (uint256)",
  "function paused() view returns (bool)",
  "function setSummonPrice(uint256 agentId,uint256 price)",
  "function summon(uint256 agentId,uint256 maxPrice) payable returns (uint256)",
  "function fulfill(uint256 requestId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,bytes32 nonce,bytes attestationSig) returns (uint256)",
  "function refund(uint256 requestId)",
  "function withdraw()",
  "event SummonPriceSet(uint256 indexed agentId,address indexed owner,uint256 price)",
  "event Summoned(uint256 indexed requestId,uint256 indexed agentId,address indexed buyer,uint256 fee,uint64 deadline)",
  "event Fulfilled(uint256 indexed requestId,uint256 indexed agentId,address indexed buyer,uint256 tokenId,address agentOwner,uint256 ownerCut,uint256 platformFee)",
  "event Refunded(uint256 indexed requestId,address indexed buyer,uint256 fee)",
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
/** True when a fresh AuraINFT has been deployed + wired (CONTRACTS.auraINFT set). Gates the INFT flows. */
export function auraInftConfigured(): boolean {
  return typeof CONTRACTS.auraINFT === "string" && /^0x[0-9a-fA-F]{40}$/.test(CONTRACTS.auraINFT);
}
/**
 * The contract AGENTS live on: the REAL ERC-7857 AuraINFT once it is configured (post-cutover), else the
 * legacy AgentRegistry. ownerOf + royaltyBpsOf + nextAgentId + getAgent (decoded by NAMED field, so the
 * INFT tuple's extra dataHash is transparent) are all selector-compatible across the two, so EVERY
 * agent-IDENTITY read routes through here and flips ATOMICALLY with auraInftConfigured(). This is the single
 * lever that moves the reads + the memory ownerOf gate onto AuraINFT together with create/transfer (the
 * audit's atomic-cutover tripwire: reads, memory gate, indexer, web mint, transfers must all agree agents =
 * AuraINFT, or "create" breaks). Use this for agent identity; use registryRead() only for the legacy registry.
 */
export function agentsRead() {
  return auraInftConfigured() ? auraInftRead() : registryRead();
}
/** AuraINFT read-only (ownerOf, getAgent, sealedKeyOf, oracle, transferProofDigest, usedProof, royaltyInfo). */
export function auraInftRead() {
  if (!auraInftConfigured()) throw new Error("auraINFT not configured (set AURA_INFT_ADDR or deployed-v2.json auraINFT)");
  return new ethers.Contract(CONTRACTS.auraINFT, INFT_ABI as unknown as string[], readProvider());
}
/** AuraINFT bound to a SIGNER (owner/deployer) - used by deploy/e2e tooling, never by the user-args routes. */
export function auraInftWrite(signer: ethers.Signer) {
  if (!auraInftConfigured()) throw new Error("auraINFT not configured (set AURA_INFT_ADDR or deployed-v2.json auraINFT)");
  return new ethers.Contract(CONTRACTS.auraINFT, INFT_ABI as unknown as string[], signer);
}
export function outputRead() {
  return new ethers.Contract(CONTRACTS.outputNFT, OUT_ABI as unknown as string[], readProvider());
}
export function marketRead() {
  return new ethers.Contract(CONTRACTS.marketplace, MKT_ABI as unknown as string[], readProvider());
}
export function summonRead() {
  return new ethers.Contract(CONTRACTS.summonEscrow, SUMMON_ABI as unknown as string[], readProvider());
}
/** SummonEscrow bound to a SIGNER (the sponsor/runner) for fulfill() writes. */
export function summonWrite(signer: ethers.Signer) {
  return new ethers.Contract(CONTRACTS.summonEscrow, SUMMON_ABI as unknown as string[], signer);
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
