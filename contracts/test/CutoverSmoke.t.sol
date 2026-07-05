// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// STEP-1 SMOKE / PREREQ GATE for the AuraINFT cutover (closes overclaim O1). Proves that the interface the
// rest of the stack binds to actually works when agents live on the REAL ERC-7857 AuraINFT instead of the
// AgentRegistry stub:
//   1. AuraINFT.mintAgent (9-arg) -> ownerOf + royaltyBpsOf read back (the OutputNFT royalty + memory-gate deps).
//   2. OutputNFT bound to AuraINFT (registry = the AuraINFT address, which is IMMUTABLE) routes royaltyInfo()
//      to the AuraINFT agent's CURRENT owner at that agent's royaltyBps -- the whole thesis primitive, on AuraINFT.
//   3. A sealed re-key transfer of the agent moves the royalty stream to the NEW owner (income follows the agent).
//   4. SummonEscrow bound to AuraINFT prices + reads ownerOf the AuraINFT agent (the summon fee target).
// If this suite is GREEN, AuraINFT exposes everything the cutover wires to and NO view needs adding.
import {Test} from "forge-std/Test.sol";
import {AuraINFT} from "../src/AuraINFT.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {SummonEscrow} from "../src/SummonEscrow.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract CutoverSmokeTest is Test {
    using MessageHashUtils for bytes32;

    AuraINFT inft;
    OutputNFT outNft;
    SummonEscrow escrow;

    uint256 oraclePk = 0x0AAC1E; // the trusted re-encryption oracle (ECDSA signer)
    uint256 attestorPk = 0xA11CE; // the OutputNFT EIP-712 MintAuth attestor
    address oracle;
    address attestor;
    address platform = makeAddr("platform");

    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");
    address collector = makeAddr("collector"); // owns the Relic; NEVER the royalty receiver

    bytes sealedToCreator = hex"01020304";
    bytes sealedToBuyer = hex"0a0b0c0d0e";
    bytes32 constant DATA0 = keccak256("envelope-v0");
    bytes32 constant DATA1 = keccak256("envelope-v1");
    string constant IMAGE_BASE = "https://aura.topengdev.com/images/";

    uint256 agentId;

    function setUp() public {
        oracle = vm.addr(oraclePk);
        attestor = vm.addr(attestorPk);

        // Agents live on the REAL ERC-7857 AuraINFT.
        inft = new AuraINFT(oracle, IMAGE_BASE);
        // OutputNFT bound to the AuraINFT address (registry is immutable -> it MUST point here at deploy).
        outNft = new OutputNFT(address(inft), attestor, IMAGE_BASE);
        // SummonEscrow bound to the AuraINFT address (ownerOf is the fee target).
        escrow = new SummonEscrow(address(inft), address(outNft), platform, 250);

        // Mint the catalog-style agent as an AuraINFT iNFT (9-arg): owned by creator, output royalty 700 bps.
        vm.prank(creator);
        agentId = inft.mintAgent(
            creator, "NOKTURNE", keccak256("style-dna"), "0g://enc-brain-v0", DATA0, keccak256("model:qwen"), 700, 1000, sealedToCreator
        );
    }

    function _authSig(address to, bytes32 teeAtt, bytes32 nonce) internal view returns (bytes memory) {
        bytes32 digest = outNft.authDigest(to, agentId, "0g://img", keccak256("prov"), teeAtt, 42, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mintRelic(address to, bytes32 nonce) internal returns (uint256) {
        bytes32 teeAtt = keccak256("tee");
        return outNft.mintOutput(to, agentId, "0g://img", keccak256("prov"), teeAtt, 42, nonce, _authSig(to, teeAtt, nonce));
    }

    function _oracleProof(address from, address to, bytes memory newSealedKey, bytes32 newDataHash, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest =
            keccak256(abi.encodePacked(block.chainid, address(inft), agentId, from, to, keccak256(newSealedKey), newDataHash, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }

    // 1 + the interface: mint on AuraINFT, ownerOf + royaltyBpsOf read back (the deps OutputNFT + memory gate need).
    function test_Smoke_AuraINFT_MintOwnerRoyaltyInterface() public view {
        assertEq(inft.ownerOf(agentId), creator, "ownerOf resolves the AuraINFT agent owner");
        assertEq(inft.royaltyBpsOf(agentId), 700, "royaltyBpsOf (OutputNFT + memory-gate dep) reads back");
        (address recv, uint256 amt) = inft.royaltyInfo(agentId, 1 ether);
        assertEq(recv, creator, "agent-resale royaltyInfo -> creator");
        assertEq(amt, 0.10 ether, "10% creator resale royalty");
    }

    // 2: OutputNFT bound to AuraINFT routes royaltyInfo to the agent's CURRENT owner at the agent's output bps.
    function test_Smoke_OutputNFT_RoutesRoyaltyToAuraINFTOwner() public {
        uint256 relic = _mintRelic(collector, keccak256("n1"));
        (address receiver, uint256 amount) = outNft.royaltyInfo(relic, 1 ether);
        assertEq(receiver, creator, "Relic royalty -> the AuraINFT agent's current owner (NOT the Relic owner)");
        assertEq(amount, 0.07 ether, "7% output royalty resolved via AuraINFT.royaltyBpsOf");
    }

    // 3: a sealed re-key transfer moves the SAME Relic's royalty stream to the new owner (income follows the agent).
    function test_Smoke_RoyaltyFollowsSealedTransfer() public {
        uint256 relic = _mintRelic(collector, keccak256("n2"));
        (address beforeOwner,) = outNft.royaltyInfo(relic, 1 ether);
        assertEq(beforeOwner, creator, "before transfer: routes to creator");

        // sealed re-key transfer creator -> buyer (fresh sealed key + fresh data hash, oracle-signed).
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _oracleProof(creator, buyer, sealedToBuyer, DATA1, deadline);
        vm.prank(creator);
        inft.transfer(creator, buyer, agentId, sealedToBuyer, "0g://enc-brain-v1", DATA1, deadline, proof);
        assertEq(inft.ownerOf(agentId), buyer, "agent moved to buyer via the sealed transfer");

        (address afterOwner,) = outNft.royaltyInfo(relic, 1 ether);
        assertEq(afterOwner, buyer, "after transfer: the SAME Relic royalty now routes to the NEW agent owner");
    }

    // 4: SummonEscrow bound to AuraINFT prices + reads ownerOf the agent (the summon fee target).
    function test_Smoke_SummonEscrow_PricesViaAuraINFTOwner() public {
        vm.prank(creator);
        escrow.setSummonPrice(agentId, 0.01 ether);
        assertEq(escrow.summonPrice(agentId), 0.01 ether, "owner (via AuraINFT ownerOf) can price the agent");

        vm.prank(buyer); // not the owner
        vm.expectRevert(bytes("not agent owner"));
        escrow.setSummonPrice(agentId, 0.02 ether);
    }
}
