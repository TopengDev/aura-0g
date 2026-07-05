// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuraBase} from "./Aura.t.sol";
import {TokenURILib} from "./TokenURILib.sol";

/// @dev tokenURI() assertions for OutputNFT (the Relics). Reuses AuraBase (Aura.t.sol) for the registry +
///      attestor-signed mint machinery, then decodes the on-chain data:application/json;base64 metadata and
///      asserts the ERC-721 shape, the https image at the existing route, the provenance attributes, and the
///      provable rarity tiers (bit-exact with server deriveRarity()).
contract OutputNFTTokenURITest is AuraBase {
    function _mintOutputSeed(address to, uint256 agentId, uint256 seed, bytes32 nonce)
        internal
        returns (uint256 tokenId)
    {
        bytes32 digest = outNft.authDigest(to, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), seed, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        tokenId = outNft.mintOutput(
            to, agentId, "0g://image-root", keccak256("prov"), keccak256("tee"), seed, nonce, abi.encodePacked(r, s, v)
        );
    }

    function _decoded(uint256 tokenId) internal view returns (string memory) {
        return TokenURILib.b64decode(TokenURILib.afterFirstComma(outNft.tokenURI(tokenId)));
    }

    function test_TokenURI_HasDataUriPrefix() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("uri-prefix"));
        string memory uri = outNft.tokenURI(tokenId);
        assertTrue(TokenURILib.startsWith(uri, "data:application/json;base64,"), "on-chain data uri");
        assertGt(bytes(uri).length, 120, "non-trivial payload");
    }

    function test_TokenURI_DecodesToExpectedRelicJSON() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("uri-json")); // helper seed 42 -> Common
        string memory j = _decoded(tokenId);
        assertTrue(TokenURILib.contains(j, '"name":"AURA Relic #'), "name");
        assertTrue(TokenURILib.contains(j, '"image":"https://aura.topengdev.com/images/0g://image-root"'), "https image at /images route");
        assertTrue(TokenURILib.contains(j, '"external_url":"https://aura.topengdev.com/outputs/'), "external_url");
        assertTrue(TokenURILib.contains(j, '"trait_type":"Image Root","value":"0g://image-root"'), "image root trait");
        assertTrue(
            TokenURILib.contains(j, string(abi.encodePacked('"trait_type":"Creator Agent","value":"', vm.toString(agentId), '"'))),
            "creator agent trait"
        );
        assertTrue(TokenURILib.contains(j, '"trait_type":"Provenance Hash"'), "provenance hash trait");
        assertTrue(TokenURILib.contains(j, '"trait_type":"TEE Attestation"'), "tee attestation trait");
        assertTrue(TokenURILib.contains(j, '"trait_type":"Seed"'), "seed trait");
    }

    function test_TokenURI_RarityTiersMatchDeriveRarity() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        // legacy/decorative seed (< 2^64) -> Common
        uint256 cId = _mintOutputSeed(seller, agentId, 42, keccak256("r-common"));
        assertTrue(TokenURILib.contains(_decoded(cId), '"trait_type":"Rarity","value":"Common"'), "Common for legacy seed");
        // uint256(keccak256("smoke-seed")) -> roll 9960 -> Legendary (cross-checked off-chain vs deriveRarity)
        uint256 lId = _mintOutputSeed(seller, agentId, uint256(keccak256("smoke-seed")), keccak256("r-leg"));
        assertTrue(TokenURILib.contains(_decoded(lId), '"trait_type":"Rarity","value":"Legendary"'), "Legendary for pull seed");
    }

    function test_TokenURI_RevertsForNonexistent() public {
        vm.expectRevert(bytes("no such output"));
        outNft.tokenURI(9999);
    }

    function test_SetBaseImageURI_RepointsImage_AttestorOnly() public {
        vm.prank(creator);
        uint256 agentId = _mintAgentTo(creator, 700, 1000);
        uint256 tokenId = _mintOutputTo(seller, agentId, keccak256("repoint"));
        assertTrue(TokenURILib.contains(_decoded(tokenId), '"image":"https://aura.topengdev.com/images/0g://image-root"'), "default base");
        // a non-attestor cannot repoint
        vm.prank(other);
        vm.expectRevert(bytes("only attestor"));
        outNft.setBaseImageURI("ipfs://evil/");
        // the attestor can, and it flows into the image field
        vm.prank(attestor);
        outNft.setBaseImageURI("ipfs://newbase/");
        assertTrue(TokenURILib.contains(_decoded(tokenId), '"image":"ipfs://newbase/0g://image-root"'), "repointed image");
    }

    function test_SupportsERC721Metadata() public view {
        assertTrue(outNft.supportsInterface(0x5b5e139f), "advertises ERC721Metadata (0x5b5e139f)");
    }
}
