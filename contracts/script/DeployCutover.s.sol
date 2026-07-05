// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AuraINFT} from "../src/AuraINFT.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {AuraMarketplace} from "../src/AuraMarketplace.sol";
import {SummonEscrow} from "../src/SummonEscrow.sol";
import {AuraMigration} from "./AuraMigration.sol";

/// @title DeployCutover - the ATOMIC AuraINFT cutover deploy (closes overclaim O1).
/// @notice Deploys the FULL v2 stack against ONE registry = the REAL ERC-7857 AuraINFT (not the AgentRegistry
///         stub), so agents ARE real iNFTs everywhere the stack touches ownership + royalty:
///           AuraINFT(oracle, baseImageURI)
///           OutputNFT(registry = AuraINFT, attestor, baseImageURI)   // registry is IMMUTABLE -> must bind here
///           AuraMarketplace(platform, bps)
///           SummonEscrow(registry = AuraINFT, OutputNFT, platform, bps)
///         then pins the Option A on-chain TEE-verify signer (OutputNFT.setTeeSigner), allowlists the trade
///         collections, and MIGRATES the existing catalog agents from the live AgentRegistry onto AuraINFT
///         (id-preserving, income-follows-owner), pricing the deployer-owned ones for Summon.
///
///         This is the SINGLE-registry atomic redeploy the audit tripwire requires: reads, indexer, memory
///         gate, web mint, and transfers ALL move to AuraINFT together (the server flips on auraInftConfigured()
///         once deployed-v2.json.auraINFT is set to the AuraINFT printed below).
///
/// LOCAL ONLY in this task: build + `forge test` (DeployCutover.t.sol) + optional anvil. The MAINNET (16661)
/// broadcast is a SEPARATE, human-overseen step (Christopher runs it; it is irreversible on his live entry).
///
/// Env:
///   PRIVATE_KEY          - funded deployer (also default oracle/attestor/platform). REQUIRED.
///   ORACLE_ADDR          - AuraINFT re-encryption oracle (ECDSA signer). Default: deployer.
///   ATTESTOR_ADDR        - OutputNFT EIP-712 MintAuth signer. Default: deployer.
///   PLATFORM_ADDR        - marketplace/escrow fee beneficiary. Default: deployer.
///   PLATFORM_BPS         - platform fee bps. Default 250 (2.5%).
///   IMAGE_BASE_URI       - tokenURI image origin. Default https://aura.topengdev.com/images/ .
///   TEE_SIGNER_ADDR      - the on-chain TEE-verify signer to pin (Option A). Default: the 0G TESTNET
///                          image-edit enclave signer 0x2A94D671f1A5e080f75A8164087Cdd35c8442e69. Only pinned
///                          when the deployer == attestor (setTeeSigner is attestor-gated); else pin it after.
///   AGENT_REGISTRY_ADDR  - the EXISTING registry to MIGRATE FROM (live: 0xb596...). Unset => no migration
///                          (a fresh, empty AuraINFT - e.g. a clean local run).
///   MIGRATE_AGENT_COUNT  - migrate source ids 1..N (contiguous catalog). Default 30. Halts at the first gap.
///   SUMMON_PRICE         - per-agent summon price in wei for deployer-owned migrated agents. Default 0.01 ether.
contract DeployCutover is Script {
    // Option A (proven, smoke test wjr88st0x): the 0G TESTNET image-edit TeeML enclave signer. Every Relic's
    // REAL base-anchored art is on-chain-verifiable against this signer inside the mainnet contract.
    address constant OPTION_A_TESTNET_TEE_SIGNER = 0x2A94D671f1A5e080f75A8164087Cdd35c8442e69;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address oracle = vm.envOr("ORACLE_ADDR", me);
        address attestor = vm.envOr("ATTESTOR_ADDR", me);
        address platform = vm.envOr("PLATFORM_ADDR", me);
        uint16 platformBps = uint16(vm.envOr("PLATFORM_BPS", uint256(250)));
        string memory imageBaseURI = vm.envOr("IMAGE_BASE_URI", string("https://aura.topengdev.com/images/"));
        address teeSigner = vm.envOr("TEE_SIGNER_ADDR", OPTION_A_TESTNET_TEE_SIGNER);
        address sourceRegistry = vm.envOr("AGENT_REGISTRY_ADDR", address(0));
        uint256 migrateCount = vm.envOr("MIGRATE_AGENT_COUNT", uint256(30));
        uint256 summonPrice = vm.envOr("SUMMON_PRICE", uint256(0.01 ether));

        vm.startBroadcast(pk);

        // 1..4: the whole stack, ALL bound to ONE registry = AuraINFT.
        uint256 auraInftDeployBlock = block.number;
        AuraINFT inft = new AuraINFT(oracle, imageBaseURI);
        OutputNFT outNft = new OutputNFT(address(inft), attestor, imageBaseURI);
        AuraMarketplace mkt = new AuraMarketplace(platform, platformBps);
        SummonEscrow escrow = new SummonEscrow(address(inft), address(outNft), platform, platformBps);

        // 5: pin the Option A on-chain TEE-verify signer. setTeeSigner is attestor-gated; the broadcast can call
        //    it only when the deployer IS the attestor. When attestor is split off, pin it in a follow-up
        //    attestor-signed tx (printed below). Ships effectively OFF until pinned (mintOutputVerified == mintOutput).
        bool teePinned = false;
        if (teeSigner != address(0) && attestor == me) {
            outNft.setTeeSigner(teeSigner);
            teePinned = true;
        }

        // 6: allowlist the trade collections on the fresh marketplace (Relic trades route royalty via AuraINFT).
        mkt.setAllowedCollection(address(inft), true);
        mkt.setAllowedCollection(address(outNft), true);

        // 7: MIGRATE the catalog agents onto AuraINFT (id-preserving, income-follows-owner), then price the
        //    deployer-owned ones for Summon. Guarded + loud: halts at the first source gap so ids can never
        //    silently misalign (the live catalog is contiguous 1..N).
        uint256 migrated = 0;
        uint256 priced = 0;
        if (sourceRegistry != address(0)) {
            AgentRegistry src = AgentRegistry(sourceRegistry);
            for (uint256 id = 1; id <= migrateCount; id++) {
                // read the source agent; a revert = end of the contiguous catalog -> stop.
                try src.getAgent(id) returns (AgentRegistry.Agent memory a) {
                    address owner_ = src.ownerOf(id);
                    // id preservation: a fresh AuraINFT assigns ids in order, so nextAgentId MUST equal `id` here.
                    require(inft.nextAgentId() == id, "migration id gap: source registry not contiguous");
                    uint256 newId = AuraMigration.remint(inft, owner_, a);
                    require(newId == id, "migration id mismatch");
                    migrated++;
                    // price for Summon only if the deployer owns it (setSummonPrice is owner-gated).
                    if (summonPrice > 0 && owner_ == me) {
                        escrow.setSummonPrice(id, summonPrice);
                        priced++;
                    }
                } catch {
                    break; // end of catalog (or first non-existent id) - contiguous catalog assumption
                }
            }
        }

        vm.stopBroadcast();

        console.log("=== AURA AuraINFT CUTOVER deploy (ONE registry = AuraINFT) ===");
        console.log("AuraINFT      (NEW registry)  :", address(inft));
        console.log("OutputNFT     (NEW, reg=INFT) :", address(outNft));
        console.log("AuraMarketplace (NEW)         :", address(mkt));
        console.log("SummonEscrow  (NEW, reg=INFT) :", address(escrow));
        console.log("oracle                        :", oracle);
        console.log("attestor                      :", attestor);
        console.log("platform                      :", platform);
        console.log("platformBps                   :", platformBps);
        console.log("teeSigner (Option A)          :", teeSigner);
        console.log("teeSigner pinned in this run  :", teePinned);
        console.log("auraInft deploy block         :", auraInftDeployBlock);
        console.log("agents migrated onto AuraINFT :", migrated);
        console.log("agents priced for summon      :", priced);
        console.log("");
        console.log("--- paste into contracts/deployed-v2.json (coherent single source of truth) ---");
        console.log('  "agentRegistry": "', sourceRegistry, '",  // kept for history; agents now on auraINFT');
        console.log('  "auraINFT": "', address(inft), '",');
        console.log('  "auraInftDeployBlock": ', auraInftDeployBlock, ',');
        console.log('  "auraINFTOracle": "', oracle, '",');
        console.log('  "outputNFT": "', address(outNft), '",');
        console.log('  "marketplace": "', address(mkt), '",');
        console.log('  "summonEscrow": "', address(escrow), '",');
        console.log("  (also: set deployBlock/outputNftDeployBlock/summonStartBlock =", auraInftDeployBlock, ")");
        if (!teePinned && teeSigner != address(0)) {
            console.log("");
            console.log("NOTE: attestor is split from deployer - pin the TEE signer post-deploy with an attestor tx:");
            console.log("      OutputNFT(", address(outNft), ").setTeeSigner(", teeSigner);
        }
    }
}
