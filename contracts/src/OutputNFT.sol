// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

/// @title OutputNFT - the artwork NFT (ERC-721 + EIP-2981 dynamic royalty)
/// @notice Each artwork records WHICH agent created it + the 0G provenance (storage root,
///         provenance hash, TEE attestation). The EIP-2981 royaltyInfo() resolves the
///         beneficiary DYNAMICALLY to the creating agent's CURRENT owner - so selling the
///         agent transfers its entire future royalty stream. This is the thesis primitive.
contract OutputNFT is ERC721, IERC2981 {
    struct Provenance {
        uint256 creatorAgentId; // which agent made it → routes royalty
        string imageRoot;       // 0G Storage root of the image
        bytes32 provenanceHash; // hash of {agent, model, prompt, seed, attestation, ts}
        bytes32 teeAttestation; // TEE proof of the generating model
        uint256 seed;           // generation seed
    }

    AgentRegistry public immutable registry;
    uint256 public nextTokenId = 1;
    mapping(uint256 => Provenance) private _prov;

    event OutputMinted(
        uint256 indexed tokenId,
        uint256 indexed creatorAgentId,
        string imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation
    );

    constructor(address registryAddr) ERC721("Zero Cup Output", "ZCOUT") {
        registry = AgentRegistry(registryAddr);
    }

    function mintOutput(
        address to,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed
    ) external returns (uint256 tokenId) {
        // creatorAgentId must reference a real agent (its owner is the royalty target)
        registry.ownerOf(creatorAgentId); // reverts if agent doesn't exist
        tokenId = nextTokenId++;
        _prov[tokenId] = Provenance(creatorAgentId, imageRoot, provenanceHash, teeAttestation, seed);
        _safeMint(to, tokenId);
        emit OutputMinted(tokenId, creatorAgentId, imageRoot, provenanceHash, teeAttestation);
    }

    function provenanceOf(uint256 tokenId) external view returns (Provenance memory) {
        require(_ownerOf(tokenId) != address(0), "no such output");
        return _prov[tokenId];
    }

    /// @inheritdoc IERC2981
    /// @dev The beneficiary is the CURRENT owner of the creating agent - resolved live.
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        Provenance storage p = _prov[tokenId];
        uint256 agentId = p.creatorAgentId;
        receiver = registry.ownerOf(agentId);              // ← current agent owner
        uint16 bps = registry.royaltyBpsOf(agentId);
        royaltyAmount = (salePrice * bps) / 10_000;
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
}
