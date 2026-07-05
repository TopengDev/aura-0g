// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {FuseGenome} from "./FuseGenome.sol";

/// @dev The exact surface AuraFusion needs from the real ERC-7857 AuraINFT. The Agent struct mirrors
///      AuraINFT.Agent field-for-field so getAgent() decodes (only styleFingerprint is read). mintAgent is
///      PERMISSIONLESS on AuraINFT, so fusion mints a REAL iNFT child through the real sealed-key path - no
///      minter role, no fake mechanism.
interface IAuraINFTFusion {
    struct Agent {
        string name;
        bytes32 styleFingerprint;
        string encBrainRoot;
        bytes32 dataHash;
        bytes32 modelAttestation;
        uint16 royaltyBps;
        uint16 styleVersion;
        uint16 creatorResaleBps;
    }

    function ownerOf(uint256 tokenId) external view returns (address);
    function getAgent(uint256 agentId) external view returns (Agent memory);
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
    ) external returns (uint256 agentId);
}

/// @title AuraFusion - FUSION: mint a hybrid child AuraINFT from TWO parent agents, with an on-chain-recomputable
///        genome and an un-grindable per-fusion seed. (AURA calls this FUSION, never "breeding".)
/// @notice The LOCKED design (Christopher, 2026-07-05):
///           - Own BOTH parents to fuse (cross-owner "stud" economy is post-cup).
///           - Parents PERSIST (never burned). The child is a new iNFT sealed to the fuser.
///           - ALLOW-REPEAT the same pair: each fusion has a unique per-fusion seed (unique requestId + a FUTURE
///             blockhash), so a repeat yields a DIFFERENT child (siblings, not clones). Scarcity is ECONOMIC
///             (fusion fee + per-Aura cooldown + rising breedCount + generation), not a one-per-pair cap.
///           - Pedigree/reputation inheritance is Tier-2 (this contract only RECORDS lineage: parents +
///             generation + genome). Memory L1-inherit / L2-reset is a later phase; the contract just records.
///
///         WHY commit-reveal on a FUTURE block: requestFusion() commits the parents + fuser BEFORE the target
///         block exists; executeFusion() reveals after it is mined, reading blockhash(targetBlock) into the seed.
///         Neither the operator nor the fuser can grind toward a favourable child (the entropy is fixed only
///         after commit, and is bound to the fuser + both parents' fingerprints via FuseGenome.fuseSeed).
///
///         HONEST ERC-7857: the child is minted through AuraINFT.mintAgent (the REAL sealed-key iNFT path),
///         sealed to the fuser, with a real per-owner sealed key - not a vanity interface-id. The heritable
///         genome is DERIVED ON-CHAIN (bit-exact recomputable), not caller-supplied, so it cannot be rigged.
contract AuraFusion is Ownable2Step, ReentrancyGuardTransient {
    using Address for address payable;
    using FuseGenome for bytes32;

    uint256 internal constant N_LOCI = 8;
    /// @notice The target block is `block.number + REVEAL_DELAY` (>= 1 => strictly a FUTURE block at commit).
    uint256 public constant REVEAL_DELAY = 1;
    /// @notice After this many blocks past the target, blockhash(target) is 0 (EVM 256-block window) => the
    ///         request can no longer be executed and the fee is reclaimable via refundExpiredFusion.
    uint256 public constant BLOCKHASH_WINDOW = 256;

    IAuraINFTFusion public immutable auraINFT;

    /// @notice Per-agent lineage + the discrete on-chain style genome (the heritable DNA).
    struct Lineage {
        bool genomeSet; // true once this agent has an anchored genome (genesis) or a derived one (fused child)
        uint32 generation; // 1 for a genesis agent; max(parentGen)+1 for a fused child
        uint32 breedCount; // times this agent has been used as a PARENT (rises => economic scarcity)
        uint64 lastFusedAt; // last time this agent was used as a parent (per-Aura cooldown anchor)
        uint256 parentA; // 0 for a genesis agent
        uint256 parentB; // 0 for a genesis agent
        bytes32 styleFingerprint; // cached from AuraINFT at registration/mint (feeds fuseSeed)
        uint16[N_LOCI] genome; // the 8-locus allele vector
    }

    /// @notice An open fusion request (commit-reveal on a future block).
    struct Request {
        address fuser;
        uint256 parentA;
        uint256 parentB;
        uint64 targetBlock; // the FUTURE block whose hash seeds this fusion
        uint256 fee; // escrowed fusion fee (credited to feeSink on execute, refunded to fuser if expired)
        bool executed;
        bool refunded;
    }

    mapping(uint256 => Lineage) internal _lineage;
    mapping(uint256 => Request) public requests;
    uint256 public nextRequestId = 1;

    /// @notice Fusion economics (owner-settable). fusionFee is charged per requestFusion; cooldown rate-limits
    ///         how often a given parent can be fused (consumed at request time).
    uint256 public fusionFee;
    uint256 public cooldown;
    /// @notice Where collected fusion fees accrue (pull). Defaults to the deployer; owner-settable.
    address public feeSink;

    /// @notice Pull-payment balances (fee sink accruals + expired-request fuser refunds + overpay).
    mapping(address => uint256) public pendingWithdrawals;

    event GenesisRegistered(uint256 indexed agentId, uint32 generation, bytes32 styleFingerprint);
    event FusionRequested(
        uint256 indexed requestId, address indexed fuser, uint256 indexed parentA, uint256 parentB, uint64 targetBlock, uint256 fee
    );
    event FusionExecuted(
        uint256 indexed requestId,
        uint256 indexed childId,
        uint256 parentA,
        uint256 parentB,
        bytes32 fuseSeed,
        uint32 generation
    );
    event FusionRefunded(uint256 indexed requestId, address indexed fuser, uint256 fee);
    event FusionFeeUpdated(uint256 fee);
    event CooldownUpdated(uint256 cooldown);
    event FeeSinkUpdated(address indexed feeSink);
    event Withdrawal(address indexed who, uint256 amount);

    constructor(address auraINFT_, uint256 fusionFee_, uint256 cooldown_) Ownable(msg.sender) {
        require(auraINFT_ != address(0), "auraINFT=0");
        auraINFT = IAuraINFTFusion(auraINFT_);
        fusionFee = fusionFee_;
        cooldown = cooldown_;
        feeSink = msg.sender;
    }

    // ------------------------------- genesis -------------------------------

    /// @notice Anchor a genesis agent's discrete style genome, making it FUSABLE. One-time, callable only by the
    ///         agent's current owner. generation is pinned to 1. The genome is the owner-declared discrete
    ///         decomposition of the agent's style (its styleFingerprint is the off-chain identity commitment);
    ///         for a FUSED child the genome is instead DERIVED on-chain (un-riggable). Alleles must be in-range.
    function registerGenesis(uint256 agentId, uint16[N_LOCI] calldata genome) external {
        require(auraINFT.ownerOf(agentId) == msg.sender, "not agent owner");
        require(!_lineage[agentId].genomeSet, "genome already set");
        uint16[N_LOCI] memory pools = FuseGenome.poolSizes();
        for (uint256 i = 0; i < N_LOCI; i++) {
            require(genome[i] < pools[i], "allele out of range");
        }
        bytes32 fp = auraINFT.getAgent(agentId).styleFingerprint;
        Lineage storage L = _lineage[agentId];
        L.genomeSet = true;
        L.generation = 1;
        L.styleFingerprint = fp;
        L.genome = genome;
        emit GenesisRegistered(agentId, 1, fp);
    }

    // ------------------------------- fuse: request -------------------------------

    /// @notice COMMIT phase: request a fusion of two agents you own. Charges the fusion fee (escrowed), checks
    ///         the gates, consumes each parent's cooldown, and commits a FUTURE target block. The child is
    ///         minted later in executeFusion once that block is mined (un-grindable). Returns the requestId.
    /// @dev GATES: own BOTH parents; parents differ (self-fuse revert); both have an anchored genome; both off
    ///      cooldown; fee paid. Cooldown is consumed HERE (rate-limits requests); breedCount rises on execute.
    function requestFusion(uint256 parentA, uint256 parentB) external payable nonReentrant returns (uint256 requestId) {
        require(parentA != parentB, "self-fuse"); // a parent cannot fuse with itself
        require(auraINFT.ownerOf(parentA) == msg.sender, "not owner of A");
        require(auraINFT.ownerOf(parentB) == msg.sender, "not owner of B"); // own BOTH parents
        Lineage storage a = _lineage[parentA];
        Lineage storage b = _lineage[parentB];
        require(a.genomeSet && b.genomeSet, "parent genome unset");
        // Cooldown applies only AFTER a parent's first fusion (lastFusedAt == 0 => never fused => fusable now).
        require(a.lastFusedAt == 0 || block.timestamp >= uint256(a.lastFusedAt) + cooldown, "A on cooldown");
        require(b.lastFusedAt == 0 || block.timestamp >= uint256(b.lastFusedAt) + cooldown, "B on cooldown");
        require(msg.value >= fusionFee, "fee too low");

        // EFFECTS: consume cooldown on both parents now (rate-limit further requests), escrow the fee, refund
        // any overpay (pull), and commit the future target block.
        a.lastFusedAt = uint64(block.timestamp);
        b.lastFusedAt = uint64(block.timestamp);

        uint256 overpay = msg.value - fusionFee;
        if (overpay > 0) {
            pendingWithdrawals[msg.sender] += overpay;
        }

        requestId = nextRequestId++;
        uint64 target = uint64(block.number + REVEAL_DELAY);
        requests[requestId] = Request(msg.sender, parentA, parentB, target, fusionFee, false, false);
        emit FusionRequested(requestId, msg.sender, parentA, parentB, target, fusionFee);
    }

    // ------------------------------- fuse: execute -------------------------------

    /// @notice REVEAL phase: once the target block is mined, derive the child genome from the un-grindable
    ///         fuseSeed and mint the hybrid child AuraINFT (sealed to the fuser). Only the fuser may call it.
    ///         The child's genome is DERIVED ON-CHAIN (bit-exact recomputable), so it cannot be rigged; the
    ///         caller supplies only the off-chain identity envelope (name, styleFingerprint, sealed brain).
    /// @param requestId          the open fusion request
    /// @param childName          the child agent's display name
    /// @param childStyleFingerprint the child's off-chain identity commitment (keccak(JCS(publicStyle)) that
    ///                              embeds the derived genome; verified off-chain, same boundary as create-agent)
    /// @param childEncBrainRoot  0G Storage root of the child's encrypted brain envelope
    /// @param childDataHash      sha256 of that envelope
    /// @param childModelAttestation TEE attestation hash of the child's model
    /// @param royaltyBps         the child's OUTPUT royalty (<= 2000, enforced by AuraINFT)
    /// @param creatorResaleBps   the child's creator-resale royalty (<= 2000, enforced by AuraINFT)
    /// @param childSealedKey     the child's AES data-key sealed to the FUSER's pubkey (real ERC-7857 seal)
    function executeFusion(
        uint256 requestId,
        string calldata childName,
        bytes32 childStyleFingerprint,
        string calldata childEncBrainRoot,
        bytes32 childDataHash,
        bytes32 childModelAttestation,
        uint16 royaltyBps,
        uint16 creatorResaleBps,
        bytes calldata childSealedKey
    ) external nonReentrant returns (uint256 childId) {
        Request storage r = requests[requestId];
        require(r.fuser == msg.sender, "not fuser");
        require(!r.executed && !r.refunded, "request closed");
        require(block.number > r.targetBlock, "target block not mined");
        bytes32 bh = _blockhashOf(r.targetBlock);
        require(bh != bytes32(0), "target blockhash unavailable"); // >256 blocks old => use refundExpiredFusion

        // Re-check ownership at reveal (the fuser must still own BOTH parents at mint time).
        require(auraINFT.ownerOf(r.parentA) == msg.sender, "no longer owner of A");
        require(auraINFT.ownerOf(r.parentB) == msg.sender, "no longer owner of B");

        Lineage storage a = _lineage[r.parentA];
        Lineage storage b = _lineage[r.parentB];

        // The un-grindable per-fusion seed, then the on-chain-recomputable child genome.
        bytes32 seed = FuseGenome.fuseSeed(requestId, r.fuser, a.styleFingerprint, b.styleFingerprint, bh);
        uint16[N_LOCI] memory childGenome =
            FuseGenome.deriveChildGenome(a.genome, b.genome, seed, FuseGenome.poolSizes());
        uint32 childGen = (a.generation >= b.generation ? a.generation : b.generation) + 1;

        // EFFECTS: close the request + rising breedCount on both parents BEFORE the external mint (CEI).
        r.executed = true;
        unchecked {
            a.breedCount += 1;
            b.breedCount += 1;
        }
        if (r.fee > 0) {
            pendingWithdrawals[feeSink] += r.fee;
        }

        // INTERACTION: mint the REAL ERC-7857 child iNFT sealed to the fuser (AuraINFT.mintAgent is
        // permissionless; the child carries a genuine per-owner sealed key). _safeMint pings the fuser's
        // onERC721Received - the reentrancy surface - and it is guarded (nonReentrant + effects-before-mint).
        childId = auraINFT.mintAgent(
            r.fuser,
            childName,
            childStyleFingerprint,
            childEncBrainRoot,
            childDataHash,
            childModelAttestation,
            royaltyBps,
            creatorResaleBps,
            childSealedKey
        );

        // Record the child's lineage: parents, generation, and the ON-CHAIN-DERIVED genome (a fused child is
        // itself immediately fusable => dynasties). breedCount starts at 0.
        Lineage storage c = _lineage[childId];
        c.genomeSet = true;
        c.generation = childGen;
        c.parentA = r.parentA;
        c.parentB = r.parentB;
        c.styleFingerprint = childStyleFingerprint;
        c.genome = childGenome;

        emit FusionExecuted(requestId, childId, r.parentA, r.parentB, seed, childGen);
    }

    /// @notice Reclaim the escrowed fee if a request could not be executed within the 256-block hash window
    ///         (the target blockhash is gone). Only the fuser; refunds the fee (pull). The parents' cooldown
    ///         stays consumed (it was a rate-limit); no child was minted so breedCount was never bumped.
    function refundExpiredFusion(uint256 requestId) external nonReentrant {
        Request storage r = requests[requestId];
        require(r.fuser == msg.sender, "not fuser");
        require(!r.executed && !r.refunded, "request closed");
        require(block.number > uint256(r.targetBlock) + BLOCKHASH_WINDOW, "not expired");
        r.refunded = true;
        if (r.fee > 0) {
            pendingWithdrawals[r.fuser] += r.fee;
        }
        emit FusionRefunded(requestId, r.fuser, r.fee);
    }

    // ------------------------------- withdraw -------------------------------

    /// @notice Withdraw an accrued pull balance (fee-sink accruals / expired-request refunds / overpay).
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        payable(msg.sender).sendValue(amount);
        emit Withdrawal(msg.sender, amount);
    }

    // ------------------------------- admin -------------------------------

    function setFusionFee(uint256 fee) external onlyOwner {
        fusionFee = fee;
        emit FusionFeeUpdated(fee);
    }

    function setCooldown(uint256 cooldown_) external onlyOwner {
        cooldown = cooldown_;
        emit CooldownUpdated(cooldown_);
    }

    function setFeeSink(address feeSink_) external onlyOwner {
        require(feeSink_ != address(0), "feeSink=0");
        feeSink = feeSink_;
        emit FeeSinkUpdated(feeSink_);
    }

    // ------------------------------- views -------------------------------

    /// @notice Full lineage record for an agent (genome + generation + breedCount + parents + fingerprint).
    function lineageOf(uint256 agentId) external view returns (Lineage memory) {
        return _lineage[agentId];
    }

    /// @notice The agent's 8-locus genome (allele indices). Zeroed if the agent is not fusable (no genome).
    function genomeOf(uint256 agentId) external view returns (uint16[N_LOCI] memory) {
        return _lineage[agentId].genome;
    }

    function generationOf(uint256 agentId) external view returns (uint32) {
        return _lineage[agentId].generation;
    }

    function breedCountOf(uint256 agentId) external view returns (uint32) {
        return _lineage[agentId].breedCount;
    }

    function isFusable(uint256 agentId) external view returns (bool) {
        return _lineage[agentId].genomeSet;
    }

    /// @notice Recompute the fuseSeed for a mined request (keyless verify: anyone re-derives the child from
    ///         this + the parents' public genomes). Reverts if the target blockhash is unavailable.
    function fuseSeedOf(uint256 requestId) external view returns (bytes32) {
        Request memory r = requests[requestId];
        require(r.fuser != address(0), "no such request");
        bytes32 bh = _blockhashOf(r.targetBlock);
        require(bh != bytes32(0), "blockhash unavailable");
        return FuseGenome.fuseSeed(
            requestId, r.fuser, _lineage[r.parentA].styleFingerprint, _lineage[r.parentB].styleFingerprint, bh
        );
    }

    /// @dev The block-hash source for the un-grindable fusion seed. Production returns the real EVM
    ///      `blockhash(blockNumber)` (available for the last 256 blocks). It is `virtual` ONLY so a test can
    ///      inject a deterministic historical blockhash - Foundry's bare (non-fork) EVM returns 0 for
    ///      `blockhash` of a rolled-over block, which would make executeFusion untestable otherwise. The
    ///      production behavior is unchanged.
    function _blockhashOf(uint256 blockNumber) internal view virtual returns (bytes32) {
        return blockhash(blockNumber);
    }
}
