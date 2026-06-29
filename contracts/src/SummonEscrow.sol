// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title SummonEscrow - demand-pull commissioning for AURA autonomous agents (the net-new "Summon" delta)
/// @notice A buyer PAYS to summon an agent; the agent (its autonomous runner) generates a 1/1 LIVE, then
///         atomically MINTS the output to the buyer (via the existing attestation-gated OutputNFT) and the
///         escrowed fee SPLITS to the agent's CURRENT owner + the platform. If the runner fails to deliver
///         by the deadline, the buyer refunds. This is the structural anti-spam answer: the agent NEVER
///         generates speculatively - supply can never exceed paid demand.
///
///         Owner earnings = (1) the summon-fee cut here (primary, immediate on fulfill) PLUS (2) the
///         perpetual EIP-2981 resale royalty already on OutputNFT (unchanged). BOTH resolve to the agent's
///         CURRENT owner, so selling the agent transfers the entire future income - the AURA ownership thesis.
///
///         Reuses, does NOT replace: OutputNFT (mint + attestation gate + dynamic royalty) and
///         AgentRegistry (ownerOf) are untouched. The mint stays attestor-gated, so only the real
///         TEE-attested generation can settle a summon.
///
///         SECURITY (mirrors AuraMarketplace, hardened over the smoke-validated 16/16 prototype):
///           - PULL PAYMENTS for every value-out (owner cut / platform fee / buyer refund / overpay) -
///             a hostile recipient can neither brick a settlement nor re-enter it.
///           - CEI + nonReentrant (EIP-1153 transient-storage guard, cancun) on every state-changing,
///             value-bearing path. The one external interaction in fulfill is OutputNFT.mintOutput, whose
///             _safeMint pings the buyer's onERC721Received - the reentrancy surface - and it is fully
///             guarded (r.settled flipped BEFORE the mint + nonReentrant).
///           - Escrow holds EXACTLY the price; any overpay is refunded (pull), matching buy(). A maxPrice
///             slippage guard makes the buyer's payment intent explicit + front-run-resistant.
///           - platformBps is IMMUTABLE (no owner can re-cut an in-flight escrow) and capped at deploy.
///           - Pausable circuit-breaker on summon() ONLY (stop NEW escrows in an emergency); fulfill /
///             refund / withdraw are NEVER pausable, so escrowed funds can never be trapped.
///           - The CORE SAFETY INVARIANT: every escrowed fee has exactly one terminal owner - it is either
///             split to (agentOwner, platform) on fulfill OR refunded to the buyer after the deadline,
///             never both, never neither. A forged/replayed attestation reverts the whole settlement and
///             leaves the escrow intact for the refund path.
interface IAgentRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IOutputNFT {
    function mintOutput(
        address to,
        uint256 creatorAgentId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce,
        bytes calldata attestationSig
    ) external returns (uint256 tokenId);
}

