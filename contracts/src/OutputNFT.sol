// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AgentRegistry} from "./AgentRegistry.sol";

/// @title OutputNFT - the artwork NFT (ERC-721 + DYNAMIC EIP-2981 royalty + EIP-712 attestation gate)
/// @notice Each artwork records WHICH agent created it + the 0G provenance (storage root,
///         provenance hash, TEE attestation, seed). The EIP-2981 royaltyInfo() resolves the
///         beneficiary DYNAMICALLY to the creating agent's CURRENT owner - so selling the agent
///         transfers its entire future royalty stream. This is the thesis primitive; it is a
///         HAND-ROLLED royaltyInfo (NOT OZ ERC2981), intentionally, because the receiver must be
///         resolved live at call time, not pinned at mint.
///
///         Minting is ATTESTATION-GATED: the user sends the mint tx themselves, but it only
///         succeeds with a valid backend-attestor EIP-712 signature over the exact mint params.
///         This binds every on-chain artwork to a TEE-attested off-chain generation (consent +
///         provenance), and a per-signature nonce blocks replay. Forged/garbage/replayed -> revert.
contract OutputNFT is ERC721, IERC2981, EIP712 {
    using ECDSA for bytes32;

    struct Provenance {
        uint256 creatorAgentId; // which agent made it -> routes royalty
        string imageRoot;       // 0G Storage root of the image
        bytes32 provenanceHash; // hash of {agent, model, prompt, seed, attestation, ts}
        bytes32 teeAttestation; // TEE proof of the generating model
        uint256 seed;           // generation seed
    }

    AgentRegistry public immutable registry;
    /// @notice The backend signer (TEE-attestation authority). Set at deploy; mints require its sig.
    address public immutable attestor;

    uint256 public nextTokenId = 1;
    mapping(uint256 => Provenance) private _prov;
    /// @notice Replay guard: each attestation nonce may be consumed exactly once.
    mapping(bytes32 => bool) public usedNonce;

    // EIP-712 typed struct the backend attestor signs.
    bytes32 private constant MINTAUTH_TYPEHASH = keccak256(
        "MintAuth(address to,uint256 creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation,uint256 seed,uint256 nonce)"
    );

    event OutputMinted(
        uint256 indexed tokenId,
        uint256 indexed creatorAgentId,
        address indexed owner,
        string imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed
    );

    constructor(address registryAddr, address attestor_)
        ERC721("Zero Cup Output", "ZCOUT")
        EIP712("AuraOutputNFT", "1")
    {
        require(attestor_ != address(0), "attestor required");
        registry = AgentRegistry(registryAddr);
        attestor = attestor_;
    }

    /// @notice Mint a provenance-stamped artwork. Requires a valid attestor EIP-712 signature.
    /// @param to              recipient of the artwork
    /// @param creatorAgentId  the agent that generated it (must exist; its CURRENT owner earns royalty)
    /// @param attestationSig  attestor's EIP-712 signature over MintAuth(...nonce)
    /// @param nonce           single-use nonce binding this signature (replay guard)
    function mintOutput(
        address to,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce,
        bytes calldata attestationSig
    ) external returns (uint256 tokenId) {
        require(!usedNonce[nonce], "nonce used");
        // creatorAgentId must reference a real agent (its owner is the dynamic royalty target).
        registry.ownerOf(creatorAgentId); // reverts if agent doesn't exist

        bytes32 structHash = keccak256(
            abi.encode(
                MINTAUTH_TYPEHASH,
                to,
                creatorAgentId,
                keccak256(bytes(imageRoot)),
                provenanceHash,
                teeAttestation,
                seed,
                nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(attestationSig); // reverts on malformed signature
        require(recovered == attestor, "bad attestation");

        usedNonce[nonce] = true;
        tokenId = nextTokenId++;
        _prov[tokenId] = Provenance(creatorAgentId, imageRoot, provenanceHash, teeAttestation, seed);
        _safeMint(to, tokenId);
        emit OutputMinted(tokenId, creatorAgentId, to, imageRoot, provenanceHash, teeAttestation, seed);
    }

    /// @notice Compute the EIP-712 digest the attestor must sign for a given mint (for backend/tests).
    function authDigest(
        address to,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                MINTAUTH_TYPEHASH,
                to,
                creatorAgentId,
                keccak256(bytes(imageRoot)),
                provenanceHash,
                teeAttestation,
                seed,
                nonce
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function provenanceOf(uint256 tokenId) external view returns (Provenance memory) {
        require(_ownerOf(tokenId) != address(0), "no such output");
        return _prov[tokenId];
    }

    /// @inheritdoc IERC2981
    /// @dev The beneficiary is the CURRENT owner of the creating agent - resolved LIVE at call time.
    ///      This is what lets the royalty stream follow the agent when the agent is sold.
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        override
        returns (address receiver, uint256 royaltyAmount)
    {
        Provenance storage p = _prov[tokenId];
        uint256 agentId = p.creatorAgentId;
        receiver = registry.ownerOf(agentId);              // current agent owner (dynamic)
        uint16 bps = registry.royaltyBpsOf(agentId);
        royaltyAmount = (salePrice * bps) / 10_000;
    }

    /// @dev Hand-rolled IERC2981 (not OZ ERC2981) -> override(ERC721, IERC165). NOTE: override(ERC721,
    ///      IERC2981) does NOT compile here because IERC2981 has no supportsInterface to override.
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
}
