// SERVER-ONLY. GET /api/verify?token=<id> (alias ?id=) - the PUBLIC, KEYLESS, machine-readable provenance +
// verification surface. No wallet, no auth, read-only, fresh chain read every call. It ASSEMBLES existing
// reads (getProvenance + getRoyalty + OutputNFT.dataHashOf / teeSigner / ownerOf) into ONE JSON a skeptic can
// curl in ~10s and cross-check against the chain independently. ZERO contract change, ZERO data duplication.
//
// PATH (load-bearing): it MUST live under /api/ to be same-origin reachable on the main domain (prod nginx
// only proxies /api/* to the backend). A STATIC /api/verify wins over the /api/* indexer passthrough in
// find-my-way (static beats wildcard), so it intercepts BEFORE the request falls through to the Ponder proxy.
//
// HONEST DEGRADE: dataHashOf(token) is 0 for every token minted before the on-chain-TEE-verified path is armed
// (setTeeSigner + a fresh mintOutputVerified mint). When 0, Tier 2 (sha256 bound to the 0G enclave signer) is
// dormant + labeled "activates at the mainnet deploy"; Tier 1 (provenance + attestation + royalty, all keyless)
// is always served. The endpoint NEVER asserts sha256-binding for a token whose dataHash is 0.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ethers } from "ethers";
import { getProvenance } from "../aura/provenance.js";
import { getRoyalty } from "../aura/royalty.js";
import { outputRead, auraInftConfigured } from "../aura/contracts.js";
import { buildChecks } from "../aura/verify-checks.js";
import { isHiddenOutput } from "../aura/curation.js";
import {
  GALILEO,
  CONTRACTS,
  DEPLOYED,
  NETWORK_NAME,
  PUBLIC_WEB_ORIGIN,
  STORAGE_FILE_INFO_BASE,
  VERIFY_IMAGE_MODEL,
  VERIFY_IMAGE_COMPUTE_NETWORK,
  VERIFY_IMAGE_TEE_SIGNER_EXPECTED,
} from "../aura/config.js";

const ZERO32 = "0x" + "0".repeat(64);

