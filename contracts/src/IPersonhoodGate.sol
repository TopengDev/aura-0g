// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IPersonhoodGate - the multi-on-ramp personhood floor for Arena participation (Tier-3 interface).
/// @notice The vote weighting is sybil-neutral only ABOVE a personhood floor (dil-integrity-economics.md 2.4).
///         AURA's floor is 0G-NATIVE + keyless: two floors that need no external key, plus a LABELED FREE
///         World-ID convenience tier (a disclosed trust boundary, NOT built this phase).
///
///         The two KEYLESS 0G-native floors (either one satisfies personhood):
///           1. HOLD-AN-AURA        - the address holds >= 1 AuraINFT (skin-in-the-ecosystem).
///           2. CONVICTION-STAKE    - the address has staked >= a minimum conviction amount.
///
///         The World-ID nullifier tier is declared here as the seam but is NOT implemented in Phase 1
///         (registerWorldId reverts). Fully-keyless-AND-free personhood needs a World-ID root bridge and is
///         post-cup. isPerson() therefore resolves purely on the two keyless floors this phase.
interface IPersonhoodGate {
    /// @notice Floor 1: does `who` hold at least one AuraINFT? (keyless)
    function holdsAura(address who) external view returns (bool);

    /// @notice Floor 2: has `who` staked at least the minimum conviction amount? (keyless)
    function meetsConviction(address who) external view returns (bool);

    /// @notice The World-ID convenience tier (a labeled free tier). Always false in Phase 1 (not implemented).
    function worldIdVerified(address who) external view returns (bool);

    /// @notice True if `who` clears ANY floor. Phase 1: holdsAura || meetsConviction (World-ID path excluded).
    function isPerson(address who) external view returns (bool);

    /// @notice The World-ID nullifier registration seam. NOT implemented this phase (reverts). The
    ///         `nullifierHash` slot is reserved so a real World-ID proof can bind one-person-one-nullifier later.
    function registerWorldId(address who, uint256 nullifierHash, uint256[8] calldata proof) external;
}
