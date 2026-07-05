// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IAuraRegistry} from "./IAuraRegistry.sol";

/// @title ArenaReputation - the per-agent rating ladder anchor (Tier-2).
/// @notice The R7 split (dil-rating-ladder.md), one layer up from verify-public.ts: the per-battle VERDICTS are
///         already on-chain + bit-exact (ArenaVote's commit-reveal tally); the season ladder is a canonical
///         fixed-point integer Glicko-1 computed OFF-CHAIN over those verdicts, and ONLY its Merkle root is
///         anchored here (1 SSTORE / season). Anyone recomputes the whole ladder from the on-chain verdicts and
///         asserts the root matches (keyless verifyRating). This contract stores NO float math and runs NO
///         Glicko on-chain; it is a trust anchor + a keyless verifier, nothing more.
///
///         KEYED TO THE iNFT: a rating is keyed by agentId, and its economic holder is `registry.ownerOf(agentId)`
///         (currentHolderOf). Because it is agent-keyed (like the EIP-2981 royalty rail), the reputation
///         TRANSFERS WITH the iNFT when the agent is sold - the Living-Agents property.
///
///         HARD RULE (dil-rating-ladder.md 6.2): rank feeds a SIGNAL (price / matchmaking / siring value),
///         it NEVER mints or emits a token. There is deliberately NO reward/emission function on this contract:
///         attaching a payout to a gameable rank is the LooksRare wash-trading regime (~90% wash). Rank informs
///         what a buyer will pay; it never pays out directly.
contract ArenaReputation is Ownable2Step {
    /// @notice The agent registry a rating resolves to (ownerOf => the current economic holder of the rating).
    IAuraRegistry public immutable registry;

    /// @notice The address authorized to anchor season roots (the off-chain Glicko-1 compute service). The
    ///         owner may also anchor. Anchoring publishes a commitment only; it can never mint or move value.
    address public anchorer;

    /// @notice seasonEpoch => Merkle root of the sorted { agentId -> (rating, RD) } ladder for that season.
    mapping(uint256 => bytes32) public seasonRoot;
    /// @notice The latest anchored season (monotonic).
    uint256 public currentSeason;

    event AnchorerUpdated(address indexed anchorer);
    event SeasonAnchored(uint256 indexed seasonEpoch, bytes32 ladderRoot);

    constructor(address registry_, address anchorer_) Ownable(msg.sender) {
        require(registry_ != address(0), "registry=0");
        registry = IAuraRegistry(registry_);
        anchorer = anchorer_; // may be address(0) until set
        emit AnchorerUpdated(anchorer_);
    }

    /// @notice Set / rotate the season anchorer (the off-chain fixed-point Glicko-1 compute service).
    function setAnchorer(address anchorer_) external onlyOwner {
        anchorer = anchorer_;
        emit AnchorerUpdated(anchorer_);
    }

    /// @notice Anchor a season's ladder root. The root commits the whole { agentId -> (rating, RD) } table; a
    ///         keyless verifier recomputes the fixed-point Glicko-1 over the on-chain verdicts and asserts the
    ///         recomputed root == this. Monotonic seasons (soft resets carry rating forward, inflate RD).
    function anchorSeason(uint256 seasonEpoch, bytes32 ladderRoot) external {
        require(msg.sender == anchorer || msg.sender == owner(), "not anchorer");
        require(ladderRoot != bytes32(0), "empty root");
        require(seasonEpoch >= currentSeason, "stale season");
        seasonRoot[seasonEpoch] = ladderRoot;
        currentSeason = seasonEpoch;
        emit SeasonAnchored(seasonEpoch, ladderRoot);
    }

    /// @notice Keyless verification that (agentId, rating, rd) is in the anchored ladder for a season. The leaf
    ///         is the OZ-standard double-hashed leaf (keccak(bytes.concat(keccak(abi.encode(...))))), so it is
    ///         second-preimage-safe and matches an off-chain OpenZeppelin StandardMerkleTree (merkle-tree pkg).
    /// @param seasonEpoch the season the proof is against
    /// @param agentId     the rated agent
    /// @param rating      the fixed-point Glicko-1 rating (scaled integer)
    /// @param rd          the fixed-point rating deviation (scaled integer)
    /// @param proof       the Merkle proof from the off-chain ladder tree
    function verifyRating(uint256 seasonEpoch, uint256 agentId, uint32 rating, uint32 rd, bytes32[] calldata proof)
        external
        view
        returns (bool)
    {
        bytes32 root = seasonRoot[seasonEpoch];
        if (root == bytes32(0)) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(agentId, rating, rd))));
        return MerkleProof.verify(proof, root, leaf);
    }

    /// @notice The leaf encoding, exposed so the off-chain ladder builder and tests derive the identical leaf.
    function leafOf(uint256 agentId, uint32 rating, uint32 rd) external pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(agentId, rating, rd))));
    }

    /// @notice The current economic holder of an agent's rating (the rating follows the iNFT on transfer).
    function currentHolderOf(uint256 agentId) external view returns (address) {
        return registry.ownerOf(agentId);
    }
}
