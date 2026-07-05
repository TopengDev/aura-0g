"use client";

// The wallet-signed ARENA VOTE flow (blind, staked commit-reveal), driven off the backend's computed args
// (non-custodial). The server builds the blind commitment + returns the client-secret salt (it never stores
// it, so the ballot stays blind); this hook submits commit / reveal / finalize / claim with the wallet. Same
// write discipline as useSummon (writeContract + manual pollReceipt, never waitForTransactionReceipt).
//
// GRACEFUL-OFF: a 501 from vote/prepare (ArenaVote not configured) puts the hook in the "gated" phase so the
// UI shows the honest "activates at the mainnet deploy" state, never a fake vote.

import { useCallback, useState } from "react";
import { writeContract } from "wagmi/actions";
import { parseEther } from "viem";
import { useAccount, useConfig } from "wagmi";
import { APP_CHAIN } from "@/lib/chains";
import { arenaVoteAbi, GAME_CONTRACTS } from "@/lib/game-contracts";
import { humanError, pollReceipt, useEnsureChain } from "@/lib/tx";
import { prepareVote, type VotePrep } from "@/lib/game";

const ARENA_ERRORS: Array<[RegExp, string]> = [
  [/commit window|closed|ended/i, "The voting window has closed."],
  [/already committed/i, "You have already committed a vote for this battle."],
  [/no commitment|not committed/i, "No committed ballot found to reveal."],
  [/bad reveal|commitment/i, "The reveal does not match your commitment (wrong salt or choice)."],
  [/not finalized|reveal window/i, "The reveal window is not over yet."],
  [/insufficient funds/i, "Insufficient 0G balance for the stake + gas."],
  [/self-match|same owner/i, "Self-matches are rejected on-chain."],
];

export type ArenaPhase = "idle" | "preparing" | "gated" | "signing" | "confirming" | "success" | "error";
export type ArenaAction = "commit" | "reveal" | "finalize" | "claim";

export interface ArenaState {
  phase: ArenaPhase;
  action: ArenaAction | null;
  txHash: `0x${string}` | null;
  error: string | null;
  step: string | null;
  gatedError: string | null;
}

const IDLE: ArenaState = { phase: "idle", action: null, txHash: null, error: null, step: null, gatedError: null };

export function useArenaVote() {
  const config = useConfig();
  const { address } = useAccount();
  const ensureChain = useEnsureChain();
  const [state, setState] = useState<ArenaState>(IDLE);
  const reset = useCallback(() => setState(IDLE), []);

  // ── COMMIT: build the blind commitment (server) + stake it (wallet). Returns the prep incl. the salt the
  //    voter MUST keep to reveal. ──
  const commitVote = useCallback(
    async (token: string, battleId: number, choice: 1 | 2, stakeEther: string): Promise<VotePrep | null> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        const value = parseEther(stakeEther);
        if (value <= 0n) throw new Error("Enter a stake greater than 0.");
        setState({ ...IDLE, action: "commit", phase: "preparing", step: "Building your blind commitment" });
        const r = await prepareVote(token, battleId, choice);
        if (r.state === "gated") {
          setState((s) => ({ ...s, phase: "gated", gatedError: r.error }));
          return null;
        }
        if (r.state !== "ok") throw new Error(r.error);
        const prep = r.data;
        await ensureChain();
        setState((s) => ({ ...s, phase: "signing", step: "Confirm the staked, blind ballot in your wallet" }));
        const hash = await writeContract(config, {
          address: prep.commitCall.contract as `0x${string}`,
          abi: arenaVoteAbi,
          functionName: "commit",
          args: [BigInt(prep.battleId), prep.commitment as `0x${string}`],
          value,
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Locking your stake on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("commit reverted on-chain.");
        setState((s) => ({ ...s, phase: "success", step: "Ballot committed (keep your salt)" }));
        return prep;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, ARENA_ERRORS) }));
        return null;
      }
    },
    [address, config, ensureChain],
  );

  // ── REVEAL: open the committed ballot (choice + salt). ──
  const revealVote = useCallback(
    async (prep: VotePrep): Promise<boolean> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        setState({ ...IDLE, action: "reveal", phase: "signing", step: "Confirm the reveal in your wallet" });
        const hash = await writeContract(config, {
          address: prep.revealCall.contract as `0x${string}`,
          abi: arenaVoteAbi,
          functionName: "reveal",
          args: [BigInt(prep.battleId), prep.choice, prep.salt as `0x${string}`],
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Revealing your vote on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("reveal reverted on-chain.");
        setState((s) => ({ ...s, phase: "success", step: "Vote revealed" }));
        return true;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, ARENA_ERRORS) }));
        return false;
      }
    },
    [address, config, ensureChain],
  );

  // ── FINALIZE / CLAIM: settle the battle, then pull your share. ──
  const runWrite = useCallback(
    async (action: "finalize" | "claim", battleId: number): Promise<boolean> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        const contract = GAME_CONTRACTS.arenaVote;
        if (!contract) throw new Error("The arena is not wired on this deploy.");
        await ensureChain();
        setState({ ...IDLE, action, phase: "signing", step: action === "finalize" ? "Confirm finalize in your wallet" : "Confirm the claim in your wallet" });
        const hash = await writeContract(config, {
          address: contract,
          abi: arenaVoteAbi,
          functionName: action,
          args: [BigInt(battleId)],
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: action === "finalize" ? "Finalizing the battle on-chain" : "Claiming your share" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error(`${action} reverted on-chain.`);
        setState((s) => ({ ...s, phase: "success", step: action === "finalize" ? "Battle finalized" : "Share claimed" }));
        return true;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, ARENA_ERRORS) }));
        return false;
      }
    },
    [address, config, ensureChain],
  );

  const finalize = useCallback((battleId: number) => runWrite("finalize", battleId), [runWrite]);
  const claim = useCallback((battleId: number) => runWrite("claim", battleId), [runWrite]);

  const busy = state.phase === "preparing" || state.phase === "signing" || state.phase === "confirming";
  return { state, busy, commitVote, revealVote, finalize, claim, reset };
}
