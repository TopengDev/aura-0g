// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {AuraMarketplace} from "../src/AuraMarketplace.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Shared deployment + EIP-712 signing helpers for the AURA v2 suite.
abstract contract AuraBase is Test {
    AgentRegistry reg;
    OutputNFT outNft;
    AuraMarketplace mkt;

    uint256 attestorPk = 0xA11CE;
    address attestor;
    uint256 forgerPk = 0xBAD;

    address platform = makeAddr("platform");
    address creator  = makeAddr("creator");   // ORIGINAL agent creator
    address seller   = makeAddr("seller");
    address buyer    = makeAddr("buyer");
    address other    = makeAddr("other");

    uint16 constant PLATFORM_BPS = 250; // 2.5%

    function setUp() public virtual {
        attestor = vm.addr(attestorPk);
        reg = new AgentRegistry();
        outNft = new OutputNFT(address(reg), attestor);
        mkt = new AuraMarketplace(platform, PLATFORM_BPS);
        mkt.setAllowedCollection(address(reg), true);
        mkt.setAllowedCollection(address(outNft), true);
    }

    // --- agent minting helpers ---
    function _mintAgentTo(address to, uint16 outputBps, uint16 resaleBps) internal returns (uint256 id) {
        id = reg.mintAgent(
            to, "NOKTURNE", keccak256("style-dna"), "0g://enc-brain", keccak256("model:qwen"), outputBps, resaleBps
        );
    }

    // --- EIP-712 attestation mint helpers ---
    function _sign(uint256 pk, address to, uint256 agentId, bytes32 nonce) internal view returns (bytes memory) {
        bytes32 digest = outNft.authDigest(
            to, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), 42, nonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mintOutputTo(address to, uint256 agentId, bytes32 nonce) internal returns (uint256 tokenId) {
        bytes memory sig = _sign(attestorPk, to, agentId, nonce);
        tokenId = outNft.mintOutput(to, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), 42, nonce, sig);
    }
}

// ============================================================================
//  EIP-2981 AGENT RESALE routes to the ORIGINAL CREATOR (not the seller)
// ============================================================================
contract AgentResaleRoyaltyTest is AuraBase {
    function test_AgentSupportsERC2981_and_ERC721() public view {
        assertTrue(reg.supportsInterface(0x2a55205a), "agent advertises EIP-2981");
        assertTrue(reg.supportsInterface(0x80ac58cd), "agent is ERC721");
    }

    function test_AgentResale_RoyaltyGoesToOriginalCreator_NotSeller() public {
        // creator mints agent (10% creator-resale royalty), then sells it to `seller`.
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        assertEq(reg.agentCreator(agentId), creator, "creator pinned");

        // creator transfers the agent to `seller` (now seller will resell it).
        vm.prank(creator);
        reg.transferFrom(creator, seller, agentId);

        // SECONDARY sale: seller lists the AGENT; royalty must route to the ORIGINAL creator.
        vm.startPrank(seller);
        reg.setApprovalForAll(address(mkt), true);
        mkt.list(address(reg), agentId, 1 ether);
        vm.stopPrank();

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        mkt.buy{value: 1 ether}(address(reg), agentId);

        // pull balances: creator royalty 10%, platform 2.5%, seller remainder.
        assertEq(mkt.pendingWithdrawals(creator), 0.10 ether, "royalty -> ORIGINAL creator");
        assertEq(mkt.pendingWithdrawals(platform), 0.025 ether, "platform fee");
        assertEq(mkt.pendingWithdrawals(seller), 1 ether - 0.10 ether - 0.025 ether, "seller proceeds");
        assertEq(reg.ownerOf(agentId), buyer, "agent transferred to buyer");
    }

    function test_AgentRoyaltyInfo_StaysPinnedAfterTransfer() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);

        (address r1, uint256 a1) = reg.royaltyInfo(agentId, 1 ether);
        assertEq(r1, creator);
        assertEq(a1, 0.10 ether);

        // transferring the agent does NOT move the resale-royalty target (static EIP-2981).
        vm.prank(creator);
        reg.transferFrom(creator, seller, agentId);
        (address r2,) = reg.royaltyInfo(agentId, 1 ether);
        assertEq(r2, creator, "agent resale royalty stays with ORIGINAL creator");
    }
}

