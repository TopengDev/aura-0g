"use client";

// The wallet-signed SUMMON flows. Same discipline as useTrade/useMint: every write is user-signed via
// wagmi/viem on APP_CHAIN, the CLIENT builds + sends the tx, and we poll getTransactionReceipt manually
// (NEVER waitForTransactionReceipt - it hangs on the 0G RPC). Writes:
//   summon(agentId, priceEther)          -> SummonEscrow.summon(agentId, maxPrice) { value }; parses the
//                                            new requestId out of the Summoned event (drives the status poll)
//   setSummonPrice(agentId, priceEther)  -> owner sets/updates the commission price (0 disables)
//   withdraw()                            -> owner pulls accrued summon earnings (+ any refund/overpay)
// The agent owner earns the summon-fee split on fulfill; the watcher (server) does the gen + fulfill.

import { useCallback, useState } from "react";
import { writeContract } from "wagmi/actions";
import { decodeEventLog, parseEther } from "viem";
import { useAccount, useConfig } from "wagmi";
import { APP_CHAIN } from "@/lib/chains";
import { CONTRACTS, summonEscrowAbi, summonedEvent } from "@/lib/contracts";
import { humanError, pollReceipt, useEnsureChain } from "@/lib/tx";

// Summon-specific revert messages layered on the shared humanError fallbacks.
const SUMMON_ERRORS: Array<[RegExp, string]> = [
  [/insufficient funds/i, "Insufficient 0G balance for the summon fee + gas."],
  [/agent not summonable/i, "This agent is not currently accepting summons."],
  [/price exceeds max/i, "The price changed - refresh and try again."],
  [/insufficient payment/i, "The amount sent is below the commission price."],
  [/not agent owner/i, "Only the agent's owner can set its summon price."],
  [/nothing to withdraw/i, "No summon earnings to withdraw yet."],
];

export type SummonPhase = "idle" | "pending" | "confirming" | "success" | "error";
export type SummonAction = "summon" | "setPrice" | "withdraw" | "refund";

export interface SummonState {
  phase: SummonPhase;
  action: SummonAction | null;
  txHash: `0x${string}` | null;
  error: string | null;
  step: string | null;
  /** The new requestId, parsed from the Summoned event on a successful summon(). */
  requestId: number | null;
}

const IDLE: SummonState = { phase: "idle", action: null, txHash: null, error: null, step: null, requestId: null };

export function useSummon() {
  const config = useConfig();
  const { address } = useAccount();
  const ensureChain = useEnsureChain();
  const [state, setState] = useState<SummonState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  const escrow = CONTRACTS.summonEscrow;

  // ── SUMMON (pay to commission; the agent generates LIVE, then mints to the buyer) ──
  const summon = useCallback(
    async (agentId: number, priceEther: string): Promise<number | null> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        if (!escrow) throw new Error("Summon is not available on this deployment.");
        await ensureChain();
        const value = parseEther(priceEther);
        setState({ ...IDLE, action: "summon", phase: "pending", step: "Confirm the summon payment in your wallet" });
        const hash = await writeContract(config, {
          address: escrow,
          abi: summonEscrowAbi,
          functionName: "summon",
          // maxPrice == the displayed price: pay exactly this, revert if the owner front-ran it higher.
          args: [BigInt(agentId), value],
          value,
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Escrowing your payment on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("The summon reverted on-chain.");

        let requestId: number | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = decodeEventLog({ abi: [summonedEvent], data: log.data, topics: log.topics });
            if (parsed.eventName === "Summoned") {
              requestId = Number((parsed.args as { requestId: bigint }).requestId);
              break;
            }
          } catch {
            // not our event
          }
        }
        setState((s) => ({ ...s, phase: "success", step: "Payment escrowed", requestId }));
        return requestId;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, SUMMON_ERRORS) }));
        return null;
      }
    },
    [address, config, ensureChain, escrow],
  );

  // ── SET SUMMON PRICE (owner) ──
  const setSummonPrice = useCallback(
    async (agentId: number, priceEther: string): Promise<boolean> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        if (!escrow) throw new Error("Summon is not available on this deployment.");
        await ensureChain();
        setState({ ...IDLE, action: "setPrice", phase: "pending", step: "Confirm the price in your wallet" });
        const hash = await writeContract(config, {
          address: escrow,
          abi: summonEscrowAbi,
          functionName: "setSummonPrice",
          args: [BigInt(agentId), parseEther(priceEther)],
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Setting the price on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("The price update reverted on-chain.");
        setState((s) => ({ ...s, phase: "success", step: "Summon price set" }));
        return true;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, SUMMON_ERRORS) }));
        return false;
      }
    },
    [address, config, ensureChain, escrow],
  );

  // ── WITHDRAW (owner pulls accrued summon earnings) ──
  const withdraw = useCallback(async (): Promise<boolean> => {
    try {
      if (!address) throw new Error("Connect a wallet first.");
      if (!escrow) throw new Error("Summon is not available on this deployment.");
      await ensureChain();
      setState({ ...IDLE, action: "withdraw", phase: "pending", step: "Confirm the withdrawal in your wallet" });
      const hash = await writeContract(config, {
        address: escrow,
        abi: summonEscrowAbi,
        functionName: "withdraw",
        args: [],
        chainId: APP_CHAIN.id,
      });
      setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Withdrawing your earnings" }));
      const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
      if (receipt.status !== "success") throw new Error("The withdrawal reverted on-chain.");
      setState((s) => ({ ...s, phase: "success", step: "Earnings withdrawn" }));
      return true;
    } catch (e) {
      setState((s) => ({ ...s, phase: "error", error: humanError(e, SUMMON_ERRORS) }));
      return false;
    }
  }, [address, config, ensureChain, escrow]);

  // ── REFUND (buyer reclaims the fee if the runner never delivered by the deadline; the anti-rug path) ──
  const refund = useCallback(
    async (requestId: number): Promise<boolean> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        if (!escrow) throw new Error("Summon is not available on this deployment.");
        await ensureChain();
        setState({ ...IDLE, action: "refund", phase: "pending", step: "Confirm the refund in your wallet" });
        const hash = await writeContract(config, {
          address: escrow,
          abi: summonEscrowAbi,
          functionName: "refund",
          args: [BigInt(requestId)],
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Refunding your payment" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("The refund reverted on-chain.");
        setState((s) => ({ ...s, phase: "success", step: "Refunded - withdraw from your balance" }));
        return true;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, SUMMON_ERRORS) }));
        return false;
      }
    },
    [address, config, ensureChain, escrow],
  );

  const busy = state.phase === "pending" || state.phase === "confirming";
  return { state, busy, summon, setSummonPrice, withdraw, refund, reset };
}
