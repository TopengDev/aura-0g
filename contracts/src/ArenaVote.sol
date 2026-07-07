// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IAuraRegistry} from "./IAuraRegistry.sol";

/// @title ArenaVote - the Creative Arena's BLIND, STAKED, COMMIT-REVEAL battle vote, hardened.
/// @notice The winner is a DETERMINISTIC recompute from PUBLIC chain data alone: the votes live in on-chain
///         state + `Revealed(voter, choice, stake, weight)` events, and the winner is a pure function of that
///         log. The contract ALSO enforces the identical tally on-chain, so an independent 3rd-party re-tally
///         from the logs MUST equal the contract's finalized winner. This is the "recompute it yourself"
///         surface verify-public.ts ships for provenance, applied to the vote - NOT SQLite theater.
///
///         Ported from the proven pf-smoke prototype (9/9 integrity: wrong-salt, ballot-substitution, double
///         commit/reveal, out-of-window, early-finalize all REVERT) and HARDENED with the diligence
///         corrections (dil-integrity-economics.md, dil-rating-ladder.md):
///
///           1. LINEAR stake-weight (w = stake), NOT isqrt/sqrt. Sqrt-of-money is the Gitcoin sybil hole:
///              splitting capital C across N identities multiplies power by sqrt(N) (a ~7x free multiplier at
///              the floor). Linear weight is sybil-NEUTRAL to splitting (power == capital, any identity count).
///              Sqrt is safe only ABOVE a hard personhood floor (Tier-3, post-cup).
///           2. NON-REVEAL SLASH: a committed-but-unrevealed ballot FORFEITS fraction f of its stake into the
///              reward pool (RANDAO commit-reveal-punish / TCR-1.1). This kills the STRADDLE (commit both sides,
///              reveal only the winner): with f >= 2*rho the straddle is negative-EV for any skill level. This
///              contract pins rho = 0.2 (RHO_BPS) and f = 0.5 (F_BPS), so F_BPS >= 2*RHO_BPS holds by construction.
///           3. QUORUM gate: a battle CONFERS a rated verdict only if >= `quorum` DISTINCT voters revealed.
///              Below quorum = UNRATED (kills the low-turnout self-vote wash); unrated battles refund all stakes.
///           4. SELF-MATCH revert: a battle's two sides must differ, and (when a registry is set) must not share
///              the same current owner - structural anti-wash.
///           5. ENDOGENOUS reward pool: pool = rho*loserStake + f*unrevealedStake, funded ONLY by losers +
///              non-revealers, NEVER an external subsidy. The vote is constant-sum among participants, so a
///              no-edge sybil is negative-EV (only a genuine scout with predictive skill beats zero).
///           6. NO emission for winning: the prize is the reward pool redistribution + reputation (a SIGNAL),
///              never a minted token (the LooksRare wash-trading lesson). Rank feeds price, never emission.
///
///         Matchmaking is operator-created (onlyOwner createBattle) => seed-blind pairing; a voter is never a
///         matchmaker and cannot force a self-match.
contract ArenaVote is Ownable2Step, ReentrancyGuardTransient {
    using Address for address payable;

    // --- diligence-locked economic parameters (basis points, immutable by design) ---
    /// @notice Minority-slash rho = 0.2. GENTLE on purpose: art is subjective, so this is a Schelling nudge
    ///         against lazy coin-flipping, NOT a punishment of honest minority taste.
    uint16 public constant RHO_BPS = 2000;
    /// @notice Non-reveal forfeit f = 0.5. Chosen so F_BPS >= 2*RHO_BPS (5000 >= 4000): the straddle-kill bound.
    uint16 public constant F_BPS = 5000;
    uint16 internal constant BPS = 10_000;

    /// @notice Optional agent registry (may be address(0)). When set, createBattle reverts a same-owner pairing
    ///         (ownerOf(agentA) == ownerOf(agentB)) - the structural self-match guard.
    IAuraRegistry public immutable registry;
    /// @notice Minimum DISTINCT revealed voters for a battle to confer a RATED verdict. Below this = unrated
    ///         (full refunds, no slash, no reputation).
    uint256 public immutable quorum;

    struct Battle {
        uint256 agentA;
        uint256 agentB;
        uint64 commitEnd;
        uint64 revealEnd;
        bool finalized;
        bool rated; // revealCount >= quorum
        uint8 winner; // 0 = tie/unrated, 1 = A, 2 = B
        uint256 stakeCommitted; // total wei committed across all voters
        uint256 weightA; // LINEAR: sum of revealed stake on side A
        uint256 weightB; // LINEAR: sum of revealed stake on side B
        uint256 revealCount; // distinct voters that revealed
        uint256 pool; // endogenous reward pool computed at finalize (rho*loserStake + f*unrevealedStake)
    }

    mapping(uint256 => Battle) public battles;
    /// @notice battleId => voter => blinded commitment (keccak256(abi.encode(battleId, choice, salt, voter))).
    mapping(uint256 => mapping(address => bytes32)) public commitmentOf;
    mapping(uint256 => mapping(address => uint256)) public stakeOf;
    /// @notice battleId => voter => revealed side (0 = not revealed, 1 = A, 2 = B).
    mapping(uint256 => mapping(address => uint8)) public sideOf;
    mapping(uint256 => mapping(address => bool)) public claimedOf;
    uint256 public nextBattleId = 1;

    event BattleCreated(uint256 indexed battleId, uint256 indexed agentA, uint256 indexed agentB, uint64 commitEnd, uint64 revealEnd);
    event Committed(uint256 indexed battleId, address indexed voter, bytes32 commitment, uint256 stake);
    event Revealed(uint256 indexed battleId, address indexed voter, uint8 choice, uint256 stake, uint256 weight);
    event Finalized(uint256 indexed battleId, uint8 winner, uint256 weightA, uint256 weightB, bool rated, uint256 pool);
    event Claimed(uint256 indexed battleId, address indexed voter, uint256 payout);

    constructor(address registry_, uint256 quorum_) Ownable(msg.sender) {
        // F_BPS >= 2*RHO_BPS is the straddle-kill invariant; assert it at deploy so the constants can never
        // drift into an exploitable configuration.
        require(F_BPS >= 2 * RHO_BPS, "f<2rho");
        // A RATED verdict needs at least 2 DISTINCT revealers. quorum < 2 is a footgun (L8): quorum == 0 would
        // RATE a zero-reveal battle (revealCount >= 0 always holds), whose non-reveal forfeit pool (F_BPS of the
        // committed stake) then has NO revealer to claim it -> ~50% of the stake locks in the contract forever;
        // and quorum == 1 lets a single self-reveal confer a rated verdict, defeating the quorum's anti-wash
        // purpose. The shipped default is 3, so live is safe; this bound hardens the constructor against a
        // misconfigured deploy.
        require(quorum_ >= 2, "quorum<2");
        registry = IAuraRegistry(registry_); // address(0) allowed (self-match falls back to agentA != agentB)
        quorum = quorum_;
    }

    // ------------------------------- matchmaking -------------------------------

    /// @notice Operator (matchmaker) creates a battle between two DISTINCT agents. Seed-blind pairing lives in
    ///         the operator; a voter is never a matchmaker. Reverts a self-match: same agent, or (registry set)
    ///         same current owner.
    function createBattle(uint256 agentA, uint256 agentB, uint64 commitDur, uint64 revealDur)
        external
        onlyOwner
        returns (uint256 battleId)
    {
        require(agentA != agentB, "self-match"); // structural self-match revert
        require(commitDur > 0 && revealDur > 0, "bad window");
        if (address(registry) != address(0)) {
            require(registry.ownerOf(agentA) != registry.ownerOf(agentB), "same-owner self-match");
        }
        battleId = nextBattleId++;
        uint64 commitEnd = uint64(block.timestamp) + commitDur;
        uint64 revealEnd = commitEnd + revealDur;
        Battle storage bt = battles[battleId];
        bt.agentA = agentA;
        bt.agentB = agentB;
        bt.commitEnd = commitEnd;
        bt.revealEnd = revealEnd;
        emit BattleCreated(battleId, agentA, agentB, commitEnd, revealEnd);
    }

    // ------------------------------- commit -------------------------------

    /// @notice Commit a blinded, staked ballot. commitment = keccak256(abi.encode(battleId, choice, salt, voter)).
    ///         Stake is LOCKED at commit (skin-in-the-game before the outcome is knowable). One commit per voter.
    function commit(uint256 battleId, bytes32 commitment) external payable {
        Battle storage bt = battles[battleId];
        require(bt.commitEnd != 0, "no such battle");
        require(block.timestamp < bt.commitEnd, "commit window closed");
        require(commitmentOf[battleId][msg.sender] == bytes32(0), "already committed");
        require(msg.value > 0, "stake required");
        commitmentOf[battleId][msg.sender] = commitment;
        stakeOf[battleId][msg.sender] = msg.value;
        bt.stakeCommitted += msg.value;
        emit Committed(battleId, msg.sender, commitment, msg.value);
    }

    // ------------------------------- reveal -------------------------------

    /// @notice Reveal (choice, salt). The contract re-hashes and REJECTS any mismatch (no ballot substitution,
    ///         no copy-voting, no last-second bandwagon). Weight is LINEAR (= stake). Weighted-add on-chain + emit.
    function reveal(uint256 battleId, uint8 choice, bytes32 salt) external {
        Battle storage bt = battles[battleId];
        require(bt.commitEnd != 0, "no such battle");
        require(block.timestamp >= bt.commitEnd && block.timestamp < bt.revealEnd, "not reveal window");
        require(sideOf[battleId][msg.sender] == 0, "already revealed");
        require(choice == 1 || choice == 2, "bad choice");
        bytes32 c = commitmentOf[battleId][msg.sender];
        require(c != bytes32(0), "no commit");
        require(keccak256(abi.encode(battleId, choice, salt, msg.sender)) == c, "commitment mismatch");

        sideOf[battleId][msg.sender] = choice;
        uint256 stake = stakeOf[battleId][msg.sender];
        uint256 weight = stake; // LINEAR stake-weight (the sybil-neutral correction; NOT isqrt/sqrt)
        if (choice == 1) bt.weightA += weight;
        else bt.weightB += weight;
        bt.revealCount += 1;
        emit Revealed(battleId, msg.sender, choice, stake, weight);
    }

    // ------------------------------- finalize -------------------------------

    /// @notice Settle the winner + compute the endogenous reward pool after the reveal window. Permissionless.
    ///         rated = (revealCount >= quorum). If unrated, the pool is 0 and every committer refunds in full.
    function finalize(uint256 battleId) external {
        Battle storage bt = battles[battleId];
        require(bt.commitEnd != 0, "no such battle");
        require(block.timestamp >= bt.revealEnd, "reveal window not over");
        require(!bt.finalized, "already finalized");

        bt.finalized = true;
        bt.rated = bt.revealCount >= quorum;
        uint8 winner = bt.weightA > bt.weightB ? 1 : (bt.weightB > bt.weightA ? 2 : 0);
        bt.winner = winner;

        if (bt.rated) {
            uint256 revealedStake = bt.weightA + bt.weightB;
            uint256 unrevealedStake = bt.stakeCommitted - revealedStake;
            // loserStake = the revealed stake on the LOSING side (0 on a tie -> no minority slash on a tie).
            uint256 loserStake = winner == 1 ? bt.weightB : (winner == 2 ? bt.weightA : 0);
            // ENDOGENOUS pool: minority-slash of losers + non-reveal forfeit of withholders. No external funds.
            bt.pool = (loserStake * RHO_BPS) / BPS + (unrevealedStake * F_BPS) / BPS;
        } else {
            bt.pool = 0; // unrated: the battle did not count -> full refunds, no slash
        }

        emit Finalized(battleId, winner, bt.weightA, bt.weightB, bt.rated, bt.pool);
    }

    // ------------------------------- claim -------------------------------

    /// @notice Claim a voter's settlement for a finalized battle (pull). Payout by role:
    ///           - UNRATED battle: full stake refund to every committer (revealed or not).
    ///           - committed but NOT revealed: (1 - f) * stake  (forfeits f into the pool -> straddle-kill).
    ///           - RATED tie: full stake back + a pro-rata share (by stake) of the non-revealer-forfeit pool.
    ///           - RATED winner: stake back + a pro-rata share (by LINEAR weight = stake) of the pool.
    ///           - RATED loser: (1 - rho) * stake.
    ///         The payouts are constant-sum: they always total exactly stakeCommitted (integer-division dust
    ///         stays locked in the contract), so no external subsidy is ever needed.
    function claim(uint256 battleId) external nonReentrant returns (uint256 payout) {
        Battle memory bt = battles[battleId];
        require(bt.finalized, "not finalized");
        require(!claimedOf[battleId][msg.sender], "already claimed");
        uint256 stake = stakeOf[battleId][msg.sender];
        require(stake > 0, "no stake");
        claimedOf[battleId][msg.sender] = true;

        uint8 side = sideOf[battleId][msg.sender]; // 0 = committed but never revealed

        if (!bt.rated) {
            // Unrated: the battle conferred no verdict -> return every committer's full stake.
            payout = stake;
        } else if (side == 0) {
            // Non-revealer: forfeit f, get (1 - f) back. The forfeited f is in the pool for the winners.
            payout = (stake * (BPS - F_BPS)) / BPS;
        } else if (bt.winner == 0) {
            // Rated tie: full stake back + pro-rata (by stake) of the pool (which is only non-revealer forfeits).
            uint256 revealedTotal = bt.weightA + bt.weightB;
            payout = stake + (revealedTotal == 0 ? 0 : (bt.pool * stake) / revealedTotal);
        } else if (side == bt.winner) {
            // Winner: stake back + pro-rata share of the pool by LINEAR weight (= stake).
            uint256 winStake = bt.winner == 1 ? bt.weightA : bt.weightB;
            payout = stake + (winStake == 0 ? 0 : (bt.pool * stake) / winStake);
        } else {
            // Loser: (1 - rho) of stake back (the rho slice funded the pool).
            payout = (stake * (BPS - RHO_BPS)) / BPS;
        }

        if (payout > 0) {
            payable(msg.sender).sendValue(payout);
        }
        emit Claimed(battleId, msg.sender, payout);
    }

    // ------------------------------- views / helpers -------------------------------

    /// @notice The blinded commitment a voter must submit (for the off-chain client + tests). Binds the
    ///         battleId (domain separation) so a commitment can never be replayed across battles.
    function commitmentFor(uint256 battleId, uint8 choice, bytes32 salt, address voter) external pure returns (bytes32) {
        return keccak256(abi.encode(battleId, choice, salt, voter));
    }

    function getBattle(uint256 battleId) external view returns (Battle memory) {
        return battles[battleId];
    }
}
