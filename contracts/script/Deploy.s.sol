// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {AuraMarketplace} from "../src/AuraMarketplace.sol";
import {SummonEscrow} from "../src/SummonEscrow.sol";

/// @title Deploy - AURA v2 (0G Galileo, chainId 16602)
/// @notice Deploy order: AgentRegistry -> OutputNFT(registry, ATTESTOR) -> AuraMarketplace(platform, bps)
///         -> SummonEscrow(registry, outputNFT, platform, bps), then allowlist BOTH collections, seed the
///         4 proven agents (NOKTURNE/MIRAI/RISO/SCRIPTORIUM) with output + creator-resale royalties, mint
///         1 showcase output per agent via the EIP-712 attestation path (signed in-script by the attestor
///         key), and price the agents for Summon so the demo has summonable agents out of the box.
///
/// Env:
///   PRIVATE_KEY   - funded deployer key (hex, 0x...). Also the default attestor + platform.
///   ATTESTOR_ADDR - (optional) the OutputNFT attestor; defaults to the deployer address.
///   PLATFORM_ADDR - (optional) the marketplace fee beneficiary; defaults to the deployer address.
///   PLATFORM_BPS  - (optional) platform fee in bps; defaults to 250 (2.5%).
///   SUMMON_PRICE  - (optional) per-agent commission price in wei; defaults to 0.01 ETH. 0 = leave unpriced.
///
/// Usage (Galileo):
///   forge script script/Deploy.s.sol --legacy --gas-price 5000000000 \
///     --rpc-url https://evmrpc-testnet.0g.ai --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        // Attestor defaults to the deployer so the deploy script can self-sign the showcase mints.
        address attestor = vm.envOr("ATTESTOR_ADDR", me);
        address platform = vm.envOr("PLATFORM_ADDR", me);
        uint16 platformBps = uint16(vm.envOr("PLATFORM_BPS", uint256(250)));

        vm.startBroadcast(pk);

        AgentRegistry reg = new AgentRegistry();
        OutputNFT outNft = new OutputNFT(address(reg), attestor);
        AuraMarketplace mkt = new AuraMarketplace(platform, platformBps);
        // SummonEscrow: demand-pull commissioning. attestor == the OutputNFT attestor (the runner settles
        // mints), platform + bps mirror the marketplace's split.
        SummonEscrow escrow = new SummonEscrow(address(reg), address(outNft), platform, platformBps);

        // Allowlist BOTH AURA collections so they trade through the one marketplace.
        mkt.setAllowedCollection(address(reg), true);
        mkt.setAllowedCollection(address(outNft), true);

        // Seed the 4 proven agents. (outputBps, creatorResaleBps) per agent.
        uint256 a1 = reg.mintAgent(
            me, "NOKTURNE", keccak256("style-dna-nokturne"),
            "0g://enc-brain-nokturne", keccak256("model:qwen-image-edit-2511"), 700, 1000
        );
        uint256 a2 = reg.mintAgent(
            me, "MIRAI", keccak256("style-dna-mirai"),
            "0g://enc-brain-mirai", keccak256("model:qwen-image-edit-2511"), 800, 1000
        );
        uint256 a3 = reg.mintAgent(
            me, "RISO", keccak256("style-dna-riso"),
            "0g://enc-brain-riso", keccak256("model:qwen-image-edit-2511"), 600, 750
        );
        uint256 a4 = reg.mintAgent(
            me, "SCRIPTORIUM", keccak256("style-dna-scriptorium"),
            "0g://enc-brain-scriptorium", keccak256("model:qwen-image-edit-2511"), 900, 1200
        );

        // Mint 1 showcase output per agent through the EIP-712 attestation path (placeholder roots).
        _seedOutput(outNft, pk, me, a1, "0g://showcase-nokturne", 101);
        _seedOutput(outNft, pk, me, a2, "0g://showcase-mirai", 102);
        _seedOutput(outNft, pk, me, a3, "0g://showcase-riso", 103);
        _seedOutput(outNft, pk, me, a4, "0g://showcase-scriptorium", 104);

        // Price the seeded agents for Summon (deployer owns them, so it can set prices). 0 = skip.
        uint256 summonPrice = vm.envOr("SUMMON_PRICE", uint256(0.01 ether));
        if (summonPrice > 0) {
            escrow.setSummonPrice(a1, summonPrice);
            escrow.setSummonPrice(a2, summonPrice);
            escrow.setSummonPrice(a3, summonPrice);
            escrow.setSummonPrice(a4, summonPrice);
        }

        vm.stopBroadcast();

        console.log("=== AURA v2 deployed (chainId 16602) ===");
        console.log("AgentRegistry :", address(reg));
        console.log("OutputNFT     :", address(outNft));
        console.log("AuraMarketplace:", address(mkt));
        console.log("SummonEscrow  :", address(escrow));
        console.log("attestor      :", attestor);
        console.log("platform      :", platform);
        console.log("platformBps   :", platformBps);
        console.log("agents (1..4) :", a1, a2, a4); // a3 logged below to fit arg limits
        console.log("agent RISO id :", a3);

        (address recv, uint256 amt) = outNft.royaltyInfo(1, 1 ether);
        console.log("output#1 royalty recv:", recv);
        console.log("output#1 royalty amt (1e18 sale):", amt);
    }

    /// @dev Mints a showcase output via the attestor-signed EIP-712 path. Attestor == deployer here,
    ///      so we can sign in-script with the same key. provenanceHash/teeAttestation are placeholders.
    function _seedOutput(
        OutputNFT outNft,
        uint256 pk,
        address to,
        uint256 agentId,
        string memory imageRoot,
        uint256 seed
    ) internal {
        bytes32 provenanceHash = keccak256(abi.encodePacked("prov", agentId, seed));
        bytes32 teeAttestation = keccak256(abi.encodePacked("tee", agentId, seed));
        bytes32 nonce = keccak256(abi.encodePacked("seed-output", agentId, seed));

        bytes32 digest = outNft.authDigest(to, agentId, imageRoot, provenanceHash, teeAttestation, seed, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        outNft.mintOutput(to, agentId, imageRoot, provenanceHash, teeAttestation, seed, nonce, sig);
    }
}
