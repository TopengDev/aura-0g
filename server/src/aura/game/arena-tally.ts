// SERVER-ONLY. The KEYLESS battle tally recompute - the vote's "recompute it yourself" surface, cloned from
// verify-public.ts one layer up (from a per-token provenance read to a per-battle vote re-tally). The winner
// is a DETERMINISTIC pure function of the on-chain `Revealed(battleId, voter, choice, stake, weight)` log:
// sum the LINEAR weight per side, argmax. A third party re-tallies from the events ALONE (no AURA DB) and
// asserts it equals the contract's enforced getBattle().winner - NOT SQLite theater. This mirrors the proven
// pf-smoke third-party-retally.mjs (9 wallets, ethers + viem, separate process, matched the contract).
//
// It also recomputes each emitted weight from the staked wei (LINEAR: weight == stake) so even the WEIGHTING
// is not trusted - a tampered weight is caught. Blindness/quorum/slash are enforced by the contract; this
// module only proves the TALLY is reproducible from public data.
import { ethers } from "ethers";
import { GALILEO } from "../config.js";
import { CONTRACTS } from "../config.js";
import { arenaVoteRead, arenaVoteConfigured } from "./contracts.js";
import { readProvider } from "../contracts.js";

/** One Revealed event, as a third party reads it from the log (choice 1 = A, 2 = B; weight is LINEAR = stake). */
export interface RevealedEvent {
  voter: string;
  choice: number; // 1 = A, 2 = B
  stake: bigint;
  weight: bigint;
}

export interface PureTally {
  weightA: bigint;
  weightB: bigint;
  winner: number; // 0 = tie, 1 = A, 2 = B
  revealCount: number;
  weightTampered: boolean; // true if ANY emitted weight != stake (LINEAR weighting must hold)
}

/**
 * PURE: the entire tally from the Revealed events alone. This is the 3rd-party recompute - it trusts nothing
 * but the log. winner = argmax(weightA, weightB); weightTampered flags any non-linear (weight != stake) weight.
 */
export function tallyFromEvents(events: RevealedEvent[]): PureTally {
  let weightA = 0n;
  let weightB = 0n;
  let weightTampered = false;
  for (const e of events) {
    if (e.weight !== e.stake) weightTampered = true; // LINEAR stake-weight: the contract emits weight == stake
    if (e.choice === 1) weightA += e.weight;
    else if (e.choice === 2) weightB += e.weight;
    // any other choice value is not a valid reveal (the contract rejects choice != 1/2) -> ignored in the tally
  }
  const winner = weightA > weightB ? 1 : weightB > weightA ? 2 : 0;
  return { weightA, weightB, winner, revealCount: events.length, weightTampered };
}

/** The contract's finalized state, for the cross-check against the independent tally. */
export interface OnChainBattle {
  finalized: boolean;
  rated: boolean;
  winner: number;
  weightA: bigint;
  weightB: bigint;
  revealCount: number;
  pool: bigint;
}

export interface TallyReport {
  battleId: number;
  found: boolean;
  network: { chainId: number; name: string; explorer: string; rpc: string };
  contract: string;
  // the INDEPENDENT recompute (from Revealed events only)
  recompute: {
    weightA: string;
    weightB: string;
    winner: number;
    winnerLabel: "A" | "B" | "tie";
    revealCount: number;
    weightTampered: boolean;
  };
  // the contract's own enforced tally (getBattle)
  onchain: {
    finalized: boolean;
    rated: boolean;
    winner: number;
    weightA: string;
    weightB: string;
    revealCount: number;
    pool: string;
  };
  // the verdict: the independent tally MUST equal the contract's enforced tally
  agree: {
    winnerMatches: boolean;
    weightAMatches: boolean;
    weightBMatches: boolean;
    revealCountMatches: boolean;
    weightingIsLinear: boolean; // NOT weightTampered
    ok: boolean;
  };
  selfCheck: Record<string, string>;
  trustBoundary: string;
  generatedAt: string;
}

function winnerLabel(w: number): "A" | "B" | "tie" {
  return w === 1 ? "A" : w === 2 ? "B" : "tie";
}

/**
 * PURE: assemble the keyless tally report from the independent event tally + the contract's finalized state.
 * Testable with synthetic events (the true "3rd party from events" proof), no chain needed.
 */
