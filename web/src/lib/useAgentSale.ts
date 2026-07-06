"use client";

// The PAID OPEN-MARKET AGENT SALE client flow (Flow B: server-custodian escrow). Repoints the agent Buy CTA
// off the on-chain AuraMarketplace (whose buy() reverts for AuraINFT agents) onto the backend sale routes.
//
//   buyAgent(agentId)               -> SIWE -> commit (reserve escrow + get custodian) -> wallet PAYS the
//                                      custodian -> poll settle (server transfers the agent + re-keys the
//                                      brain + resets memory + splits the ETH) -> success.
//   listAgent(agentId, priceEther)  -> SIWE -> [approve the custodian as operator if needed] -> record listing.
//
// The buyer signs exactly ONE thing on-chain (the payment to the custodian); the server performs the
// proof-gated AuraINFT.transfer + the royalty/fee/seller split. This is a TRUSTED-custodian MVP, disclosed
// honestly in the UI; the trustless on-chain escrow (Flow A) is the post-vote upgrade.
//
// Phase-1 viem gotcha (load-bearing, inherited from useTrade): NEVER use waitForTransactionReceipt - it
// hangs on the 0G RPC. We poll getTransactionReceipt manually (pollReceipt) then assert status.

import { useCallback, useMemo, useState } from "react";
import { readContract, sendTransaction, writeContract } from "wagmi/actions";
import { useAccount, useConfig } from "wagmi";
import { APP_CHAIN } from "@/lib/chains";
import { CONTRACTS, erc721Abi } from "@/lib/contracts";
import { useAuth } from "@/components/web3/AuthProvider";
import { humanError, pollReceipt, useEnsureChain } from "@/lib/tx";
import { fetchAgentSales, saleCommit, saleList, saleSettle, type SaleSettleResult } from "@/lib/api";

export type SalePhase =
  | "idle"
  | "signin" // SIWE sign-in (also registers the buyer pubkey the brain is re-sealed to)
  | "committing" // reserve the escrow + fetch the custodian to pay
  | "paying" // wallet prompt: send the price to the custodian
  | "confirmingPayment" // poll the payment receipt
  | "settling" // server transfers the agent + splits the ETH
  | "approving" // (list) setApprovalForAll(custodian) one-time
  | "listing" // (list) record the priced listing
  | "success"
  | "error";

export interface AgentSaleState {
  phase: SalePhase;
  action: "buy" | "list" | null;
  paymentTx: `0x${string}` | null;
  approvalTxHash: `0x${string}` | null;
  result: SaleSettleResult | null;
  error: string | null;
  step: string | null;
}

const IDLE: AgentSaleState = {
  phase: "idle",
  action: null,
  paymentTx: null,
  approvalTxHash: null,
  result: null,
  error: null,
  step: null,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useAgentSale() {
  const config = useConfig();
  const { address } = useAccount();
  const auth = useAuth();
  const ensureChain = useEnsureChain();
  const [state, setState] = useState<AgentSaleState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  // SIWE returns the fresh JWT (React state updates async, so we use the returned token immediately).
  const ensureSignedIn = useCallback(async (): Promise<string> => {
    if (auth.token) return auth.token;
    setState((s) => ({ ...s, phase: "signin", step: "Sign in to AURA (SIWE)" }));
    return auth.signIn();
  }, [auth]);

  // ── BUY: commit -> pay the custodian -> settle ─────────────────────────────
  const buyAgent = useCallback(
    async (agentId: number) => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        const token = await ensureSignedIn();

        // 1. commit: reserve the escrow, learn the custodian + the exact amount to pay.
        setState((s) => ({ ...s, action: "buy", phase: "committing", error: null, step: "Reserving your purchase" }));
        const commit = await saleCommit(token, agentId);

        // 2. pay the custodian the exact escrowed amount (the buyer's single on-chain signature).
        setState((s) => ({ ...s, phase: "paying", step: `Pay ${commit.amountEther} 0G to the sale custodian` }));
        const paymentTx = await sendTransaction(config, {
          to: commit.custodian as `0x${string}`,
          value: BigInt(commit.amountWei),
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, paymentTx, phase: "confirmingPayment", step: "Confirming your payment" }));
        const pr = await pollReceipt(config, paymentTx, APP_CHAIN.id);
        if (pr.status !== "success") throw new Error("The payment transaction reverted on-chain.");

        // 3. settle: the server verifies the payment, transfers the agent (re-keys the brain + resets memory),
        //    and splits the ETH. Retry a few times so a just-mined payment is seen by the node the API reads.
        setState((s) => ({ ...s, phase: "settling", step: "Transferring the Aura, re-keying its brain, splitting the payment" }));
        let result: SaleSettleResult | null = null;
        let lastErr: unknown = null;
        for (let i = 0; i < 4; i++) {
          try {
            result = await saleSettle(token, agentId, commit.escrowId, paymentTx);
            break;
          } catch (e) {
            lastErr = e;
            const msg = e instanceof Error ? e.message : String(e);
            if (/not found|not yet mined|in progress/i.test(msg) && i < 3) {
              await sleep(3000);
              continue;
            }
            throw e;
          }
        }
        if (!result) throw lastErr instanceof Error ? lastErr : new Error("settle failed");

        setState((s) => ({ ...s, phase: "success", result, step: "Brain re-keyed, memory resealed, royalty split" }));
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e) }));
      }
    },
    [address, config, ensureChain, ensureSignedIn],
  );

  // ── LIST: approve the custodian (one-time) -> record the priced listing ─────
  const listAgent = useCallback(
    async (agentId: number, priceEther: string) => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        const token = await ensureSignedIn();

        // the custodian (== platform) that will submit the transfer at settle. Read it from the sale surface.
        const market = await fetchAgentSales();
        const custodian = (market?.custodian ?? "") as `0x${string}`;
        if (!custodian) throw new Error("Sale custodian unavailable - try again in a moment.");

        // the platform must be an approved operator to move the agent at settle (like approving a marketplace).
        if (CONTRACTS.auraINFT) {
          const approved = await readContract(config, {
            address: CONTRACTS.auraINFT as `0x${string}`,
            abi: erc721Abi,
            functionName: "isApprovedForAll",
            args: [address, custodian],
            chainId: APP_CHAIN.id,
          });
          if (!approved) {
            setState((s) => ({ ...s, action: "list", phase: "approving", error: null, step: "Approve the sale custodian (one-time)" }));
            const approvalHash = await writeContract(config, {
              address: CONTRACTS.auraINFT as `0x${string}`,
              abi: erc721Abi,
              functionName: "setApprovalForAll",
              args: [custodian, true],
              chainId: APP_CHAIN.id,
            });
            setState((s) => ({ ...s, approvalTxHash: approvalHash, step: "Confirming approval" }));
            const ar = await pollReceipt(config, approvalHash, APP_CHAIN.id);
            if (ar.status !== "success") throw new Error("Approval reverted on-chain.");
          }
        }

        setState((s) => ({ ...s, action: "list", phase: "listing", step: "Listing your Aura for sale" }));
        await saleList(token, agentId, priceEther);
        setState((s) => ({ ...s, phase: "success", step: "Listed for sale" }));
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e) }));
      }
    },
    [address, config, ensureChain, ensureSignedIn],
  );

  const busy = useMemo(
    () => ["signin", "committing", "paying", "confirmingPayment", "settling", "approving", "listing"].includes(state.phase),
    [state.phase],
  );

  return { state, busy, buyAgent, listAgent, reset };
}
