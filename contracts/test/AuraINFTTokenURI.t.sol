// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AuraBase} from "./AuraINFT.t.sol";
import {TokenURILib} from "./TokenURILib.sol";

/// @dev tokenURI() assertions for AuraINFT (the agent iNFT PUBLIC card). Verifies the card exposes ONLY the
///      public identity and NEVER the sealed brain (encBrainRoot / dataHash / sealedKey), and that a
///      JSON-unsafe agent name is escaped so the on-chain metadata JSON can never be corrupted.
contract AuraINFTTokenURITest is AuraBase {
    function _decoded(uint256 agentId) internal view returns (string memory) {
        return TokenURILib.b64decode(TokenURILib.afterFirstComma(inft.tokenURI(agentId)));
    }

    function test_TokenURI_HasDataUriPrefix() public {
        uint256 id = _mint(creator);
        string memory uri = inft.tokenURI(id);
        assertTrue(TokenURILib.startsWith(uri, "data:application/json;base64,"), "on-chain data uri");
        assertGt(bytes(uri).length, 120, "non-trivial payload");
    }

    function test_TokenURI_PublicCard_LeaksNoSealedData() public {
        // SEALED fields carry loud markers that must NEVER surface on the public card.
        uint256 id = inft.mintAgent(
            creator,
            "NOKTURNE",
            keccak256("style-dna"),
            "0g://SEALED-BRAIN-ROOT-DO-NOT-LEAK",
            keccak256("SEALED-DATA-HASH"),
            keccak256("model:qwen"),
            700,
            1000,
            hex"5ea1eddeadbeef"
        );
        string memory j = _decoded(id);
        // public identity present
        assertTrue(TokenURILib.contains(j, '"name":"NOKTURNE"'), "public name");
        assertTrue(TokenURILib.contains(j, '"image":"https://aura.topengdev.com/images/agent-'), "public portrait image");
        assertTrue(TokenURILib.contains(j, '"trait_type":"Style Fingerprint"'), "style fingerprint trait");
        assertTrue(TokenURILib.contains(j, '"trait_type":"Output Royalty (bps)","value":"700"'), "output royalty trait");
        assertTrue(TokenURILib.contains(j, '"trait_type":"Creator Resale (bps)","value":"1000"'), "creator resale trait");
        // sealed identifiers AND their values ABSENT
        assertFalse(TokenURILib.contains(j, "encBrainRoot"), "no encBrainRoot key");
        assertFalse(TokenURILib.contains(j, "dataHash"), "no dataHash key");
        assertFalse(TokenURILib.contains(j, "sealedKey"), "no sealedKey key");
        assertFalse(TokenURILib.contains(j, "SEALED-BRAIN-ROOT-DO-NOT-LEAK"), "no encBrainRoot value");
        assertFalse(TokenURILib.contains(j, "5ea1eddeadbeef"), "no sealedKey bytes");
    }

    function test_TokenURI_EscapesUnsafeName() public {
        // name laced with a double-quote, a backslash, and a TAB control char.
        string memory nastyName = string(abi.encodePacked("Ev", '"', "il", "\\", "Agent", hex"09", "X"));
        uint256 id = inft.mintAgent(
            creator, nastyName, keccak256("style-dna"), "0g://enc", keccak256("data"), keccak256("model"), 700, 1000, hex"01"
        );
        string memory j = _decoded(id);
        // the exact escaped form the escaper must produce: Ev\"il\\Agent	X
        string memory escaped = string(abi.encodePacked("Ev", '\\"', "il", "\\\\", "Agent", "\\u0009", "X"));
        assertTrue(TokenURILib.contains(j, escaped), "unsafe name is JSON-escaped");
        // the raw unescaped quote+backslash sequence must NOT appear
        assertFalse(TokenURILib.contains(j, string(abi.encodePacked("il", "\\", "Agent"))), "no raw backslash sequence");
    }

    function test_TokenURI_RevertsForNonexistent() public {
        vm.expectRevert(bytes("no such agent"));
        inft.tokenURI(9999);
    }

    function test_SetBaseImageURI_RepointsImage_OwnerOnly() public {
        uint256 id = _mint(creator);
        // a non-owner cannot repoint (OZ Ownable custom error)
        vm.prank(other);
        vm.expectRevert();
        inft.setBaseImageURI("ipfs://evil/");
        // the owner (this test deployed inft) can, and it flows into the image field
        inft.setBaseImageURI("ipfs://portraits/");
        assertTrue(
            TokenURILib.contains(_decoded(id), string(abi.encodePacked('"image":"ipfs://portraits/agent-', vm.toString(id)))),
            "repointed portrait image"
        );
    }

    function test_SupportsERC721Metadata() public view {
        assertTrue(inft.supportsInterface(0x5b5e139f), "advertises ERC721Metadata (0x5b5e139f)");
    }
}
