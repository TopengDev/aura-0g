// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AuraINFT} from "../src/AuraINFT.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {AuraMarketplace} from "../src/AuraMarketplace.sol";
import {SummonEscrow} from "../src/SummonEscrow.sol";
import {ArenaVote} from "../src/ArenaVote.sol";
import {AuraFusion} from "../src/AuraFusion.sol";
import {ArenaReputation} from "../src/ArenaReputation.sol";
import {PersonhoodGate} from "../src/PersonhoodGate.sol";
import {AuraMigration} from "./AuraMigration.sol";
import {AuraCatalogMainnet} from "../src/AuraCatalogMainnet.sol";

/// @title DeployCutover - the ATOMIC AuraINFT cutover deploy (closes overclaim O1) + the GAME LAYER.
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
///         GAME LAYER (folded into THIS SAME atomic deploy, all bound to the ONE registry = AuraINFT):
///           ArenaVote(registry = AuraINFT, quorum)          // ownerOf() -> same-owner self-match guard
///           AuraFusion(auraINFT = AuraINFT, fee, cooldown)  // children mint through AuraINFT.mintAgent (real seal)
///           ArenaReputation(registry = AuraINFT, anchorer)  // ownerOf() -> the rating follows the iNFT on sale
///           PersonhoodGate(aura = AuraINFT, minConviction)  // Floor-1 hold-an-Aura = the ArenaVote sybil floor
///         All four are constructor-wired (no post-deploy setter is required) and DEGRADE-SAFE: they stay inert
///         until their addresses are published in deployed-v2.json / NEXT_PUBLIC_* AND a user interacts (the
///         backend flows 501 and the web shows the DeployGate until then). Their owner is the deployer, which is
///         the same operator the backend signs createBattle / anchorSeason with (single-key testnet deploy).
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
///                          (a fresh, empty AuraINFT - e.g. a clean local run). IGNORED when EMBEDDED_CATALOG=1.
///   EMBEDDED_CATALOG     - "1" => MAINNET path: re-mint the byte-faithful EMBEDDED catalog (AuraCatalogMainnet)
///                          instead of an on-chain read of AGENT_REGISTRY_ADDR (the source registry has NO code
///                          on mainnet, so an on-chain read reverts). Same AuraMigration.remint + same
///                          require(nextAgentId()==id) id-preservation; ALL agents consolidated to the deployer
///                          (owner override), summon-pricing gated to the curated set. Unset/"0" => the on-chain
///                          -read path below, byte-identical to today (zero regression to the forge suite + E2E).
///   MIGRATE_AGENT_COUNT  - migrate source ids 1..N (contiguous catalog). Default 30. Halts at the first gap.
///                          (On-chain-read path only; the embedded path mints the full 30-entry AuraCatalogMainnet.)
///   SUMMON_PRICE         - per-agent summon price in wei for deployer-owned migrated agents. Default 0.01 ether.
///   --- game layer ---
///   ARENA_QUORUM         - min DISTINCT revealed voters for a battle to confer a RATED verdict. Default 3.
///   FUSION_FEE_WEI       - per-request fusion fee (wei), escrowed at requestFusion. Default 0.01 ether.
///   FUSION_COOLDOWN_SECS - per-parent fusion cooldown (seconds), rate-limits how often a parent fuses. Default 1 days.
///   ARENA_ANCHORER_ADDR  - the off-chain fixed-point Glicko-1 compute service that anchors season roots. Default: deployer.
///   PERSONHOOD_MIN_CONVICTION_WEI - min conviction stake (wei) to clear PersonhoodGate Floor-2. Default 0.01 ether.
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
        // MAINNET cutover flag: re-mint the EMBEDDED catalog (no cross-chain read). "1" activates it.
        bool embeddedCatalog = vm.envOr("EMBEDDED_CATALOG", uint256(0)) == 1;

        // ── game-layer params (folded into this same cutover; all wired to the ONE registry = AuraINFT) ──
        uint256 arenaQuorum = vm.envOr("ARENA_QUORUM", uint256(3));
        uint256 fusionFee = vm.envOr("FUSION_FEE_WEI", uint256(0.01 ether));
        uint256 fusionCooldown = vm.envOr("FUSION_COOLDOWN_SECS", uint256(1 days));
        address anchorer = vm.envOr("ARENA_ANCHORER_ADDR", me);
        uint256 minConviction = vm.envOr("PERSONHOOD_MIN_CONVICTION_WEI", uint256(0.01 ether));

        vm.startBroadcast(pk);

        // 1..4: the whole stack, ALL bound to ONE registry = AuraINFT.
        uint256 auraInftDeployBlock = block.number;
        AuraINFT inft = new AuraINFT(oracle, imageBaseURI);
        OutputNFT outNft = new OutputNFT(address(inft), attestor, imageBaseURI);
        AuraMarketplace mkt = new AuraMarketplace(platform, platformBps);
        SummonEscrow escrow = new SummonEscrow(address(inft), address(outNft), platform, platformBps);

        // 4b: the GAME LAYER, all bound to the SAME registry = AuraINFT (folded into this ONE atomic cutover).
        //   - AuraFusion mints hybrid CHILDREN through the REAL AuraINFT.mintAgent sealed-key path (permissionless,
        //     no minter role) -> children are genuine ERC-7857 iNFTs, not a vanity mechanism.
        //   - ArenaVote resolves ownerOf(agentId) on AuraINFT for its same-owner self-match guard (structural anti-wash).
        //   - ArenaReputation keys each rating to AuraINFT.ownerOf so reputation FOLLOWS the iNFT when the agent sells.
        //   - PersonhoodGate's Floor-1 (hold-an-Aura) IS the AuraINFT (balanceOf >= 1) => the Arena's 0G-native sybil
        //     floor over the SAME registry the battles are about (ArenaVote stays LINEAR/sybil-neutral for the cup;
        //     the floor gates sqrt weighting Tier-3/post-cup + is available to the backend for isPerson checks).
        //   All four are constructor-wired (immutable registry/auraINFT/aura) so NO post-deploy setter is needed, and
        //   they stay INERT (backend 501 / web DeployGate) until published in deployed-v2.json + NEXT_PUBLIC_*.
        uint256 gameDeployBlock = block.number; // same broadcast as the stack above (== auraInftDeployBlock)
        ArenaVote arena = new ArenaVote(address(inft), arenaQuorum);
        AuraFusion fusion = new AuraFusion(address(inft), fusionFee, fusionCooldown);
        ArenaReputation reputation = new ArenaReputation(address(inft), anchorer);
        PersonhoodGate personhood = new PersonhoodGate(address(inft), minConviction);

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
        if (embeddedCatalog) {
            // ── MAINNET path (EMBEDDED_CATALOG=1): re-mint the byte-faithful embedded catalog ──
            // The live source registry (0xb596) has NO code on mainnet, so an on-chain read reverts the whole
            // simulation (fail-closed). Instead we iterate AuraCatalogMainnet - a GENERATED, fork-parity-verified
            // snapshot of the 30 testnet agents - through the SAME AuraMigration.remint path, keeping the SAME
            // require(nextAgentId()==id) id-preservation invariant (ids stay contiguous 1..30, so VELLUM..SOLACE
            // keep ids 11..30). Per the diligence Q2 ownership verdict, EVERY agent consolidates to the deployer
            // (owner override = me); summon-pricing is gated to the curated set (the 6 non-curated test/external
            // agents are minted only to preserve ids, not surfaced into the priced demo economy).
            AgentRegistry.Agent[] memory cat = AuraCatalogMainnet.agents();
            bool[] memory cur = AuraCatalogMainnet.curated();
            for (uint256 i = 0; i < cat.length; i++) {
                uint256 id = i + 1;
                require(inft.nextAgentId() == id, "embedded migration id gap");
                uint256 newId = AuraMigration.remint(inft, me, cat[i]); // owner override = deployer (consolidate)
                require(newId == id, "embedded migration id mismatch");
                migrated++;
                // price the curated set for Summon (all embedded agents are deployer-owned here).
                if (summonPrice > 0 && cur[i]) {
                    escrow.setSummonPrice(id, summonPrice);
                    priced++;
                }
            }
        } else if (sourceRegistry != address(0)) {
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
        console.log("catalog source                :", embeddedCatalog ? "EMBEDDED (mainnet cutover)" : "on-chain read");
        console.log("agents migrated onto AuraINFT :", migrated);
        console.log("agents priced for summon      :", priced);
        console.log("--- game layer (bound to AuraINFT) ---");
        console.log("ArenaVote     (reg=INFT)      :", address(arena));
        console.log("AuraFusion    (auraINFT=INFT) :", address(fusion));
        console.log("ArenaReputation (reg=INFT)    :", address(reputation));
        console.log("PersonhoodGate (aura=INFT)    :", address(personhood));
        console.log("arena quorum                  :", arenaQuorum);
        console.log("fusion fee (wei)              :", fusionFee);
        console.log("fusion cooldown (secs)        :", fusionCooldown);
        console.log("arena anchorer                :", anchorer);
        console.log("personhood minConviction (wei):", minConviction);
        console.log("game deploy block             :", gameDeployBlock);
        console.log("");
        console.log("--- paste into contracts/deployed-v2.json (coherent single source of truth) ---");
        console.log('  "agentRegistry": "', sourceRegistry, '",  // kept for history; agents now on auraINFT');
        console.log('  "auraINFT": "', address(inft), '",');
        console.log('  "auraInftDeployBlock": ', auraInftDeployBlock, ',');
        console.log('  "auraINFTOracle": "', oracle, '",');
        console.log('  "outputNFT": "', address(outNft), '",');
        console.log('  "marketplace": "', address(mkt), '",');
        console.log('  "summonEscrow": "', address(escrow), '",');
        console.log('  "arenaVote": "', address(arena), '",');
        console.log('  "auraFusion": "', address(fusion), '",');
        console.log('  "arenaReputation": "', address(reputation), '",');
        console.log('  "personhoodGate": "', address(personhood), '",');
        console.log('  "gameDeployBlock": ', gameDeployBlock, ',');
        console.log("  (also: set deployBlock/outputNftDeployBlock/summonStartBlock =", auraInftDeployBlock, ")");
        console.log("");
        console.log("--- web build args (NEXT_PUBLIC_*, baked into the prod web image; the game flips LIVE when set) ---");
        console.log("  NEXT_PUBLIC_AURA_FUSION       =", address(fusion));
        console.log("  NEXT_PUBLIC_ARENA_VOTE        =", address(arena));
        console.log("  NEXT_PUBLIC_ARENA_REPUTATION  =", address(reputation));
        if (!teePinned && teeSigner != address(0)) {
            console.log("");
            console.log("NOTE: attestor is split from deployer - pin the TEE signer post-deploy with an attestor tx:");
            console.log("      OutputNFT(", address(outNft), ").setTeeSigner(", teeSigner);
        }
    }
}
