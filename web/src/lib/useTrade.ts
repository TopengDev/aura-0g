"use client";

// The wallet-signed trade flows for AURA's product pages. All writes are user-signed via wagmi/viem
// on chain 16602 (APP_CHAIN). The backend only supplies READ data; the CLIENT builds and sends every
// transaction here. Flows:
//   buy(kind, tokenId, priceEther)         -> marketplace.buy(collection, tokenId) { value: price }
//   list(kind, tokenId, priceEther)        -> [setApprovalForAll(collection, marketplace) if needed]
//                                              then marketplace.list(collection, tokenId, price)
//   cancel(kind, tokenId)                  -> marketplace.cancelListing(collection, tokenId)
//   updatePrice(kind, tokenId, priceEther) -> marketplace.updatePrice(collection, tokenId, newPrice)
//
// Phase-1 viem gotcha (load-bearing): NEVER use waitForTransactionReceipt. It hangs on this RPC.
// We poll getTransactionReceipt manually until it lands (or a timeout), then assert receipt.status.

import { useCallback, useMemo, useState } from "react";
import { readContract, writeContract } from "wagmi/actions";
import { parseEther } from "viem";
import { useAccount, useConfig } from "wagmi";
import { APP_CHAIN } from "@/lib/chains";
import { CONTRACTS, collectionAddress, erc721Abi, marketplaceAbi } from "@/lib/contracts";
import { useAuth } from "@/components/web3/AuthProvider";
import { humanError, pollReceipt, useEnsureChain } from "@/lib/tx";

export type TradeKind = "agent" | "output";
export type TradeAction = "buy" | "list" | "cancel" | "updatePrice";
export type TradePhase =
  | "idle"
  | "signin" // optional SIWE sign-in
  | "approving" // setApprovalForAll (list only, if not already an operator)
  | "pending" // wallet prompt open / tx submitted, awaiting hash
  | "confirming" // hash received, polling for the receipt
  | "success"
  | "error";

export interface TradeState {
  phase: TradePhase;
  action: TradeAction | null;
  txHash: `0x${string}` | null;
  approvalTxHash: `0x${string}` | null;
  error: string | null;
  /** A human label of the current step, surfaced in the panel. */
  step: string | null;
}

const IDLE: TradeState = {
  phase: "idle",
  action: null,
  txHash: null,
  approvalTxHash: null,
  error: null,
  step: null,
};

