// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IPersonhoodGate} from "./IPersonhoodGate.sol";

/// @title PersonhoodGate - a reference STUB of the two keyless 0G-native personhood floors (Tier-3).
/// @notice Implements the two KEYLESS floors for real (they are cheap + need no external oracle) and leaves the
///         World-ID convenience tier explicitly UNIMPLEMENTED this phase (registerWorldId reverts):
///           - Floor 1 HOLD-AN-AURA:   aura.balanceOf(who) >= 1  (the AuraINFT is an ERC-721).
///           - Floor 2 CONVICTION:     convictionOf(who) >= minConviction (a refundable ETH stake).
///         isPerson() = holdsAura || meetsConviction. worldIdVerified() is always false until the World-ID root
///         bridge ships (post-cup). This is a STUB by scope (World-ID), not a fake: the two 0G-native floors
///         are genuine, keyless, and immediately usable as the Arena's anti-sybil floor.
contract PersonhoodGate is IPersonhoodGate, Ownable2Step, ReentrancyGuardTransient {
    using Address for address payable;

    IERC721 public immutable aura;
    /// @notice Minimum conviction stake (wei) to clear Floor 2. Owner-settable.
    uint256 public minConviction;
    mapping(address => uint256) public convictionOf;

    event ConvictionStaked(address indexed who, uint256 amount, uint256 total);
    event ConvictionWithdrawn(address indexed who, uint256 amount, uint256 remaining);
    event MinConvictionUpdated(uint256 minConviction);

    constructor(address aura_, uint256 minConviction_) Ownable(msg.sender) {
        require(aura_ != address(0), "aura=0");
        aura = IERC721(aura_);
        minConviction = minConviction_;
    }

    /// @inheritdoc IPersonhoodGate
    function holdsAura(address who) public view returns (bool) {
        return aura.balanceOf(who) > 0;
    }

    /// @inheritdoc IPersonhoodGate
    function meetsConviction(address who) public view returns (bool) {
        return convictionOf[who] >= minConviction && minConviction > 0;
    }

    /// @inheritdoc IPersonhoodGate
    function worldIdVerified(address) external pure returns (bool) {
        return false; // NOT implemented this phase
    }

    /// @inheritdoc IPersonhoodGate
    function isPerson(address who) external view returns (bool) {
        return holdsAura(who) || meetsConviction(who);
    }

    /// @inheritdoc IPersonhoodGate
    /// @dev The World-ID nullifier path is the post-cup convenience tier; it is NOT implemented in Phase 1.
    function registerWorldId(address, uint256, uint256[8] calldata) external pure {
        revert("world-id not implemented this phase");
    }

    /// @notice Stake conviction (a refundable ETH deposit) to clear Floor 2 without holding an Aura.
    function stakeConviction() external payable {
        require(msg.value > 0, "no stake");
        convictionOf[msg.sender] += msg.value;
        emit ConvictionStaked(msg.sender, msg.value, convictionOf[msg.sender]);
    }

    /// @notice Withdraw part or all of your conviction stake (pull, CEI + guarded).
    function withdrawConviction(uint256 amount) external nonReentrant {
        uint256 bal = convictionOf[msg.sender];
        require(amount > 0 && amount <= bal, "bad amount");
        convictionOf[msg.sender] = bal - amount;
        payable(msg.sender).sendValue(amount);
        emit ConvictionWithdrawn(msg.sender, amount, bal - amount);
    }

    function setMinConviction(uint256 minConviction_) external onlyOwner {
        minConviction = minConviction_;
        emit MinConvictionUpdated(minConviction_);
    }
}
