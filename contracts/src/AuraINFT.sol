// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title AuraINFT - the DE-MOCKED creative-agent iNFT (REAL ERC-7857 secure transfer)
/// @notice This is the de-mocked successor to AgentRegistry: the ERC-7857 secure transfer is NO LONGER
///         a stub. Each "creative agent" is an NFT carrying an ENCRYPTED style-DNA pointer (on 0G
///         Storage), a public style fingerprint, the model attestation hash, AND an on-chain
///         ECIES-SEALED data-key (`sealedKey`) bound to the CURRENT owner's secp256k1 wallet pubkey.
///
///         WHAT WAS MOCKED, AND IS NOW REAL:
///           - AgentRegistry.transfer(to,tokenId,proofs) ignored `proofs` and fell back to a plain
///             ERC721 transfer; the brain stayed sealed to the original key and `BrainRekeyed` never
///             fired. There was also NO per-owner sealing at all (one server-held AES key).
///           - Here, ownership ONLY moves through transfer() with a VALID re-encryption proof signed by
///             the trusted oracle, the sealed key ROTATES to the new owner on-chain, the data hash
///             rotates, and BrainRekeyed + SealedKeyDelivered are emitted. Raw transferFrom /
///             safeTransferFrom REVERT (spec-strict ERC-7857).
///
///         TRUST MODEL (honest): the re-encryption oracle is a TRUSTED ECDSA SIGNER (an off-chain
///         server holding ORACLE_PRIVATE_KEY), NOT a hardware-TEE enclave. This is exactly the bar the
///         field actually ships today (mainnet ZeroArena's ReencryptionOracle is the same trusted-ECDSA
///         shape; genuine TEE-quote verification is everyone's unshipped roadmap, 0G included). The
///         contract VERIFIES the oracle's EIP-191 signature over the transfer tuple; it cannot itself
///         attest the off-chain re-encryption happened in an enclave. That is the documented bound.
///
///         Royalty: the original creator's EIP-2981 agent-resale royalty is preserved (pinned at mint),
///         unchanged from AgentRegistry.
contract AuraINFT is ERC721, ERC2981, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using Strings for uint256;

    struct Agent {
        string name;             // public display name (e.g. "NOKTURNE")
        bytes32 styleFingerprint;// hash of style-DNA -> provable agent identity (public)
        string encBrainRoot;     // 0G Storage root of the (re-)encrypted style-DNA ("brain") envelope
        bytes32 dataHash;        // sha256 of the encrypted envelope on storage; ROTATES on every transfer
        bytes32 modelAttestation;// TEE attestation hash of the model the agent runs on
        uint16 royaltyBps;       // OUTPUT royalty in basis points (consumed by OutputNFT)
        uint16 styleVersion;     // bumps on every re-key / brain update
        uint16 creatorResaleBps; // AGENT-RESALE royalty to the original creator (basis points)
    }

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;

    /// @notice Base URL the ERC-721 tokenURI() image field is built on: image = baseImageURI + "agent-" + id.
    ///         Owner-settable so the public portrait origin can be repointed without a redeploy. Display-only:
    ///         it can never touch the sealed brain, ownership, or royalties.
    string public baseImageURI;

    /// @notice The ORIGINAL creator (minter) of each agent. The EIP-2981 resale-royalty target.
    ///         Pinned at mint; does NOT change when the agent is transferred/resold.
    mapping(uint256 => address) public agentCreator;

    /// @notice The ECIES-sealed AES data-key for the agent's CURRENT owner. Sealed to the owner's
    ///         secp256k1 wallet pubkey off-chain; published here so the handoff is provable on-chain.
    ///         ROTATES on every secure transfer (re-encrypted to the new owner by the oracle).
    mapping(uint256 => bytes) public sealedKey;

    /// @notice The trusted ERC-7857 re-encryption oracle (an ECDSA signer). Settable by owner.
    ///         NOT a hardware TEE - a trusted off-chain signer, matching the shipped field bar.
    address public oracle;

    /// @notice Mirrors ERC-7857's PROOF_VALIDITY_PERIOD (informational; the actual deadline is carried
    ///         in each proof and enforced against block.timestamp).
    uint256 public constant PROOF_VALIDITY_PERIOD = 1 hours;

    /// @notice Replay guard: each oracle transfer-proof digest may be consumed exactly once.
    mapping(bytes32 => bool) public usedProof;

    event AgentMinted(
        uint256 indexed agentId,
        address indexed owner,
        string name,
        bytes32 styleFingerprint,
        uint16 royaltyBps,
        bytes32 modelAttestation,
        bytes32 dataHash
    );
    event BrainUpdated(uint256 indexed agentId, string encBrainRoot, bytes32 dataHash, uint16 styleVersion);
    /// @notice Emitted on a successful ERC-7857 secure transfer once the brain is re-keyed to the new owner.
    event BrainRekeyed(uint256 indexed agentId, string newEncRoot, bytes32 newDataHash, address indexed newOwner);
    /// @notice The re-encrypted, owner-sealed data-key delivered on transfer (the new owner decrypts it
    ///         with their wallet private key). Mirrors ZeroArena's SealedKeyDelivered.
    event SealedKeyDelivered(uint256 indexed agentId, address indexed newOwner, bytes sealedKey, bytes32 sealedKeyHash);
    event OracleUpdated(address indexed oracle);

    constructor(address oracle_, string memory baseImageURI_) ERC721("AURA Creative Agent", "AURA") Ownable(msg.sender) {
        oracle = oracle_; // may be address(0) at deploy; transfers are blocked until set
        baseImageURI = baseImageURI_;
        emit OracleUpdated(oracle_);
    }

    /// @notice Set the trusted ERC-7857 re-encryption oracle (ECDSA signer). Owner only.
    function setOracle(address oracle_) external onlyOwner {
        require(oracle_ != address(0), "oracle=0");
        oracle = oracle_;
        emit OracleUpdated(oracle_);
    }

    /// @notice Mint a new creative-agent iNFT (permissionless), with the data-key already sealed to `to`.
    /// @param to               recipient + ORIGINAL CREATOR (the resale-royalty beneficiary)
    /// @param dataHash         sha256 of the encrypted brain envelope on 0G Storage (commit to the data)
    /// @param sealedKey_       ECIES seal of the AES data-key to `to`'s secp256k1 pubkey (per-owner seal)
    function mintAgent(
        address to,
        string calldata name,
        bytes32 styleFingerprint,
        string calldata encBrainRoot,
        bytes32 dataHash,
        bytes32 modelAttestation,
        uint16 royaltyBps,
        uint16 creatorResaleBps,
        bytes calldata sealedKey_
    ) external returns (uint256 agentId) {
        require(royaltyBps <= 2000, "royalty too high");
        require(creatorResaleBps <= 2000, "resale royalty too high");
        require(sealedKey_.length > 0, "sealedKey required");
        agentId = nextAgentId++;
        _agents[agentId] =
            Agent(name, styleFingerprint, encBrainRoot, dataHash, modelAttestation, royaltyBps, 1, creatorResaleBps);
        agentCreator[agentId] = to;
        sealedKey[agentId] = sealedKey_;
        _safeMint(to, agentId);
        _setTokenRoyalty(agentId, to, creatorResaleBps);
        emit AgentMinted(agentId, to, name, styleFingerprint, royaltyBps, modelAttestation, dataHash);
        emit SealedKeyDelivered(agentId, to, sealedKey_, keccak256(sealedKey_));
    }

    /// @notice ERC-7857 SECURE TRANSFER (REAL - no longer a stub). Ownership moves ONLY through here.
    ///         The oracle has re-encrypted the brain to `to`, produced `newSealedKey` (sealed to `to`'s
    ///         pubkey) + `newEncBrainRoot`/`newDataHash` (the re-uploaded envelope), and SIGNED an
    ///         EIP-191 proof over the transfer tuple. This contract VERIFIES that proof recovers to
    ///         `oracle`, enforces the sealed key + data hash actually rotated, then flips ownership and
    ///         publishes the new sealed key.
    /// @param from           current owner (must equal ownerOf(tokenId))
    /// @param to             new owner the oracle re-encrypted to
    /// @param tokenId        the agent
    /// @param newSealedKey   the data-key ECIES-sealed to `to`'s pubkey (rotated)
    /// @param newEncBrainRoot 0G Storage root of the re-encrypted envelope
    /// @param newDataHash    sha256 of the re-encrypted envelope (rotated)
    /// @param deadline       proof expiry (unix seconds); must be >= block.timestamp
    /// @param proof          oracle's EIP-191 signature over the transfer tuple
    function transfer(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata newSealedKey,
        string calldata newEncBrainRoot,
        bytes32 newDataHash,
        uint256 deadline,
        bytes calldata proof
    ) external {
        require(oracle != address(0), "oracle unset");
        require(to != address(0), "to=0");
        require(from != to, "from==to");
        require(ownerOf(tokenId) == from, "from not owner");
        // Only the owner (or an operator they approved) may initiate the secure transfer.
        require(
            msg.sender == from || isApprovedForAll(from, msg.sender) || getApproved(tokenId) == msg.sender,
            "not owner nor approved"
        );
        require(block.timestamp <= deadline, "proof expired");
        require(newSealedKey.length > 0, "sealedKey required");

        // The brain must have actually been re-keyed: a fresh sealed key AND a fresh data hash.
        bytes32 newSealedKeyHash = keccak256(newSealedKey);
        require(newSealedKeyHash != keccak256(sealedKey[tokenId]), "sealedKey not rotated");
        require(newDataHash != _agents[tokenId].dataHash, "dataHash not rotated");

        // ERC-7857 trusted-signer proof: bind chain + this contract + token + parties + the rotated
        // (sealedKey, dataHash) + deadline. Mirrors ZeroArena's ReencryptionOracle digest.
        bytes32 digest = keccak256(
            abi.encodePacked(
                block.chainid, address(this), tokenId, from, to, newSealedKeyHash, newDataHash, deadline
            )
        );
        require(!usedProof[digest], "proof replayed");
        usedProof[digest] = true;

        address recovered = digest.toEthSignedMessageHash().recover(proof);
        require(recovered == oracle, "bad oracle proof");

        // Effects: rotate the sealed key + brain pointer, bump version, flip ownership.
        sealedKey[tokenId] = newSealedKey;
        Agent storage a = _agents[tokenId];
        a.encBrainRoot = newEncBrainRoot;
        a.dataHash = newDataHash;
        unchecked { a.styleVersion += 1; }

        _transfer(from, to, tokenId); // internal ERC721 move (NOT the reverting public path)

        emit BrainRekeyed(tokenId, newEncBrainRoot, newDataHash, to);
        emit SealedKeyDelivered(tokenId, to, newSealedKey, newSealedKeyHash);
    }

    /// @notice The EIP-191 transfer-proof digest the oracle must sign (for the off-chain oracle + tests).
    ///         Returns the RAW tuple hash; the oracle signs toEthSignedMessageHash(this) (personal_sign).
    function transferProofDigest(
        address from,
        address to,
        uint256 tokenId,
        bytes calldata newSealedKey,
        bytes32 newDataHash,
        uint256 deadline
    ) external view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                block.chainid, address(this), tokenId, from, to, keccak256(newSealedKey), newDataHash, deadline
            )
        );
    }

    /// @notice Owner-only brain update (re-tune / re-seal to self). Bumps styleVersion.
    function updateBrain(uint256 agentId, string calldata encBrainRoot, bytes32 dataHash, bytes calldata sealedKey_)
        external
    {
        require(ownerOf(agentId) == msg.sender, "not agent owner");
        require(sealedKey_.length > 0, "sealedKey required");
        Agent storage a = _agents[agentId];
        a.encBrainRoot = encBrainRoot;
        a.dataHash = dataHash;
        unchecked { a.styleVersion += 1; }
        sealedKey[agentId] = sealedKey_;
        emit BrainUpdated(agentId, encBrainRoot, dataHash, a.styleVersion);
        emit SealedKeyDelivered(agentId, msg.sender, sealedKey_, keccak256(sealedKey_));
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        require(_ownerOf(agentId) != address(0), "no such agent");
        return _agents[agentId];
    }

    function royaltyBpsOf(uint256 agentId) external view returns (uint16) {
        return _agents[agentId].royaltyBps;
    }

    function creatorResaleBpsOf(uint256 agentId) external view returns (uint16) {
        return _agents[agentId].creatorResaleBps;
    }

    function sealedKeyOf(uint256 agentId) external view returns (bytes memory) {
        return sealedKey[agentId];
    }

    /// @notice ERC-721 Metadata: a fully ON-CHAIN PUBLIC card (data:application/json;base64) for the agent.
    ///         Deliberately exposes ONLY the public identity (name, style fingerprint, model attestation,
    ///         royalties, style version) plus a public portrait image. It NEVER references the sealed brain
    ///         (encBrainRoot / dataHash / sealedKey): ERC-7857's private metadata stays sealed and off this
    ///         surface, so any wallet or explorer can render the agent with zero leak of the owned secret.
    function tokenURI(uint256 agentId) public view override returns (string memory) {
        require(_ownerOf(agentId) != address(0), "no such agent");
        Agent storage a = _agents[agentId];
        string memory image = string(abi.encodePacked(baseImageURI, "agent-", agentId.toString()));
        string memory attrs = string(
            abi.encodePacked(
                '{"trait_type":"Style Fingerprint","value":"', Strings.toHexString(uint256(a.styleFingerprint), 32), '"},',
                '{"trait_type":"Model Attestation","value":"', Strings.toHexString(uint256(a.modelAttestation), 32), '"},',
                '{"trait_type":"Style Version","value":"', uint256(a.styleVersion).toString(), '"},',
                '{"trait_type":"Output Royalty (bps)","value":"', uint256(a.royaltyBps).toString(), '"},',
                '{"trait_type":"Creator Resale (bps)","value":"', uint256(a.creatorResaleBps).toString(), '"}'
            )
        );
        string memory json = string(
            abi.encodePacked(
                '{"name":"', _jsonEscape(a.name),
                '","description":"An AURA creative agent (iNFT). It owns a provable, transferable creative identity and earns royalties on every Relic it makes. The agent brain is sealed and private (ERC-7857); this card shows only public identity.",',
                '"image":"', image, '",',
                '"external_url":"https://aura.topengdev.com/agents/', agentId.toString(), '",',
                '"attributes":[', attrs, ']}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    /// @notice Repoint the tokenURI image origin (e.g. if the portrait host moves). Owner-only; display-only.
    function setBaseImageURI(string calldata baseImageURI_) external onlyOwner {
        baseImageURI = baseImageURI_;
    }

    /// @dev Minimal JSON string escaper for the free-text agent name: escapes '"' and backslash and any
    ///      control char (< 0x20) as \u00XX, so a crafted name can never break the on-chain metadata JSON.
    ///      Raw UTF-8 (>= 0x20) passes through unchanged (JSON permits it) so unicode / emoji names survive.
    function _jsonEscape(string memory s) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out;
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c == 0x22) {
                out = abi.encodePacked(out, '\\"');
            } else if (c == 0x5c) {
                out = abi.encodePacked(out, "\\\\");
            } else if (c < 0x20) {
                out = abi.encodePacked(out, "\\u00", _hexPair(c));
            } else {
                out = abi.encodePacked(out, b[i]);
            }
        }
        return string(out);
    }

    function _hexPair(uint8 c) private pure returns (string memory) {
        bytes memory HEXD = "0123456789abcdef";
        bytes memory r = new bytes(2);
        r[0] = HEXD[c >> 4];
        r[1] = HEXD[c & 0x0f];
        return string(r);
    }

    // --- spec-strict ERC-7857: ownership moves ONLY through transfer() with an oracle proof ---
    // Raw ERC721 transfers REVERT, so the brain can never move to a new owner without being re-keyed.
    // (Trade-off vs marketplace compatibility is documented; AURA's marketplace would call transfer().)

    // NOTE: OZ's 3-arg safeTransferFrom(address,address,uint256) is non-virtual; it delegates to the
    // 4-arg overload below, so overriding transferFrom + the 4-arg safeTransferFrom is sufficient -
    // every raw-transfer entrypoint reverts.

    function transferFrom(address, address, uint256) public pure override {
        revert("use transfer(): ERC-7857 secure transfer required");
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert("use transfer(): ERC-7857 secure transfer required");
    }

    /// @dev ERC721 + ERC2981 both define supportsInterface -> must override both ("diamond").
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
