// AURA game layer - UNIT test: the ARENA battle + vote flow + the KEYLESS tally recompute (3rd-party from the
// Revealed events ALONE). LOCAL ONLY (no network). Proves the anti-SQLite-theater property in TS: an
// independent tally from the on-chain event log equals the contract's enforced winner - the exact assertion
// contracts/test/ArenaVote.t.sol makes on-chain (test_reTally_fromRevealedEventsMatchesOnChain), reproduced
// here with the SAME scenario (A=3+4=7 ether, B=5+1=6 ether -> A wins). Also proves the shared-theme 2-gen
// battle (seed-blind, own-style) + the blind commitment (byte-identical to ArenaVote.commitmentFor).
import { ethers } from "ethers";
import { keccak256, encodeAbiParameters, getAddress } from "viem";
import type { GenProof } from "../aura/generate.js";
import { tallyFromEvents, buildTallyReport, recomputeBattleTally, type RevealedEvent, type OnChainBattle, type TallyDeps } from "../aura/game/arena-tally.js";
import { deriveBattleTheme, battleThemeSeed, buildCommitment, prepareVote, createBattleFlow, ArenaError, type CreateBattleDeps, type BattleAgent } from "../aura/game/arena.js";

let pass = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error("  \x1b[31mFAIL:\x1b[0m", m);
    process.exit(1);
  }
  pass++;
  console.log("  \x1b[32mPASS:\x1b[0m", m);
};

const E = (n: string) => ethers.parseEther(n); // ether -> wei bigint

