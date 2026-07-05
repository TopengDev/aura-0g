// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {AuraMarketplace} from "../src/AuraMarketplace.sol";
import {SummonEscrow} from "../src/SummonEscrow.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Shared deployment + EIP-712 signing helpers for the SummonEscrow suite. Mirrors AuraBase in
///      Aura.t.sol (same attestation-signing convention: authDigest -> vm.sign -> packed r,s,v).
abstract contract SummonBase is Test {
    AgentRegistry reg;
    OutputNFT outNft;
    AuraMarketplace mkt;
    SummonEscrow escrow;

    uint256 attestorPk = 0xA11CE; // == runner; the SummonEscrow attestor signer
    address attestor;
    uint256 forgerPk = 0xBAD;

    address platform = makeAddr("platform");
    address owner1 = makeAddr("owner1"); // the agent's owner (earns the summon cut + royalty)
    address owner2 = makeAddr("owner2"); // buys the agent later (income must follow)
    address buyer = makeAddr("buyer"); // the summoner
    address buyer2 = makeAddr("buyer2");
    address collector = makeAddr("collector"); // resale buyer
    address other = makeAddr("other");

    uint16 constant PLATFORM_BPS = 250; // 2.5% -> owner keeps 97.5%
    uint256 constant PRICE = 0.1 ether;

    // fixed (content-agnostic) mint fields; the gate only cares the attestor SIGNED over them.
    bytes32 constant PROV = keccak256("prov");
    bytes32 constant TEE = keccak256("tee");
    uint256 constant SEED = 42;
    string constant IMG = "0g://summon-image-root";

    function setUp() public virtual {
        attestor = vm.addr(attestorPk);
        reg = new AgentRegistry();
        outNft = new OutputNFT(address(reg), attestor, "https://aura.topengdev.com/images/"); // runner/attestor settles mints
        mkt = new AuraMarketplace(platform, PLATFORM_BPS);
        mkt.setAllowedCollection(address(outNft), true);
        escrow = new SummonEscrow(address(reg), address(outNft), platform, PLATFORM_BPS); // this test == owner
    }

    // --- agent + price helpers ---
    function _mintAgentTo(address to, uint16 outputBps) internal returns (uint256 id) {
        id = reg.mintAgent(to, "NOKTURNE", keccak256("style-dna"), "0g://enc-brain", keccak256("model:qwen"), outputBps, 1000);
    }

    function _setPrice(address agentOwner, uint256 agentId, uint256 price) internal {
        vm.prank(agentOwner);
        escrow.setSummonPrice(agentId, price);
    }

    function _summon(address from, uint256 agentId, uint256 value, uint256 maxPrice) internal returns (uint256 requestId) {
        vm.deal(from, from.balance + value);
        vm.prank(from);
        requestId = escrow.summon{value: value}(agentId, maxPrice);
    }

    // --- SETTLEMENT attestation signing (the escrow settles via mintForSettlement, which binds
    //     settler == the escrow). Signs over (to, settler=escrow, agentId, IMG, PROV, TEE, seed, nonce). ---
    function _sig(uint256 pk, address to, uint256 agentId, uint256 seed, bytes32 nonce) internal view returns (bytes memory) {
        bytes32 digest = outNft.settlementAuthDigest(to, address(escrow), agentId, IMG, PROV, TEE, seed, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Fulfill request `requestId` whose buyer==`to`, agent==`agentId`, signed by `pk`.
    function _fulfill(address caller, uint256 requestId, address to, uint256 agentId, uint256 seed, bytes32 nonce, uint256 pk)
        internal
        returns (uint256 tokenId)
    {
        bytes memory sig = _sig(pk, to, agentId, seed, nonce);
        vm.prank(caller);
        tokenId = escrow.fulfill(requestId, IMG, PROV, TEE, seed, nonce, sig);
    }

    // tuple accessors for the public `requests` getter: (buyer, agentId, fee, deadline, settled)
    function _req(uint256 id) internal view returns (address b, uint256 a, uint256 fee, uint64 dl, bool settled) {
        (b, a, fee, dl, settled) = escrow.requests(id);
    }
}

// ============================================================================
//  HAPPY PATH - the full demand-pull loop (ports the 16/16 smoke assertions)
// ============================================================================
contract SummonHappyPathTest is SummonBase {
    function test_FullSummonCycle_PayGenMintSplitResaleFollowRefund() public {
        // agent #1 NOKTURNE (7% output royalty) owned by owner1
        uint256 agentId = _mintAgentTo(owner1, 700);
        assertEq(reg.ownerOf(agentId), owner1, "agent minted to owner1");

        // owner1 prices it; buyer summons -> EXACTLY 0.1 escrowed
        _setPrice(owner1, agentId, PRICE);
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        (address rb, , uint256 fee, , bool settled) = _req(id);
        assertEq(rb, buyer, "request buyer");
        assertEq(fee, PRICE, "0.1 ETH escrowed");
        assertFalse(settled, "unsettled");
        assertEq(address(escrow).balance, PRICE, "escrow HOLDS the fee");

        // FORGED (non-attestor) attestation -> fulfill reverts, request stays unsettled (buyer protected)
        bytes memory forged = _sig(forgerPk, buyer, agentId, SEED, keccak256("n1"));
        vm.expectRevert(bytes("bad attestation"));
        escrow.fulfill(id, IMG, PROV, TEE, SEED, keccak256("n1"), forged);
        (, , , , bool s2) = _req(id);
        assertFalse(s2, "still unsettled after forged attempt");

        // VALID fulfill by the runner -> mints output to buyer + splits the fee
        uint256 tokenId = _fulfill(attestor, id, buyer, agentId, SEED, keccak256("n1"), attestorPk);
        assertEq(outNft.ownerOf(tokenId), buyer, "output minted to BUYER");
        assertEq(escrow.pendingWithdrawals(owner1), 0.0975 ether, "owner cut 97.5%");
        assertEq(escrow.pendingWithdrawals(platform), 0.0025 ether, "platform 2.5%");
        (, , , , bool s3) = _req(id);
        assertTrue(s3, "settled after fulfill");

        // owner1 withdraws the summon cut -> real ETH
        uint256 ob = owner1.balance;
        vm.prank(owner1);
        escrow.withdraw();
        assertEq(owner1.balance - ob, 0.0975 ether, "owner withdrew the cut");

        // RESALE through the marketplace -> EIP-2981 royalty (7%) routes LIVE to the agent owner
        vm.startPrank(buyer);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        vm.stopPrank();
        vm.deal(collector, 1 ether);
        vm.prank(collector);
        mkt.buy{value: 1 ether}(address(outNft), tokenId);
        assertEq(outNft.ownerOf(tokenId), collector, "resold to collector");
        assertEq(mkt.pendingWithdrawals(owner1), 0.07 ether, "resale royalty 7% -> agent owner");

        // SELL THE AGENT to owner2 -> the NEXT summon pays owner2 (income follows the agent)
        vm.prank(owner1);
        reg.transferFrom(owner1, owner2, agentId);
        assertEq(reg.ownerOf(agentId), owner2, "agent sold to owner2");
        _setPrice(owner2, agentId, PRICE);
        uint256 id2 = _summon(buyer, agentId, PRICE, PRICE);
        _fulfill(attestor, id2, buyer, agentId, SEED + 1, keccak256("n2"), attestorPk);
        assertEq(escrow.pendingWithdrawals(owner2), 0.0975 ether, "income FOLLOWED the agent to owner2");
        assertEq(escrow.pendingWithdrawals(owner1), 0, "old owner earns nothing on the new summon");

        // REFUND path: an unfulfilled summon refunds the buyer after the deadline
        uint256 id3 = _summon(buyer, agentId, PRICE, PRICE);
        vm.prank(buyer);
        vm.expectRevert(bytes("not yet expired"));
        escrow.refund(id3);
        (, , , uint64 dl3, ) = _req(id3);
        vm.warp(uint256(dl3) + 1);
        vm.prank(buyer);
        escrow.refund(id3);
        // buyer's pull balance = the refunded fee (buyer had no overpay across the run)
        assertEq(escrow.pendingWithdrawals(buyer), PRICE, "unfulfilled summon REFUNDED in full (anti-rug)");
    }

    function test_SummonedOutput_RoyaltyResolvesToCurrentAgentOwner() public {
        uint256 agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        uint256 tokenId = _fulfill(attestor, id, buyer, agentId, SEED, keccak256("r"), attestorPk);

        (address recv, uint256 amt) = outNft.royaltyInfo(tokenId, 1 ether);
        assertEq(recv, owner1, "royalty receiver = agent owner");
        assertEq(amt, 0.07 ether, "7% of sale price");
    }
}

// ============================================================================
//  PRICING - setSummonPrice access + lifecycle
// ============================================================================
contract SummonPricingTest is SummonBase {
    uint256 agentId;

    function setUp() public override {
        super.setUp();
        agentId = _mintAgentTo(owner1, 700);
    }

    function test_SetPrice_OnlyAgentOwner() public {
        vm.prank(other);
        vm.expectRevert(bytes("not agent owner"));
        escrow.setSummonPrice(agentId, PRICE);

        _setPrice(owner1, agentId, PRICE);
        assertEq(escrow.summonPrice(agentId), PRICE);
    }

    function test_Summon_NotSummonable_WhenPriceZero() public {
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(bytes("agent not summonable"));
        escrow.summon{value: PRICE}(agentId, PRICE);
    }

    function test_PriceChange_DoesNotAffectInflightRequest() public {
        _setPrice(owner1, agentId, PRICE);
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);

        // owner raises the price AFTER the buyer summoned
        _setPrice(owner1, agentId, 1 ether);

        // the in-flight request still escrowed (and splits) the ORIGINAL 0.1, not 1.0
        uint256 tokenId = _fulfill(attestor, id, buyer, agentId, SEED, keccak256("n"), attestorPk);
        assertEq(outNft.ownerOf(tokenId), buyer);
        assertEq(escrow.pendingWithdrawals(owner1), 0.0975 ether, "split uses the escrowed fee, not the new price");
    }

    function test_SetPrice_AfterAgentSold_OnlyNewOwner() public {
        _setPrice(owner1, agentId, PRICE);
        vm.prank(owner1);
        reg.transferFrom(owner1, owner2, agentId);

        // old owner can no longer price it
        vm.prank(owner1);
        vm.expectRevert(bytes("not agent owner"));
        escrow.setSummonPrice(agentId, 1 ether);

        // new owner can
        _setPrice(owner2, agentId, 0.2 ether);
        assertEq(escrow.summonPrice(agentId), 0.2 ether);
    }
}

// ============================================================================
//  PAYMENT - overpay refund + maxPrice slippage + sufficiency
// ============================================================================
contract SummonPaymentTest is SummonBase {
    uint256 agentId;

    function setUp() public override {
        super.setUp();
        agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
    }

    function test_Overpay_EscrowsExactlyPrice_RefundsRest() public {
        uint256 id = _summon(buyer, agentId, 0.15 ether, 0.15 ether); // pays 0.15 for a 0.1 summon
        (, , uint256 fee, , ) = _req(id);
        assertEq(fee, PRICE, "escrow holds EXACTLY the price");
        assertEq(escrow.pendingWithdrawals(buyer), 0.05 ether, "overpay credited to buyer (pull)");
        assertEq(address(escrow).balance, 0.15 ether, "contract holds escrow + the buyer's pull");

        // and the split is on the price, not msg.value
        _fulfill(attestor, id, buyer, agentId, SEED, keccak256("n"), attestorPk);
        assertEq(escrow.pendingWithdrawals(owner1), 0.0975 ether, "owner cut off the PRICE");

        uint256 bb = buyer.balance;
        vm.prank(buyer);
        escrow.withdraw();
        assertEq(buyer.balance - bb, 0.05 ether, "buyer withdrew the overpay");
    }

    function test_MaxPrice_SlippageGuard_Reverts() public {
        // owner front-runs the price up to 0.2; buyer's maxPrice 0.1 protects them
        _setPrice(owner1, agentId, 0.2 ether);
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(bytes("price exceeds max"));
        escrow.summon{value: 1 ether}(agentId, PRICE);
    }

    function test_MaxPrice_ExactlyAtMax_Ok() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE); // maxPrice == price
        (, , uint256 fee, , ) = _req(id);
        assertEq(fee, PRICE);
    }

    function test_InsufficientPayment_Reverts() public {
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(bytes("insufficient payment"));
        escrow.summon{value: 0.05 ether}(agentId, PRICE);
    }
}

