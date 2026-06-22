// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// Proves the full thesis on-chain: provable creation + dynamic royalty that follows the agent.
contract SmokeTest is Test {
    AgentRegistry reg;
    OutputNFT out;
    Marketplace mkt;

    address creator = makeAddr("creator");   // original agent owner (e.g. Toper)
    address buyerOfAgent = makeAddr("buyerOfAgent");
    address collector = makeAddr("collector"); // buys an artwork
    address artOwner = makeAddr("artOwner");   // current holder selling an artwork
    address platform = makeAddr("platform");

    function setUp() public {
        reg = new AgentRegistry();
        out = new OutputNFT(address(reg));
        mkt = new Marketplace(address(out), platform, 250); // 2.5% platform
    }

    function test_MintAgent_And_ReadBack() public {
        vm.prank(address(this));
        uint256 agentId = reg.mintAgent(
            creator, "NOKTURNE",
            keccak256("style-dna-nokturne"),
            "0g://encrypted-brain-root-hash",
            keccak256("model:qwen-image-edit-2511"),
            700 // 7%
        );
        assertEq(agentId, 1);
        assertEq(reg.ownerOf(agentId), creator);
        AgentRegistry.Agent memory a = reg.getAgent(agentId);
        assertEq(a.name, "NOKTURNE");
        assertEq(a.royaltyBps, 700);
        assertEq(a.styleFingerprint, keccak256("style-dna-nokturne"));
    }

    function test_MintOutput_Provenance_And_Royalty() public {
        uint256 agentId = reg.mintAgent(creator, "MIRAI", keccak256("dna"), "0g://brain", keccak256("model"), 700);
        uint256 tokenId = out.mintOutput(
            collector, agentId,
            "0g://image-root", keccak256("provenance"), keccak256("tee-attestation"), 42
        );
        assertEq(out.ownerOf(tokenId), collector);
        OutputNFT.Provenance memory p = out.provenanceOf(tokenId);
        assertEq(p.creatorAgentId, agentId);
        assertEq(p.teeAttestation, keccak256("tee-attestation"));

        // EIP-2981 royalty resolves to the agent's owner (creator), 7% of 1 ETH.
        (address recv, uint256 amt) = out.royaltyInfo(tokenId, 1 ether);
        assertEq(recv, creator);
        assertEq(amt, 0.07 ether);
    }

    /// THE THESIS: sell the agent → its outputs' future royalties route to the NEW owner.
    function test_RoyaltyFollowsAgentOnTransfer() public {
        uint256 agentId = reg.mintAgent(creator, "RISO", keccak256("dna"), "0g://brain", keccak256("model"), 1000);
        uint256 tokenId = out.mintOutput(collector, agentId, "0g://img", keccak256("prov"), keccak256("tee"), 7);

        (address recv1,) = out.royaltyInfo(tokenId, 1 ether);
        assertEq(recv1, creator, "royalty starts with creator");

        // Creator sells the AGENT to buyerOfAgent.
        vm.prank(creator);
        reg.transferFrom(creator, buyerOfAgent, agentId);
        assertEq(reg.ownerOf(agentId), buyerOfAgent);

        // Now the SAME artwork's royalty routes to the new agent owner - no re-mint.
        (address recv2, uint256 amt2) = out.royaltyInfo(tokenId, 1 ether);
        assertEq(recv2, buyerOfAgent, "royalty FOLLOWED the agent to new owner");
        assertEq(amt2, 0.1 ether);
    }

    /// Enforced royalty split through the marketplace buy().
    function test_Marketplace_EnforcedRoyaltySplit() public {
        uint256 agentId = reg.mintAgent(creator, "SCRIPTORIUM", keccak256("dna"), "0g://brain", keccak256("model"), 700);
        // collector mints + owns an artwork, then artOwner buys it primary (simulate by minting to artOwner)
        uint256 tokenId = out.mintOutput(artOwner, agentId, "0g://img", keccak256("prov"), keccak256("tee"), 1);

        // artOwner lists at 1 ether.
        vm.startPrank(artOwner);
        out.setApprovalForAll(address(mkt), true);
        mkt.list(tokenId, 1 ether);
        vm.stopPrank();

        uint256 creatorBefore = creator.balance;
        uint256 platformBefore = platform.balance;
        uint256 sellerBefore = artOwner.balance;

        // collector buys.
        vm.deal(collector, 1 ether);
        vm.prank(collector);
        mkt.buy{value: 1 ether}(tokenId);

        // royalty 7% → creator (agent owner); platform 2.5%; seller gets the rest.
        assertEq(creator.balance - creatorBefore, 0.07 ether, "agent owner royalty");
        assertEq(platform.balance - platformBefore, 0.025 ether, "platform fee");
        assertEq(artOwner.balance - sellerBefore, 1 ether - 0.07 ether - 0.025 ether, "seller proceeds");
        assertEq(out.ownerOf(tokenId), collector, "NFT transferred to buyer");
    }

    function test_SupportsERC2981Interface() public view {
        assertTrue(out.supportsInterface(0x2a55205a)); // EIP-2981 interface id
    }
}
