"use client";

// Shared wallet-write plumbing for the AURA tx hooks (useMint / useTrade / useSummon). These three had
// byte-for-byte copies of the receipt poll, the error humanizer, and the chain-guard, and had already
// drifted (the poll timeout differed between them). This is the ONE canonical copy.

import { useCallback } from "react";
import { getTransactionReceipt } from "wagmi/actions";
import { type Config, useChainId, useSwitchChain } from "wagmi";
import { APP_CHAIN } from "@/lib/chains";

// LOAD-BEARING (Phase-1 viem gotcha): NEVER use waitForTransactionReceipt — it hangs on the 0G RPC. We
// poll getTransactionReceipt manually until the tx is mined (or we time out), then the CALLER asserts
// receipt.status ("success" | "reverted"). This is the single shared implementation; do not re-inline it.
export async function pollReceipt(
  config: Config,
  hash: `0x${string}`,
  chainId: number,
  { intervalMs = 2500, timeoutMs = 120_000 }: { intervalMs?: number; timeoutMs?: number } = {},
) {
  const deadline = Date.now() + timeoutMs;
  // small initial delay so the tx has a chance to propagate before the first lookup
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() < deadline) {
    try {
      const receipt = await getTransactionReceipt(config, { hash, chainId });
      if (receipt) return receipt;
    } catch {
      // not mined yet (viem throws TransactionReceiptNotFoundError) -> keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timed out waiting for the transaction to confirm. Check the explorer.");
}

// Turn a thrown wallet/RPC error into a short, human message. Common cases are handled here; callers pass
// domain-specific matchers via `extra` (checked before the generic fallbacks) so mint/summon can keep
// their tailored copy (nonce used, agent not summonable, ...).
export function humanError(e: unknown, extra: Array<[RegExp, string]> = []): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|User denied|rejected the request/i.test(msg)) return "Transaction rejected.";
  for (const [re, out] of extra) if (re.test(msg)) return out;
  if (/insufficient funds/i.test(msg)) return "Insufficient 0G balance for this transaction.";
  if (/reverted/i.test(msg)) return "The transaction reverted on-chain.";
  // keep it short: first line only
  return msg.split("\n")[0].slice(0, 180);
}

// Ensure the wallet is on APP_CHAIN before any write; prompt a switch if not. Hook form because it needs
// the wagmi chain state.
export function useEnsureChain() {
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  return useCallback(async () => {
    if (chainId !== APP_CHAIN.id) await switchChainAsync({ chainId: APP_CHAIN.id });
  }, [chainId, switchChainAsync]);
}