// ============================================================================
//  FULFILL GUARDS - forged / tampered / replay / cross-request / nonexistent
// ============================================================================
contract SummonFulfillGuardsTest is SummonBase {
    uint256 agentId;

    function setUp() public override {
        super.setUp();
        agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
    }

    function test_ForgedSigner_Reverts() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        bytes memory sig = _sig(forgerPk, buyer, agentId, SEED, keccak256("n"));
        vm.expectRevert(bytes("bad attestation"));
        escrow.fulfill(id, IMG, PROV, TEE, SEED, keccak256("n"), sig);
    }

    function test_TamperedSeed_Reverts() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        // sign for seed=SEED but submit seed=SEED+1 -> recovered signer != attestor
        bytes memory sig = _sig(attestorPk, buyer, agentId, SEED, keccak256("n"));
        vm.expectRevert(bytes("bad attestation"));
        escrow.fulfill(id, IMG, PROV, TEE, SEED + 1, keccak256("n"), sig);
    }

    function test_NonceReplay_AcrossRequests_Reverts() public {
        uint256 id1 = _summon(buyer, agentId, PRICE, PRICE);
        uint256 id2 = _summon(buyer, agentId, PRICE, PRICE);
        bytes32 nonce = keccak256("shared");
        _fulfill(attestor, id1, buyer, agentId, SEED, nonce, attestorPk); // consumes the nonce in OutputNFT

        // reusing the same nonce on a different request -> OutputNFT "nonce used" bubbles up, fulfill reverts
        bytes memory sig = _sig(attestorPk, buyer, agentId, SEED, nonce);
        vm.expectRevert(bytes("nonce used"));
        escrow.fulfill(id2, IMG, PROV, TEE, SEED, nonce, sig);
        (, , , , bool settled) = _req(id2);
        assertFalse(settled, "id2 stays unsettled (buyer can still refund)");
    }

    function test_SigForRequestA_CannotFulfillRequestB() public {
        uint256 idA = _summon(buyer, agentId, PRICE, PRICE); // buyer
        uint256 idB = _summon(buyer2, agentId, PRICE, PRICE); // buyer2
        // a perfectly valid sig for A's buyer; replayed against B whose buyer differs
        bytes memory sigForA = _sig(attestorPk, buyer, agentId, SEED, keccak256("nA"));
        // fulfill(B,...) forwards r.buyer=buyer2 to mint; digest over buyer2 != signed digest -> revert
        vm.expectRevert(bytes("bad attestation"));
        escrow.fulfill(idB, IMG, PROV, TEE, SEED, keccak256("nA"), sigForA);
        idA; // (A intentionally left unfulfilled)
    }

    function test_NonexistentRequest_Reverts() public {
        bytes memory sig = _sig(attestorPk, buyer, agentId, SEED, keccak256("n"));
        vm.expectRevert(bytes("no such request"));
        escrow.fulfill(999, IMG, PROV, TEE, SEED, keccak256("n"), sig);
    }

    function test_DoubleFulfill_Reverts() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        _fulfill(attestor, id, buyer, agentId, SEED, keccak256("n1"), attestorPk);
        // a second fulfill (fresh nonce) must revert on the settled flag
        bytes memory sig = _sig(attestorPk, buyer, agentId, SEED, keccak256("n2"));
        vm.expectRevert(bytes("already settled"));
        escrow.fulfill(id, IMG, PROV, TEE, SEED, keccak256("n2"), sig);
    }
}

