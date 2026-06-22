// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistry - Creative Agent as an iNFT (ERC-7857-style MVP)
/// @notice Smoke-test MVP of the "creative agent" iNFT for the Zero Cup build.
///         The full ERC-7857 standard adds a TEE-oracle-verified SECURE TRANSFER that
///         re-encrypts the private "brain" to the new owner's key. That oracle is the
///         hard part and is intentionally OUT of MVP scope (build-plan §4.1). Here we
///         keep the *data model* + ownership (which is all the royalty routing needs):
///         each agent carries an ENCRYPTED style-DNA pointer (on 0G Storage) + a public
///         style fingerprint + the model TEE-attestation hash. ownerOf(agentId) is the
///         royalty beneficiary used by OutputNFT.royaltyInfo().
contract AgentRegistry is ERC721, Ownable {
    struct Agent {
        string name;             // public display name (e.g. "NOKTURNE")
        bytes32 styleFingerprint;// hash of style-DNA → provable agent identity (public)
        string encBrainRoot;     // 0G Storage root of the ENCRYPTED style-DNA ("brain")
        bytes32 modelAttestation;// TEE attestation hash of the model the agent runs on
        uint16 royaltyBps;       // royalty on each output sale (basis points, e.g. 700 = 7%)
        uint16 styleVersion;     // bumps if the brain is retuned
    }

    uint256 public nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;

    event AgentMinted(uint256 indexed agentId, address indexed owner, string name, bytes32 styleFingerprint);
    event BrainUpdated(uint256 indexed agentId, string encBrainRoot, uint16 styleVersion);

    constructor() ERC721("Zero Cup Creative Agent", "ZCAGENT") Ownable(msg.sender) {}

    /// @notice Mint a new creative agent iNFT.
    function mintAgent(
        address to,
        string calldata name,
        bytes32 styleFingerprint,
        string calldata encBrainRoot,
        bytes32 modelAttestation,
        uint16 royaltyBps
    ) external returns (uint256 agentId) {
        require(royaltyBps <= 2000, "royalty too high"); // cap 20%
        agentId = nextAgentId++;
        _agents[agentId] = Agent(name, styleFingerprint, encBrainRoot, modelAttestation, royaltyBps, 1);
        _safeMint(to, agentId);
        emit AgentMinted(agentId, to, name, styleFingerprint);
    }

    /// @notice Update the encrypted-brain pointer (e.g. after retuning style-DNA). Owner only.
    function updateBrain(uint256 agentId, string calldata encBrainRoot) external {
        require(ownerOf(agentId) == msg.sender, "not agent owner");
        Agent storage a = _agents[agentId];
        a.encBrainRoot = encBrainRoot;
        a.styleVersion += 1;
        emit BrainUpdated(agentId, encBrainRoot, a.styleVersion);
    }

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        require(_ownerExists(agentId), "no such agent");
        return _agents[agentId];
    }

    function royaltyBpsOf(uint256 agentId) external view returns (uint16) {
        return _agents[agentId].royaltyBps;
    }

    function _ownerExists(uint256 agentId) internal view returns (bool) {
        return _ownerOf(agentId) != address(0);
    }

    // --- ERC-7857 full-standard stubs (documented, out of MVP scope) ---
    // function transferSecure(address to, uint256 agentId, bytes calldata reEncryptProof) external;
    //   ↑ Full standard: a TEE oracle verifies the brain was re-encrypted to `to`'s key,
    //     THEN transfers. MVP uses the inherited ERC721 transfer (brain stays sealed to the
    //     original key); acceptable for the hackathon demo, flagged honestly to judges.
}