/** Same numeric-id guard as routes/reads.ts (positive integer). */
function parseId(s: string | undefined): number | null {
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

export async function verifyPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/verify", async (req: FastifyRequest, reply: FastifyReply) => {
    reply.header("cache-control", "no-store"); // fresh chain read every call
    const q = req.query as Record<string, string | undefined>;
    const network = { chainId: GALILEO.chainId, name: NETWORK_NAME, explorer: GALILEO.explorer, rpc: GALILEO.rpc };

    const id = parseId(q.token ?? q.id);
    if (id === null) {
      return reply.code(400).send({ error: "token must be a positive integer (?token=<id>)", network });
    }

    // Curation mask: a hidden (superseded z-image) relic is masked to the SAME not-found body as a token that
    // never existed, so /api/verify can't mis-label a z-image relic under the advertised qwen provenance. This
    // shares the exact predicate the LIST feeds use (aura/curation.ts), so list + direct-read stay consistent.
    if (isHiddenOutput(id)) {
      return reply.code(404).send({ token: id, found: false, error: "no such Relic on-chain", network });
    }

    // provenanceOf gates existence; getRoyalty is a display tier (its own null is non-fatal).
    const [p, r] = await Promise.all([getProvenance(id), getRoyalty(id)]);
    if (!p) return reply.code(404).send({ token: id, found: false, error: "no such Relic on-chain", network });

    // The on-chain-TEE tier reads (all keyless view calls). Each has its own catch so one hiccup never
    // sinks the whole response - the provenance/royalty tier still serves.
    const out = outputRead();
    const [dataHashRaw, teeSignerRaw, ownerRaw] = await Promise.all([
      out.dataHashOf(id).catch(() => ZERO32),
      out.teeSigner().catch(() => ethers.ZeroAddress),
      out.ownerOf(id).catch(() => ethers.ZeroAddress),
    ]);
    const dataHash = String(dataHashRaw);
    const teeSigner = String(teeSignerRaw);
    const owner = String(ownerRaw);
    const onchainTeeVerified = !!dataHash && dataHash.toLowerCase() !== ZERO32;

    const checks = buildChecks(p, r, { onchainTeeVerified });

    // Config-driven so it flips testnet -> mainnet with no code edit (never hardcode a network URL/addr).
    const contract = CONTRACTS.outputNFT;
    const rpc = GALILEO.rpc;
    const explorer = GALILEO.explorer;
    const agentStandard: "erc7857" | "erc721" = auraInftConfigured() ? "erc7857" : "erc721";
    const agentContract = auraInftConfigured() ? CONTRACTS.auraINFT : CONTRACTS.agentRegistry;
    const imageUrl = `${PUBLIC_WEB_ORIGIN}/images/${p.onChain.imageRoot}`;

    // The COPY-PASTE self-check script (no wallet, ~10s). Pure commands (no inline comments) so a copy is
    // paste-ready; the "== X" targets ride in `image.sha256Expected` / `onchain.teeSignerExpected` / `royalty`.
    const selfCheck = {
      provenance: `curl -s ${PUBLIC_WEB_ORIGIN}/api/verify?token=${id}`,
      onchainProvenance: `cast call ${contract} 'provenanceOf(uint256)' ${id} --rpc-url ${rpc}`,
      royalty: `cast call ${contract} 'royaltyInfo(uint256,uint256)' ${id} 1000000000000000000 --rpc-url ${rpc}`,
      agentOwner: `cast call ${agentContract} 'ownerOf(uint256)' ${p.onChain.creatorAgentId} --rpc-url ${rpc}`,
      storageProof: `${STORAGE_FILE_INFO_BASE}/${p.onChain.imageRoot}`,
      imageHash: `curl -sL ${imageUrl} | sha256sum`,
      teeSigner: `cast call ${contract} 'teeSigner()' --rpc-url ${rpc}`,
      explorer: `${explorer}/token/${contract}?a=${id}`,
    };

    // Two honest tiers, chosen by onchainTeeVerified. Tier 1 is always live + keyless; Tier 2 lights up only
    // for an armed mintOutputVerified mint (dataHash != 0), else it is labeled dormant, never asserted.
    const tiers = {
      tier1: {
        label: "Provenance + attestation + royalty",
        keyless: true,
        active: true,
        checks: ["provenance", "onchainProvenance", "royalty", "agentOwner", "storageProof"] as const,
      },
      tier2: {
        label: "On-chain TEE-verified (sha256 bound to the 0G enclave signer)",
        keyless: true,
        active: onchainTeeVerified,
        note: onchainTeeVerified
          ? "armed: this Relic was minted through mintOutputVerified; dataHash is the on-chain sha256 the 0G enclave attested, and teeSigner() equals the 0G-published enclave signer."
          : "activates at the mainnet deploy: after setTeeSigner + a fresh mintOutputVerified mint, `curl image | sha256sum` equals dataHashOf(token) and teeSigner() equals the 0G-published enclave signer.",
        checks: ["imageHash", "teeSigner"] as const,
      },
    };

    const trustBoundaries = [
      `attestor == platform == deployer == one key (${DEPLOYED.attestor}) - a disclosed single-platform trust boundary`,
      `the image-gen TEE runs on ${VERIFY_IMAGE_COMPUTE_NETWORK}; the contracts, on-chain verify and marketplace run on ${NETWORK_NAME}`,
      onchainTeeVerified
        ? "dataHash is the on-chain sha256 the 0G enclave attested at mint; teeSigner is the pinned 0G enclave signer"
        : "dataHash is 0 for this token: the on-chain sha256-bound-to-0G-signer tier activates only for mintOutputVerified mints after setTeeSigner is armed. Verification here is the provenance + attestation + royalty tier (all keyless).",
      "the raw TEE envelope (teeText/teeSig) is transient + owner-gated; the keyless proof anchors on the on-chain dataHash + pinned teeSigner - the mint itself already ecrecovered the enclave signature and reverts on forgery",
      agentStandard === "erc7857"
        ? "agents are real ERC-7857 iNFTs (AuraINFT configured): ownership moves only through a proof-gated sealed transfer, and raw ERC-721 transfer reverts"
        : "agents currently trade as ERC-721 on AgentRegistry; the real ERC-7857 AuraINFT cutover is staged (not yet configured on this deploy)",
    ];

    return {
      token: id,
      found: true,
      network,
      contract,
      onchain: {
        owner,
        creatorAgentId: p.onChain.creatorAgentId,
        agentName: p.agent.name,
        agentOwner: p.agent.owner,
        imageRoot: p.onChain.imageRoot,
        provenanceHash: p.onChain.provenanceHash,
        teeAttestation: p.onChain.teeAttestation,
        seed: p.onChain.seed,
        rarity: p.rarity,
        dataHash,
        teeSigner,
        teeSignerExpected: VERIFY_IMAGE_TEE_SIGNER_EXPECTED,
        onchainTeeVerified,
      },
      image: {
        url: imageUrl,
        sha256Expected: onchainTeeVerified ? dataHash.replace(/^0x/, "") : null,
      },
      royalty: r
        ? {
            standard: "EIP-2981",
            pct: r.royaltyPct,
            bps: r.royaltyBps,
            receiver: r.receiver,
            receiverIsAgentOwner: r.receiverIsAgentOwner,
          }
        : null,
      model: {
        name: VERIFY_IMAGE_MODEL,
        verifiability: "TeeML",
        computeNetwork: VERIFY_IMAGE_COMPUTE_NETWORK,
        teeSigner: VERIFY_IMAGE_TEE_SIGNER_EXPECTED,
      },
      agent: { standard: agentStandard, contract: agentContract, owner: p.agent.owner },
      verify: { ok: checks.every((c) => c.ok), checks, summary: p.verification.summary },
      selfCheck,
      tiers,
      trustBoundaries,
      generatedAt: new Date().toISOString(),
    };
  });
}