// ============================================================================
//  DEADLINE BOUNDARIES - fulfill <= deadline < refund (exact-edge)
// ============================================================================
contract SummonDeadlineTest is SummonBase {
    uint256 agentId;

    function setUp() public override {
        super.setUp();
        agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
    }

    function test_FulfillExactlyAtDeadline_Ok() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl)); // exactly at deadline: block.timestamp <= deadline holds
        uint256 tokenId = _fulfill(attestor, id, buyer, agentId, SEED, keccak256("n"), attestorPk);
        assertEq(outNft.ownerOf(tokenId), buyer, "fulfill ok at the exact deadline");
    }

    function test_FulfillPastDeadline_Reverts() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl) + 1);
        bytes memory sig = _sig(attestorPk, buyer, agentId, SEED, keccak256("n"));
        vm.expectRevert(bytes("request expired"));
        escrow.fulfill(id, IMG, PROV, TEE, SEED, keccak256("n"), sig);
    }

    function test_RefundAtDeadline_Reverts() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl)); // exactly at deadline: NOT yet > deadline
        vm.prank(buyer);
        vm.expectRevert(bytes("not yet expired"));
        escrow.refund(id);
    }

    function test_RefundPastDeadline_Ok() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl) + 1);
        vm.prank(buyer);
        escrow.refund(id);
        assertEq(escrow.pendingWithdrawals(buyer), PRICE);
    }
}

