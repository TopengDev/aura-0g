// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PersonhoodGate} from "../src/PersonhoodGate.sol";
import {AuraINFT} from "../src/AuraINFT.sol";

/// @dev Tier-3 personhood floor STUB: the two keyless 0G-native floors (hold-an-Aura + conviction-stake) are
///      real; the World-ID convenience tier is explicitly unimplemented this phase.
contract PersonhoodGateTest is Test {
    AuraINFT aura;
    PersonhoodGate gate;

    address holder = makeAddr("holder"); // will hold an Aura
    address staker = makeAddr("staker"); // will stake conviction
    address nobody = makeAddr("nobody"); // neither floor
    address oracle = makeAddr("oracle");

    uint256 constant MIN_CONVICTION = 0.02 ether;

    function setUp() public {
        aura = new AuraINFT(oracle, "https://img/");
        gate = new PersonhoodGate(address(aura), MIN_CONVICTION);
        vm.deal(staker, 10 ether);
        // holder holds one Aura
        aura.mintAgent(holder, "H", keccak256("h"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"01");
    }

    function test_floor1_holdAnAura() public view {
        assertTrue(gate.holdsAura(holder), "holder holds an Aura");
        assertFalse(gate.holdsAura(nobody), "nobody holds none");
    }

    function test_floor2_convictionStake() public {
        assertFalse(gate.meetsConviction(staker), "no stake yet");
        vm.prank(staker);
        gate.stakeConviction{value: MIN_CONVICTION}();
        assertTrue(gate.meetsConviction(staker), "meets floor after staking >= min");
    }

    function test_floor2_belowMinFails() public {
        vm.prank(staker);
        gate.stakeConviction{value: MIN_CONVICTION - 1}();
        assertFalse(gate.meetsConviction(staker), "below min => not met");
    }

    function test_isPerson_eitherFloor() public {
        assertTrue(gate.isPerson(holder), "aura-holder is a person");
        assertFalse(gate.isPerson(nobody), "no floor => not a person");
        vm.prank(staker);
        gate.stakeConviction{value: MIN_CONVICTION}();
        assertTrue(gate.isPerson(staker), "conviction-staker is a person");
    }

    function test_worldId_notImplementedThisPhase() public {
        assertFalse(gate.worldIdVerified(holder), "world-id always false this phase");
        uint256[8] memory proof;
        vm.expectRevert("world-id not implemented this phase");
        gate.registerWorldId(holder, 12345, proof);
    }

    function test_conviction_withdrawable() public {
        vm.startPrank(staker);
        gate.stakeConviction{value: 1 ether}();
        uint256 before = staker.balance;
        gate.withdrawConviction(0.4 ether);
        assertEq(staker.balance - before, 0.4 ether, "partial withdraw");
        assertEq(gate.convictionOf(staker), 0.6 ether, "remainder tracked");
        vm.stopPrank();
    }

    function test_conviction_withdrawTooMuchReverts() public {
        vm.startPrank(staker);
        gate.stakeConviction{value: 1 ether}();
        vm.expectRevert("bad amount");
        gate.withdrawConviction(2 ether);
        vm.stopPrank();
    }

    function test_setMinConviction_ownerOnly() public {
        vm.prank(staker);
        vm.expectRevert();
        gate.setMinConviction(1 ether);
        gate.setMinConviction(0.05 ether); // owner ok
        assertEq(gate.minConviction(), 0.05 ether);
    }

    function test_minConvictionZero_disablesFloor2() public {
        gate.setMinConviction(0);
        // with min 0, meetsConviction must NOT trivially pass for a zero-stake address
        assertFalse(gate.meetsConviction(nobody), "min 0 does not make everyone a person");
    }
}