export function buildTallyReport(battleId: number, events: RevealedEvent[], onchain: OnChainBattle, opts?: { contract?: string; rpc?: string; explorer?: string; chainId?: number; name?: string }): TallyReport {
  const t = tallyFromEvents(events);
  const contract = opts?.contract ?? CONTRACTS.arenaVote;
  const rpc = opts?.rpc ?? GALILEO.rpc;
  const explorer = opts?.explorer ?? GALILEO.explorer;
  const chainId = opts?.chainId ?? GALILEO.chainId;
  const name = opts?.name ?? (chainId === 16661 ? "0G Aristotle Mainnet" : "0G Galileo Testnet");

  const agree = {
    winnerMatches: t.winner === onchain.winner,
    weightAMatches: t.weightA === onchain.weightA,
    weightBMatches: t.weightB === onchain.weightB,
    revealCountMatches: t.revealCount === onchain.revealCount,
    weightingIsLinear: !t.weightTampered,
    ok: false,
  };
  agree.ok =
    agree.winnerMatches && agree.weightAMatches && agree.weightBMatches && agree.revealCountMatches && agree.weightingIsLinear;

  // The copy-paste, wallet-free self-check (~10s). eth_getLogs pulls the Revealed events; getBattle is the
  // contract's enforced tally; a skeptic sums the weights themselves and asserts they match.
  const revealedTopic = ethers.id("Revealed(uint256,address,uint8,uint256,uint256)");
  const selfCheck = {
    getBattle: `cast call ${contract} 'getBattle(uint256)' ${battleId} --rpc-url ${rpc}`,
    revealedLogs: `cast logs --address ${contract} '${revealedTopic}' '0x${battleId.toString(16).padStart(64, "0")}' --rpc-url ${rpc}`,
    note: "sum `weight` by `choice` over the Revealed logs (choice 1=A, 2=B); argmax is the winner; assert weight==stake (linear); it MUST equal getBattle().winner. No AURA server in the loop.",
    explorer: `${explorer}/address/${contract}`,
  };

  return {
    battleId,
    found: true,
    network: { chainId, name, explorer, rpc },
    contract,
    recompute: {
      weightA: t.weightA.toString(),
      weightB: t.weightB.toString(),
      winner: t.winner,
      winnerLabel: winnerLabel(t.winner),
      revealCount: t.revealCount,
      weightTampered: t.weightTampered,
    },
    onchain: {
      finalized: onchain.finalized,
      rated: onchain.rated,
      winner: onchain.winner,
      weightA: onchain.weightA.toString(),
      weightB: onchain.weightB.toString(),
      revealCount: onchain.revealCount,
      pool: onchain.pool.toString(),
    },
    agree,
    selfCheck,
    trustBoundary:
      "the trust root is the deployed ArenaVote bytecode (public, immutable), not AURA's DB. Votes live in on-chain state + Revealed events; the winner is a pure function of that log. A committed-but-unrevealed ballot forfeits f of its stake (straddle-kill) and does not count - fine for the deterministic tally.",
    generatedAt: new Date().toISOString(),
  };
}

/** The injectable chain seams for the recompute (mocked in tests; real defaults hit ArenaVote). */
export interface TallyDeps {
  getRevealedEvents(battleId: number): Promise<RevealedEvent[]>;
  getBattle(battleId: number): Promise<OnChainBattle>;
}

/** Real defaults: queryFilter the Revealed log (chunked) + getBattle, both from the deployed ArenaVote. */
export function defaultTallyDeps(fromBlock = Number(process.env.ARENA_DEPLOY_BLOCK ?? 0)): TallyDeps {
  return {
    async getRevealedEvents(battleId) {
      const c = arenaVoteRead();
      const filter = c.filters.Revealed(battleId);
      const latest = await readProvider().getBlockNumber();
      const CHUNK = 2000; // eth_getLogs range safety (the pf-smoke gotcha: chunk by block range on a busy chain)
      const out: RevealedEvent[] = [];
      for (let from = fromBlock; from <= latest; from += CHUNK) {
        const to = Math.min(from + CHUNK - 1, latest);
        const logs = await c.queryFilter(filter, from, to);
        for (const l of logs) {
          const a = (l as ethers.EventLog).args;
          if (!a) continue;
          out.push({ voter: String(a.voter), choice: Number(a.choice), stake: BigInt(a.stake), weight: BigInt(a.weight) });
        }
      }
      return out;
    },
    async getBattle(battleId) {
      const b = await arenaVoteRead().getBattle(battleId);
      return {
        finalized: Boolean(b.finalized),
        rated: Boolean(b.rated),
        winner: Number(b.winner),
        weightA: BigInt(b.weightA),
        weightB: BigInt(b.weightB),
        revealCount: Number(b.revealCount),
        pool: BigInt(b.pool),
      };
    },
  };
}

/**
 * Recompute a battle's winner from the on-chain Revealed events ALONE and cross-check it against the contract's
 * enforced getBattle() tally. The keyless endpoint serves this JSON; a skeptic reproduces it with the selfCheck
 * commands. Injectable so a test drives it with synthetic events (proving the 3rd-party-from-events property).
 */
export async function recomputeBattleTally(battleId: number, deps: TallyDeps = defaultTallyDeps()): Promise<TallyReport> {
  const [events, onchain] = await Promise.all([deps.getRevealedEvents(battleId), deps.getBattle(battleId)]);
  return buildTallyReport(battleId, events, onchain);
}

export { arenaVoteConfigured };
