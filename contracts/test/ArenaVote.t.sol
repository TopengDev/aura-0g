// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ArenaVote} from "../src/ArenaVote.sol";
import {IAuraRegistry} from "../src/IAuraRegistry.sol";

/// @dev Minimal registry double for the same-owner self-match guard.
contract MockRegistry is IAuraRegistry {
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

/// @dev ArenaVote hardened-integrity + economics suite. Ports the proven 9/9 commit-reveal reject paths and
///      ADDS the diligence corrections: linear-weight sybil-neutrality, non-reveal slash + straddle-kill,
///      quorum gate, self-match revert, endogenous-pool solvency, and a from-events re-tally.
contract ArenaVoteTest is Test {
    ArenaVote av;
    uint256 constant QUORUM = 3;
    uint64 constant COMMIT_DUR = 1000;
    uint64 constant REVEAL_DUR = 1000;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    address eve = makeAddr("eve");

    function setUp() public {
        av = new ArenaVote(address(0), QUORUM); // no registry => self-match falls back to agentA != agentB
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(dave, 100 ether);
        vm.deal(eve, 100 ether);
    }

    function _newBattle() internal returns (uint256 id) {
        id = av.createBattle(101, 202, COMMIT_DUR, REVEAL_DUR);
    }

    function _commit(uint256 id, address who, uint8 choice, bytes32 salt, uint256 stake) internal {
        bytes32 c = keccak256(abi.encode(id, choice, salt, who));
        vm.prank(who);
        av.commit{value: stake}(id, c);
    }

    function _reveal(uint256 id, address who, uint8 choice, bytes32 salt) internal {
        vm.prank(who);
        av.reveal(id, choice, salt);
    }

    // =========================== L8: constructor quorum floor ===========================

    // L8: the constructor REJECTS a quorum < 2. quorum == 0 would RATE a zero-reveal battle (revealCount >= 0),
    //     whose non-reveal forfeit pool (F_BPS of the committed stake) has NO revealer to claim -> ~50% of the
    //     stake would lock in the contract; quorum == 1 lets a solo self-reveal confer a rated verdict (anti-wash
    //     defeat). The shipped default is 3, so live is safe; this proves the source hardening.
    function test_L8_ctor_rejectsQuorumBelowTwo() public {
        vm.expectRevert(bytes("quorum<2"));
        new ArenaVote(address(0), 0);
        vm.expectRevert(bytes("quorum<2"));
        new ArenaVote(address(0), 1);
        // quorum == 2 is the minimum accepted (>= 2 DISTINCT revealers for a rated verdict).
        ArenaVote ok2 = new ArenaVote(address(0), 2);
        assertEq(ok2.quorum(), 2, "quorum 2 accepted");
    }

    // =========================== ported 9/9 integrity ===========================

    function test_happyPath_linearWeightedWinner() public {
        uint256 id = _newBattle();
        // A: alice 3 + bob 2 = 5 (linear); B: carol 6 + dave 4 = 10 -> B wins
        _commit(id, alice, 1, "s1", 3 ether);
        _commit(id, bob, 1, "s2", 2 ether);
        _commit(id, carol, 2, "s3", 6 ether);
        _commit(id, dave, 2, "s4", 4 ether);

        vm.warp(block.timestamp + COMMIT_DUR + 1);
        _reveal(id, alice, 1, "s1");
        _reveal(id, bob, 1, "s2");
        _reveal(id, carol, 2, "s3");
        _reveal(id, dave, 2, "s4");

        ArenaVote.Battle memory bt = av.getBattle(id);
        assertEq(bt.weightA, 5 ether, "linear weightA = 3+2");
        assertEq(bt.weightB, 10 ether, "linear weightB = 6+4");

        vm.warp(block.timestamp + REVEAL_DUR + 1);
        av.finalize(id);
        assertEq(av.getBattle(id).winner, 2, "B wins on linear weight");
        assertTrue(av.getBattle(id).rated, "rated (4 >= quorum 3)");
    }

    function test_wrongSaltRevealReverts() public {
        uint256 id = _newBattle();
        _commit(id, alice, 1, "s1", 4 ether);
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        vm.prank(alice);
        vm.expectRevert("commitment mismatch");
        av.reveal(id, 1, "WRONG");
    }

    function test_choiceSubstitutionReverts() public {
        uint256 id = _newBattle();
        _commit(id, alice, 1, "s1", 4 ether); // committed to A(1)
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        vm.prank(alice);
        vm.expectRevert("commitment mismatch");
        av.reveal(id, 2, "s1"); // trying to reveal B(2)
    }

    function test_doubleCommitReverts() public {
        uint256 id = _newBattle();
        _commit(id, alice, 1, "s1", 4 ether);
        bytes32 c2 = keccak256(abi.encode(id, uint8(2), bytes32("s2"), alice));
        vm.prank(alice);
        vm.expectRevert("already committed");
        av.commit{value: 1 ether}(id, c2);
    }

    function test_doubleRevealReverts() public {
        uint256 id = _newBattle();
        _commit(id, alice, 1, "s1", 4 ether);
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        _reveal(id, alice, 1, "s1");
        vm.prank(alice);
        vm.expectRevert("already revealed");
        av.reveal(id, 1, "s1");
    }

    function test_commitAfterWindowReverts() public {
        uint256 id = _newBattle();
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        bytes32 c = keccak256(abi.encode(id, uint8(1), bytes32("s1"), alice));
        vm.prank(alice);
        vm.expectRevert("commit window closed");
        av.commit{value: 1 ether}(id, c);
    }

    function test_revealBeforeWindowReverts() public {
        uint256 id = _newBattle();
        _commit(id, alice, 1, "s1", 4 ether);
        vm.prank(alice);
        vm.expectRevert("not reveal window");
        av.reveal(id, 1, "s1");
    }

    function test_finalizeEarlyReverts() public {
        uint256 id = _newBattle();
        vm.expectRevert("reveal window not over");
        av.finalize(id);
    }

    function test_commitmentBindsBattleId_noCrossBattleReplay() public {
        uint256 id1 = _newBattle();
        uint256 id2 = _newBattle();
        // take alice's battle-1 commitment value and submit it into battle 2
        bytes32 c1 = av.commitmentFor(id1, 1, "s1", alice);
        vm.prank(alice);
        av.commit{value: 1 ether}(id2, c1);
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        // revealing (1,"s1") in battle 2 recomputes keccak(id2,...) != c1 -> mismatch (domain separated)
        vm.prank(alice);
        vm.expectRevert("commitment mismatch");
        av.reveal(id2, 1, "s1");
    }

    // =========================== self-match revert ===========================

    function test_selfMatch_sameAgentReverts() public {
        vm.expectRevert("self-match");
        av.createBattle(101, 101, COMMIT_DUR, REVEAL_DUR);
    }

    function test_selfMatch_sameOwnerReverts() public {
        MockRegistry reg = new MockRegistry();
        reg.setOwner(101, alice);
        reg.setOwner(202, alice); // same owner controls both sides
        ArenaVote av2 = new ArenaVote(address(reg), QUORUM);
        vm.expectRevert("same-owner self-match");
        av2.createBattle(101, 202, COMMIT_DUR, REVEAL_DUR);
    }

    function test_selfMatch_differentOwnersOk() public {
        MockRegistry reg = new MockRegistry();
        reg.setOwner(101, alice);
        reg.setOwner(202, bob);
        ArenaVote av2 = new ArenaVote(address(reg), QUORUM);
        uint256 id = av2.createBattle(101, 202, COMMIT_DUR, REVEAL_DUR);
        assertEq(id, 1, "distinct-owner battle allowed");
    }

    function test_createBattle_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(); // Ownable: not owner
        av.createBattle(101, 202, COMMIT_DUR, REVEAL_DUR);
    }

    // =========================== linear-weight sybil-neutrality ===========================

    /// One whale staking C produces the SAME weight as N sybils splitting C. Linear weight is sybil-neutral to
    /// splitting (the isqrt/sqrt hole would multiply the split by sqrt(N)); here the multiplier is exactly 1.
    function test_linearWeight_sybilNeutralToSplitting() public {
        // whale battle: alice alone stakes 10 ether on A
        uint256 idW = _newBattle();
        _commit(idW, alice, 1, "s", 10 ether);
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        _reveal(idW, alice, 1, "s");
        uint256 whaleWeightA = av.getBattle(idW).weightA;

        // sybil battle: 5 addresses each stake 2 ether on A (same total capital, split 5 ways)
        uint256 idS = av.createBattle(303, 404, COMMIT_DUR, REVEAL_DUR);
        address[5] memory sy = [makeAddr("s0"), makeAddr("s1"), makeAddr("s2"), makeAddr("s3"), makeAddr("s4")];
        for (uint256 i = 0; i < 5; i++) {
            vm.deal(sy[i], 10 ether);
            bytes32 c = keccak256(abi.encode(idS, uint8(1), bytes32("z"), sy[i]));
            vm.prank(sy[i]);
            av.commit{value: 2 ether}(idS, c);
        }
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(sy[i]);
            av.reveal(idS, 1, "z");
        }
        uint256 sybilWeightA = av.getBattle(idS).weightA;

        assertEq(whaleWeightA, 10 ether, "whale weight == capital");
        assertEq(sybilWeightA, 10 ether, "5-way split weight == same capital (NO sqrt(N) multiplier)");
        assertEq(whaleWeightA, sybilWeightA, "linear weight is sybil-neutral to identity splitting");
    }

    // =========================== quorum gate ===========================

    function test_quorumGate_belowQuorumIsUnrated_fullRefund() public {
        uint256 id = _newBattle();
        // only 2 revealers (< quorum 3)
        _commit(id, alice, 1, "s1", 3 ether);
        _commit(id, bob, 2, "s2", 5 ether);
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        _reveal(id, alice, 1, "s1");
        _reveal(id, bob, 2, "s2");
        vm.warp(block.timestamp + REVEAL_DUR + 1);
        av.finalize(id);

        ArenaVote.Battle memory bt = av.getBattle(id);
        assertFalse(bt.rated, "2 < quorum 3 => unrated");
        assertEq(bt.pool, 0, "no pool on unrated");

        // unrated => full refunds, NO slash even for the loser
        uint256 aBefore = alice.balance;
        vm.prank(alice);
        uint256 pa = av.claim(id);
        assertEq(pa, 3 ether, "loser refunded in full on unrated battle");
        assertEq(alice.balance - aBefore, 3 ether, "balance restored");
    }

    // =========================== non-reveal slash + straddle-kill ===========================

    /// The straddle-kill parameter invariant: F_BPS >= 2 * RHO_BPS (5000 >= 4000). This is what makes
    /// committing both sides + revealing only the winner strictly negative-EV.
    function test_straddleKillInvariant_params() public view {
        assertTrue(av.F_BPS() >= 2 * av.RHO_BPS(), "f >= 2*rho (straddle-kill)");
        assertEq(uint256(av.RHO_BPS()), 2000, "rho = 0.2 (gentle: art is subjective)");
        assertEq(uint256(av.F_BPS()), 5000, "f = 0.5");
    }

    function test_nonRevealSlash_forfeitsHalfIntoPool() public {
        uint256 id = _newBattle();
        // 3 revealers (meet quorum) + 1 non-revealer (eve)
        _commit(id, alice, 1, "s1", 4 ether);
        _commit(id, bob, 1, "s2", 4 ether);
        _commit(id, carol, 1, "s3", 4 ether);
        _commit(id, dave, 2, "s4", 6 ether);
        _commit(id, eve, 2, "s5", 10 ether); // eve commits on B but will NOT reveal (straddle-style withhold)

        vm.warp(block.timestamp + COMMIT_DUR + 1);
        _reveal(id, alice, 1, "s1");
        _reveal(id, bob, 1, "s2");
        _reveal(id, carol, 1, "s3");
        _reveal(id, dave, 2, "s4");
        // eve withholds

        vm.warp(block.timestamp + REVEAL_DUR + 1);
        av.finalize(id);
        ArenaVote.Battle memory bt = av.getBattle(id);
        // weightA = 12, weightB = 6 -> A wins; loserStake = 6; unrevealed = eve 10
        assertEq(bt.winner, 1, "A wins");
        assertTrue(bt.rated, "4 revealers >= quorum");
        // pool = rho*loser(6) + f*unrevealed(10) = 0.2*6 + 0.5*10 = 1.2 + 5 = 6.2 ether
        assertEq(bt.pool, 6.2 ether, "endogenous pool = rho*loser + f*unrevealed");

        // eve (non-revealer) claims (1-f)=50% back -> forfeits 5 ether into the pool (straddle-kill)
        uint256 eBefore = eve.balance;
        vm.prank(eve);
        uint256 pe = av.claim(id);
        assertEq(pe, 5 ether, "non-revealer forfeits f=50%");
        assertEq(eve.balance - eBefore, 5 ether, "50% of 10 ether back");
    }

    // =========================== endogenous pool + solvency ===========================

    function test_endogenousPool_exactSolvency_allClaims() public {
        uint256 id = _newBattle();
        // A losers: alice 3, bob 2 (weightA 5). B winners: carol 6, dave 4 (weightB 10). Non-revealer: eve 5.
        _commit(id, alice, 1, "s1", 3 ether);
        _commit(id, bob, 1, "s2", 2 ether);
        _commit(id, carol, 2, "s3", 6 ether);
        _commit(id, dave, 2, "s4", 4 ether);
        _commit(id, eve, 1, "s5", 5 ether);

        vm.warp(block.timestamp + COMMIT_DUR + 1);
        _reveal(id, alice, 1, "s1");
        _reveal(id, bob, 1, "s2");
        _reveal(id, carol, 2, "s3");
        _reveal(id, dave, 2, "s4");
        // eve withholds (unrevealed 5)

        vm.warp(block.timestamp + REVEAL_DUR + 1);

        uint256 committed = 20 ether;
        assertEq(address(av).balance, committed, "contract holds exactly the committed stake");

        av.finalize(id);
        ArenaVote.Battle memory bt = av.getBattle(id);
        assertEq(bt.winner, 2, "B wins (10 > 5)");
        // pool = 0.2*loser(5) + 0.5*unrevealed(5) = 1 + 2.5 = 3.5
        assertEq(bt.pool, 3.5 ether, "pool");

        // exact per-role payouts
        assertEq(_claim(id, carol), 8.1 ether, "winner carol: 6 + 3.5*6/10");
        assertEq(_claim(id, dave), 5.4 ether, "winner dave: 4 + 3.5*4/10");
        assertEq(_claim(id, alice), 2.4 ether, "loser alice: 0.8*3");
        assertEq(_claim(id, bob), 1.6 ether, "loser bob: 0.8*2");
        assertEq(_claim(id, eve), 2.5 ether, "non-revealer eve: 0.5*5");

        // constant-sum: every wei of committed stake is redistributed (no external subsidy, no insolvency)
        assertEq(address(av).balance, 0, "pool fully + exactly distributed from participant stakes alone");
    }

    function _claim(uint256 id, address who) internal returns (uint256 payout) {
        vm.prank(who);
        payout = av.claim(id);
    }

    function test_doubleClaimReverts() public {
        uint256 id = _oneWinnerBattle();
        vm.prank(carol);
        av.claim(id);
        vm.prank(carol);
        vm.expectRevert("already claimed");
        av.claim(id);
    }

    function test_claimBeforeFinalizeReverts() public {
        uint256 id = _newBattle();
        _commit(id, alice, 1, "s1", 1 ether);
        vm.prank(alice);
        vm.expectRevert("not finalized");
        av.claim(id);
    }

    // a small rated battle used by claim-guard tests
    function _oneWinnerBattle() internal returns (uint256 id) {
        id = _newBattle();
        _commit(id, alice, 1, "s1", 1 ether);
        _commit(id, bob, 1, "s2", 1 ether);
        _commit(id, carol, 2, "s3", 5 ether);
        _commit(id, dave, 2, "s4", 1 ether);
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        _reveal(id, alice, 1, "s1");
        _reveal(id, bob, 1, "s2");
        _reveal(id, carol, 2, "s3");
        _reveal(id, dave, 2, "s4");
        vm.warp(block.timestamp + REVEAL_DUR + 1);
        av.finalize(id);
    }

    // =========================== from-events re-tally (trustless) ===========================

    /// A 3rd party re-tallies the winner from the Revealed event log ALONE (choice + weight), and it MUST equal
    /// the contract's on-chain-enforced tally. This is the anti-SQLite-theater property, in-forge.
    function test_reTally_fromRevealedEventsMatchesOnChain() public {
        uint256 id = _newBattle();
        _commit(id, alice, 1, "s1", 3 ether);
        _commit(id, bob, 2, "s2", 5 ether);
        _commit(id, carol, 1, "s3", 4 ether);
        _commit(id, dave, 2, "s4", 1 ether);
        vm.warp(block.timestamp + COMMIT_DUR + 1);

        vm.recordLogs();
        _reveal(id, alice, 1, "s1");
        _reveal(id, bob, 2, "s2");
        _reveal(id, carol, 1, "s3");
        _reveal(id, dave, 2, "s4");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bytes32 sig = keccak256("Revealed(uint256,address,uint8,uint256,uint256)");
        uint256 tallyA;
        uint256 tallyB;
        uint256 counted;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != sig) continue;
            (uint8 choice,, uint256 weight) = abi.decode(logs[i].data, (uint8, uint256, uint256));
            if (choice == 1) tallyA += weight;
            else tallyB += weight;
            counted++;
        }
        assertEq(counted, 4, "re-tallied all 4 revealed ballots from the log");

        vm.warp(block.timestamp + REVEAL_DUR + 1);
        av.finalize(id);
        ArenaVote.Battle memory bt = av.getBattle(id);
        // independent event tally == contract-enforced tally == the winner
        assertEq(tallyA, bt.weightA, "event tally A == on-chain A");
        assertEq(tallyB, bt.weightB, "event tally B == on-chain B");
        uint8 reTallyWinner = tallyA > tallyB ? 1 : (tallyB > tallyA ? 2 : 0);
        assertEq(reTallyWinner, bt.winner, "re-tallied winner == contract winner");
        // weightA = 3+4 = 7, weightB = 5+1 = 6 -> A wins
        assertEq(bt.winner, 1, "A wins: 7 > 6");
    }

    // =========================== tie handling ===========================

    function test_ratedTie_refundsPlusPoolFromNonRevealers() public {
        uint256 id = _newBattle();
        // weightA == weightB (tie): alice 5 on A, bob 5 on B, carol 3 on A, dave 3 on B -> A=8,B=8
        _commit(id, alice, 1, "s1", 5 ether);
        _commit(id, bob, 2, "s2", 5 ether);
        _commit(id, carol, 1, "s3", 3 ether);
        _commit(id, dave, 2, "s4", 3 ether);
        _commit(id, eve, 1, "s5", 4 ether); // non-revealer
        vm.warp(block.timestamp + COMMIT_DUR + 1);
        _reveal(id, alice, 1, "s1");
        _reveal(id, bob, 2, "s2");
        _reveal(id, carol, 1, "s3");
        _reveal(id, dave, 2, "s4");
        vm.warp(block.timestamp + REVEAL_DUR + 1);
        av.finalize(id);
        ArenaVote.Battle memory bt = av.getBattle(id);
        assertEq(bt.winner, 0, "tie");
        assertTrue(bt.rated, "rated");
        // pool = f*unrevealed(4) only (no loser slash on a tie) = 2 ether
        assertEq(bt.pool, 2 ether, "tie pool = f*unrevealed");
        // revealed voters: stake back + pro-rata of pool by stake (revealedTotal = 16)
        // alice: 5 + 2*5/16 = 5.625
        assertEq(_claim(id, alice), 5 ether + (2 ether * 5) / 16, "tie: stake + pool share");
        assertEq(_claim(id, eve), 2 ether, "non-revealer (1-f)*4");
    }
}
