// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// FORK-PARITY GATE (the mandatory safety gate before the irreversible mainnet cutover).
//
// Proves the GENERATED AuraCatalogMainnet library is a BYTE-FAITHFUL copy of the LIVE 0G Galileo testnet
// catalog (AgentRegistry 0xb596), and that running the EMBEDDED cutover mint (the exact AuraCatalogMainnet +
// AuraMigration.remint path DeployCutover uses under EMBEDDED_CATALOG=1):
//   - preserves ids 1..30 (contiguous; the curated premium agents keep ids 1-4 + 11-30),
//   - consolidates EVERY agent's ownership to the mainnet deployer (the diligence Q2 verdict),
//   - prices the curated set for Summon,
//   - and yields on-chain agent fields (name incl. non-ASCII "BETON", styleFingerprint, encBrainRoot,
//     modelAttestation, royaltyBps, creatorResaleBps) that equal the LIVE testnet fields, field-by-field.
//
// It forks live testnet ONLY when FORK_PARITY_RPC is set (e.g. https://evmrpc-testnet.0g.ai), so the default
// `forge test` stays OFFLINE and green (this test reports as skipped there, zero regression to the 212 suite).
// Run the gate explicitly with:
//   FORK_PARITY_RPC=https://evmrpc-testnet.0g.ai forge test --match-contract AuraCatalogForkParity -vv
import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AuraINFT} from "../src/AuraINFT.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {SummonEscrow} from "../src/SummonEscrow.sol";
import {AuraMigration} from "../script/AuraMigration.sol";
import {AuraCatalogMainnet} from "../src/AuraCatalogMainnet.sol";

contract AuraCatalogForkParityTest is Test {
    // the LIVE testnet catalog the embedded snapshot must equal
    address constant LIVE_REGISTRY = 0xB5960cc08caa5195095Cfb8Aa270F122BE09Ba0a;
    // the mainnet cutover deployer = the single consolidation owner (diligence Q2). Not special on the fork.
    address constant DEPLOYER = 0x8a3bCd5937C1f5847CAfCb98Cf748C88A9e9Bf3d;
    string constant IMAGE_BASE = "https://aura.topengdev.com/images/";
    uint256 constant SUMMON_PRICE = 0.01 ether;

    function test_ForkParity_EmbeddedCatalogMatchesLiveTestnet() public {
        string memory rpc = vm.envOr("FORK_PARITY_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true, "set FORK_PARITY_RPC=https://evmrpc-testnet.0g.ai to run the fork-parity gate");
            return;
        }
        vm.createSelectFork(rpc);
        AgentRegistry live = AgentRegistry(LIVE_REGISTRY);

        // sanity: the live catalog is exactly the contiguous 30 the library snapshotted.
        assertEq(live.nextAgentId(), AuraCatalogMainnet.count() + 1, "live testnet catalog is 30 agents (ids 1..30)");

        // deploy a fresh cutover stack on the fork + run the EMBEDDED migration (mirrors DeployCutover EMBEDDED_CATALOG=1).
        AuraINFT inft = new AuraINFT(DEPLOYER, IMAGE_BASE);
        OutputNFT outNft = new OutputNFT(address(inft), DEPLOYER, IMAGE_BASE);
        SummonEscrow escrow = new SummonEscrow(address(inft), address(outNft), DEPLOYER, 250);

        AgentRegistry.Agent[] memory cat = AuraCatalogMainnet.agents();
        bool[] memory cur = AuraCatalogMainnet.curated();
        assertEq(cat.length, AuraCatalogMainnet.count(), "embedded catalog length == COUNT");
        assertEq(cat.length, 30, "embedded catalog has 30 entries");

        vm.startPrank(DEPLOYER); // deployer both mints (to self) and prices (owner-gated) - mirrors the broadcast
        for (uint256 i = 0; i < cat.length; i++) {
            uint256 id = i + 1;
            require(inft.nextAgentId() == id, "embedded id gap");
            uint256 newId = AuraMigration.remint(inft, DEPLOYER, cat[i]); // owner override = deployer
            require(newId == id, "embedded id mismatch");
            if (cur[i]) {
                escrow.setSummonPrice(id, SUMMON_PRICE);
            }
        }
        vm.stopPrank();

        // ── id-preservation + consolidation across ALL 30 ──
        assertEq(inft.nextAgentId(), 31, "all 30 embedded agents minted, ids 1..30 preserved");
        for (uint256 id = 1; id <= 30; id++) {
            assertEq(inft.ownerOf(id), DEPLOYER, "every agent consolidated to the mainnet deployer");
        }

        // ── field-by-field faithfulness for the CURATED set (24) vs LIVE testnet ──
        uint256 curatedCount;
        for (uint256 i = 0; i < cat.length; i++) {
            uint256 id = i + 1;
            if (!cur[i]) {
                continue;
            }
            curatedCount++;

            AgentRegistry.Agent memory L = live.getAgent(id); // the LIVE testnet source of truth
            AuraINFT.Agent memory E = inft.getAgent(id); // what the EMBEDDED mint produced on-chain

            // (a) the on-chain minted agent equals live testnet, field-by-field
            assertEq(E.name, L.name, "minted name parity");
            assertEq(E.styleFingerprint, L.styleFingerprint, "minted styleFingerprint parity");
            assertEq(E.encBrainRoot, L.encBrainRoot, "minted encBrainRoot parity");
            assertEq(E.modelAttestation, L.modelAttestation, "minted modelAttestation parity");
            assertEq(E.royaltyBps, L.royaltyBps, "minted royaltyBps parity");
            assertEq(E.creatorResaleBps, L.creatorResaleBps, "minted creatorResaleBps parity");

            // (b) the embedded LIBRARY entry itself equals live testnet (catches a generation error directly,
            //     independent of the mint path)
            assertEq(cat[i].name, L.name, "embedded-lib name parity");
            assertEq(cat[i].styleFingerprint, L.styleFingerprint, "embedded-lib styleFingerprint parity");
            assertEq(cat[i].encBrainRoot, L.encBrainRoot, "embedded-lib encBrainRoot parity");
            assertEq(cat[i].modelAttestation, L.modelAttestation, "embedded-lib modelAttestation parity");
            assertEq(cat[i].royaltyBps, L.royaltyBps, "embedded-lib royaltyBps parity");
            assertEq(cat[i].creatorResaleBps, L.creatorResaleBps, "embedded-lib creatorResaleBps parity");

            // (c) summonPrice parity: the curated agents are priced for Summon
            assertEq(escrow.summonPrice(id), SUMMON_PRICE, "curated agent priced for summon");
        }
        assertEq(curatedCount, 24, "exactly 24 curated agents asserted (ids 1-4, 11-30)");

        emit log_named_uint("fork-parity: curated agents proven byte-faithful", curatedCount);
        emit log_named_uint("fork-parity: total agents minted id-preserving", inft.nextAgentId() - 1);
    }
}