export function useTrade() {
  const config = useConfig();
  const { address } = useAccount();
  const auth = useAuth();
  const ensureChain = useEnsureChain();
  const [state, setState] = useState<TradeState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  // Best-effort SIWE. The brief gates writes behind SIWE; we sign in if we have no token yet. A SIWE
  // failure is surfaced but does not silently swallow the user's intent (they can retry).
  const ensureSignedIn = useCallback(async () => {
    if (auth.token) return;
    setState((s) => ({ ...s, phase: "signin", step: "Sign in to AURA (SIWE)" }));
    await auth.signIn();
  }, [auth]);

  // Shared write + confirm. Submits a write, captures the hash, polls the receipt, asserts success.
  const submit = useCallback(
    async (
      action: TradeAction,
      write: () => Promise<`0x${string}`>,
      confirmStep: string,
    ) => {
      const hash = await write();
      setState((s) => ({ ...s, action, txHash: hash, phase: "confirming", step: confirmStep }));
      const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
      if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
      return hash;
    },
    [config],
  );

  // ── BUY ──────────────────────────────────────────────────────────────────
  // marketplace.buy(collection, tokenId) with value = listed price (ether string -> wei).
  const buy = useCallback(
    async (kind: TradeKind, tokenId: number, priceEther: string) => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        await ensureSignedIn();
        setState((s) => ({ ...s, action: "buy", phase: "pending", error: null, step: "Confirm purchase in your wallet" }));
        await submit(
          "buy",
          () =>
            writeContract(config, {
              address: CONTRACTS.marketplace,
              abi: marketplaceAbi,
              functionName: "buy",
              args: [collectionAddress(kind), BigInt(tokenId)],
              value: parseEther(priceEther),
              chainId: APP_CHAIN.id,
            }),
          "Settling the sale on-chain",
        );
        setState((s) => ({ ...s, phase: "success", step: "Purchase complete" }));
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e) }));
      }
    },
    [address, config, ensureChain, ensureSignedIn, submit],
  );

  // ── LIST (with the operator-approval pre-step) ─────────────────────────────
  // The marketplace must be an approved operator for the seller's collection before it can escrow the
  // token. We read isApprovedForAll(owner, marketplace); if false we send setApprovalForAll first,
  // confirm it, THEN list(collection, tokenId, price).
  const list = useCallback(
    async (kind: TradeKind, tokenId: number, priceEther: string) => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        await ensureSignedIn();
        const collection = collectionAddress(kind);

        const approved = await readContract(config, {
          address: collection,
          abi: erc721Abi,
          functionName: "isApprovedForAll",
          args: [address, CONTRACTS.marketplace],
          chainId: APP_CHAIN.id,
        });

        if (!approved) {
          setState((s) => ({ ...s, action: "list", phase: "approving", error: null, step: "Approve the marketplace (one-time)" }));
          const approvalHash = await writeContract(config, {
            address: collection,
            abi: erc721Abi,
            functionName: "setApprovalForAll",
            args: [CONTRACTS.marketplace, true],
            chainId: APP_CHAIN.id,
          });
          setState((s) => ({ ...s, approvalTxHash: approvalHash, phase: "confirming", step: "Confirming approval" }));
          const ar = await pollReceipt(config, approvalHash, APP_CHAIN.id);
          if (ar.status !== "success") throw new Error("Approval reverted on-chain.");
        }

        setState((s) => ({ ...s, action: "list", phase: "pending", step: "Confirm the listing in your wallet" }));
        await submit(
          "list",
          () =>
            writeContract(config, {
              address: CONTRACTS.marketplace,
              abi: marketplaceAbi,
              functionName: "list",
              args: [collection, BigInt(tokenId), parseEther(priceEther)],
              chainId: APP_CHAIN.id,
            }),
          "Posting the listing on-chain",
        );
        setState((s) => ({ ...s, phase: "success", step: "Listed" }));
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e) }));
      }
    },
    [address, config, ensureChain, ensureSignedIn, submit],
  );

  // ── CANCEL ─────────────────────────────────────────────────────────────────
  const cancel = useCallback(
    async (kind: TradeKind, tokenId: number) => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        await ensureSignedIn();
        setState((s) => ({ ...s, action: "cancel", phase: "pending", error: null, step: "Confirm cancellation in your wallet" }));
        await submit(
          "cancel",
          () =>
            writeContract(config, {
              address: CONTRACTS.marketplace,
              abi: marketplaceAbi,
              functionName: "cancelListing",
              args: [collectionAddress(kind), BigInt(tokenId)],
              chainId: APP_CHAIN.id,
            }),
          "Removing the listing on-chain",
        );
        setState((s) => ({ ...s, phase: "success", step: "Listing cancelled" }));
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e) }));
      }
    },
    [address, config, ensureChain, ensureSignedIn, submit],
  );

  // ── UPDATE PRICE ─────────────────────────────────────────────────────────
  const updatePrice = useCallback(
    async (kind: TradeKind, tokenId: number, priceEther: string) => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        await ensureSignedIn();
        setState((s) => ({ ...s, action: "updatePrice", phase: "pending", error: null, step: "Confirm the new price in your wallet" }));
        await submit(
          "updatePrice",
          () =>
            writeContract(config, {
              address: CONTRACTS.marketplace,
              abi: marketplaceAbi,
              functionName: "updatePrice",
              args: [collectionAddress(kind), BigInt(tokenId), parseEther(priceEther)],
              chainId: APP_CHAIN.id,
            }),
          "Updating the price on-chain",
        );
        setState((s) => ({ ...s, phase: "success", step: "Price updated" }));
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e) }));
      }
    },
    [address, config, ensureChain, ensureSignedIn, submit],
  );

  const busy = useMemo(
    () => ["signin", "approving", "pending", "confirming"].includes(state.phase),
    [state.phase],
  );

  return { state, busy, buy, list, cancel, updatePrice, reset };
}
