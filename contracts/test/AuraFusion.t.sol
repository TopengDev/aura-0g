// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AuraFusion} from "../src/AuraFusion.sol";
import {FuseGenome} from "../src/FuseGenome.sol";
import {AuraINFT} from "../src/AuraINFT.sol";

/// @dev Test harness: overrides ONLY the blockhash source so a deterministic historical blockhash can be
///      injected (Foundry's bare EVM returns 0 for blockhash of a rolled-over block). Production AuraFusion
///      uses the real blockhash - unchanged.
contract AuraFusionHarness is AuraFusion {
    mapping(uint256 => bytes32) public mockBlockhash;

    constructor(address aura_, uint256 fee_, uint256 cd_) AuraFusion(aura_, fee_, cd_) {}

    function setBlockhash(uint256 blockNumber, bytes32 h) external {
        mockBlockhash[blockNumber] = h;
    }

    /// @dev Fully deterministic test double: returns ONLY the injected mock (0 if unset), so the
    ///      "blockhash unavailable" revert path is testable without depending on Foundry's blockhash quirks.
    function _blockhashOf(uint256 blockNumber) internal view override returns (bytes32) {
        return mockBlockhash[blockNumber];
    }
}

contract AuraFusionTest is Test {
    AuraINFT aura;
    AuraFusionHarness fusion;

    address fuser = makeAddr("fuser");
    address stranger = makeAddr("stranger");
    address feeSink = makeAddr("feeSink");
    address oracle = makeAddr("oracle");

    uint256 constant FEE = 0.01 ether;
    uint256 constant COOLDOWN = 1 days;

    bytes32 constant A_FP = 0x55f2e8c197e23f8f78cae12e4a70266a0821937425eb388dbae7cc60e0658b8b;
    bytes32 constant B_FP = 0x3c7f28f3ee12859ba72d458f6caf7ced48b5433da6903fcb34a002c6b33fab8c;

    uint256 parentA;
    uint256 parentB;

    function _gA() internal pure returns (uint16[8] memory g) { g = [uint16(0), 1, 2, 3, 4, 5, 6, 0]; }
    function _gB() internal pure returns (uint16[8] memory g) { g = [uint16(9), 7, 5, 6, 3, 2, 1, 4]; }

    function setUp() public {
        aura = new AuraINFT(oracle, "https://img/");
        fusion = new AuraFusionHarness(address(aura), FEE, COOLDOWN);
        fusion.setFeeSink(feeSink);
        vm.deal(fuser, 100 ether);
        vm.deal(stranger, 100 ether);

        // Mint two genesis parents to the fuser (permissionless mintAgent), with fixed fingerprints.
        parentA = aura.mintAgent(fuser, "NOKTURNE", A_FP, "encA", keccak256("dA"), keccak256("mA"), 500, 500, hex"01");
        parentB = aura.mintAgent(fuser, "SOLARA", B_FP, "encB", keccak256("dB"), keccak256("mB"), 500, 500, hex"01");

        // Anchor their genomes (as the owner = fuser) to make them fusable.
        vm.startPrank(fuser);
        fusion.registerGenesis(parentA, _gA());
        fusion.registerGenesis(parentB, _gB());
        vm.stopPrank();
    }

    // ------------------------------- genesis registration -------------------------------

    function test_registerGenesis_setsLineage() public view {
        AuraFusion.Lineage memory L = fusion.lineageOf(parentA);
        assertTrue(L.genomeSet, "genomeSet");
        assertEq(uint256(L.generation), 1, "genesis generation = 1");
        assertEq(uint256(L.breedCount), 0, "breedCount 0");
        assertEq(L.styleFingerprint, A_FP, "cached fingerprint");
        uint16[8] memory g = fusion.genomeOf(parentA);
        for (uint256 i = 0; i < 8; i++) assertEq(uint256(g[i]), uint256(_gA()[i]), "genome");
    }

    function test_registerGenesis_onlyOwner() public {
        uint256 id = aura.mintAgent(fuser, "X", keccak256("x"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"01");
        vm.prank(stranger);
        vm.expectRevert("not agent owner");
        fusion.registerGenesis(id, _gA());
    }

    function test_registerGenesis_rejectsOutOfRangeAllele() public {
        uint256 id = aura.mintAgent(fuser, "X", keccak256("x"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"01");
        uint16[8] memory bad = _gA();
        bad[0] = 12; // palette pool is 12 => valid indices 0..11
        vm.prank(fuser);
        vm.expectRevert("allele out of range");
        fusion.registerGenesis(id, bad);
    }

    function test_registerGenesis_onlyOnce() public {
        vm.prank(fuser);
        vm.expectRevert("genome already set");
        fusion.registerGenesis(parentA, _gA());
    }

    // ------------------------------- request gates -------------------------------

    function test_request_requiresOwnBothParents() public {
        // stranger owns neither
        vm.prank(stranger);
        vm.expectRevert("not owner of A");
        fusion.requestFusion{value: FEE}(parentA, parentB);
    }

    function test_request_selfFuseReverts() public {
        vm.prank(fuser);
        vm.expectRevert("self-fuse");
        fusion.requestFusion{value: FEE}(parentA, parentA);
    }

    function test_request_requiresGenomeSet() public {
        uint256 bare = aura.mintAgent(fuser, "BARE", keccak256("bare"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"01");
        vm.prank(fuser);
        vm.expectRevert("parent genome unset");
        fusion.requestFusion{value: FEE}(parentA, bare);
    }

    function test_request_feeTooLowReverts() public {
        vm.prank(fuser);
        vm.expectRevert("fee too low");
        fusion.requestFusion{value: FEE - 1}(parentA, parentB);
    }

    function test_request_overpayRefundedViaPull() public {
        vm.prank(fuser);
        fusion.requestFusion{value: FEE + 0.5 ether}(parentA, parentB);
        assertEq(fusion.pendingWithdrawals(fuser), 0.5 ether, "overpay credited");
    }

    function test_request_cooldownEnforced() public {
        vm.prank(fuser);
        fusion.requestFusion{value: FEE}(parentA, parentB);
        // second request immediately -> parent A on cooldown
        vm.prank(fuser);
        vm.expectRevert("A on cooldown");
        fusion.requestFusion{value: FEE}(parentA, parentB);
        // after cooldown -> allowed again
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(fuser);
        fusion.requestFusion{value: FEE}(parentA, parentB);
    }

    // ------------------------------- execute (happy path) -------------------------------

    function _doFusion(uint256 reqId, bytes32 bh) internal returns (uint256 childId) {
        // advance past the target block and inject the deterministic blockhash
        AuraFusion.Request memory r = _req(reqId);
        vm.roll(uint256(r.targetBlock) + 1);
        fusion.setBlockhash(r.targetBlock, bh);
        vm.prank(fuser);
        childId = fusion.executeFusion(
            reqId, "CHILD", keccak256("childFp"), "encChild", keccak256("dChild"), keccak256("mChild"), 300, 300, hex"02"
        );
    }

    function _req(uint256 reqId) internal view returns (AuraFusion.Request memory r) {
        (address f, uint256 pa, uint256 pb, uint64 tb, uint256 fee, bool ex, bool rf) = fusion.requests(reqId);
        r = AuraFusion.Request(f, pa, pb, tb, fee, ex, rf);
    }

    function test_execute_mintsChildWithDerivedGenomeAndLineage() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        bytes32 bh = keccak256("bh-1");
        uint256 childId = _doFusion(reqId, bh);

        // child is a REAL AuraINFT owned by + sealed to the fuser
        assertEq(aura.ownerOf(childId), fuser, "child owned by fuser");
        assertGt(aura.sealedKeyOf(childId).length, 0, "child has a real sealed key");

        // lineage: generation 2, parents [A,B], breedCount 0, genomeSet
        AuraFusion.Lineage memory L = fusion.lineageOf(childId);
        assertEq(uint256(L.generation), 2, "gen = max(1,1)+1");
        assertEq(L.parentA, parentA);
        assertEq(L.parentB, parentB);
        assertEq(uint256(L.breedCount), 0, "child breedCount 0");
        assertTrue(L.genomeSet, "child fusable");

        // the child genome equals the PUBLIC-INPUT recompute (juror path): fuseSeed(reqId, fuser, aFp, bFp, bh)
        bytes32 seed = FuseGenome.fuseSeed(reqId, fuser, A_FP, B_FP, bh);
        uint16[8] memory expect = FuseGenome.deriveChildGenome(_gA(), _gB(), seed, FuseGenome.poolSizes());
        uint16[8] memory got = fusion.genomeOf(childId);
        for (uint256 i = 0; i < 8; i++) assertEq(uint256(got[i]), uint256(expect[i]), "child genome recompute");

        // parents' breedCount rose to 1
        assertEq(uint256(fusion.breedCountOf(parentA)), 1, "A breedCount++");
        assertEq(uint256(fusion.breedCountOf(parentB)), 1, "B breedCount++");
    }

    function test_execute_feeAccruesToFeeSink() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        _doFusion(reqId, keccak256("bh-1"));
        assertEq(fusion.pendingWithdrawals(feeSink), FEE, "fee to sink");
        uint256 before = feeSink.balance;
        vm.prank(feeSink);
        fusion.withdraw();
        assertEq(feeSink.balance - before, FEE, "sink withdrew fee");
    }

    function test_execute_parentsPersist() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        _doFusion(reqId, keccak256("bh-1"));
        // parents NOT burned - still owned by the fuser
        assertEq(aura.ownerOf(parentA), fuser, "parent A persists");
        assertEq(aura.ownerOf(parentB), fuser, "parent B persists");
    }

    // ------------------------------- allow-repeat -------------------------------

    function test_allowRepeat_sameParentsDifferentChild() public {
        vm.prank(fuser);
        uint256 req1 = fusion.requestFusion{value: FEE}(parentA, parentB);
        uint256 child1 = _doFusion(req1, keccak256("bh-A"));

        // cooldown passes, fuse the SAME pair again with a different requestId + blockhash
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(fuser);
        uint256 req2 = fusion.requestFusion{value: FEE}(parentA, parentB);
        uint256 child2 = _doFusion(req2, keccak256("bh-B"));

        assertTrue(child1 != child2, "distinct child tokenIds");
        uint16[8] memory g1 = fusion.genomeOf(child1);
        uint16[8] memory g2 = fusion.genomeOf(child2);
        bool anyDiff = false;
        for (uint256 i = 0; i < 8; i++) if (g1[i] != g2[i]) anyDiff = true;
        assertTrue(anyDiff, "siblings, not clones (different genome)");
        // both are gen-2 children of the same pair
        assertEq(uint256(fusion.generationOf(child1)), 2);
        assertEq(uint256(fusion.generationOf(child2)), 2);
        assertEq(uint256(fusion.breedCountOf(parentA)), 2, "A used as parent twice");
    }

    function test_dynasty_gen3() public {
        // fuse A x B -> child (gen2), then child x A -> grandchild (gen3)
        vm.prank(fuser);
        uint256 req1 = fusion.requestFusion{value: FEE}(parentA, parentB);
        uint256 child = _doFusion(req1, keccak256("bh-1"));

        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(fuser);
        uint256 req2 = fusion.requestFusion{value: FEE}(child, parentB);
        uint256 grandchild = _doFusion(req2, keccak256("bh-2"));
        assertEq(uint256(fusion.generationOf(grandchild)), 3, "gen = max(2,1)+1 = 3");
    }

    // ------------------------------- execute gates -------------------------------

    function test_execute_onlyFuser() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        AuraFusion.Request memory r = _req(reqId);
        vm.roll(uint256(r.targetBlock) + 1);
        fusion.setBlockhash(r.targetBlock, keccak256("bh"));
        vm.prank(stranger);
        vm.expectRevert("not fuser");
        fusion.executeFusion(reqId, "C", keccak256("c"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"02");
    }

    function test_execute_beforeTargetBlockReverts() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        // do NOT roll -> target block not mined
        vm.prank(fuser);
        vm.expectRevert("target block not mined");
        fusion.executeFusion(reqId, "C", keccak256("c"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"02");
    }

    function test_execute_blockhashUnavailableReverts() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        AuraFusion.Request memory r = _req(reqId);
        vm.roll(uint256(r.targetBlock) + 1); // mined, but no mock blockhash set + bare EVM returns 0
        vm.prank(fuser);
        vm.expectRevert("target blockhash unavailable");
        fusion.executeFusion(reqId, "C", keccak256("c"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"02");
    }

    function test_execute_cannotRunTwice() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        _doFusion(reqId, keccak256("bh-1"));
        vm.prank(fuser);
        vm.expectRevert("request closed");
        fusion.executeFusion(reqId, "C", keccak256("c"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"02");
    }

    // ------------------------------- expiry / refund -------------------------------

    function test_refundExpired_afterHashWindow() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        AuraFusion.Request memory r = _req(reqId);
        // roll beyond the 256-block hash window with NO blockhash set -> expired
        vm.roll(uint256(r.targetBlock) + fusion.BLOCKHASH_WINDOW() + 1);
        vm.prank(fuser);
        fusion.refundExpiredFusion(reqId);
        assertEq(fusion.pendingWithdrawals(fuser), FEE, "fee refundable");
        // and it can't then be executed
        vm.prank(fuser);
        vm.expectRevert("request closed");
        fusion.executeFusion(reqId, "C", keccak256("c"), "e", keccak256("d"), keccak256("m"), 0, 0, hex"02");
    }

    function test_refundExpired_tooEarlyReverts() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        AuraFusion.Request memory r = _req(reqId);
        vm.roll(uint256(r.targetBlock) + 10); // still within the window
        vm.prank(fuser);
        vm.expectRevert("not expired");
        fusion.refundExpiredFusion(reqId);
    }

    // ------------------------------- keyless recompute view -------------------------------

    function test_fuseSeedOf_matchesLibrary() public {
        vm.prank(fuser);
        uint256 reqId = fusion.requestFusion{value: FEE}(parentA, parentB);
        AuraFusion.Request memory r = _req(reqId);
        bytes32 bh = keccak256("bh-view");
        vm.roll(uint256(r.targetBlock) + 1);
        fusion.setBlockhash(r.targetBlock, bh);
        bytes32 got = fusion.fuseSeedOf(reqId);
        bytes32 expect = FuseGenome.fuseSeed(reqId, fuser, A_FP, B_FP, bh);
        assertEq(got, expect, "fuseSeedOf keyless recompute");
    }
}
