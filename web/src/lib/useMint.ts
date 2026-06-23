"use client";

// The wallet-signed MINT flows for AURA's action pages. Same discipline as useTrade.ts: every write is
// user-signed via wagmi/viem on chain 16602, the CLIENT builds + sends the tx, and we poll
// getTransactionReceipt manually (NEVER waitForTransactionReceipt - it hangs on the 0G RPC). Two writes:
//   mintOutput(args)  -> OutputNFT.mintOutput(...) using the backend's attestation args; parses the new
//                        tokenId out of the OutputMinted event.
//   mintAgent(args)   -> AgentRegistry.mintAgent(...); parses the new agentId out of AgentMinted.
// The backend supplies the args (and, for output, the attestor signature); the wallet only signs.

import { useCallback, useState } from "react";
import { getTransactionReceipt, writeContract } from "wagmi/actions";
import { decodeEventLog } from "viem";
import { type Config, useAccount, useChainId, useConfig, useSwitchChain } from "wagmi";
import { APP_CHAIN } from "@/lib/chains";
import {
  CONTRACTS,
  agentRegistryAbi,
  outputMintedEvent,
  outputNftAbi,
} from "@/lib/contracts";
import { useAuth } from "@/components/web3/AuthProvider";
import type { CreateAgentArgs, MintArgs } from "@/lib/api";

export type MintPhase =
  | "idle"
  | "pending" // wallet prompt open / tx submitted, awaiting hash
  | "confirming" // hash received, polling for the receipt
  | "success"
  | "error";

export interface MintState {
  phase: MintPhase;
  txHash: `0x${string}` | null;
  error: string | null;
  step: string | null;
  /** The minted token/agent id, parsed from the receipt event on success. */
  mintedId: number | null;
}

const IDLE: MintState = { phase: "idle", txHash: null, error: null, step: null, mintedId: null };

// Manual receipt poll - identical contract to useTrade.pollReceipt (NEVER waitForTransactionReceipt).
async function pollReceipt(
  config: Config,
  hash: `0x${string}`,
  chainId: number,
  { intervalMs = 2500, timeoutMs = 180_000 }: { intervalMs?: number; timeoutMs?: number } = {},
) {
  const deadline = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() < deadline) {
    try {
      const receipt = await getTransactionReceipt(config, { hash, chainId });
      if (receipt) return receipt;
    } catch {
      // not mined yet -> keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timed out waiting for the transaction to confirm. Check the explorer.");
}

function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/User rejected|User denied|rejected the request/i.test(msg)) return "Transaction rejected.";
  if (/insufficient funds/i.test(msg)) return "Insufficient 0G balance for the gas fee.";
  if (/nonce used/i.test(msg)) return "This attestation was already minted. Generate a fresh piece to mint again.";
  if (/bad attestation/i.test(msg)) return "The attestation signature was rejected on-chain. Try regenerating.";
  if (/royalty too high|resale royalty too high/i.test(msg)) return "Royalty exceeds the 20% on-chain cap.";
  if (/reverted/i.test(msg)) return "The transaction reverted on-chain.";
  return msg.split("\n")[0].slice(0, 180);
}

export function useMint() {
  const config = useConfig();
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const auth = useAuth();
  const [state, setState] = useState<MintState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  const ensureChain = useCallback(async () => {
    if (chainId !== APP_CHAIN.id) await switchChainAsync({ chainId: APP_CHAIN.id });
  }, [chainId, switchChainAsync]);

  // ── MINT OUTPUT (the /generate write) ──────────────────────────────────────
  // Submits OutputNFT.mintOutput with the backend's exact args + attestor signature. seed arrives as a
  // decimal string and nonce as bytes32 hex (both -> the contract's uint256/bytes32). Returns tokenId.
  const mintOutput = useCallback(
    async (args: MintArgs): Promise<number | null> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        setState({ ...IDLE, phase: "pending", step: "Confirm the mint in your wallet" });
        const hash = await writeContract(config, {
          address: CONTRACTS.outputNFT,
          abi: outputNftAbi,
          functionName: "mintOutput",
          args: [
            args.to as `0x${string}`,
            BigInt(args.creatorAgentId),
            args.imageRoot,
            args.provenanceHash as `0x${string}`,
            args.teeAttestation as `0x${string}`,
            BigInt(args.seed),
            args.nonce as `0x${string}`,
            args.attestationSig as `0x${string}`,
          ],
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Minting on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("The mint reverted on-chain.");

        // parse the new tokenId from the OutputMinted event.
        let mintedId: number | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = decodeEventLog({ abi: [outputMintedEvent], data: log.data, topics: log.topics });
            if (parsed.eventName === "OutputMinted") {
              mintedId = Number((parsed.args as { tokenId: bigint }).tokenId);
              break;
            }
          } catch {
            // not our event
          }
        }
        setState((s) => ({ ...s, phase: "success", step: "Minted", mintedId }));
        return mintedId;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e) }));
        return null;
      }
    },
    [address, config, ensureChain],
  );

  // ── MINT AGENT (the /create write) ─────────────────────────────────────────
  // Submits AgentRegistry.mintAgent with the backend's computed args. Returns the new agentId (parsed
  // from AgentMinted). The page then calls confirmAgentMint(encBrainRoot, agentId) to promote the brain.
  const mintAgent = useCallback(
    async (args: CreateAgentArgs): Promise<number | null> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        setState({ ...IDLE, phase: "pending", step: "Confirm the agent mint in your wallet" });
        const hash = await writeContract(config, {
          address: CONTRACTS.agentRegistry,
          abi: agentRegistryAbi,
          functionName: "mintAgent",
          args: [
            args.to as `0x${string}`,
            args.name,
            args.styleFingerprint as `0x${string}`,
            args.encBrainRoot,
            args.modelAttestation as `0x${string}`,
            args.royaltyBps,
            args.creatorResaleBps,
          ],
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Registering the agent on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("The agent mint reverted on-chain.");

        let mintedId: number | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = decodeEventLog({ abi: agentRegistryAbi, data: log.data, topics: log.topics });
            if (parsed.eventName === "AgentMinted") {
              mintedId = Number((parsed.args as { agentId: bigint }).agentId);
              break;
            }
          } catch {
            // not our event
          }
        }
        setState((s) => ({ ...s, phase: "success", step: "Agent registered", mintedId }));
        return mintedId;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e) }));
        return null;
      }
    },
    [address, config, ensureChain],
  );

  const busy = state.phase === "pending" || state.phase === "confirming";
  // SIWE token getter for the authed backend calls the pages make alongside the writes.
  return { state, busy, mintOutput, mintAgent, reset, ensureChain, auth };
}
