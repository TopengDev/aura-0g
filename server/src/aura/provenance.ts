// SERVER-ONLY. Assemble unforgeable provenance for an output - which agent, which model, the TEE
// attestation, the 0G storage root - read LIVE on-chain (v2 OutputNFT), enriched with the SQLite mint
// index where available. Ported + simplified from lib/aura/provenance.ts (re-backed on chain; the
// indexer enrichment is Phase 3).
import { ethers } from "ethers";
import { outputRead, registryRead, storageScanUrl } from "./contracts.js";
import { deriveRarity } from "./gacha.js";
import type { ProvenanceResponse } from "./types.js";

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const SAMPLE_PRICE = ethers.parseEther("1");

export async function getProvenance(tokenId: number): Promise<ProvenanceResponse | null> {
  const out = outputRead();
  const reg = registryRead();

  // provenanceOf gates the read; royaltyInfo depends only on tokenId (not the agentId), so fetch both in
  // parallel. royaltyReceiver is a display field -> its own catch keeps a royaltyInfo hiccup non-fatal
  // while provenanceOf still governs the null (token-not-found) result.
  let p: any;
  let royaltyReceiver: string = ethers.ZeroAddress;
  try {
    const [prov, royalty] = await Promise.all([
      out.provenanceOf(tokenId),
      out.royaltyInfo(tokenId, SAMPLE_PRICE).then((r: [string, bigint]) => r[0]).catch(() => ethers.ZeroAddress),
    ]);
    p = prov;
    royaltyReceiver = royalty;
  } catch {
    return null;
  }
  const creatorAgentId = Number(p.creatorAgentId);

  // getAgent + ownerOf both key on creatorAgentId -> independent, so Promise.all them (was serialized).
  let agentName = `agent#${creatorAgentId}`;
  let agentOwner = ethers.ZeroAddress;
  let modelAttestation = ZERO32;
  let styleFingerprint = ZERO32;
  let agentExists = false;
  try {
    const [a, owner] = await Promise.all([reg.getAgent(creatorAgentId), reg.ownerOf(creatorAgentId)]);
    agentOwner = owner;
    agentName = a.name;
    modelAttestation = a.modelAttestation;
    styleFingerprint = a.styleFingerprint;
    agentExists = true;
  } catch {
    /* agent missing - verification will flag it */
  }

  const imageOnChain = typeof p.imageRoot === "string" && p.imageRoot.length > 0;
  const teeAttestationPresent = p.teeAttestation && p.teeAttestation !== ZERO32;

  const summary =
    agentExists && teeAttestationPresent
      ? `Verified: ${agentName} · TEE-attested on 0G. Royalty -> ${royaltyReceiver}.`
      : "Partial: see verification.";

  // p.seed is the on-chain uint256 (ethers bigint). Keep FULL precision as a decimal string (a summon pull
  // seed is a full keccak that overflows JS number) and derive the provable rarity from it (legacy/small
  // seeds -> Common, no migration).
  const seedBig: bigint = typeof p.seed === "bigint" ? p.seed : BigInt(p.seed);
  const rarity = deriveRarity(seedBig);

  return {
    tokenId,
    onChain: {
      creatorAgentId,
      imageRoot: p.imageRoot,
      provenanceHash: p.provenanceHash,
      teeAttestation: p.teeAttestation,
      seed: seedBig.toString(),
    },
    rarity,
    agent: { agentId: creatorAgentId, name: agentName, owner: agentOwner, modelAttestation, styleFingerprint },
    verification: {
      agentExists,
      imageOnChain,
      teeAttestationPresent: Boolean(teeAttestationPresent),
      royaltyReceiver,
      summary,
    },
    links: { storageScan: storageScanUrl(p.imageRoot) },
  };
}