// ============================================================================
//  REFUND GUARDS - buyer-only + mutual exclusion with fulfill
// ============================================================================
contract SummonRefundTest is SummonBase {
    uint256 agentId;
    uint256 id;

    function setUp() public override {
        super.setUp();
        agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
        id = _summon(buyer, agentId, PRICE, PRICE);
    }

    function test_Refund_OnlyBuyer() public {
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl) + 1);
        vm.prank(other);
        vm.expectRevert(bytes("not buyer"));
        escrow.refund(id);
    }

    function test_RefundAfterFulfill_Reverts() public {
        _fulfill(attestor, id, buyer, agentId, SEED, keccak256("n"), attestorPk);
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl) + 1);
        vm.prank(buyer);
        vm.expectRevert(bytes("already settled"));
        escrow.refund(id);
    }

    function test_FulfillAfterRefund_Reverts() public {
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl) + 1);
        vm.prank(buyer);
        escrow.refund(id);
        // now fulfill must fail (settled), so the buyer can never get BOTH the NFT and the refund
        bytes memory sig = _sig(attestorPk, buyer, agentId, SEED, keccak256("n"));
        vm.expectRevert(bytes("already settled"));
        escrow.fulfill(id, IMG, PROV, TEE, SEED, keccak256("n"), sig);
    }

    function test_DoubleRefund_Reverts() public {
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl) + 1);
        vm.prank(buyer);
        escrow.refund(id);
        vm.prank(buyer);
        vm.expectRevert(bytes("already settled"));
        escrow.refund(id);
    }
}