// ============================================================================
//  BOTH collections trade through the SAME buy()
//   - agent: STATIC creator-resale royalty
//   - output: DYNAMIC owner-follows royalty
// ============================================================================
contract MultiCollectionTradeTest is AuraBase {
    function test_OutputSupportsERC2981_dynamic() public view {
        assertTrue(outNft.supportsInterface(0x2a55205a), "output advertises EIP-2981");
        assertTrue(outNft.supportsInterface(0x80ac58cd), "output is ERC721");
    }

    function test_DynamicRoyalty_OutputTradesThroughSameBuy() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000); // 7% output royalty

        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n-out"));

        // dynamic royalty resolves to the agent's CURRENT owner (creator).
        (address recv,) = outNft.royaltyInfo(tokenId, 1 ether);
        assertEq(recv, creator);

        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        vm.stopPrank();

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        mkt.buy{value: 1 ether}(address(outNft), tokenId);

        assertEq(mkt.pendingWithdrawals(creator), 0.07 ether, "dynamic royalty -> agent owner");
        assertEq(mkt.pendingWithdrawals(platform), 0.025 ether, "platform fee");
        assertEq(mkt.pendingWithdrawals(seller), 1 ether - 0.07 ether - 0.025 ether, "seller proceeds");
        assertEq(outNft.ownerOf(tokenId), buyer);
    }

    function test_DynamicRoyalty_FollowsAgentToNewOwner() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n-follow"));

        (address r1,) = outNft.royaltyInfo(tokenId, 1 ether);
        assertEq(r1, creator);

        // sell the AGENT to `other` -> the output's future royalty now routes to `other`.
        vm.prank(creator);
        reg.transferFrom(creator, other, agentId);

        (address r2,) = outNft.royaltyInfo(tokenId, 1 ether);
        assertEq(r2, other, "output royalty FOLLOWS the agent to its new owner");

        // and it pays through buy() to the new owner.
        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        vm.stopPrank();

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        mkt.buy{value: 1 ether}(address(outNft), tokenId);
        assertEq(mkt.pendingWithdrawals(other), 0.07 ether, "royalty paid to NEW agent owner");
    }

    function test_BothCollections_ThroughOneMarketplace() public {
        // mint an agent owned by `creator`, plus an output (credited to that agent) owned by `seller`.
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n-both"));

        // creator lists the AGENT (static royalty), seller lists the OUTPUT (dynamic royalty).
        vm.startPrank(creator);
        reg.setApprovalForAll(address(mkt), true);
        mkt.list(address(reg), agentId, 2 ether);
        vm.stopPrank();

        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        vm.stopPrank();

        // buyer buys the output first (royalty -> creator since creator still owns the agent).
        vm.deal(buyer, 3 ether);
        vm.prank(buyer);
        mkt.buy{value: 1 ether}(address(outNft), tokenId);
        assertEq(outNft.ownerOf(tokenId), buyer);

        // then buyer buys the AGENT (resale royalty -> creator, who is BOTH seller and creator here).
        vm.prank(buyer);
        mkt.buy{value: 2 ether}(address(reg), agentId);
        assertEq(reg.ownerOf(agentId), buyer);

        // creator: 0.07 (output royalty) + agent sale (resale royalty 0.20 + seller proceeds).
        // agent sale: price 2, royalty 10% = 0.20 -> creator, platform 2.5% = 0.05, seller(=creator) rest 1.75.
        // creator total = 0.07 + 0.20 + 1.75 = 2.02
        assertEq(mkt.pendingWithdrawals(creator), 0.07 ether + 0.20 ether + 1.75 ether, "creator pull total");
        assertEq(mkt.pendingWithdrawals(platform), 0.025 ether + 0.05 ether, "platform total");
    }
}

