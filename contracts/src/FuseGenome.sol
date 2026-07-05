// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FuseGenome - PURE, on-chain-recomputable derivation of a FUSED child's 8-locus style genome.
/// @notice Ported from the proven pf-smoke prototype (600-fusion cross-lib determinism, 5/5 forge, bit-exact
///         across ethers + viem + Solidity). The cryptographic machinery is the SHIPPED gacha's anchored-keccak
///         seed + domain-separated per-index pick (server/src/aura/gacha.ts): a child allele vector any third
///         party recomputes from public inputs alone, so a rigged/hand-picked child is impossible.
///
///         AURA calls this FUSION (never "breeding"); the domain tags live in the AURA-FUSE-* namespace.
///
///         TWO layers, both PURE + independently recomputable:
///           1. fuseSeed(...)     the un-grindable per-fusion seed. A 6-field keccak binding the fuser + BOTH
///                                parents' style fingerprints + a FUTURE blockhash (commit-reveal on a future
///                                block), so neither the operator nor the fuser can grind toward a child.
///           2. deriveChildGenome the proven 8-locus Mendelian select + 5% provable mutation, VERBATIM the
///                                gacha per-dimension pick primitive: keccak256(abi.encode(seed, tag, i)) % size.
///
///         HONEST BOUNDARY (same as the shipped gacha/create-agent): the GENOME derivation is on-chain-exact
///         (this library); the child styleFingerprint = keccak(JCS(publicStyle)) stays an OFF-CHAIN step
///         (RFC-8785 canonicalization is impractical in Solidity), exactly like create-agent.ts. The heritable
///         DNA that must be un-riggable IS the genome, and it is fully on-chain-recomputable here.
library FuseGenome {
    uint256 internal constant N_LOCI = 8;
    /// @notice 5% per-locus provable mutation (the gacha rarity-roll threshold pattern: roll % 10000 < 500).
    uint256 internal constant MUTATION_BPS = 500;

    // --- Domain-separation tags (FUSION namespace). keccak of a static label so every abi.encode below is
    //     statically typed and therefore unambiguous to re-encode in any language (ethers/viem off-chain,
    //     Solidity on-chain). Versioned: never edit a tag string or reorder a pool without bumping the version. ---
    function DOMAIN_FUSE() internal pure returns (bytes32) { return keccak256(bytes("AURA-FUSE-v1")); }
    function TAG_INHERIT() internal pure returns (bytes32) { return keccak256(bytes("AURA-FUSE-inherit-v1")); }
    function TAG_MUTATE()  internal pure returns (bytes32) { return keccak256(bytes("AURA-FUSE-mutate-v1")); }
    function TAG_ALLELE()  internal pure returns (bytes32) { return keccak256(bytes("AURA-FUSE-allele-v1")); }

    /// @notice The canonical 8-locus pool sizes: palette(12), linework(8), texture(8), renderingModel(8),
    ///         motifVocab(10), compositionBias(8), lightBehavior(8), finish(6). The STYLE analog of the gacha's
    ///         12 SUBJECT pools; the allele index at each locus is taken modulo the pool size.
    function poolSizes() internal pure returns (uint16[N_LOCI] memory p) {
        p = [uint16(12), 8, 8, 8, 10, 8, 8, 6];
    }

    /// @notice The un-grindable per-fusion seed (Phase-1 spec):
    ///         keccak256(abi.encode(DOMAIN_FUSE, requestId, fuser, aFp, bFp, blockHash)).
    ///         Binds the fuser + BOTH parent fingerprints + a FUTURE blockhash, so the child is a deterministic
    ///         SURPRISE fixed only after the target block is mined (neither party can grind a favourable child).
    /// @param requestId strictly-unique per fusion (guarantees a distinct seed => siblings, not clones)
    /// @param fuser     the address performing the fusion (bound so a seed cannot be reused cross-fuser)
    /// @param aFp       parent A's on-chain styleFingerprint
    /// @param bFp       parent B's on-chain styleFingerprint
    /// @param blockHash the hash of the committed FUTURE block (learned only after commit; un-grindable)
    function fuseSeed(uint256 requestId, address fuser, bytes32 aFp, bytes32 bFp, bytes32 blockHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(DOMAIN_FUSE(), requestId, fuser, aFp, bFp, blockHash));
    }

    /// @dev The per-locus roll primitive: uint256(keccak256(abi.encode(seed, tag, i))). VERBATIM the gacha
    ///      per-dimension pick (gacha.ts subjectIndices / rarityRoll) - domain-separated, no bit-slicing bugs.
    function _roll(bytes32 seed, bytes32 tag, uint256 i) private pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, tag, i)));
    }

    /// @notice Mendelian 2-parent inheritance + provable 5% mutation. Deterministic + bit-exact with the
    ///         off-chain ethers + viem derivation (see FuseGenome.t.sol vectors). A juror recomputes a child
    ///         from public inputs and rejects any tampered allele.
    /// @param genomeA parent A's allele-index vector (length N_LOCI)
    /// @param genomeB parent B's allele-index vector (length N_LOCI)
    /// @param seed    the fuseSeed for this fusion
    /// @param pools   the per-locus pool sizes (poolSizes())
    function deriveChildGenome(
        uint16[N_LOCI] memory genomeA,
        uint16[N_LOCI] memory genomeB,
        bytes32 seed,
        uint16[N_LOCI] memory pools
    ) internal pure returns (uint16[N_LOCI] memory child) {
        for (uint256 i = 0; i < N_LOCI; i++) {
            uint256 parentBit = _roll(seed, TAG_INHERIT(), i) % 2; // 50/50 which parent
            uint16 inherited = parentBit == 0 ? genomeA[i] : genomeB[i];
            uint256 mutRoll = _roll(seed, TAG_MUTATE(), i) % 10000; // gacha rarity-roll pattern
            if (mutRoll < MUTATION_BPS) {
                child[i] = uint16(_roll(seed, TAG_ALLELE(), i) % pools[i]); // gacha subject-pick, VERBATIM
            } else {
                child[i] = inherited;
            }
        }
    }
}
