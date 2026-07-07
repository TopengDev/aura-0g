// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// M1 (marketplace) - the COMPOSED end-to-end tests the audit flagged as missing, on the PRODUCTION wiring
// (agents on the REAL ERC-7857 AuraINFT, Relics on OutputNFT bound to it):
//   c) a full Relic list -> buy() that asserts the EIP-2981 royalty actually PAYS the creating agent's CURRENT
//      owner (the living-agents royalty rail, settled through the marketplace), including the royalty FOLLOWING
//      a secure agent transfer;
//   d) an AuraINFT (agent) listing + buy() REVERTS atomically (spec-strict ERC-7857) - documenting the
//      intentional block: agents are NOT marketplace-tradable, even when allowlisted (the harmless live no-op).
//      Agent resale is Flow B, the server-custodian secure transfer (AuraINFT.transfer() + oracle re-encryption
//      proof), never a generic buy() (ERC-7857 cannot use one).
//
// The pre-existing Aura.t.sol marketplace tests trade the AgentRegistry stub (which PERMITS raw transfers), so
// they never exercised the AuraINFT transfer-revert. These tests close that gap on the real registry.
import {Test} from "forge-std/Test.sol";
import {AuraINFT} from "../src/AuraINFT.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {AuraMarketplace} from "../src/AuraMarketplace.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract AuraMarketplaceRelicTest is Test {
    using MessageHashUtils for bytes32;

    AuraINFT inft;
    OutputNFT outNft;
    AuraMarketplace mkt;

    uint256 oraclePk = 0x0AAC1E; // ERC-7857 re-encryption oracle (ECDSA signer)
    uint256 attestorPk = 0xA11CE; // OutputNFT MintAuth attestor
    address oracle;
    address attestor;
    address platform = makeAddr("platform");

    address creator = makeAddr("creator"); // ORIGINAL agent owner -> the Relic royalty receiver
    address collector = makeAddr("collector"); // owns/lists the Relic; NEVER the royalty receiver
    address buyer = makeAddr("buyer");
    address newOwner = makeAddr("newOwner"); // takes the AGENT via a secure transfer (royalty follows)

    uint16 constant PLATFORM_BPS = 250; // 2.5%
    uint16 constant OUTPUT_BPS = 700; // 7% Relic (output) royalty
    uint16 constant RESALE_BPS = 1000; // 10% agent-resale royalty
    string constant IMAGE_BASE = "https://aura.topengdev.com/images/";

    bytes sealedToCreator = hex"01020304";
    bytes sealedToNew = hex"0a0b0c0d0e";
    bytes32 constant DATA0 = keccak256("envelope-v0");
    bytes32 constant DATA1 = keccak256("envelope-v1");

    uint256 agentId;

    function setUp() public {
        oracle = vm.addr(oraclePk);
        attestor = vm.addr(attestorPk);

        // Production shape: agents on the REAL ERC-7857 AuraINFT; OutputNFT bound to it (immutable registry).
        inft = new AuraINFT(oracle, IMAGE_BASE);
        outNft = new OutputNFT(address(inft), attestor, IMAGE_BASE);
        mkt = new AuraMarketplace(platform, PLATFORM_BPS);
        // Relics-only (mirrors the corrected DeployCutover): agents are Flow B, not marketplace-traded.
        mkt.setAllowedCollection(address(outNft), true);

        vm.prank(creator);
        agentId = inft.mintAgent(
            creator, "NOKTURNE", keccak256("style-dna"), "0g://enc-brain-v0", DATA0, keccak256("model:qwen"), OUTPUT_BPS, RESALE_BPS, sealedToCreator
        );
    }

    // ---- helpers ----
    function _authSig(address to, bytes32 nonce) internal view returns (bytes memory) {
        bytes32 digest = outNft.authDigest(to, agentId, "0g://img", keccak256("prov"), keccak256("tee"), 42, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mintRelic(address to, bytes32 nonce) internal returns (uint256) {
        return outNft.mintOutput(to, agentId, "0g://img", keccak256("prov"), keccak256("tee"), 42, nonce, _authSig(to, nonce));
    }

    // ERC-7857 secure transfer of the agent (oracle-signed re-encryption proof). Mirrors CutoverSmoke.t.sol.
    function _secureTransferAgent(address from, address to, bytes memory newSealed, bytes32 newData) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest =
            keccak256(abi.encodePacked(block.chainid, address(inft), agentId, from, to, keccak256(newSealed), newData, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, MessageHashUtils.toEthSignedMessageHash(digest));
        vm.prank(from);
        inft.transfer(from, to, agentId, newSealed, "0g://enc-brain-v1", newData, deadline, abi.encodePacked(r, s, v));
    }

    function _listAndBuyRelic(uint256 relic, address seller, uint256 price) internal {
        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), relic, price);
        vm.stopPrank();
        vm.deal(buyer, price);
        vm.prank(buyer);
        mkt.buy{value: price}(address(outNft), relic);
    }

    // ================ M1(c): composed Relic list + buy pays the creating agent's owner ================
    function test_M1c_RelicListBuy_RoyaltyPaysCreatorAgentOwner() public {
        uint256 relic = _mintRelic(collector, keccak256("n1"));

        // sanity: EIP-2981 on the Relic resolves to the agent's CURRENT owner (creator), NOT the Relic owner.
        (address recv, uint256 amt) = outNft.royaltyInfo(relic, 1 ether);
        assertEq(recv, creator, "EIP-2981 receiver = the creating agent's owner (creator)");
        assertEq(amt, 0.07 ether, "7% Relic royalty");

        _listAndBuyRelic(relic, collector, 1 ether);

        // pull balances: royalty 7% -> creator (the agent owner), platform 2.5%, seller (collector) the rest.
        assertEq(mkt.pendingWithdrawals(creator), 0.07 ether, "royalty -> the creating agent's owner (living-agents rail)");
        assertEq(mkt.pendingWithdrawals(platform), 0.025 ether, "platform fee");
        assertEq(mkt.pendingWithdrawals(collector), 1 ether - 0.07 ether - 0.025 ether, "seller proceeds = price - royalty - platform");
        assertEq(outNft.ownerOf(relic), buyer, "Relic transferred to the buyer");

        // and the royalty is actually WITHDRAWABLE by the creator-agent owner (pull payment settles end to end).
        uint256 balBefore = creator.balance;
        vm.prank(creator);
        mkt.withdraw();
        assertEq(creator.balance - balBefore, 0.07 ether, "creator withdrew the royalty");
    }

    // The living-agents property, THROUGH the marketplace: after a secure agent transfer, a Relic's royalty on a
    // marketplace sale pays the NEW agent owner (income follows the iNFT), not the original creator.
    function test_M1c_RoyaltyFollowsAgent_AfterSecureTransfer() public {
        uint256 relic = _mintRelic(collector, keccak256("n2"));
        _secureTransferAgent(creator, newOwner, sealedToNew, DATA1);
        assertEq(inft.ownerOf(agentId), newOwner, "agent moved to newOwner via ERC-7857 secure transfer");

        _listAndBuyRelic(relic, collector, 1 ether);
        assertEq(mkt.pendingWithdrawals(newOwner), 0.07 ether, "royalty follows the agent -> paid to the NEW owner");
        assertEq(mkt.pendingWithdrawals(creator), 0, "the original creator no longer earns (income followed the iNFT)");
    }

    // ================ M1(d): an AuraINFT (agent) buy REVERTS atomically (intentional block) ================
    // Even when AuraINFT is allowlisted (as the LIVE marketplace still has it from the original cutover), a
    // buy() on an agent reverts on AuraINFT's spec-strict ERC-7857 transferFrom - no funds move, no partial
    // state. Agent resale must use Flow B (AuraINFT.transfer() + oracle re-encryption proof), never buy().
    function test_M1d_AgentListBuy_RevertsAtomically() public {
        // allowlist the AGENT collection too (models the harmless live no-op the audit flagged as latent/low).
        mkt.setAllowedCollection(address(inft), true);

        // a seller CAN list an agent (list only checks ownerOf + approval, which AuraINFT supports) ...
        vm.startPrank(creator);
        inft.setApprovalForAll(address(mkt), true);
        mkt.list(address(inft), agentId, 1 ether);
        vm.stopPrank();

        // ... but the buy() reverts atomically at the ERC-7857 transfer step.
        vm.deal(buyer, 1 ether);
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        vm.expectRevert(bytes("use transfer(): ERC-7857 secure transfer required"));
        mkt.buy{value: 1 ether}(address(inft), agentId);

        // no funds moved, no partial state: agent still the creator's, listing still active, no pending balances.
        assertEq(buyer.balance, buyerBefore, "buyer's funds untouched (atomic revert)");
        assertEq(inft.ownerOf(agentId), creator, "agent still owned by the creator");
        assertEq(mkt.pendingWithdrawals(creator), 0, "no royalty/proceeds credited");
        assertEq(mkt.pendingWithdrawals(platform), 0, "no platform fee credited");
        assertEq(mkt.pendingWithdrawals(buyer), 0, "no refund credited (nothing was paid)");
        (,, bool active) = mkt.listings(mkt.listingKey(address(inft), agentId));
        assertTrue(active, "listing still active (buy reverted, no state change)");
    }
}
