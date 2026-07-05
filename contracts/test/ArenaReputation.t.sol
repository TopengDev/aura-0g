// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArenaReputation} from "../src/ArenaReputation.sol";
import {IAuraRegistry} from "../src/IAuraRegistry.sol";

contract RepMockRegistry is IAuraRegistry {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 id, address o) external {
        owners[id] = o;
    }

    function ownerOf(uint256 id) external view returns (address) {
        return owners[id];
    }

    function royaltyBpsOf(uint256) external pure returns (uint16) {
        return 0;
    }
}

/// @dev Tier-2 rating-ladder anchor: Merkle-anchored off-chain Glicko-1, keyless verify, agent-keyed (follows
///      the iNFT), and NO emission (rank is a signal, never a mint).
contract ArenaReputationTest is Test {
    ArenaReputation rep;
    RepMockRegistry reg;

    address anchorer = makeAddr("anchorer");
    address owner = address(this);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    // a 2-leaf ladder: agent 101 -> (1500,80), agent 202 -> (1610,60)
    uint256 constant AG0 = 101;
    uint32 constant R0 = 1500;
    uint32 constant RD0 = 80;
    uint256 constant AG1 = 202;
    uint32 constant R1 = 1610;
    uint32 constant RD1 = 60;

    function setUp() public {
        reg = new RepMockRegistry();
        reg.setOwner(AG0, alice);
        rep = new ArenaReputation(address(reg), anchorer);
    }

    function _leaf(uint256 agentId, uint32 r, uint32 rd) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(agentId, r, rd))));
    }

    // OZ MerkleProof commutative hash (sorted pair).
    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _root() internal pure returns (bytes32) {
        return _hashPair(_leaf(AG0, R0, RD0), _leaf(AG1, R1, RD1));
    }

    function test_leafOf_matchesOffchainEncoding() public view {
        assertEq(rep.leafOf(AG0, R0, RD0), _leaf(AG0, R0, RD0), "leaf encoding");
    }

    function test_anchorAndVerify_validProofPasses() public {
        vm.prank(anchorer);
        rep.anchorSeason(1, _root());
        assertEq(rep.currentSeason(), 1);

        // proof for leaf0 is [leaf1]
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _leaf(AG1, R1, RD1);
        assertTrue(rep.verifyRating(1, AG0, R0, RD0, proof), "valid rating verifies");
    }

    function test_verify_tamperedRatingFails() public {
        vm.prank(anchorer);
        rep.anchorSeason(1, _root());
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _leaf(AG1, R1, RD1);
        // claim a higher (rigged) rating for the same agent -> proof fails
        assertFalse(rep.verifyRating(1, AG0, 1900, RD0, proof), "tampered rating rejected");
    }

    function test_verify_wrongSeasonReturnsFalse() public {
        vm.prank(anchorer);
        rep.anchorSeason(1, _root());
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _leaf(AG1, R1, RD1);
        assertFalse(rep.verifyRating(2, AG0, R0, RD0, proof), "unanchored season => false");
    }

    function test_anchor_ownerAlsoAllowed() public {
        // owner (this test) can also anchor
        rep.anchorSeason(5, _root());
        assertEq(rep.currentSeason(), 5);
    }

    function test_anchor_notAnchorerReverts() public {
        vm.prank(alice);
        vm.expectRevert("not anchorer");
        rep.anchorSeason(1, _root());
    }

    function test_anchor_emptyRootReverts() public {
        vm.prank(anchorer);
        vm.expectRevert("empty root");
        rep.anchorSeason(1, bytes32(0));
    }

    function test_anchor_monotonicSeason() public {
        vm.startPrank(anchorer);
        rep.anchorSeason(3, _root());
        vm.expectRevert("stale season");
        rep.anchorSeason(2, _root()); // cannot go backwards
        vm.stopPrank();
    }

    function test_currentHolder_followsTheINFT() public {
        // reputation is agent-keyed; its economic holder is the CURRENT owner of the agent
        assertEq(rep.currentHolderOf(AG0), alice, "holder = current agent owner");
        reg.setOwner(AG0, bob); // agent sold to bob
        assertEq(rep.currentHolderOf(AG0), bob, "rating follows the iNFT on transfer");
    }

    function test_setAnchorer_ownerOnly() public {
        vm.prank(alice);
        vm.expectRevert();
        rep.setAnchorer(alice);
        rep.setAnchorer(bob); // owner ok
        assertEq(rep.anchorer(), bob);
    }

    /// NO emission: the contract accepts NO value (no payable / receive / fallback). Rank is a signal, never a
    /// mint or a reward - so a washed rank can never pay out (the LooksRare lesson).
    function test_noEmission_rejectsValue() public {
        (bool ok,) = address(rep).call{value: 1 ether}("");
        assertFalse(ok, "reputation contract holds/moves no value (no emission on rank)");
    }
}