// ============================================================================
//  EIP-712 ATTESTATION-GATED MINT (valid / forged / garbage / nonce-replay)
// ============================================================================
contract AttestationMintTest is AuraBase {
    uint256 agentId;

    function setUp() public override {
        super.setUp();
        vm.prank(creator);
        agentId = _mintAgentTo(creator, 700, 1000);
    }

    function test_ValidAttestation_UserMints() public {
        bytes32 nonce = keccak256("ok");
        bytes memory sig = _sign(attestorPk, buyer, agentId, nonce);
        vm.prank(buyer);
        uint256 tokenId =
            outNft.mintOutput(buyer, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), 42, nonce, sig);
        assertEq(outNft.ownerOf(tokenId), buyer);
        OutputNFT.Provenance memory p = outNft.provenanceOf(tokenId);
        assertEq(p.creatorAgentId, agentId);
        assertEq(p.seed, 42);
        assertEq(p.teeAttestation, keccak256("tee"));
    }

    function test_ForgedSigner_Reverts() public {
        bytes32 nonce = keccak256("forge");
        bytes memory sig = _sign(forgerPk, buyer, agentId, nonce); // wrong signer
        vm.prank(buyer);
        vm.expectRevert(bytes("bad attestation"));
        outNft.mintOutput(buyer, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), 42, nonce, sig);
    }

    function test_TamperedParams_Reverts() public {
        // sig is valid for seed=42 but we submit seed=43 -> recovered signer != attestor.
        bytes32 nonce = keccak256("tamper");
        bytes memory sig = _sign(attestorPk, buyer, agentId, nonce);
        vm.prank(buyer);
        vm.expectRevert(bytes("bad attestation"));
        outNft.mintOutput(buyer, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), 43, nonce, sig);
    }

    function test_GarbageSignature_Reverts() public {
        bytes32 nonce = keccak256("garbage");
        bytes memory sig = new bytes(65); // all-zero -> ECDSA reverts / yields address(0)
        vm.prank(buyer);
        vm.expectRevert();
        outNft.mintOutput(buyer, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), 42, nonce, sig);
    }

    function test_NonceReplay_Reverts() public {
        bytes32 nonce = keccak256("replay");
        bytes memory sig = _sign(attestorPk, buyer, agentId, nonce);
        vm.prank(buyer);
        outNft.mintOutput(buyer, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), 42, nonce, sig);
        vm.prank(buyer);
        vm.expectRevert(bytes("nonce used"));
        outNft.mintOutput(buyer, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), 42, nonce, sig);
    }

    function test_MintForNonexistentAgent_Reverts() public {
        bytes32 nonce = keccak256("noagent");
        uint256 ghostAgent = 999;
        bytes memory sig = _sign(attestorPk, buyer, ghostAgent, nonce);
        vm.prank(buyer);
        vm.expectRevert(); // registry.ownerOf reverts (ERC721NonexistentToken)
        outNft.mintOutput(buyer, ghostAgent, "0g://image-root", keccak256("prov"), keccak256("tee"), 42, nonce, sig);
    }
}

// ============================================================================
//  PULL PAYMENTS / withdraw
// ============================================================================
contract WithdrawTest is AuraBase {
    function test_Withdraw_PaysOutAccruedBalance() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n"));

        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        vm.stopPrank();

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        mkt.buy{value: 1 ether}(address(outNft), tokenId);

        uint256 sellerProceeds = 1 ether - 0.07 ether - 0.025 ether;
        uint256 before = seller.balance;
        vm.prank(seller);
        mkt.withdraw();
        assertEq(seller.balance - before, sellerProceeds, "seller withdrew proceeds");
        assertEq(mkt.pendingWithdrawals(seller), 0, "balance cleared");

        // creator withdraws royalty.
        uint256 cBefore = creator.balance;
        vm.prank(creator);
        mkt.withdraw();
        assertEq(creator.balance - cBefore, 0.07 ether, "creator withdrew royalty");
    }

    function test_Withdraw_NothingReverts() public {
        vm.prank(other);
        vm.expectRevert(bytes("nothing to withdraw"));
        mkt.withdraw();
    }
}

// ============================================================================
//  STALE-LISTING recheck (list, transfer away, buy reverts + deactivates)
// ============================================================================
contract StaleListingTest is AuraBase {
    function test_Buy_StaleAfterSellerTransfersAway_RevertsAtomically() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n"));

        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        // seller transfers the NFT away AFTER listing -> listing is now stale.
        outNft.transferFrom(seller, other, tokenId);
        vm.stopPrank();

        // The stale check reverts the WHOLE buy atomically -> the buyer's funds are protected
        // (the in-tx deactivation write is rolled back by the revert; this is the safe behavior).
        vm.deal(buyer, 1 ether);
        uint256 buyerBefore = buyer.balance;
        vm.prank(buyer);
        vm.expectRevert(bytes("listing stale"));
        mkt.buy{value: 1 ether}(address(outNft), tokenId);

        // buyer paid nothing (atomic revert), and the listing state is unchanged (still active).
        assertEq(buyer.balance, buyerBefore, "buyer funds protected by atomic revert");
        (, , bool active) = mkt.listings(mkt.listingKey(address(outNft), tokenId));
        assertTrue(active, "listing unchanged after reverted buy");
        assertEq(mkt.pendingWithdrawals(buyer), 0, "no stray refund balance");
    }

    function test_Buy_StaleAfterApprovalRevoked_Reverts() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n"));

        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        outNft.setApprovalForAll(address(mkt), false); // revoke approval after listing
        vm.stopPrank();

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(bytes("listing stale"));
        mkt.buy{value: 1 ether}(address(outNft), tokenId);
    }
}

