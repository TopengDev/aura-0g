// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {FuseGenome} from "../src/FuseGenome.sol";

/// @dev Asserts the ON-CHAIN fusion derivation reproduces, BIT-FOR-BIT, the vectors emitted by the authoritative
///      off-chain generator (scratchpad/fuse-vectors/gen-vectors.mjs), which itself cross-checked ethers == viem
///      == cast. If these pass, the fuseSeed + the 8-locus child genome are recomputable IDENTICALLY across
///      ethers, viem, cast, AND Solidity - a juror verifies any child on-chain and a rigged child is impossible.
contract FuseGenomeTest is Test {
    // --- vectors (from gen-vectors.mjs; ethers == viem == cast) ---
    address constant FUSER = 0x0000000000000000000000000000000000000042;
    uint256 constant REQ = 42;
    bytes32 constant A_FP = 0x55f2e8c197e23f8f78cae12e4a70266a0821937425eb388dbae7cc60e0658b8b;
    bytes32 constant B_FP = 0x3c7f28f3ee12859ba72d458f6caf7ced48b5433da6903fcb34a002c6b33fab8c;
    bytes32 constant BH = 0xc3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3;
    bytes32 constant EXPECT_SEED = 0xd6ad21051b619d74fa7b5c2a0abab2dd47713692502107ef8898bfb2fd646a4c;

    function _genomeA() internal pure returns (uint16[8] memory g) { g = [uint16(0), 1, 2, 3, 4, 5, 6, 0]; }
    function _genomeB() internal pure returns (uint16[8] memory g) { g = [uint16(9), 7, 5, 6, 3, 2, 1, 4]; }
    function _expectedChild() internal pure returns (uint16[8] memory g) { g = [uint16(0), 1, 5, 6, 3, 2, 1, 0]; }

    /// The FUSION domain tags recompute on-chain to the exact bytes32 the off-chain generator used.
    function test_domainTagsMatchOffchain() public pure {
        assertEq(FuseGenome.DOMAIN_FUSE(), 0xc0ff70ec7b86376379139e55e8d4c9c7328a1a16abc2ed8705be11eaa9a8a4c4, "DOMAIN_FUSE");
        assertEq(FuseGenome.TAG_INHERIT(), 0x7b7137a4a0f7fd04246c1e054a72aafa8afb1c8c5988d13a67a5dbea18bd95fc, "TAG_INHERIT");
        assertEq(FuseGenome.TAG_MUTATE(), 0x53c8a35bc020bb21ab9cf726931dbcb14220889a5e0c2e981bececc6c25e4263, "TAG_MUTATE");
        assertEq(FuseGenome.TAG_ALLELE(), 0x6e6caa0fa86402fa9b1e20527283a7a4f7d8165c481b5032a4f807e819d2d372, "TAG_ALLELE");
    }

    /// The 6-field fuseSeed recomputes on-chain to the exact off-chain value (ethers == viem == cast == Solidity).
    function test_fuseSeedMatchesOffchain() public pure {
        assertEq(FuseGenome.fuseSeed(REQ, FUSER, A_FP, B_FP, BH), EXPECT_SEED, "fuseSeed mismatch");
    }

    /// The full 8-locus child genome recomputes on-chain to the exact off-chain allele vector.
    function test_childGenomeMatchesOffchain() public pure {
        bytes32 seed = FuseGenome.fuseSeed(REQ, FUSER, A_FP, B_FP, BH);
        uint16[8] memory child = FuseGenome.deriveChildGenome(_genomeA(), _genomeB(), seed, FuseGenome.poolSizes());
        uint16[8] memory expect = _expectedChild();
        for (uint256 i = 0; i < 8; i++) {
            assertEq(uint256(child[i]), uint256(expect[i]), string(abi.encodePacked("locus ", vm.toString(i))));
        }
    }

    /// A rigged child (any single allele hand-changed) FAILS the deterministic recompute -> rigging rejected.
    function test_riggedChildRejected() public pure {
        bytes32 seed = FuseGenome.fuseSeed(REQ, FUSER, A_FP, B_FP, BH);
        uint16[8] memory child = FuseGenome.deriveChildGenome(_genomeA(), _genomeB(), seed, FuseGenome.poolSizes());
        uint16[8] memory rigged = _expectedChild();
        rigged[0] = uint16(uint256(rigged[0]) + 1); // hand-pick a "better" palette allele
        bool anyDiff = false;
        for (uint256 i = 0; i < 8; i++) if (child[i] != rigged[i]) anyDiff = true;
        assertTrue(anyDiff, "a rigged genome must differ from the deterministic recompute");
    }

    /// ALLOW-REPEAT: the SAME pair with a DIFFERENT requestId yields a DIFFERENT child (siblings, not clones).
    function test_allowRepeat_differentChild() public pure {
        bytes32 seed42 = FuseGenome.fuseSeed(42, FUSER, A_FP, B_FP, BH);
        bytes32 seed43 = FuseGenome.fuseSeed(43, FUSER, A_FP, B_FP, BH);
        assertTrue(seed42 != seed43, "distinct requestId => distinct seed");
        uint16[8] memory child42 = FuseGenome.deriveChildGenome(_genomeA(), _genomeB(), seed42, FuseGenome.poolSizes());
        uint16[8] memory child43 = FuseGenome.deriveChildGenome(_genomeA(), _genomeB(), seed43, FuseGenome.poolSizes());
        // off-chain vector for reqId 43: [0,1,2,6,3,5,6,4]
        uint16[8] memory expect43 = [uint16(0), 1, 2, 6, 3, 5, 6, 4];
        bool anyDiff = false;
        for (uint256 i = 0; i < 8; i++) {
            assertEq(uint256(child43[i]), uint256(expect43[i]), "reqId43 child vector");
            if (child42[i] != child43[i]) anyDiff = true;
        }
        assertTrue(anyDiff, "sibling child must differ from the reqId-42 child");
    }

    /// A different FUSER (same everything else) yields a different seed (fuser-bound, no cross-fuser reuse).
    function test_fuserBoundSeed() public pure {
        bytes32 s1 = FuseGenome.fuseSeed(REQ, FUSER, A_FP, B_FP, BH);
        bytes32 s2 = FuseGenome.fuseSeed(REQ, address(0x43), A_FP, B_FP, BH);
        assertTrue(s1 != s2, "seed must be bound to the fuser");
    }

    /// Determinism: recomputing twice yields the identical seed + genome (no hidden state).
    function test_deterministicAcrossCalls() public pure {
        bytes32 s1 = FuseGenome.fuseSeed(REQ, FUSER, A_FP, B_FP, BH);
        bytes32 s2 = FuseGenome.fuseSeed(REQ, FUSER, A_FP, B_FP, BH);
        assertEq(s1, s2, "seed not deterministic");
        uint16[8] memory g1 = FuseGenome.deriveChildGenome(_genomeA(), _genomeB(), s1, FuseGenome.poolSizes());
        uint16[8] memory g2 = FuseGenome.deriveChildGenome(_genomeA(), _genomeB(), s2, FuseGenome.poolSizes());
        for (uint256 i = 0; i < 8; i++) assertEq(uint256(g1[i]), uint256(g2[i]), "genome not deterministic");
    }
}