// ============================================================================
//  FEE MATH - conservation, rounding, platformBps extremes
// ============================================================================
contract SummonFeeMathTest is SummonBase {
    function test_Conservation_OwnerPlusPlatform_EqualsFee() public {
        uint256 agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        _fulfill(attestor, id, buyer, agentId, SEED, keccak256("n"), attestorPk);
        assertEq(
            escrow.pendingWithdrawals(owner1) + escrow.pendingWithdrawals(platform),
            PRICE,
            "owner + platform == fee (value conserved, no dust lost)"
        );
    }

    function test_TinyFee_PlatformRoundsToZero_OwnerGetsAll() public {
        uint256 agentId = _mintAgentTo(owner1, 700);
        // price 3 wei * 250 / 10000 = 0 (rounds down) -> owner gets all 3 wei
        _setPrice(owner1, agentId, 3);
        uint256 id = _summon(buyer, agentId, 3, 3);
        _fulfill(attestor, id, buyer, agentId, SEED, keccak256("n"), attestorPk);
        assertEq(escrow.pendingWithdrawals(platform), 0, "platform fee rounds to 0 on a tiny fee");
        assertEq(escrow.pendingWithdrawals(owner1), 3, "owner gets the whole tiny fee");
    }

    function test_ZeroPlatformBps_AllToOwner() public {
        SummonEscrow z = new SummonEscrow(address(reg), address(outNft), platform, 0);
        uint256 agentId = _mintAgentTo(owner1, 700);
        vm.prank(owner1);
        z.setSummonPrice(agentId, PRICE);
        vm.deal(buyer, PRICE);
        vm.prank(buyer);
        uint256 id = z.summon{value: PRICE}(agentId, PRICE);
        bytes32 nonce = keccak256("z");
        // settler must be THIS escrow (z), since z.fulfill -> mintForSettlement binds settler == msg.sender
        bytes32 digest = outNft.settlementAuthDigest(buyer, address(z), agentId, IMG, PROV, TEE, SEED, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        vm.prank(attestor);
        z.fulfill(id, IMG, PROV, TEE, SEED, nonce, abi.encodePacked(r, s, v));
        assertEq(z.pendingWithdrawals(owner1), PRICE, "100% to owner when platformBps=0");
        assertEq(z.pendingWithdrawals(platform), 0);
    }
}

// ============================================================================
//  PAUSABLE - kill-switch on summon ONLY; fund paths NEVER trapped
// ============================================================================
contract SummonPausableTest is SummonBase {
    uint256 agentId;

    function setUp() public override {
        super.setUp();
        agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
    }

    function test_Pause_BlocksSummon() public {
        escrow.pause();
        vm.deal(buyer, PRICE);
        vm.prank(buyer);
        vm.expectRevert(); // EnforcedPause()
        escrow.summon{value: PRICE}(agentId, PRICE);
    }

    function test_Pause_DoesNotTrapFunds_FulfillRefundWithdrawStillWork() public {
        // two in-flight escrows BEFORE pausing
        uint256 idF = _summon(buyer, agentId, PRICE, PRICE);
        uint256 idR = _summon(buyer2, agentId, PRICE, PRICE);

        escrow.pause();

        // fulfill STILL works while paused (runner can deliver an in-flight commission)
        uint256 tokenId = _fulfill(attestor, idF, buyer, agentId, SEED, keccak256("nf"), attestorPk);
        assertEq(outNft.ownerOf(tokenId), buyer, "fulfill works while paused");
        // owner can WITHDRAW while paused
        vm.prank(owner1);
        escrow.withdraw();
        assertEq(escrow.pendingWithdrawals(owner1), 0, "withdraw works while paused");
        // buyer2 can REFUND the other escrow while paused (after the deadline)
        (, , , uint64 dl, ) = _req(idR);
        vm.warp(uint256(dl) + 1);
        vm.prank(buyer2);
        escrow.refund(idR);
        assertEq(escrow.pendingWithdrawals(buyer2), PRICE, "refund works while paused (funds never trapped)");
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(other);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        escrow.pause();
    }

    function test_Unpause_RestoresSummon() public {
        escrow.pause();
        escrow.unpause();
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        (, , uint256 fee, , ) = _req(id);
        assertEq(fee, PRICE, "summon restored after unpause");
    }
}

// ============================================================================
//  REENTRANCY - a malicious buyer re-enters during the mint callback
// ============================================================================
/// A buyer contract that, on receiving the minted output (onERC721Received fires inside fulfill's
/// _safeMint), tries to re-enter the escrow (withdraw / fulfill). The transient nonReentrant guard
/// (held by the in-flight fulfill) + the CEI settled-flag must block every re-entry. It overpays on
/// summon so it has a NONZERO pull balance - proving the GUARD blocks withdraw(), not an empty balance.
contract ReentrantSummoner is IERC721Receiver {
    SummonEscrow public escrow;
    uint256 public agentId;
    uint256 public requestId;
    bool public attempted;
    bool public withdrawReverted;
    bool public fulfillReverted;

    constructor(SummonEscrow escrow_) {
        escrow = escrow_;
    }

    function doSummon(uint256 agentId_, uint256 price) external payable {
        agentId = agentId_;
        // overpay by 0.01 so this contract holds a pull balance during the callback
        requestId = escrow.summon{value: msg.value}(agentId_, price + 0.01 ether);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!attempted) {
            attempted = true;
            // (1) re-enter withdraw() mid-fulfill -> guard must revert it (even with a nonzero balance)
            try escrow.withdraw() {
                withdrawReverted = false;
            } catch {
                withdrawReverted = true;
            }
            // (2) re-enter fulfill() on our own request -> guard + settled flag must revert it
            bytes memory empty = new bytes(65);
            try escrow.fulfill(requestId, "x", bytes32(0), bytes32(0), 0, bytes32(0), empty) {
                fulfillReverted = false;
            } catch {
                fulfillReverted = true;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

contract SummonReentrancyTest is SummonBase {
    function test_Reentrancy_BlockedDuringMintCallback() public {
        uint256 agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);

        ReentrantSummoner attacker = new ReentrantSummoner(escrow);
        vm.deal(address(attacker), 0.11 ether);
        attacker.doSummon{value: 0.11 ether}(agentId, PRICE); // escrows 0.1, 0.01 overpay -> pull balance
        uint256 id = attacker.requestId();

        // runner fulfills -> mints to the attacker -> its onERC721Received re-enters (and is blocked)
        bytes32 nonce = keccak256("re");
        bytes memory sig = _sig(attestorPk, address(attacker), agentId, SEED, nonce);
        vm.prank(attestor);
        uint256 tokenId = escrow.fulfill(id, IMG, PROV, TEE, SEED, nonce, sig);

        assertTrue(attacker.attempted(), "re-entry was attempted");
        assertTrue(attacker.withdrawReverted(), "re-entrant withdraw() blocked by the guard");
        assertTrue(attacker.fulfillReverted(), "re-entrant fulfill() blocked by guard + settled flag");

        // the outer fulfill completed correctly + exactly once (no double-spend)
        assertEq(outNft.ownerOf(tokenId), address(attacker), "outer fulfill minted to the attacker");
        assertEq(escrow.pendingWithdrawals(owner1), 0.0975 ether, "owner credited exactly once");
        assertEq(escrow.pendingWithdrawals(address(attacker)), 0.01 ether, "attacker's overpay intact (not drained twice)");

        // and the attacker can still legitimately withdraw its overpay AFTER the tx
        uint256 ab = address(attacker).balance;
        vm.prank(address(attacker));
        escrow.withdraw();
        assertEq(address(attacker).balance - ab, 0.01 ether, "overpay withdrawable post-fulfill");
    }
}

// ============================================================================
//  WITHDRAW + CONSTRUCTOR
// ============================================================================
contract SummonWithdrawTest is SummonBase {
    function test_Withdraw_NothingReverts() public {
        vm.prank(other);
        vm.expectRevert(bytes("nothing to withdraw"));
        escrow.withdraw();
    }

    function test_Withdraw_AccumulatedOverpayPlusRefund() public {
        uint256 agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
        // buyer overpays (0.05 pull) then lets it expire + refunds (0.1 pull) -> 0.15 total
        uint256 id = _summon(buyer, agentId, 0.15 ether, 0.15 ether);
        (, , , uint64 dl, ) = _req(id);
        vm.warp(uint256(dl) + 1);
        vm.prank(buyer);
        escrow.refund(id);
        assertEq(escrow.pendingWithdrawals(buyer), 0.15 ether, "overpay + refund accumulate");

        uint256 bb = buyer.balance;
        vm.prank(buyer);
        escrow.withdraw();
        assertEq(buyer.balance - bb, 0.15 ether, "single withdraw pays both");
    }
}

// ============================================================================
//  H-1 REGRESSION - front-run-fulfill griefing is now CLOSED (escrow-only settlement mint)
//  Audit finding H-1 (HIGH): mintOutput was permissionless + shared the settlement nonce, so a
//  mempool front-runner could call mintOutput directly with the runner's leaked sig, consume the
//  nonce, force fulfill() to revert "nonce used", and let the buyer refund after the deadline -
//  buyer keeps the art AND the money, owner+platform earn 0. The fix routes settlement through
//  mintForSettlement (settler==msg.sender bound in the sig, SEPARATE nonce namespace, DISTINCT
//  EIP-712 type). These tests assert every front-run variant now REVERTS and fulfill still settles.
// ============================================================================
contract SummonH1FrontRunRegressionTest is SummonBase {
    uint256 agentId;

    function setUp() public override {
        super.setUp();
        agentId = _mintAgentTo(owner1, 700);
        _setPrice(owner1, agentId, PRICE);
    }

    /// The EXACT H-1 exploit: a third-party griefer (or the buyer) takes the runner's settlement sig
    /// from the mempool and calls mintForSettlement DIRECTLY to consume the nonce. It must REVERT
    /// (settler binding: their msg.sender != the signed escrow), the settlement nonce must stay UNUSED,
    /// and the legitimate fulfill() must then still settle + pay the owner and platform.
    function test_H1_DirectFrontRunOfSettlementMint_Reverts_FulfillStillSettles() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        bytes32 nonce = keccak256("h1-frontrun");
        // the runner's settlement sig (bound to settler == address(escrow)); leaked in the public mempool.
        bytes memory runnerSig = _sig(attestorPk, buyer, agentId, SEED, nonce);

        // (a) third-party griefer front-runs by calling mintForSettlement directly -> settler=other != escrow.
        vm.prank(other);
        vm.expectRevert(bytes("bad attestation"));
        outNft.mintForSettlement(buyer, agentId, IMG, PROV, TEE, SEED, nonce, runnerSig);

        // (b) the buyer themselves tries the same self-grief -> also reverts.
        vm.prank(buyer);
        vm.expectRevert(bytes("bad attestation"));
        outNft.mintForSettlement(buyer, agentId, IMG, PROV, TEE, SEED, nonce, runnerSig);

        // the settlement nonce was NEVER consumed by the failed front-runs.
        assertFalse(outNft.usedSettlementNonce(nonce), "settlement nonce NOT pre-consumed by a front-run");

        // the legitimate runner now settles: art -> buyer, fee split -> owner + platform (H-1's broken promise restored).
        uint256 tokenId = _fulfill(attestor, id, buyer, agentId, SEED, nonce, attestorPk);
        assertEq(outNft.ownerOf(tokenId), buyer, "output minted to buyer via the gated settle path");
        assertEq(escrow.pendingWithdrawals(owner1), 0.0975 ether, "owner PAID 97.5% (was stiffed under H-1)");
        assertEq(escrow.pendingWithdrawals(platform), 0.0025 ether, "platform PAID 2.5%");
        assertTrue(outNft.usedSettlementNonce(nonce), "settlement nonce consumed exactly once, by fulfill");
        (, , , , bool settled) = _req(id);
        assertTrue(settled, "request settled");
    }

    /// The settlement sig cannot be re-routed through the still-permissionless mintOutput (direct-mint
    /// flow): different EIP-712 type => different digest => "bad attestation". The direct-mint nonce
    /// namespace (usedNonce) is also never touched, so it can't pre-consume the settlement.
    function test_H1_SettlementSigCannotRouteThroughPermissionlessMintOutput_Reverts() public {
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        bytes32 nonce = keccak256("h1-crosspath");
        bytes memory runnerSig = _sig(attestorPk, buyer, agentId, SEED, nonce);

        // feed the SETTLEMENT sig into the permissionless mintOutput -> rejected (wrong typehash/digest).
        vm.prank(other);
        vm.expectRevert(bytes("bad attestation"));
        outNft.mintOutput(buyer, agentId, IMG, PROV, TEE, SEED, nonce, runnerSig);

        // neither nonce namespace was consumed; fulfill still works.
        assertFalse(outNft.usedNonce(nonce), "direct-mint nonce namespace untouched");
        assertFalse(outNft.usedSettlementNonce(nonce), "settlement nonce namespace untouched");
        uint256 tokenId = _fulfill(attestor, id, buyer, agentId, SEED, nonce, attestorPk);
        assertEq(outNft.ownerOf(tokenId), buyer, "fulfill settles after the cross-path attempt failed");
        assertEq(escrow.pendingWithdrawals(owner1), 0.0975 ether, "owner paid");
    }

    /// The reverse direction stays isolated too: a legitimate DIRECT mintOutput (the public README's
    /// non-escrow flow) using nonce N does NOT block a settlement that happens to reuse value N, because
    /// the namespaces are separate. Proves the fix did not break the direct flow nor over-couple the two.
    function test_H1_DirectMintNonce_DoesNotBlockSettlement_SameNonceValue() public {
        bytes32 nonce = keccak256("shared-value");

        // a normal direct mint (the legitimate flow) consumes `nonce` in the DIRECT namespace.
        bytes32 dDigest = outNft.authDigest(collector, agentId, IMG, PROV, TEE, SEED, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, dDigest);
        vm.prank(collector);
        outNft.mintOutput(collector, agentId, IMG, PROV, TEE, SEED, nonce, abi.encodePacked(r, s, v));
        assertTrue(outNft.usedNonce(nonce), "direct nonce consumed");

        // a summon settlement reusing the SAME nonce VALUE still settles (separate namespace).
        uint256 id = _summon(buyer, agentId, PRICE, PRICE);
        uint256 tokenId = _fulfill(attestor, id, buyer, agentId, SEED, nonce, attestorPk);
        assertEq(outNft.ownerOf(tokenId), buyer, "settlement unaffected by the direct-mint nonce");
        assertEq(escrow.pendingWithdrawals(owner1), 0.0975 ether, "owner paid on settlement");
    }
}

contract SummonConstructorTest is SummonBase {
    function test_Constructor_RejectsZeroAddrs() public {
        vm.expectRevert(bytes("zero addr"));
        new SummonEscrow(address(0), address(outNft), platform, PLATFORM_BPS);
        vm.expectRevert(bytes("zero addr"));
        new SummonEscrow(address(reg), address(0), platform, PLATFORM_BPS);
    }

    function test_Constructor_RejectsZeroPlatform() public {
        vm.expectRevert(bytes("platform required"));
        new SummonEscrow(address(reg), address(outNft), address(0), PLATFORM_BPS);
    }

    function test_Constructor_RejectsPlatformBpsTooHigh() public {
        vm.expectRevert(bytes("platform bps too high"));
        new SummonEscrow(address(reg), address(outNft), platform, 1001);
    }
}