// ============================================================================
//  cancel + updatePrice (seller-only), listing validation
// ============================================================================
contract ListingMgmtTest is AuraBase {
    uint256 agentId;
    uint256 tokenId;

    function setUp() public override {
        super.setUp();
        vm.prank(creator);
        agentId = _mintAgentTo(creator, 700, 1000);
        tokenId = _mintOutputTo(seller, agentId, keccak256("n"));
        vm.prank(seller);
        outNft.setApprovalForAll(address(mkt), true);
    }

    function test_List_RequiresAllowlistedCollection() public {
        // a random unallowlisted collection address (use the marketplace itself as a non-allowed addr).
        vm.prank(seller);
        mkt.list(address(outNft), tokenId, 1 ether); // allowed one works
        // now deny the collection and confirm new listings are blocked.
        mkt.setAllowedCollection(address(outNft), false);
        vm.prank(seller);
        vm.expectRevert(bytes("collection not allowed"));
        mkt.list(address(outNft), tokenId, 2 ether);
    }

    function test_List_NotOwner_Reverts() public {
        vm.prank(other);
        vm.expectRevert(bytes("not owner"));
        mkt.list(address(outNft), tokenId, 1 ether);
    }

    function test_List_ZeroPrice_Reverts() public {
        vm.prank(seller);
        vm.expectRevert(bytes("price=0"));
        mkt.list(address(outNft), tokenId, 0);
    }

    function test_UpdatePrice_SellerOnly() public {
        vm.prank(seller);
        mkt.list(address(outNft), tokenId, 1 ether);

        vm.prank(other);
        vm.expectRevert(bytes("not seller"));
        mkt.updatePrice(address(outNft), tokenId, 2 ether);

        vm.prank(seller);
        mkt.updatePrice(address(outNft), tokenId, 2 ether);
        (, uint256 price,) = mkt.listings(mkt.listingKey(address(outNft), tokenId));
        assertEq(price, 2 ether);
    }

    function test_Cancel_SellerOnly_AndBlocksBuy() public {
        vm.prank(seller);
        mkt.list(address(outNft), tokenId, 1 ether);

        vm.prank(other);
        vm.expectRevert(bytes("not seller"));
        mkt.cancelListing(address(outNft), tokenId);

        vm.prank(seller);
        mkt.cancelListing(address(outNft), tokenId);

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(bytes("not listed"));
        mkt.buy{value: 1 ether}(address(outNft), tokenId);
    }

    function test_Cancel_AllowedWhilePaused() public {
        vm.prank(seller);
        mkt.list(address(outNft), tokenId, 1 ether);
        mkt.pause();
        // cancel must still work while paused (seller can exit).
        vm.prank(seller);
        mkt.cancelListing(address(outNft), tokenId);
        (, , bool active) = mkt.listings(mkt.listingKey(address(outNft), tokenId));
        assertFalse(active);
    }
}

// ============================================================================
//  PAUSABLE
// ============================================================================
contract PausableTest is AuraBase {
    uint256 agentId;
    uint256 tokenId;

    function setUp() public override {
        super.setUp();
        vm.prank(creator);
        agentId = _mintAgentTo(creator, 700, 1000);
        tokenId = _mintOutputTo(seller, agentId, keccak256("n"));
        vm.prank(seller);
        outNft.setApprovalForAll(address(mkt), true);
    }

    function test_Pause_BlocksListAndBuy() public {
        vm.prank(seller);
        mkt.list(address(outNft), tokenId, 1 ether);
        mkt.pause();

        // list blocked while paused
        uint256 t2 = _mintOutputTo(seller, agentId, keccak256("n2"));
        vm.prank(seller);
        vm.expectRevert(); // EnforcedPause()
        mkt.list(address(outNft), t2, 1 ether);

        // buy blocked while paused
        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(); // EnforcedPause()
        mkt.buy{value: 1 ether}(address(outNft), tokenId);

        // unpause restores buy
        mkt.unpause();
        vm.prank(buyer);
        mkt.buy{value: 1 ether}(address(outNft), tokenId);
        assertEq(outNft.ownerOf(tokenId), buyer);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(other);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        mkt.pause();
    }
}