async function main() {
  console.log("\n=== AURA arena - keyless tally recompute + battle/vote flow ===\n");

  // ── A. the KEYLESS tally (pure, from events) - the SAME scenario as the on-chain re-tally forge test ──
  // alice 1/3e, bob 2/5e, carol 1/4e, dave 2/1e -> weightA=7e, weightB=6e -> A wins. LINEAR: weight == stake.
  const events: RevealedEvent[] = [
    { voter: "0xa", choice: 1, stake: E("3"), weight: E("3") },
    { voter: "0xb", choice: 2, stake: E("5"), weight: E("5") },
    { voter: "0xc", choice: 1, stake: E("4"), weight: E("4") },
    { voter: "0xd", choice: 2, stake: E("1"), weight: E("1") },
  ];
  const t = tallyFromEvents(events);
  ok(t.weightA === E("7") && t.weightB === E("6"), "event tally: weightA=7e18, weightB=6e18 (linear stake-weight)");
  ok(t.winner === 1, "re-tallied winner == A (7 > 6), from the Revealed log alone");
  ok(t.revealCount === 4 && !t.weightTampered, "counted 4 revealed ballots, weighting is LINEAR (untampered)");

  // weight-tamper detection: a weight != stake (a non-linear/faked weight) is caught.
  const tampered = tallyFromEvents([{ voter: "0xa", choice: 1, stake: E("3"), weight: E("30") }]);
  ok(tampered.weightTampered, "a weight != stake (non-linear) is flagged as tampered");

  // tie -> winner 0.
  ok(tallyFromEvents([{ voter: "0xa", choice: 1, stake: E("5"), weight: E("5") }, { voter: "0xb", choice: 2, stake: E("5"), weight: E("5") }]).winner === 0, "equal weights -> tie (winner 0)");

  // ── B. buildTallyReport: independent tally MUST equal the contract's enforced tally ──
  const onchainTrue: OnChainBattle = { finalized: true, rated: true, winner: 1, weightA: E("7"), weightB: E("6"), revealCount: 4, pool: E("1") };
  const report = buildTallyReport(1, events, onchainTrue);
  ok(report.agree.ok, "keyless report agrees: independent event tally == contract getBattle() (anti-SQLite-theater)");
  ok(report.agree.winnerMatches && report.agree.weightAMatches && report.agree.weightBMatches && report.agree.weightingIsLinear, "every agreement axis holds (winner, weightA, weightB, linear weighting)");
  ok(report.selfCheck.revealedLogs.includes("cast logs") && report.selfCheck.note.includes("Revealed") && report.selfCheck.getBattle.includes("getBattle"), "report ships copy-paste self-check commands (cast logs over the Revealed topic + getBattle) for the skeptic");

  // a LYING contract (winner flipped to B) is caught: the independent tally disagrees.
  const onchainLie: OnChainBattle = { ...onchainTrue, winner: 2 };
  ok(!buildTallyReport(1, events, onchainLie).agree.ok, "a contract state that disagrees with the event tally FAILS the keyless check (would expose tampering)");

  // ── C. recomputeBattleTally with mocked chain seams (3rd-party from events, no AURA DB) ──
  const deps: TallyDeps = {
    async getRevealedEvents() {
      return events;
    },
    async getBattle() {
      return onchainTrue;
    },
  };
  const recomputed = await recomputeBattleTally(1, deps);
  ok(recomputed.agree.ok && recomputed.recompute.winnerLabel === "A", "recomputeBattleTally: 3rd-party winner (A) == contract winner, from events alone");

  // ── D. blind commitment: byte-identical to ArenaVote.commitmentFor keccak(abi.encode(id,choice,salt,voter)) ──
  const voter = "0x1111111111111111111111111111111111111111";
  const salt = "0x" + "ab".repeat(32);
  const c = buildCommitment(5, 1, salt, voter);
  const cViem = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint8" }, { type: "bytes32" }, { type: "address" }], [5n, 1, salt as `0x${string}`, getAddress(voter)]));
  ok(c === cViem, "buildCommitment == viem recompute of keccak(abi.encode(id,choice,salt,voter)) (== ArenaVote.commitmentFor)");
  ok(buildCommitment(5, 1, salt, voter) !== buildCommitment(5, 2, salt, voter), "a different CHOICE => a different commitment (ballot-substitution proof)");
  ok(buildCommitment(5, 1, salt, voter) !== buildCommitment(6, 1, salt, voter), "a different BATTLE => a different commitment (cross-battle replay proof)");
  const prep = prepareVote(5, 1, voter, salt);
  ok(prep.commitment === c && prep.commitCall.fn === "commit" && prep.revealCall.args[2] === salt, "prepareVote returns the commitment + commit/reveal args (salt is client-kept for reveal)");

  // ── E. shared-theme derivation: deterministic + seed-blind (blockhash-bound) ──
  const bh1 = "0x" + "11".repeat(32);
  const bh2 = "0x" + "22".repeat(32);
  const th1 = deriveBattleTheme(7, 10, 20, bh1);
  const th1b = deriveBattleTheme(7, 10, 20, bh1);
  const th2 = deriveBattleTheme(7, 10, 20, bh2);
  ok(th1.themeSeed === th1b.themeSeed && th1.subjectProse === th1b.subjectProse, "battle theme is deterministic for a fixed (battleId, agents, blockHash)");
  ok(th1.themeSeed !== th2.themeSeed && th1.subjectProse !== th2.subjectProse, "a different blockHash => a different theme (SEED-BLIND, un-grindable)");
  ok(th1.perAgentSeedA !== th1.perAgentSeedB, "each agent gets a DISTINCT provenance seed (unique per side)");
  ok(battleThemeSeed(7, 10, 20, bh1) === th1.themeSeed, "battleThemeSeed matches deriveBattleTheme.themeSeed");

  // ── F. createBattleFlow: 2 gens on ONE shared theme, each in its OWN style; seed-blind; self-match rejected ──
  const genInputs: any[] = [];
  const mockGenerate = (async (input) => {
    genInputs.push(input);
    const g: GenProof = {
      imageRoot: `0xroot-agent-${input.agentId}`,
      provenanceHash: ethers.keccak256(ethers.toUtf8Bytes(`prov-${input.agentId}`)),
      teeAttestation: ethers.keccak256(ethers.toUtf8Bytes("tee")),
      seed: input.pull!.seedRoot,
      model: "qwen/qwen-image-edit-2511",
      teeSigner: "0xsigner",
      verified: true,
      verifiability: "TeeML",
      chatId: "c",
      latencyMs: 1,
      bytes: Buffer.from("img"),
      prompt: "p",
      usedBrain: false,
      provenanceRecord: {},
      teeText: null,
      teeSig: null,
      dataHash: null,
      teeSignerVerified: null,
    };
    return g;
  }) as CreateBattleDeps["generate"];

  const battleBlockHash = "0x" + "cd".repeat(32);
  const cbDeps: CreateBattleDeps = {
    async createBattleOnChain(a, b, cd, rd) {
      ok(a === 10 && b === 20 && cd > 0 && rd > 0, "createBattleOnChain got the two agents + positive windows");
      return { battleId: 7, blockNumber: 100, blockHash: battleBlockHash };
    },
    generate: mockGenerate,
  };
  const a: BattleAgent = { id: 10, name: "NOKTURNE", encBrainRoot: "0xbrainA" };
  const b: BattleAgent = { id: 20, name: "MIRAI", encBrainRoot: "" };
  const res = await createBattleFlow(a, b, { deps: cbDeps });
  ok(res.battleId === 7 && res.images.length === 2 && res.seedBlind === true, "createBattleFlow: battle #7 created with 2 portraits (seed-blind)");
  const expectedTheme = deriveBattleTheme(7, 10, 20, battleBlockHash);
  ok(res.theme.subjectProse === expectedTheme.subjectProse, "the battle theme derives from the createBattle block hash (post-commit, seed-blind)");
  ok(genInputs.length === 2, "exactly 2 generations (one per agent)");
  ok(genInputs[0].pull.subjectProse === expectedTheme.subjectProse && genInputs[1].pull.subjectProse === expectedTheme.subjectProse, "BOTH gens rendered the SAME shared subject/theme");
  ok(genInputs[0].pull.subjectProse === genInputs[1].pull.subjectProse, "the theme is identical across both sides (one shared theme)");
  ok(genInputs[0].pull.seedRoot !== genInputs[1].pull.seedRoot, "each side has a DISTINCT provenance seed (unique per agent)");
  ok(genInputs[0].agentId === 10 && genInputs[1].agentId === 20, "each gen used its OWN agentId => its OWN style (STYLE stays per-agent)");
  ok(res.images[0]!.agentId === 10 && res.images[1]!.agentId === 20, "battle images map to [A, B]");

  // self-match is rejected before any chain/gen call.
  let selfMatchRejected = false;
  try {
    await createBattleFlow({ id: 5, name: "X", encBrainRoot: "" }, { id: 5, name: "X", encBrainRoot: "" }, { deps: cbDeps });
  } catch (e) {
    selfMatchRejected = e instanceof ArenaError && (e as ArenaError).status === 400;
  }
  ok(selfMatchRejected, "self-match (same agent both sides) is rejected (structural anti-wash)");

  console.log(`\n=== arena: ${pass}/${pass} assertions PASS (keyless tally + battle/vote flow) ===\n`);
}

main().catch((e) => {
  console.error("\narena TEST ERROR:", e);
  process.exit(1);
});