contract SummonEscrow is Ownable2Step, Pausable, ReentrancyGuardTransient {
    using Address for address payable;

    /// @notice Hard ceiling on the platform cut of a summon fee (parity with AuraMarketplace).
    uint16 public constant MAX_PLATFORM_BPS = 1000; // 10%
    /// @notice How long the runner has to deliver before the buyer can refund.
    uint256 public constant FULFILL_WINDOW = 1 hours;

    IAgentRegistry public immutable registry;
    IOutputNFT public immutable outputNFT;
    address public immutable platform;
    uint16 public immutable platformBps;

    struct Request {
        address buyer;
        uint256 agentId;
        uint256 fee; // the escrowed amount (EXACTLY the price at summon time; overpay is refunded separately)
        uint64 deadline;
        bool settled; // fulfilled OR refunded (single terminal state)
    }

    /// @notice agentId => the owner-set commission price (0 = not summonable).
    mapping(uint256 => uint256) public summonPrice;
    mapping(uint256 => Request) public requests;
    uint256 public nextRequestId = 1;
    /// @notice pull-payment balances (agent owner cut / platform fee / buyer refund / buyer overpay).
    mapping(address => uint256) public pendingWithdrawals;

    event SummonPriceSet(uint256 indexed agentId, address indexed owner, uint256 price);
    event Summoned(uint256 indexed requestId, uint256 indexed agentId, address indexed buyer, uint256 fee, uint64 deadline);
    event Fulfilled(
        uint256 indexed requestId,
        uint256 indexed agentId,
        address indexed buyer,
        uint256 tokenId,
        address agentOwner,
        uint256 ownerCut,
        uint256 platformFee
    );
    event Refunded(uint256 indexed requestId, address indexed buyer, uint256 fee);
    event Withdrawal(address indexed who, uint256 amount);

    constructor(address registry_, address outputNFT_, address platform_, uint16 platformBps_) Ownable(msg.sender) {
        require(registry_ != address(0) && outputNFT_ != address(0), "zero addr");
        require(platform_ != address(0), "platform required");
        require(platformBps_ <= MAX_PLATFORM_BPS, "platform bps too high");
        registry = IAgentRegistry(registry_);
        outputNFT = IOutputNFT(outputNFT_);
        platform = platform_;
        platformBps = platformBps_;
    }

    // ----------------------------- pricing ----------------------------

    /// @notice The agent's owner sets (or updates) its commission price. 0 disables summoning.
    ///         Affects only FUTURE summons; in-flight requests keep the fee they escrowed.
    function setSummonPrice(uint256 agentId, uint256 price) external {
        require(registry.ownerOf(agentId) == msg.sender, "not agent owner");
        summonPrice[agentId] = price;
        emit SummonPriceSet(agentId, msg.sender, price);
    }

    // ----------------------------- summon -----------------------------

    /// @notice Pay to summon an agent. EXACTLY the current price is escrowed until the runner delivers
    ///         (or the deadline passes); any overpay is refunded via pull. `maxPrice` caps what the buyer
    ///         will pay, so an owner cannot front-run a price hike to skim a buyer's slippage buffer.
    /// @param agentId  the agent to commission (must be summonable: price > 0)
    /// @param maxPrice the most the buyer is willing to pay (slippage guard; pass the displayed price)
    function summon(uint256 agentId, uint256 maxPrice)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 requestId)
    {
        uint256 price = summonPrice[agentId];
        require(price > 0, "agent not summonable");
        require(price <= maxPrice, "price exceeds max"); // slippage / front-run guard
        require(msg.value >= price, "insufficient payment");
        registry.ownerOf(agentId); // defensive: reverts if the agent somehow doesn't exist

        requestId = nextRequestId++;
        uint64 deadline = uint64(block.timestamp + FULFILL_WINDOW);
        // EFFECTS: escrow EXACTLY the price; credit any overpay back to the buyer (pull).
        requests[requestId] = Request(msg.sender, agentId, price, deadline, false);
        uint256 overpay = msg.value - price;
        if (overpay > 0) {
            pendingWithdrawals[msg.sender] += overpay;
        }
        emit Summoned(requestId, agentId, msg.sender, price, deadline);
    }

    // ----------------------------- fulfill ----------------------------

    /// @notice The runner delivers: mint the TEE-attested output to the buyer + release the fee split.
    ///         Atomic - if the mint reverts (bad/forged/replayed attestation), the whole settlement reverts
    ///         and the escrow stays intact (the buyer can still refund after the deadline). Permissionless
    ///         to CALL, but the attestation sig binds (buyer, agentId, gen-params, nonce): only the runner's
    ///         valid attestor signature lets the mint - and thus the split - succeed, and a leaked sig can
    ///         only ever settle THIS request as already intended (mint -> the bound buyer).
    function fulfill(
        uint256 requestId,
        string calldata imageRoot,
        bytes32 provenanceHash,
        bytes32 teeAttestation,
        uint256 seed,
        bytes32 nonce,
        bytes calldata attestationSig
    ) external nonReentrant returns (uint256 tokenId) {
        Request storage r = requests[requestId];
        require(r.buyer != address(0), "no such request");
        require(!r.settled, "already settled");
        require(block.timestamp <= r.deadline, "request expired");

        r.settled = true; // EFFECTS before the external mint (CEI)

        // INTERACTION: mint the output to the buyer. OutputNFT verifies the attestor sig over
        // (r.buyer, r.agentId, imageRoot, provenanceHash, teeAttestation, seed, nonce) + the nonce replay
        // guard; a forged or replayed attestation reverts here, unwinding r.settled (buyer can still refund).
        tokenId = outputNFT.mintOutput(r.buyer, r.agentId, imageRoot, provenanceHash, teeAttestation, seed, nonce, attestationSig);

        // SPLIT the escrowed fee: platform cut + owner remainder, credited as pull balances. The remainder
        // absorbs the rounding, so ownerCut + platformFee == fee exactly (value is conserved).
        address agentOwner = registry.ownerOf(r.agentId); // CURRENT owner (dynamic - follows the agent)
        uint256 platformFee = (r.fee * platformBps) / 10_000;
        uint256 ownerCut = r.fee - platformFee;
        pendingWithdrawals[agentOwner] += ownerCut;
        if (platformFee > 0) {
            pendingWithdrawals[platform] += platformFee;
        }

        emit Fulfilled(requestId, r.agentId, r.buyer, tokenId, agentOwner, ownerCut, platformFee);
    }

    // ----------------------------- refund -----------------------------

    /// @notice Buyer reclaims the fee if the runner never delivered before the deadline (the anti-rug path).
    function refund(uint256 requestId) external nonReentrant {
        Request storage r = requests[requestId];
        require(r.buyer == msg.sender, "not buyer");
        require(!r.settled, "already settled");
        require(block.timestamp > r.deadline, "not yet expired");

        r.settled = true;
        pendingWithdrawals[r.buyer] += r.fee;
        emit Refunded(requestId, r.buyer, r.fee);
    }

    // ---------------------------- withdraw ----------------------------

    /// @notice Withdraw an accrued pull balance (owner cut / platform fee / buyer refund / overpay).
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0; // effects before interaction
        payable(msg.sender).sendValue(amount);
        emit Withdrawal(msg.sender, amount);
    }

    // ------------------------------ admin -----------------------------

    /// @notice Emergency circuit-breaker: stop NEW summons. Does NOT touch fulfill / refund / withdraw,
    ///         so every in-flight escrow stays fully settleable + refundable while paused.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
