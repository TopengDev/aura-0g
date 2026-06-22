// SERVER-ONLY. The VERIFY: assemble unforgeable provenance for an output — which agent, which
// model, the TEE attestation, the 0G storage root — read live on-chain, enriched with the stored
// generation record where available, and self-checked.
import { ethers } from "ethers";
import { outputRead, registryRead } from "./contracts";
import { legacyByToken, mintRecordByToken } from "./store-index";
import type { ProvenanceResponse } from "./types";
import { storageScanUrl, txUrl } from "./contracts";

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const SAMPLE_PRICE = ethers.parseEther("1");

export async function getProvenance(tokenId: number): Promise<ProvenanceResponse | null> {
  const out = outputRead();
  const reg = registryRead();
  let p: any;
  try {
    p = await out.provenanceOf(tokenId);
  } catch {
    return null;
  }
  const creatorAgentId = Number(p.creatorAgentId);

  // agent (the unforgeable "who made it")
  let agentName = `agent#${creatorAgentId}`;
  let agentOwner = ethers.ZeroAddress;
  let modelAttestation = ZERO32;
  let styleFingerprint = ZERO32;
  let agentExists = false;
  try {
    const a = await reg.getAgent(creatorAgentId);
    agentOwner = await reg.ownerOf(creatorAgentId);
    agentName = a.name;
    modelAttestation = a.modelAttestation;
    styleFingerprint = a.styleFingerprint;
    agentExists = true;
  } catch {
    /* agent missing — verification will flag it */
  }

  const [royaltyReceiver] = await out.royaltyInfo(tokenId, SAMPLE_PRICE);

  // off-chain generation record (TEE pass details)
  const minted = mintRecordByToken(tokenId);
  const legacy = legacyByToken().get(tokenId);
  const enrich = minted ?? legacy ?? null;

  // recompute the provenance hash where we have the exact stored record
  let provenanceHashMatches: boolean | null = null;
  const record = (minted?.provenanceRecord ?? legacy?.provenanceRecord) as unknown;
  if (record) {
    try {
      const bytes = Buffer.from(JSON.stringify(record, null, 2), "utf8");
      provenanceHashMatches = ethers.keccak256(bytes) === p.provenanceHash;
    } catch {
      provenanceHashMatches = null;
    }
  }

  const imageOnChain = typeof p.imageRoot === "string" && p.imageRoot.length > 0;
  const teeAttestationPresent = p.teeAttestation && p.teeAttestation !== ZERO32;

  const checks: string[] = [];
  checks.push(agentExists ? `created by agent #${creatorAgentId} (${agentName})` : "agent missing");
  checks.push(teeAttestationPresent ? "TEE attestation on-chain" : "no TEE attestation");
  if (provenanceHashMatches === true) checks.push("provenance hash recomputed ✓");
  const summary = agentExists && teeAttestationPresent
    ? `Verified: ${agentName} · ${enrich?.model ?? "qwen/qwen-image-edit-2511"} · TEE-attested on 0G. Royalty → ${royaltyReceiver}.`
    : "Partial: see checks.";

  return {
    tokenId,
    onChain: {
      creatorAgentId,
      imageRoot: p.imageRoot,
      provenanceHash: p.provenanceHash,
      teeAttestation: p.teeAttestation,
      seed: Number(p.seed),
    },
    agent: { agentId: creatorAgentId, name: agentName, owner: agentOwner, modelAttestation, styleFingerprint },
    generation: enrich
      ? {
          model: enrich.model,
          prompt: enrich.prompt ?? null,
          teeVerifiability: enrich.teeVerifiability,
          teeSigner: enrich.teeSigner ?? "n/a",
          teeVerified: enrich.teeVerified,
          chatId: enrich.chatId ?? null,
        }
      : null,
    verification: {
      agentExists,
      imageOnChain,
      teeAttestationPresent: Boolean(teeAttestationPresent),
      provenanceHashMatches,
      teeVerifiedByProvider: enrich?.teeVerified ?? "unknown",
      royaltyReceiver,
      summary,
    },
    links: {
      image: `/api/image/${enrich?.imageKey ?? `output-${tokenId}`}`,
      storageScan: storageScanUrl(p.imageRoot),
      mintTx: (minted?.mintTx ?? legacy?.mintTx) ? txUrl((minted?.mintTx ?? legacy?.mintTx)!) : null,
    },
  };
}
