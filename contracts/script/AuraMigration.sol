// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AuraINFT} from "../src/AuraINFT.sol";

/// @title AuraMigration - re-mint one legacy AgentRegistry agent onto the real ERC-7857 AuraINFT.
/// @notice The load-bearing per-agent step of the cutover migration, factored out so the DEPLOY SCRIPT
///         (DeployCutover.s.sol) and the ATOMIC-COHERENCE TEST (DeployCutover.t.sol) exercise the EXACT
///         same logic (test-what-you-ship). It preserves the agent's identity (name, style fingerprint,
///         encrypted brain root, model attestation), its output royalty bps + creator-resale bps, and its
///         CURRENT owner, and - because a fresh AuraINFT assigns ids 1,2,3,... in mint order - re-minting
///         source ids in ascending order preserves the agentId (asserted by the caller).
///
///         BOOTSTRAP SEAL (honest bound): AuraINFT.mintAgent requires a per-owner sealedKey, which is an
///         ECIES ciphertext produced OFF-CHAIN against the owner's secp256k1 pubkey - a forge script cannot
///         compute it. The migration therefore mints with a deterministic, NON-EMPTY bootstrap seal + a
///         bootstrap dataHash; the server re-keys each (all-deployer-owned) catalog agent to its REAL
///         per-owner ECIES seal + sha256(envelope) dataHash via AuraINFT.updateBrain immediately after the
///         migration (the seller/owner already holds custody). Newly CREATED agents (post-cutover) get a
///         real per-owner seal at mint from create-agent.ts. This is strictly stronger than the status quo
///         (AgentRegistry had NO per-owner sealing at all).
library AuraMigration {
    /// @notice Re-mint `a` (a source AgentRegistry agent) onto `inft`, owned by `owner`, with a bootstrap seal.
    /// @return id the new AuraINFT agentId (equals the source id when the caller migrates in ascending order).
    function remint(AuraINFT inft, address owner, AgentRegistry.Agent memory a) internal returns (uint256 id) {
        // Deterministic, non-empty bootstrap seal + dataHash (both re-keyed to the real values server-side).
        bytes memory bootstrapSeal = abi.encodePacked(bytes4(0x53454544) /*"SEED"*/, a.styleFingerprint, owner);
        bytes32 bootstrapDataHash = keccak256(abi.encodePacked("aura-migrate:", a.encBrainRoot, a.styleFingerprint));
        id = inft.mintAgent(
            owner,
            a.name,
            a.styleFingerprint,
            a.encBrainRoot,
            bootstrapDataHash,
            a.modelAttestation,
            a.royaltyBps,
            a.creatorResaleBps,
            bootstrapSeal
        );
    }
}