// ============================================================================
//  OVERPAY refund (pull)
// ============================================================================
contract OverpayTest is AuraBase {
    function test_Overpay_RefundedToBuyerViaPull() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n"));

        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        vm.stopPrank();

        // buyer pays 1.5 ether for a 1 ether listing.
        vm.deal(buyer, 1.5 ether);
        vm.prank(buyer);
        mkt.buy{value: 1.5 ether}(address(outNft), tokenId);

        assertEq(mkt.pendingWithdrawals(buyer), 0.5 ether, "overpay credited as refund");
        // proceeds are computed off the LISTING price, not msg.value.
        assertEq(mkt.pendingWithdrawals(creator), 0.07 ether);
        assertEq(mkt.pendingWithdrawals(seller), 1 ether - 0.07 ether - 0.025 ether);

        uint256 before = buyer.balance;
        vm.prank(buyer);
        mkt.withdraw();
        assertEq(buyer.balance - before, 0.5 ether, "buyer withdrew overpay");
    }

    function test_Underpay_Reverts() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n"));

        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        vm.stopPrank();

        vm.deal(buyer, 0.5 ether);
        vm.prank(buyer);
        vm.expectRevert(bytes("insufficient payment"));
        mkt.buy{value: 0.5 ether}(address(outNft), tokenId);
    }
}

// ============================================================================
//  ROYALTY CAP + platform fee config
// ============================================================================
/// A rogue collection that claims EIP-2981 and asks for an absurd royalty (> price).
contract RogueRoyaltyNFT {
    address public owner_;
    address public royaltyTo;

    constructor(address royaltyTo_) {
        royaltyTo = royaltyTo_;
    }

    function mintTo(address to) external {
        owner_ = to;
    }

    function ownerOf(uint256) external view returns (address) {
        return owner_;
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return true;
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function safeTransferFrom(address, address to, uint256) external {
        owner_ = to;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC2981).interfaceId;
    }

    // demands 99% royalty; combined with platform fee can exceed price.
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (royaltyTo, (salePrice * 9900) / 10_000);
    }
}

contract RoyaltyCapAndFeeTest is AuraBase {
    function test_SetPlatformBps_CapEnforced() public {
        mkt.setPlatformBps(1000); // == MAX, ok
        assertEq(mkt.platformBps(), 1000);
        vm.expectRevert(bytes("platform bps too high"));
        mkt.setPlatformBps(1001);
    }

    function test_SetPlatformBps_OnlyOwner() public {
        vm.prank(other);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        mkt.setPlatformBps(100);
    }

    function test_RoyaltyPlusPlatform_ExceedsPrice_Reverts() public {
        // platform 5% + rogue royalty 99% = 104% > price -> the cap must trip.
        mkt.setPlatformBps(500);
        RogueRoyaltyNFT rogue = new RogueRoyaltyNFT(creator);
        rogue.mintTo(seller);
        mkt.setAllowedCollection(address(rogue), true);

        vm.prank(seller);
        mkt.list(address(rogue), 1, 1 ether);

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(bytes("fees exceed price"));
        mkt.buy{value: 1 ether}(address(rogue), 1);
    }

    function test_NoRoyaltyCollection_FoldsToSeller() public {
        // a collection that does NOT advertise EIP-2981 -> royalty share folds to seller.
        PlainNFT plain = new PlainNFT();
        plain.mintTo(seller);
        mkt.setAllowedCollection(address(plain), true);

        vm.prank(seller);
        mkt.list(address(plain), 1, 1 ether);

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        mkt.buy{value: 1 ether}(address(plain), 1);

        // platform 2.5%, the rest (incl. the zero royalty) to seller.
        assertEq(mkt.pendingWithdrawals(platform), 0.025 ether);
        assertEq(mkt.pendingWithdrawals(seller), 0.975 ether);
    }
}

