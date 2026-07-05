// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Tests for OutputNFT.mintOutputVerified - the ON-CHAIN 0G-TeeML-verified mint (feat/onchain-verify-mint).
// Covers: gate-off backward-compat, owner-only signer rotation, the dual MintAuth+TEE gate (valid mints +
// binds dataHash), and every forgery/tamper reject path. The final test mints against a REAL 0G mainnet
// z-image-turbo envelope captured live 2026-07-05 (signer 0x592056..), proving the contract recovers 0G's
// genuine enclave signature - not a synthetic key.
//
// NOTE: _authSig() calls outNft.authDigest() (a real contract call), so under vm.expectRevert it must be
// precomputed into a local BEFORE the expectRevert (else expectRevert binds to the authDigest call). _teeSig()
// only uses the vm.sign cheatcode (excluded from expectRevert), so it is safe inline.

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract OutputNFTVerifiedTest is Test {
    using MessageHashUtils for bytes32;

    AgentRegistry reg;
    OutputNFT outNft;

    uint256 attestorPk = 0xA11CE;
    uint256 teePk = 0x7EE; // synthetic 0G enclave signer for the controllable cases
    uint256 forgerPk = 0xBAD;
    address attestor;
    address teeSignerAddr;

    address to = makeAddr("recipient");
    uint256 agentId;

    string constant IMAGE_ROOT = "0g://image-root";
    bytes32 constant PROV = keccak256("prov");
    uint256 constant SEED = 42;

    // REAL captured 0G mainnet z-image-turbo envelope (2026-07-05).
    address constant REAL_SIGNER = 0x592056E413aB456646a50441e52D5BA89527877D;
    string constant REAL_TEXT =
        "c58444c3afce430641bbfa98d45701302010416dbfaec179ca356fecd9c53415:cbd064fadda06e4d4db3eb5c104ad88417778293262b90c727b61cd7f1ea945d";
    bytes constant REAL_SIG =
        hex"9662965b5821a9e2a95439a40397ab65c50a9cedc0cf00eb461603cbaf0c82446e718abd81ea03883d4262a5cc0cc5cbbc60a47c8af62f8b3f3dfe57101ba4591c";
    bytes32 constant REAL_IMG_SHA = 0xcbd064fadda06e4d4db3eb5c104ad88417778293262b90c727b61cd7f1ea945d;

    function setUp() public {
        attestor = vm.addr(attestorPk);
        teeSignerAddr = vm.addr(teePk);
        reg = new AgentRegistry();
        outNft = new OutputNFT(address(reg), attestor);
        agentId = reg.mintAgent(to, "NOKTURNE", keccak256("style-dna"), "0g://enc-brain", keccak256("model:qwen"), 700, 1000);
    }

    // ---- helpers ----
    function _authSig(bytes32 teeAttestation, bytes32 nonce) internal view returns (bytes memory) {
        bytes32 digest = outNft.authDigest(to, agentId, IMAGE_ROOT, PROV, teeAttestation, SEED, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _teeSig(uint256 pk, string memory text) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(bytes(text)));
        return abi.encodePacked(r, s, v);
    }

    function _hex32(bytes32 v) internal pure returns (string memory) {
        bytes memory H = "0123456789abcdef";
        bytes memory out = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            out[i * 2] = H[uint8(v[i]) >> 4];
            out[i * 2 + 1] = H[uint8(v[i]) & 0x0f];
        }
        return string(out);
    }

    function _text(bytes32 reqH, bytes32 imgH) internal pure returns (string memory) {
        return string.concat(_hex32(reqH), ":", _hex32(imgH));
    }

    function _pinTee() internal {
        vm.prank(attestor);
        outNft.setTeeSigner(teeSignerAddr);
    }

    // ============================ gate OFF (default) ============================
    function test_GateOff_MintsLikeMintOutput_IgnoringTee() public {
        bytes32 teeAtt = keccak256("tee");
        bytes32 nonce = keccak256("n-off");
        uint256 id = outNft.mintOutputVerified(
            to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, _authSig(teeAtt, nonce), "not-an-envelope", hex"00"
        );
        assertEq(outNft.ownerOf(id), to, "minted to recipient");
        assertEq(outNft.dataHashOf(id), bytes32(0), "no dataHash bound when gate off");
        assertEq(outNft.teeSigner(), address(0), "teeSigner starts unset");
    }

    // ============================ signer rotation ============================
    function test_SetTeeSigner_OnlyAttestor() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(bytes("not attestor"));
        outNft.setTeeSigner(teeSignerAddr);

        vm.prank(attestor);
        outNft.setTeeSigner(teeSignerAddr);
        assertEq(outNft.teeSigner(), teeSignerAddr, "attestor set the signer");

        vm.prank(attestor);
        outNft.setTeeSigner(address(0));
        assertEq(outNft.teeSigner(), address(0), "attestor can disable the gate");
    }

    // ============================ gate ON: happy path ============================
    function test_ValidTeeEnvelope_Mints_AndBindsDataHash() public {
        _pinTee();
        bytes32 imgH = keccak256("the-art-bytes");
        string memory text = _text(keccak256("the-request"), imgH);
        bytes32 teeAtt = keccak256(bytes(text)); // backend binds teeAttestation = keccak(teeText)
        bytes32 nonce = keccak256("n-ok");

        uint256 id = outNft.mintOutputVerified(
            to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, _authSig(teeAtt, nonce), text, _teeSig(teePk, text)
        );
        assertEq(outNft.ownerOf(id), to, "verified mint to recipient");
        assertEq(outNft.dataHashOf(id), imgH, "dataHash bound to the sha256(image) slice of the TEE text");
    }

    // ============================ gate ON: reject paths ============================
    function test_ForgedTeeSig_Reverts() public {
        _pinTee();
        string memory text = _text(keccak256("req"), keccak256("img"));
        bytes32 teeAtt = keccak256(bytes(text));
        bytes32 nonce = keccak256("n-forge");
        bytes memory auth = _authSig(teeAtt, nonce); // precompute (calls authDigest) BEFORE expectRevert
        bytes memory forgedTee = _teeSig(forgerPk, text);
        vm.expectRevert(bytes("bad TEE attestation"));
        outNft.mintOutputVerified(to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, auth, text, forgedTee);
    }

    function test_TeeTextMismatch_Reverts() public {
        _pinTee();
        string memory text = _text(keccak256("req"), keccak256("img"));
        bytes32 teeAtt = keccak256("some-other-attestation"); // != keccak(text) -> B2 reverts
        bytes32 nonce = keccak256("n-mismatch");
        bytes memory auth = _authSig(teeAtt, nonce);
        bytes memory tee = _teeSig(teePk, text);
        vm.expectRevert(bytes("tee text mismatch"));
        outNft.mintOutputVerified(to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, auth, text, tee);
    }

    function test_BadEnvelopeShape_Reverts() public {
        _pinTee();
        string memory text = "too-short-not-an-envelope"; // length != 129, no ':' at 64
        bytes32 teeAtt = keccak256(bytes(text));
        bytes32 nonce = keccak256("n-shape");
        bytes memory auth = _authSig(teeAtt, nonce);
        bytes memory tee = _teeSig(teePk, text);
        vm.expectRevert(bytes("bad envelope"));
        outNft.mintOutputVerified(to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, auth, text, tee);
    }

    function test_ForgedMintAuth_Reverts_EvenWithValidTee() public {
        _pinTee();
        string memory text = _text(keccak256("req"), keccak256("img"));
        bytes32 teeAtt = keccak256(bytes(text));
        bytes32 nonce = keccak256("n-badauth");
        bytes32 digest = outNft.authDigest(to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(forgerPk, digest); // MintAuth signed by a forger
        bytes memory badAuth = abi.encodePacked(r, s, v);
        bytes memory tee = _teeSig(teePk, text);
        vm.expectRevert(bytes("bad attestation"));
        outNft.mintOutputVerified(to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, badAuth, text, tee);
    }

    function test_NonceReplay_Reverts() public {
        _pinTee();
        string memory text = _text(keccak256("req"), keccak256("img"));
        bytes32 teeAtt = keccak256(bytes(text));
        bytes32 nonce = keccak256("n-replay");
        outNft.mintOutputVerified(
            to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, _authSig(teeAtt, nonce), text, _teeSig(teePk, text)
        );
        bytes memory auth = _authSig(teeAtt, nonce); // precompute before expectRevert
        bytes memory tee = _teeSig(teePk, text);
        vm.expectRevert(bytes("nonce used"));
        outNft.mintOutputVerified(to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, auth, text, tee);
    }

    // ============================ REAL 0G mainnet envelope ============================
    function test_RealMainnetEnvelope_RecoversRealSigner_AndBindsArt() public {
        vm.prank(attestor);
        outNft.setTeeSigner(REAL_SIGNER); // pin 0G's REAL published z-image-turbo enclave signer

        bytes32 teeAtt = keccak256(bytes(REAL_TEXT)); // backend commits teeAttestation = keccak(teeText)
        bytes32 nonce = keccak256("n-real");
        uint256 id = outNft.mintOutputVerified(
            to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, _authSig(teeAtt, nonce), REAL_TEXT, REAL_SIG
        );
        assertEq(outNft.ownerOf(id), to, "REAL 0G envelope minted a Relic");
        assertEq(outNft.dataHashOf(id), REAL_IMG_SHA, "bound dataHash == real sha256(image) 0G attested");

        // a one-byte forgery of the REAL sig must revert (rejects tampering of live data).
        bytes memory forged = REAL_SIG;
        forged[10] = forged[10] == bytes1(0x00) ? bytes1(0x01) : bytes1(0x00);
        bytes32 nonce2 = keccak256("n-real2");
        bytes memory auth2 = _authSig(teeAtt, nonce2); // precompute before expectRevert
        vm.expectRevert();
        outNft.mintOutputVerified(to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce2, auth2, REAL_TEXT, forged);
    }

    // ============================ fallback untouched ============================
    function test_MintOutput_FallbackStillWorks() public {
        bytes32 teeAtt = keccak256("tee");
        bytes32 nonce = keccak256("n-fallback");
        bytes memory sig = _authSig(teeAtt, nonce);
        uint256 id = outNft.mintOutput(to, agentId, IMAGE_ROOT, PROV, teeAtt, SEED, nonce, sig);
        assertEq(outNft.ownerOf(id), to, "the untouched mintOutput fallback still mints");
        assertEq(outNft.dataHashOf(id), bytes32(0), "fallback mint binds no dataHash");
    }
}
