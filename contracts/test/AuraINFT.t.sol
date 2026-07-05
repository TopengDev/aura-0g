// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {AuraINFT} from "../src/AuraINFT.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

/// @dev Tests the REAL ERC-7857 secure transfer on AuraINFT: per-owner sealed key, oracle-proof-gated
///      transfer, sealed-key + data-hash rotation, replay/expiry/forgery rejection, and the spec-strict
///      revert of raw ERC721 transfers. This is the de-mock: the old AgentRegistry.transfer ignored its
///      proofs; here a forged/expired/replayed/non-rotating proof CANNOT move the token.
abstract contract AuraBase is Test {
    using MessageHashUtils for bytes32;

    AuraINFT inft;

    uint256 oraclePk = 0x0AAC1E;       // the trusted re-encryption oracle (ECDSA signer)
    address oracle;
    uint256 forgerPk = 0xBAD;          // an attacker key that is NOT the oracle

    address creator = makeAddr("creator");
    address buyer   = makeAddr("buyer");
    address other   = makeAddr("other");

    // sample sealed keys (opaque bytes in tests; real ones are ECIES ciphertexts)
    bytes sealedToCreator = hex"01020304";
    bytes sealedToBuyer   = hex"0a0b0c0d0e";

    bytes32 constant DATA0 = keccak256("envelope-v0");
    bytes32 constant DATA1 = keccak256("envelope-v1");

    string constant IMAGE_BASE = "https://aura.topengdev.com/images/";

    function setUp() public virtual {
        oracle = vm.addr(oraclePk);
        inft = new AuraINFT(oracle, IMAGE_BASE);
    }

    function _mint(address to) internal returns (uint256 id) {
        id = inft.mintAgent(
            to, "NOKTURNE", keccak256("style-dna"), "0g://enc-brain-v0", DATA0,
            keccak256("model:qwen"), 700, 1000, sealedToCreator
        );
    }

    /// @dev Produce a valid oracle proof (EIP-191 personal_sign over the transfer tuple) for `pk`.
    function _proof(
        uint256 pk,
        address from,
        address to,
        uint256 tokenId,
        bytes memory newSealedKey,
        bytes32 newDataHash,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 digest = keccak256(
            abi.encodePacked(block.chainid, address(inft), tokenId, from, to, keccak256(newSealedKey), newDataHash, deadline)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }
}

// ============================================================================
//  MINT + per-owner sealed key
// ============================================================================
contract MintTest is AuraBase {
    function test_Mint_StoresSealedKeyAndData() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        assertEq(inft.ownerOf(id), creator);
        assertEq(inft.sealedKeyOf(id), sealedToCreator, "sealed key stored for owner");
        AuraINFT.Agent memory a = inft.getAgent(id);
        assertEq(a.dataHash, DATA0, "data hash stored");
        assertEq(a.styleVersion, 1);
        assertEq(inft.agentCreator(id), creator, "creator pinned");
    }

    function test_Mint_RequiresSealedKey() public {
        vm.expectRevert(bytes("sealedKey required"));
        inft.mintAgent(creator, "X", bytes32(0), "r", DATA0, bytes32(0), 700, 1000, hex"");
    }

    function test_Mint_RoyaltyCaps() public {
        vm.expectRevert(bytes("royalty too high"));
        inft.mintAgent(creator, "X", bytes32(0), "r", DATA0, bytes32(0), 2001, 1000, sealedToCreator);
        vm.expectRevert(bytes("resale royalty too high"));
        inft.mintAgent(creator, "X", bytes32(0), "r", DATA0, bytes32(0), 700, 2001, sealedToCreator);
    }

    function test_Mint_SupportsInterfaces() public {
        assertTrue(inft.supportsInterface(0x2a55205a), "EIP-2981");
        assertTrue(inft.supportsInterface(0x80ac58cd), "ERC721");
    }

    function test_AgentResaleRoyalty_PinnedToCreator() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        (address recv, uint256 amt) = inft.royaltyInfo(id, 1 ether);
        assertEq(recv, creator, "resale royalty -> original creator");
        assertEq(amt, 0.10 ether, "10% creator resale");
    }
}

// ============================================================================
//  RAW transfers REVERT (spec-strict ERC-7857)
// ============================================================================
contract RawTransferBlockedTest is AuraBase {
    function test_TransferFrom_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        vm.prank(creator);
        vm.expectRevert(bytes("use transfer(): ERC-7857 secure transfer required"));
        inft.transferFrom(creator, buyer, id);
    }

    function test_SafeTransferFrom_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        vm.prank(creator);
        vm.expectRevert(bytes("use transfer(): ERC-7857 secure transfer required"));
        inft.safeTransferFrom(creator, buyer, id);
    }

    function test_SafeTransferFromData_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        vm.prank(creator);
        vm.expectRevert(bytes("use transfer(): ERC-7857 secure transfer required"));
        inft.safeTransferFrom(creator, buyer, id, hex"00");
    }
}

