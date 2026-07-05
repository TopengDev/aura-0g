// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAuraRegistry - the agent-ownership + output-royalty surface OutputNFT binds to.
/// @notice OutputNFT resolves each Relic's EIP-2981 royalty DYNAMICALLY through this interface: the
///         receiver is `ownerOf(creatorAgentId)` (the agent's CURRENT owner) and the rate is
///         `royaltyBpsOf(creatorAgentId)`. Both the legacy `AgentRegistry` (ERC-7857 stub) AND the real
///         ERC-7857 `AuraINFT` implement this EXACT selector pair, so OutputNFT can be bound to EITHER at
///         deploy without a code change. The AuraINFT cutover just deploys OutputNFT pointing at AuraINFT
///         (its `registry` is immutable), moving the whole royalty stream onto the real iNFT and closing O1.
interface IAuraRegistry {
    /// @notice The agent's current owner (the dynamic royalty beneficiary). Reverts if the agent does not exist.
    function ownerOf(uint256 agentId) external view returns (address);

    /// @notice The agent's OUTPUT royalty in basis points (consumed by OutputNFT.royaltyInfo).
    function royaltyBpsOf(uint256 agentId) external view returns (uint16);
}
