// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ATOMIC-COHERENCE test for the AuraINFT cutover (the audit tripwire, at the contract layer). It seeds a
// legacy AgentRegistry, runs the SAME deploy + migration the DeployCutover script runs (single registry =
// AuraINFT, via the shared AuraMigration library), and asserts EVERY contract-layer surface agrees agents =
// AuraINFT:
//   - migration preserves agentId + owner + royalties + identity onto AuraINFT (income-follows-owner);
//   - OutputNFT.registry == AuraINFT, and a Relic's royalty routes to the migrated agent's CURRENT owner;
//   - a sealed re-key transfer moves that royalty stream to the new owner;
//   - SummonEscrow prices via AuraINFT.ownerOf;
//   - the Option A TEE signer is pinned; the marketplace allowlists the RELIC collection (OutputNFT) ONLY -
//     agents (AuraINFT) are NOT marketplace-tradable (buy() would revert on the ERC-7857 transfer);
//   - raw ERC721 transfers on AuraINFT REVERT (spec-strict: agents can't move without a re-key).
import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {AuraINFT} from "../src/AuraINFT.sol";
import {OutputNFT} from "../src/OutputNFT.sol";
import {AuraMarketplace} from "../src/AuraMarketplace.sol";
import {SummonEscrow} from "../src/SummonEscrow.sol";
import {ArenaVote} from "../src/ArenaVote.sol";
import {AuraFusion} from "../src/AuraFusion.sol";
import {ArenaReputation} from "../src/ArenaReputation.sol";
import {PersonhoodGate} from "../src/PersonhoodGate.sol";
import {AuraMigration} from "../script/AuraMigration.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract DeployCutoverTest is Test {
    using MessageHashUtils for bytes32;

    AgentRegistry src; // the legacy registry we migrate FROM
    AuraINFT inft; // the real ERC-7857 registry we migrate ONTO
    OutputNFT outNft;
    AuraMarketplace mkt;
    SummonEscrow escrow;
    // ── game layer (folded into the SAME cutover) ──
    ArenaVote arena;
    AuraFusion fusion;
    ArenaReputation reputation;
    PersonhoodGate personhood;
    address anchorer = makeAddr("anchorer");
    uint256 constant ARENA_QUORUM = 3;
    uint256 constant FUSION_FEE = 0.01 ether;
    uint256 constant FUSION_COOLDOWN = 1 days;
    uint256 constant MIN_CONVICTION = 0.01 ether;

    uint256 oraclePk = 0x0AAC1E;
    uint256 attestorPk = 0xA11CE;
    address oracle;
    address attestor;
    address platform = makeAddr("platform");

    address deployer = makeAddr("deployer"); // owns catalog agents 1,2 (an EOA - a valid ERC721 receiver)
    address alice = makeAddr("alice"); // owns agent 3 (proves income-follows-owner survives the migration)
    address buyer = makeAddr("buyer");
    address collector = makeAddr("collector");

    address constant OPTION_A_TEE = 0x2A94D671f1A5e080f75A8164087Cdd35c8442e69;
    string constant IMAGE_BASE = "https://aura.topengdev.com/images/";

    uint256 constant N = 3; // catalog size for the test (ids 1,2 owned by deployer; id 3 owned by alice)

    function setUp() public {
        oracle = vm.addr(oraclePk);
        attestor = vm.addr(attestorPk);

        // ── seed the legacy AgentRegistry (the pre-cutover live state): contiguous ids 1..N ──
        src = new AgentRegistry();
        src.mintAgent(deployer, "NOKTURNE", keccak256("dna-1"), "0g://brain-1", keccak256("model:qwen"), 700, 1000);
        src.mintAgent(deployer, "MIRAI", keccak256("dna-2"), "0g://brain-2", keccak256("model:qwen"), 800, 1000);
        src.mintAgent(alice, "RISO", keccak256("dna-3"), "0g://brain-3", keccak256("model:z"), 600, 750);

        // ── run the cutover deploy (mirrors DeployCutover.s.sol) ──
        inft = new AuraINFT(oracle, IMAGE_BASE);
        outNft = new OutputNFT(address(inft), attestor, IMAGE_BASE);
        mkt = new AuraMarketplace(platform, 250);
        escrow = new SummonEscrow(address(inft), address(outNft), platform, 250);
        // teeSigner pin is attestor-gated -> prank as attestor.
        vm.prank(attestor);
        outNft.setTeeSigner(OPTION_A_TEE);
        // Relics ONLY (mirrors the corrected DeployCutover.s.sol): agents (AuraINFT) are not allowlisted going
        // forward - a marketplace buy() on an agent would revert on AuraINFT's spec-strict ERC-7857 transfer.
        mkt.setAllowedCollection(address(outNft), true);

        // ── game layer, ALL bound to the SAME registry = AuraINFT (mirrors DeployCutover.s.sol step 4b) ──
        arena = new ArenaVote(address(inft), ARENA_QUORUM);
        fusion = new AuraFusion(address(inft), FUSION_FEE, FUSION_COOLDOWN);
        reputation = new ArenaReputation(address(inft), anchorer);
        personhood = new PersonhoodGate(address(inft), MIN_CONVICTION);

        // ── migrate the catalog onto AuraINFT (id-preserving) via the shared library ──
        for (uint256 id = 1; id <= N; id++) {
            AgentRegistry.Agent memory a = src.getAgent(id);
            address owner_ = src.ownerOf(id);
            require(inft.nextAgentId() == id, "id gap");
            uint256 newId = AuraMigration.remint(inft, owner_, a);
            require(newId == id, "id mismatch");
        }

        // price the deployer-owned agents for Summon (owner-gated -> as the deployer).
        vm.startPrank(deployer);
        escrow.setSummonPrice(1, 0.01 ether);
        escrow.setSummonPrice(2, 0.01 ether);
        vm.stopPrank();
    }

    // ── helpers ──
    function _authSig(address to, uint256 agentId, bytes32 teeAtt, bytes32 nonce) internal view returns (bytes memory) {
        bytes32 digest = outNft.authDigest(to, agentId, "0g://img", keccak256("prov"), teeAtt, 42, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // VerifiedMintAuth signature (the DISTINCT verified-path EIP-712 type from the L2 fix). Used by the
    // verified-mint coherence test; _authSig (MintAuth) stays the direct-mint / _mintRelic signer.
    function _verifiedAuthSig(address to, uint256 agentId, bytes32 teeAtt, bytes32 nonce) internal view returns (bytes memory) {
        bytes32 digest = outNft.verifiedAuthDigest(to, agentId, "0g://img", keccak256("prov"), teeAtt, 42, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _mintRelic(address to, uint256 agentId, bytes32 nonce) internal returns (uint256) {
        bytes32 teeAtt = keccak256("tee");
        return outNft.mintOutput(to, agentId, "0g://img", keccak256("prov"), teeAtt, 42, nonce, _authSig(to, agentId, teeAtt, nonce));
    }

    function _oracleProof(uint256 agentId, address from, address to, bytes memory sealedKey, bytes32 dataHash, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest =
            keccak256(abi.encodePacked(block.chainid, address(inft), agentId, from, to, keccak256(sealedKey), dataHash, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, MessageHashUtils.toEthSignedMessageHash(digest));
        return abi.encodePacked(r, s, v);
    }

    function _hex32(bytes32 v) internal pure returns (string memory) {
        bytes memory H = "0123456789abcdef";
        bytes memory out = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            out[i * 2] = H[uint8(v[i]) >> 4];
            out[i * 2 + 1] = H[uint8(v[i]) & 0x0f];
        }
        return string(out);
    }

    function _teeText(bytes32 reqH, bytes32 imgH) internal pure returns (string memory) {
        return string.concat(_hex32(reqH), ":", _hex32(imgH));
    }

    function _teeSig(uint256 pk, string memory text) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, MessageHashUtils.toEthSignedMessageHash(bytes(text)));
        return abi.encodePacked(r, s, v);
    }

    // 1: migration preserved id + owner + royalties + identity onto AuraINFT for EVERY catalog agent.
    function test_Coherence_MigrationPreservesAllAgents() public view {
        assertEq(inft.nextAgentId(), N + 1, "all N agents migrated, ids 1..N");
        for (uint256 id = 1; id <= N; id++) {
            AgentRegistry.Agent memory s = src.getAgent(id);
            AuraINFT.Agent memory d = inft.getAgent(id);
            assertEq(inft.ownerOf(id), src.ownerOf(id), "owner preserved (income-follows-owner)");
            assertEq(d.royaltyBps, s.royaltyBps, "output royaltyBps preserved");
            assertEq(d.creatorResaleBps, s.creatorResaleBps, "creator resale bps preserved");
            assertEq(d.name, s.name, "name preserved");
            assertEq(d.styleFingerprint, s.styleFingerprint, "style fingerprint preserved");
            assertEq(d.encBrainRoot, s.encBrainRoot, "brain root preserved");
            assertEq(d.modelAttestation, s.modelAttestation, "model attestation preserved");
            assertGt(inft.sealedKeyOf(id).length, 0, "bootstrap sealed key present (re-keyed server-side)");
        }
        // agent 3 is owned by alice, not the deployer -> its owner survived the migration.
        assertEq(inft.ownerOf(3), alice, "non-deployer-owned agent kept its owner");
    }

    // 2: OutputNFT is bound to AuraINFT + routes a Relic's royalty to the migrated agent's CURRENT owner.
    function test_Coherence_OutputNFTRoutesRoyaltyToAuraINFT() public {
        assertEq(address(outNft.registry()), address(inft), "OutputNFT.registry == AuraINFT (immutable bind)");
        uint256 relic = _mintRelic(collector, 3, keccak256("n1")); // agent 3 -> owner alice, 600 bps
        (address receiver, uint256 amount) = outNft.royaltyInfo(relic, 1 ether);
        assertEq(receiver, alice, "Relic royalty -> AuraINFT agent#3 owner (alice), not the Relic owner");
        assertEq(amount, 0.06 ether, "6% output royalty via AuraINFT.royaltyBpsOf");
    }

    // 3: a sealed re-key transfer of the agent moves the SAME Relic's royalty stream to the new owner.
    function test_Coherence_RoyaltyFollowsSealedTransfer() public {
        uint256 relic = _mintRelic(collector, 1, keccak256("n2")); // agent 1 -> owner deployer, 700 bps
        (address beforeOwner,) = outNft.royaltyInfo(relic, 1 ether);
        assertEq(beforeOwner, deployer, "before: routes to agent#1 owner (deployer)");

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory seal = hex"aabbccdd";
        bytes32 newData = keccak256("rekey-1");
        bytes memory proof = _oracleProof(1, deployer, buyer, seal, newData, deadline);
        vm.prank(deployer);
        inft.transfer(deployer, buyer, 1, seal, "0g://brain-1-rekey", newData, deadline, proof);
        assertEq(inft.ownerOf(1), buyer, "agent#1 moved via sealed transfer");

        (address afterOwner,) = outNft.royaltyInfo(relic, 1 ether);
        assertEq(afterOwner, buyer, "after: the SAME Relic royalty now follows agent#1 to buyer");
    }

    // 4: SummonEscrow prices via AuraINFT.ownerOf (deployer-owned priced; a non-owner is rejected).
    function test_Coherence_SummonEscrowPricesViaAuraINFT() public {
        assertEq(address(escrow.registry()), address(inft), "SummonEscrow.registry == AuraINFT");
        assertEq(escrow.summonPrice(1), 0.01 ether, "deployer-owned agent#1 priced during migration");
        // the deployer owns 1,2 but NOT 3 -> cannot price agent 3.
        vm.prank(deployer);
        vm.expectRevert(bytes("not agent owner"));
        escrow.setSummonPrice(3, 0.02 ether);
        // alice (the real owner) can.
        vm.prank(alice);
        escrow.setSummonPrice(3, 0.02 ether);
        assertEq(escrow.summonPrice(3), 0.02 ether, "the real owner (alice) prices agent#3 via AuraINFT ownerOf");
    }

    // 5: Option A TEE signer pinned + marketplace allowlists the RELIC collection (OutputNFT) ONLY. Agents
    //    (AuraINFT) are NOT allowlisted going forward: agent resale is Flow B (the ERC-7857 secure transfer),
    //    never a generic buy(). (The LIVE marketplace still carries AuraINFT from the original cutover - a
    //    harmless no-op, since a buy() on an agent reverts atomically; see AuraMarketplace.t.sol.)
    function test_Coherence_TeeSignerAndRelicOnlyAllowlist() public view {
        assertEq(outNft.teeSigner(), OPTION_A_TEE, "Option A testnet TEE signer pinned on OutputNFT");
        assertTrue(mkt.allowedCollection(address(outNft)), "marketplace allowlists the Relic collection (OutputNFT)");
        assertFalse(mkt.allowedCollection(address(inft)), "agents (AuraINFT) are NOT marketplace-tradable (Relics-only)");
    }

    // 6: agents on AuraINFT are spec-strict iNFTs - raw ERC721 transfer REVERTS (must go through re-key).
    function test_Coherence_RawTransferBlockedOnMigratedAgents() public {
        vm.expectRevert(bytes("use transfer(): ERC-7857 secure transfer required"));
        vm.prank(deployer);
        inft.transferFrom(deployer, buyer, 1);
    }

    // 7: OPTION A verified-mint still works against the AuraINFT-bound OutputNFT: the on-chain 0G-TEE gate
    //    mints + binds dataHash + routes royalty to the migrated AuraINFT agent's owner. (setUp pins the real
    //    Option A testnet signer; here we rotate to a controllable synthetic signer to exercise the mechanism.)
    function test_Coherence_VerifiedMintWorksAgainstAuraINFT() public {
        uint256 teePk = 0x7EE;
        vm.prank(attestor);
        outNft.setTeeSigner(vm.addr(teePk)); // rotate to a signer we can produce envelopes for

        bytes32 imgH = keccak256("the-art-bytes");
        string memory text = _teeText(keccak256("req"), imgH);
        bytes32 teeAtt = keccak256(bytes(text)); // backend binds teeAttestation = keccak(teeText)
        bytes32 nonce = keccak256("verified-1");
        uint256 relic = outNft.mintOutputVerified(
            collector, 2, "0g://img", keccak256("prov"), teeAtt, 42, nonce, _verifiedAuthSig(collector, 2, teeAtt, nonce), text, _teeSig(teePk, text)
        );
        assertEq(outNft.ownerOf(relic), collector, "verified Relic minted");
        assertEq(outNft.dataHashOf(relic), imgH, "dataHash bound to sha256(image) 0G attested");
        (address receiver, uint256 amount) = outNft.royaltyInfo(relic, 1 ether);
        assertEq(receiver, deployer, "verified Relic royalty routes to AuraINFT agent#2 owner (deployer)");
        assertEq(amount, 0.08 ether, "8% output royalty (agent#2) via AuraINFT");
    }

    // ── GAME LAYER: all four contracts fold into THIS deploy, ALL bound to the ONE registry = AuraINFT. ──

    // 8: ArenaVote resolves ownerOf on the cutover AuraINFT (registry wired + quorum set at deploy).
    function test_Game_ArenaVoteWiredToAuraINFT() public view {
        assertEq(address(arena.registry()), address(inft), "ArenaVote.registry == AuraINFT");
        assertEq(arena.quorum(), ARENA_QUORUM, "ArenaVote quorum set at deploy");
    }

    // 9: ArenaVote's structural self-match guard resolves owners THROUGH AuraINFT: a same-owner pairing reverts,
    //    a distinct-owner pairing (agent1=deployer vs agent3=alice) is accepted. Proves the registry read is live.
    function test_Game_ArenaVoteSelfMatchGuardViaAuraINFT() public {
        // agents 1 and 2 are both owned by the deployer post-migration -> same-owner self-match reverts.
        vm.expectRevert(bytes("same-owner self-match"));
        arena.createBattle(1, 2, 1 hours, 1 hours);
        // agent 1 (deployer) vs agent 3 (alice) -> distinct owners on AuraINFT -> accepted.
        uint256 battleId = arena.createBattle(1, 3, 1 hours, 1 hours);
        assertEq(battleId, 1, "distinct-owner battle created (owners resolved via AuraINFT.ownerOf)");
    }

    // 10: AuraFusion mints children through the SAME AuraINFT (auraINFT wired). registerGenesis reads ownerOf +
    //     getAgent.styleFingerprint from the migrated AuraINFT -> proves the child-mint read-path IS the cutover registry.
    function test_Game_AuraFusionWiredToAuraINFT() public {
        assertEq(address(fusion.auraINFT()), address(inft), "AuraFusion.auraINFT == AuraINFT (children mint through it)");
        // the deployer owns migrated agent 1 -> can anchor its genome (fusion resolves ownerOf via AuraINFT).
        uint16[8] memory genome; // all-zero alleles are always in range (< pool size)
        vm.prank(deployer);
        fusion.registerGenesis(1, genome);
        assertTrue(fusion.isFusable(1), "migrated AuraINFT agent#1 fusable (fusion read AuraINFT ownerOf+getAgent)");
        assertEq(fusion.generationOf(1), 1, "genesis generation pinned to 1");
    }

    // 11: ArenaReputation keys ratings to AuraINFT.ownerOf so a rating FOLLOWS the iNFT (registry wired + anchorer set).
    function test_Game_ArenaReputationWiredAndFollowsOwner() public view {
        assertEq(address(reputation.registry()), address(inft), "ArenaReputation.registry == AuraINFT");
        assertEq(reputation.anchorer(), anchorer, "season anchorer set at deploy");
        assertEq(reputation.currentHolderOf(3), alice, "agent#3 rating holder == AuraINFT owner (alice); reputation follows the iNFT");
    }

    // 12: PersonhoodGate Floor-1 (hold-an-Aura) IS the cutover AuraINFT => the Arena sybil floor resolves over the
    //     SAME registry the battles are about. A migrated-agent owner clears it; a non-holder is honest-closed.
    function test_Game_PersonhoodGateFloorOverAuraINFT() public view {
        assertEq(address(personhood.aura()), address(inft), "PersonhoodGate.aura == AuraINFT (Floor-1 over the same registry)");
        assertTrue(personhood.holdsAura(deployer), "deployer holds migrated Auras -> clears Floor-1");
        assertTrue(personhood.isPerson(deployer), "deployer is a person via Floor-1 (hold-an-Aura)");
        assertFalse(personhood.holdsAura(buyer), "buyer holds no Aura -> does not clear Floor-1");
        assertFalse(personhood.isPerson(buyer), "buyer is not a person (no Aura, no conviction) -> honest-closed");
    }
}