// ============================================================================
//  SECURE TRANSFER - happy path + the rotation it enforces
// ============================================================================
contract SecureTransferTest is AuraBase {
    function test_Transfer_HappyPath_FlipsOwnershipAndRotates() public {
        vm.prank(creator);
        uint256 id = _mint(creator);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA1, deadline);

        vm.expectEmit(true, true, false, true, address(inft));
        emit AuraINFT.BrainRekeyed(id, "0g://enc-brain-v1", DATA1, buyer);

        vm.prank(creator);
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://enc-brain-v1", DATA1, deadline, proof);

        assertEq(inft.ownerOf(id), buyer, "ownership flipped");
        assertEq(inft.sealedKeyOf(id), sealedToBuyer, "sealed key rotated to buyer");
        AuraINFT.Agent memory a = inft.getAgent(id);
        assertEq(a.dataHash, DATA1, "data hash rotated");
        assertEq(a.encBrainRoot, "0g://enc-brain-v1", "brain root rotated");
        assertEq(a.styleVersion, 2, "style version bumped");
    }

    function test_Transfer_ApprovedOperatorCanInitiate() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        vm.prank(creator);
        inft.setApprovalForAll(other, true);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA1, deadline);
        // `other` (operator) initiates on behalf of `creator`.
        vm.prank(other);
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://enc-brain-v1", DATA1, deadline, proof);
        assertEq(inft.ownerOf(id), buyer);
    }

    function test_Transfer_SecondHop_RotatesAgain() public {
        vm.prank(creator);
        uint256 id = _mint(creator);

        uint256 d1 = block.timestamp + 1 hours;
        bytes memory p1 = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA1, d1);
        vm.prank(creator);
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA1, d1, p1);

        // buyer -> other, with another fresh seal + data hash
        bytes memory sealedToOther = hex"ff00ff00ff";
        bytes32 DATA2 = keccak256("envelope-v2");
        uint256 d2 = block.timestamp + 1 hours;
        bytes memory p2 = _proof(oraclePk, buyer, other, id, sealedToOther, DATA2, d2);
        vm.prank(buyer);
        inft.transfer(buyer, other, id, sealedToOther, "0g://v2", DATA2, d2, p2);

        assertEq(inft.ownerOf(id), other);
        assertEq(inft.sealedKeyOf(id), sealedToOther);
        assertEq(inft.getAgent(id).dataHash, DATA2);
    }
}

