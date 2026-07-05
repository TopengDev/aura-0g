// SERVER-ONLY. MEMORY ON-CHAIN ANCHOR (feat/aurainft-cutover). Commits an agent's 0G-Storage-embedded
// relationship-memory roots ON-CHAIN to its AuraINFT iNFT via updateBrain, so the ERC-7857 thesis leg
// ("the agent's intelligence + memory lives provably on 0G, embedded in the iNFT") is literally true
// ON-CHAIN, not just asserted. It closes the gap between feat/memory-0g-storage (which PINS sealed memory
// envelopes to 0G Storage) and the iNFT (which, pre-cutover, never referenced them).
//
// SAFE + ENV-GATED + OPT-IN (do NOT force live-server behavior):
//   - NEVER called from the live request path. It runs ONLY when MEMORY_0G_ANCHOR is enabled AND explicitly
//     invoked (the anchor script / a test), signed by the AGENT OWNER (updateBrain is owner-gated on-chain).
//   - It returns { ok:false, reason } instead of throwing on every not-applicable path (gate off, cutover not
//     deployed, not the owner, no embedded memory, no brain custody), so it is always safe to call.
//   - It does NOT drop the brain: the on-chain encBrainRoot is repointed to a COMPOSITE envelope embedding
//     BOTH the current brain root AND the memory roots + a commitment, so the agent's brain "grows" to include
//     its committed memory (the Living Agents thesis) with nothing lost. The server keeps full brain custody.
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { auraInftConfigured, auraInftWrite } from "./contracts.js";
import { verifyOwnerMemoryOn0G } from "./chat-memory.js";
import { brainByAgentId } from "./store.js";
import { zgBackend } from "./memory/zg-store.js";

/** OPT-IN: whether the on-chain memory anchor is enabled. Default OFF so nothing live-facing ever changes. */
export function memory0gAnchorEnabled(): boolean {
  const v = (process.env.MEMORY_0G_ANCHOR ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

export interface AnchorResult {
  ok: boolean;
  reason?: string;
  agentId: number;
  anchorRoot?: string; // the 0G root of the composite brain+memory envelope (the new on-chain encBrainRoot)
  memoryCommit?: string; // keccak256 over the embedded memory roots (the on-chain commitment)
  dataHash?: string; // sha256 of the composite envelope (== the on-chain dataHash written by updateBrain)
  memoryRoots?: string[];
  txHash?: string;
}

/**
 * Commit agent #agentId's embedded 0G memory roots on-chain to its AuraINFT iNFT via updateBrain, signed by
 * the agent OWNER (`ownerSigner`). Env-gated (MEMORY_0G_ANCHOR) + opt-in; safe to call anytime (returns
 * { ok:false, reason } when not applicable instead of throwing / mutating). Never invoked by the live server.
 */
export async function anchorOwnerMemoryOnChain(agentId: number, ownerSigner: ethers.Signer): Promise<AnchorResult> {
  if (!memory0gAnchorEnabled()) {
    return { ok: false, reason: "MEMORY_0G_ANCHOR disabled (opt-in; safe default off)", agentId };
  }
  if (!auraInftConfigured()) {
    return { ok: false, reason: "auraINFT not configured (the cutover is not deployed on this network)", agentId };
  }

  const owner = (await ownerSigner.getAddress()).toLowerCase();
  // Gather the caller-owner's EMBEDDED memory roots. verifyOwnerMemoryOn0G is itself ownerOf-gated + fail-closed,
  // and only returns roots for segments that were actually pinned to 0G (MEMORY_0G_PIN) + re-download-verified.
  const mem = await verifyOwnerMemoryOn0G(agentId, owner);
  if (mem.notOwner) return { ok: false, reason: "signer is not the current on-chain owner of this agent", agentId };
  if (mem.embedded === 0 || mem.roots.length === 0) {
    return { ok: false, reason: "no embedded 0G memory to anchor (enable MEMORY_0G_PIN + build memory first)", agentId };
  }

  const brain = brainByAgentId(agentId);
  if (!brain || !brain.sealedKey) {
    return { ok: false, reason: "no brain custody / sealed key for this agent on this backend", agentId };
  }

  // A deterministic, order-stable commitment over the embedded memory roots.
  const memoryCommit = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(mem.roots)));

  // COMPOSITE envelope: embed the CURRENT brain root + the memory roots + the commitment, so updateBrain's
  // repointing of encBrainRoot loses nothing (the brain grows to include its provably-embedded memory).
  const composite = Buffer.from(
    JSON.stringify({
      kind: "aura-brain+memory-anchor-v1",
      agentId,
      brainRoot: brain.encBrainRoot,
      memoryRoots: mem.roots,
      memoryCommit,
      ts: new Date().toISOString(),
    }),
  );
  const anchorRoot = await zgBackend("mem-anchor").store(composite);
  const dataHash = "0x" + createHash("sha256").update(composite).digest("hex");

  // Commit ON-CHAIN: updateBrain(agentId, encBrainRoot=anchorRoot, dataHash, sealedKey). Re-uses the owner's
  // EXISTING sealed key (the owner is unchanged, so the AES data-key + its ECIES seal are still valid), and
  // emits BrainUpdated -> the 0G memory anchor is now recorded on the agent's iNFT. Owner-signed (non-custodial).
  const tx = await auraInftWrite(ownerSigner).updateBrain(agentId, anchorRoot, dataHash, brain.sealedKey);
  const rcpt = await tx.wait();
  return { ok: true, agentId, anchorRoot, memoryCommit, dataHash, memoryRoots: mem.roots, txHash: rcpt?.hash };
}