/// Minimal non-2981 ERC721-ish collection for the "no royalty" path.
contract PlainNFT {
    address public owner_;

    function mintTo(address to) external {
        owner_ = to;
    }

    function ownerOf(uint256) external view returns (address) {
        return owner_;
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return true;
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function safeTransferFrom(address, address to, uint256) external {
        owner_ = to;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return false;
    }
}

// ============================================================================
//  REENTRANCY GUARD (transient storage)
// ============================================================================
/// A malicious buyer that, on receiving the NFT (onERC721Received during safeTransferFrom inside
/// buy), tries to re-enter the marketplace (buy / withdraw). The nonReentrant guard must block it.
contract ReentrantBuyer is IERC721Receiver {
    AuraMarketplace public mkt;
    address public collection;
    uint256 public tokenId;
    bool public attempted;
    bool public reentryReverted;

    constructor(AuraMarketplace mkt_) {
        mkt = mkt_;
    }

    function attack(address collection_, uint256 tokenId_) external payable {
        collection = collection_;
        tokenId = tokenId_;
        mkt.buy{value: msg.value}(collection_, tokenId_);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!attempted) {
            attempted = true;
            // attempt to re-enter buy() during the in-flight buy -> must revert (guard engaged).
            try mkt.buy{value: 0}(collection, tokenId) {
                reentryReverted = false;
            } catch {
                reentryReverted = true;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    // accept refunds/withdrawals
    receive() external payable {}
}

contract ReentrancyTest is AuraBase {
    function test_Reentrancy_BuyBlockedDuringTransfer() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("n"));

        vm.startPrank(seller);
        outNft.setApprovalForAll(address(mkt), true);
        mkt.list(address(outNft), tokenId, 1 ether);
        vm.stopPrank();

        ReentrantBuyer attacker = new ReentrantBuyer(mkt);
        vm.deal(address(attacker), 1 ether);
        attacker.attack{value: 1 ether}(address(outNft), tokenId);

        // the outer buy completed; the inner re-entrant buy was reverted by the guard.
        assertTrue(attacker.attempted(), "re-entry was attempted");
        assertTrue(attacker.reentryReverted(), "re-entrant buy reverted (guard engaged)");
        assertEq(outNft.ownerOf(tokenId), address(attacker), "outer buy succeeded");
    }
}

// ============================================================================
//  AGENT REGISTRY core (mint / updateBrain / verifier / 7857 stubs)
// ============================================================================
contract AgentRegistryCoreTest is AuraBase {
    function test_Mint_ReadBack_BothRoyaltyFields() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        AgentRegistry.Agent memory a = reg.getAgent(agentId);
        assertEq(a.royaltyBps, 700, "output royalty");
        assertEq(a.creatorResaleBps, 1000, "creator resale royalty");
        assertEq(a.styleVersion, 1);
        assertEq(reg.royaltyBpsOf(agentId), 700);
        assertEq(reg.creatorResaleBpsOf(agentId), 1000);
    }

    function test_Mint_RoyaltyCaps() public {
        vm.expectRevert(bytes("royalty too high"));
        reg.mintAgent(creator, "X", bytes32(0), "r", bytes32(0), 2001, 1000);
        vm.expectRevert(bytes("resale royalty too high"));
        reg.mintAgent(creator, "X", bytes32(0), "r", bytes32(0), 700, 2001);
    }

    function test_UpdateBrain_OwnerOnly_BumpsVersion() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);

        vm.prank(other);
        vm.expectRevert(bytes("not agent owner"));
        reg.updateBrain(agentId, "0g://new-root");

        vm.prank(creator);
        reg.updateBrain(agentId, "0g://new-root");
        AgentRegistry.Agent memory a = reg.getAgent(agentId);
        assertEq(a.styleVersion, 2);
        assertEq(a.encBrainRoot, "0g://new-root");
    }

    function test_SetVerifier_OwnerOnly() public {
        // this test contract is the registry owner (it deployed reg).
        reg.setVerifier(address(0xBEEF));
        assertEq(reg.verifier(), address(0xBEEF));

        vm.prank(other);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        reg.setVerifier(address(0xCAFE));
    }

    function test_ERC7857_transferStub_movesToken() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        bytes[] memory proofs = new bytes[](0);
        vm.prank(creator);
        reg.transfer(other, agentId, proofs);
        assertEq(reg.ownerOf(agentId), other, "7857 transfer stub falls back to ERC721 transfer");
    }

    function test_ERC7857_authorizeUsage_ownerOnly() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        vm.prank(other);
        vm.expectRevert(bytes("not agent owner"));
        reg.authorizeUsage(agentId, other);
        vm.prank(creator);
        reg.authorizeUsage(agentId, other); // no revert
    }
}
