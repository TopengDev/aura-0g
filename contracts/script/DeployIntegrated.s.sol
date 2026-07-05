// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {AuraMarketplace} from "../src/AuraMarketplace.sol";
import {SummonEscrow} from "../src/SummonEscrow.sol";

/// @title DeployIntegrated - INTEGRATED Summon over the EXISTING live marketplace (0G Galileo, chainId 16602)
/// @notice The integrated deploy: it does NOT mint a fresh AgentRegistry. It ATTACHES to the EXISTING
///         live registry (all real agents, no migration) and re-deploys ONLY the output/escrow/marketplace
///         layer so EVERY existing agent becomes summonable + income follows ownership.
///
/// Deploy: OutputNFT(EXISTING_registry, attestor) [H-1 mintForSettlement + keeps mintOutput = ONE unified
///         collection for gen AND summon] -> AuraMarketplace(platform, bps) -> SummonEscrow(EXISTING_registry,
///         newOutputNFT, platform, bps); allowlist (existing registry + new OutputNFT); price the deployer's
///         existing agents for Summon (guarded - skips agents the deployer does not own / that don't exist).
///
/// It deliberately does NOT seed agents (they already exist in the registry) and does NOT seed outputs
/// (showpiece outputs are re-generated post-deploy via the real gen flow, per the integrated plan).
///
/// Env:
///   PRIVATE_KEY          - funded deployer key (hex, 0x...). Must be the OWNER of the agents to be priced.
///                          Also the default attestor + platform. (Live: 0x2537... owns agents 1..4 + more.)
///   AGENT_REGISTRY_ADDR  - REQUIRED. The EXISTING live AgentRegistry to attach to (live: 0xb596...).
///   ATTESTOR_ADDR        - (optional) the OutputNFT attestor; defaults to the deployer.
///   PLATFORM_ADDR        - (optional) marketplace/escrow fee beneficiary; defaults to the deployer.
///   PLATFORM_BPS         - (optional) platform fee in bps; defaults to 250 (2.5%).
///   SUMMON_PRICE         - (optional) per-agent commission price in wei; defaults to 0.01 ether. 0 = skip pricing.
///   SUMMON_AGENT_COUNT   - (optional) price agent IDs 1..N that the deployer owns; defaults to 12 (guarded,
///                          so non-existent / non-owned ids are skipped, never revert).
///
/// Usage (Galileo):
///   AGENT_REGISTRY_ADDR=0xb5960cc08caa5195095cfb8aa270f122be09ba0a \
///   forge script script/DeployIntegrated.s.sol --legacy --gas-price 5000000000 \
///     --rpc-url https://evmrpc-testnet.0g.ai --broadcast
contract DeployIntegrated is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        address registryAddr = vm.envAddress("AGENT_REGISTRY_ADDR"); // REQUIRED - the existing live registry
        address attestor = vm.envOr("ATTESTOR_ADDR", me);
        address platform = vm.envOr("PLATFORM_ADDR", me);
        uint16 platformBps = uint16(vm.envOr("PLATFORM_BPS", uint256(250)));
        uint256 summonPrice = vm.envOr("SUMMON_PRICE", uint256(0.01 ether));
        uint256 summonAgentCount = vm.envOr("SUMMON_AGENT_COUNT", uint256(12));
        // Base URL the OutputNFT tokenURI() image field is built on (image = baseImageURI + imageRoot).
        string memory imageBaseURI = vm.envOr("IMAGE_BASE_URI", string("https://aura.topengdev.com/images/"));

        AgentRegistry reg = AgentRegistry(registryAddr); // ATTACH to the existing deployed registry

        vm.startBroadcast(pk);

        // New OutputNFT bound to the EXISTING registry: mintForSettlement (H-1) for summon + mintOutput for gen.
        OutputNFT outNft = new OutputNFT(registryAddr, attestor, imageBaseURI);
        AuraMarketplace mkt = new AuraMarketplace(platform, platformBps);
        SummonEscrow escrow = new SummonEscrow(registryAddr, address(outNft), platform, platformBps);

        // Allowlist the EXISTING registry (agent listings) + the NEW OutputNFT (output listings) on the new mkt.
        mkt.setAllowedCollection(registryAddr, true);
        mkt.setAllowedCollection(address(outNft), true);

        // Price the deployer-owned existing agents for Summon. Guarded: ownerOf reverts on a non-existent id
        // and setSummonPrice reverts on a non-owned id, so we pre-check ownership in a try/catch and SKIP
        // anything we don't own. This makes EVERY agent the deployer owns summonable, income-follows native.
        uint256 priced = 0;
        if (summonPrice > 0) {
            for (uint256 id = 1; id <= summonAgentCount; id++) {
                try reg.ownerOf(id) returns (address owner_) {
                    if (owner_ == me) {
                        escrow.setSummonPrice(id, summonPrice);
                        priced++;
                    } else {
                        console.log("skip (not deployer-owned) agentId:", id);
                    }
                } catch {
                    // agent id does not exist - stop scanning further ids.
                    break;
                }
            }
        }

        vm.stopBroadcast();

        console.log("=== AURA INTEGRATED Summon deploy (chainId 16602) ===");
        console.log("AgentRegistry (EXISTING, kept):", registryAddr);
        console.log("OutputNFT     (NEW)           :", address(outNft));
        console.log("AuraMarketplace (NEW)         :", address(mkt));
        console.log("SummonEscrow  (NEW)           :", address(escrow));
        console.log("attestor                      :", attestor);
        console.log("platform                      :", platform);
        console.log("platformBps                   :", platformBps);
        console.log("tokenURI image base           :", imageBaseURI);
        console.log("agents priced for summon      :", priced);
        console.log("summonPrice (wei)             :", summonPrice);
    }
}