// ============================================================================
//  SECURE TRANSFER - the attacks the OLD mock let through, now BLOCKED
// ============================================================================
contract SecureTransferAttackTest is AuraBase {
    function test_ForgedProof_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        // signed by a NON-oracle key -> recovered != oracle
        bytes memory forged = _proof(forgerPk, creator, buyer, id, sealedToBuyer, DATA1, deadline);
        vm.prank(creator);
        vm.expectRevert(bytes("bad oracle proof"));
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA1, deadline, forged);
        assertEq(inft.ownerOf(id), creator, "token did NOT move on a forged proof");
    }

    function test_TamperedRecipient_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        // proof authorizes transfer to `buyer`, but caller submits `other` as the recipient.
        bytes memory proof = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA1, deadline);
        vm.prank(creator);
        vm.expectRevert(bytes("bad oracle proof"));
        inft.transfer(creator, other, id, sealedToBuyer, "0g://v1", DATA1, deadline, proof);
    }

    function test_ExpiredProof_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA1, deadline);
        vm.warp(deadline + 1); // now past the deadline
        vm.prank(creator);
        vm.expectRevert(bytes("proof expired"));
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA1, deadline, proof);
    }

    function test_ReplayedProof_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 d1 = block.timestamp + 1 hours;
        bytes memory proof1 = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA1, d1);
        vm.prank(creator);
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA1, d1, proof1);

        // buyer legitimately sells back to creator (fresh proof, fresh seal + data hash).
        bytes memory sealedBack = hex"99887766";
        bytes32 DATA2 = keccak256("envelope-v2");
        uint256 d2 = block.timestamp + 1 hours;
        bytes memory proof2 = _proof(oraclePk, buyer, creator, id, sealedBack, DATA2, d2);
        vm.prank(buyer);
        inft.transfer(buyer, creator, id, sealedBack, "0g://v2", DATA2, d2, proof2);
        assertEq(inft.ownerOf(id), creator, "round-tripped back to creator");

        // Attacker REPLAYS the original creator->buyer proof. creator IS the owner again, and the seal
        // (sealedToBuyer != sealedBack) + data hash (DATA1 != DATA2) both differ, so ONLY the per-digest
        // replay guard can stop it -> it does.
        vm.prank(creator);
        vm.expectRevert(bytes("proof replayed"));
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA1, d1, proof1);
    }

    function test_NonRotatedSealedKey_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        // reuse the CURRENT sealed key (no rotation) -> blocked even with a valid signature.
        bytes memory proof = _proof(oraclePk, creator, buyer, id, sealedToCreator, DATA1, deadline);
        vm.prank(creator);
        vm.expectRevert(bytes("sealedKey not rotated"));
        inft.transfer(creator, buyer, id, sealedToCreator, "0g://v1", DATA1, deadline, proof);
    }

    function test_NonRotatedDataHash_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        // reuse the CURRENT data hash (DATA0) -> blocked.
        bytes memory proof = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA0, deadline);
        vm.prank(creator);
        vm.expectRevert(bytes("dataHash not rotated"));
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA0, deadline, proof);
    }

    function test_NonOwnerCannotInitiate_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA1, deadline);
        // `other` is neither owner nor approved.
        vm.prank(other);
        vm.expectRevert(bytes("not owner nor approved"));
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA1, deadline, proof);
    }

    function test_WrongFrom_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(oraclePk, other, buyer, id, sealedToBuyer, DATA1, deadline);
        vm.prank(other);
        vm.expectRevert(bytes("from not owner"));
        inft.transfer(other, buyer, id, sealedToBuyer, "0g://v1", DATA1, deadline, proof);
    }

    function test_TransferToZero_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(oraclePk, creator, address(0), id, sealedToBuyer, DATA1, deadline);
        vm.prank(creator);
        vm.expectRevert(bytes("to=0"));
        inft.transfer(creator, address(0), id, sealedToBuyer, "0g://v1", DATA1, deadline, proof);
    }

    function test_TransferToSelf_Reverts() public {
        vm.prank(creator);
        uint256 id = _mint(creator);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(oraclePk, creator, creator, id, sealedToBuyer, DATA1, deadline);
        vm.prank(creator);
        vm.expectRevert(bytes("from==to"));
        inft.transfer(creator, creator, id, sealedToBuyer, "0g://v1", DATA1, deadline, proof);
    }
}

// ============================================================================
//  ORACLE config
// ============================================================================
contract OracleConfigTest is AuraBase {
    function test_SetOracle_OwnerOnly() public {
        inft.setOracle(address(0xBEEF));
        assertEq(inft.oracle(), address(0xBEEF));
        vm.prank(other);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        inft.setOracle(address(0xCAFE));
    }

    function test_SetOracle_RejectsZero() public {
        vm.expectRevert(bytes("oracle=0"));
        inft.setOracle(address(0));
    }

    function test_TransferWithUnsetOracle_Reverts() public {
        AuraINFT noOracle = new AuraINFT(address(0), "https://aura.topengdev.com/images/");
        uint256 id = noOracle.mintAgent(
            creator, "X", bytes32(0), "r", DATA0, bytes32(0), 700, 1000, sealedToCreator
        );
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(oraclePk, creator, buyer, id, sealedToBuyer, DATA1, deadline);
        vm.prank(creator);
        vm.expectRevert(bytes("oracle unset"));
        noOracle.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA1, deadline, proof);
    }
}

// ============================================================================
//  Cross-contract / cross-chain proof isolation
// ============================================================================
contract ProofIsolationTest is AuraBase {
    function test_ProofBoundToThisContract() public {
        vm.prank(creator);
        uint256 id = _mint(creator);

        // mint the SAME tokenId on a second AuraINFT with the same oracle
        AuraINFT inft2 = new AuraINFT(oracle, "https://aura.topengdev.com/images/");
        uint256 id2 = inft2.mintAgent(
            creator, "NOKTURNE", keccak256("style-dna"), "0g://enc-brain-v0", DATA0,
            keccak256("model:qwen"), 700, 1000, sealedToCreator
        );
        assertEq(id, id2, "same tokenId on both");

        // a proof minted for inft2 must NOT validate on inft (digest binds address(this)).
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest2 = keccak256(
            abi.encodePacked(block.chainid, address(inft2), id, creator, buyer, keccak256(sealedToBuyer), DATA1, deadline)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, MessageHashUtils.toEthSignedMessageHash(digest2));
        bytes memory proofForInft2 = abi.encodePacked(r, s, v);

        vm.prank(creator);
        vm.expectRevert(bytes("bad oracle proof"));
        inft.transfer(creator, buyer, id, sealedToBuyer, "0g://v1", DATA1, deadline, proofForInft2);
    }
}
