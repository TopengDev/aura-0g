"use client";

// The wallet-signed MINT flows for AURA's action pages. Same discipline as useTrade.ts: every write is
// user-signed via wagmi/viem on chain 16602, the CLIENT builds + sends the tx, and we poll
// getTransactionReceipt manually (NEVER waitForTransactionReceipt - it hangs on the 0G RPC). Two writes:
//   mintOutput(args)  -> OutputNFT.mintOutput(...) using the backend's attestation args; parses the new
//                        tokenId out of the OutputMinted event.
//   mintAgent(args)   -> AgentRegistry.mintAgent(...); parses the new agentId out of AgentMinted.
// The backend supplies the args (and, for output, the attestor signature); the wallet only signs.

import { useCallback, useState } from "react";
import { writeContract } from "wagmi/actions";
import { decodeEventLog } from "viem";
import { useAccount, useConfig } from "wagmi";
import { APP_CHAIN } from "@/lib/chains";
import {
  CONTRACTS,
  agentRegistryAbi,
  outputMintedEvent,
  outputNftAbi,
} from "@/lib/contracts";
import { useAuth } from "@/components/web3/AuthProvider";
import type { CreateAgentArgs, MintArgs } from "@/lib/api";
import { humanError, pollReceipt, useEnsureChain } from "@/lib/tx";

// Mint-specific revert messages layered on the shared humanError fallbacks.
const MINT_ERRORS: Array<[RegExp, string]> = [
  [/insufficient funds/i, "Insufficient 0G balance for the gas fee."],
  [/nonce used/i, "This attestation was already minted. Generate a fresh piece to mint again."],
  [/bad attestation/i, "The attestation signature was rejected on-chain. Try regenerating."],
  [/bad TEE attestation|tee text mismatch|bad envelope/i, "On-chain 0G TEE verification failed. Regenerate to mint."],
  [/royalty too high|resale royalty too high/i, "Royalty exceeds the 20% on-chain cap."],
];

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

export function useMint() {
  const config = useConfig();
  const { address } = useAccount();
  const auth = useAuth();
  const ensureChain = useEnsureChain();
  const [state, setState] = useState<MintState>(IDLE);

  const reset = useCallback(() => setState(IDLE), []);

  // ── MINT OUTPUT (the /generate write) ──────────────────────────────────────
  // Submits OutputNFT.mintOutput with the backend's exact args + attestor signature. seed arrives as a
  // decimal string and nonce as bytes32 hex (both -> the contract's uint256/bytes32). Returns tokenId.
  const mintOutput = useCallback(
    async (args: MintArgs): Promise<number | null> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        await ensureChain();
        // On-chain-verified mint when the backend surfaced 0G's raw signed envelope (teeText + teeSig); the
        // contract ecrecovers 0G's enclave signature and reverts on forgery. Else the testnet mintOutput fallback.
        const teeVerified = Boolean(args.teeText && args.teeSig);
        setState({
          ...IDLE,
          phase: "pending",
          step: teeVerified ? "Confirm the on-chain TEE-verified mint in your wallet" : "Confirm the mint in your wallet",
        });
        const hash = teeVerified
          ? await writeContract(config, {
              address: CONTRACTS.outputNFT,
              abi: outputNftAbi,
              functionName: "mintOutputVerified",
              args: [
                args.to as `0x${string}`,
                BigInt(args.creatorAgentId),
                args.imageRoot,
                args.provenanceHash as `0x${string}`,
                args.teeAttestation as `0x${string}`,
                BigInt(args.seed),
                args.nonce as `0x${string}`,
                args.attestationSig as `0x${string}`,
                args.teeText as string,
                args.teeSig as `0x${string}`,
              ],
              chainId: APP_CHAIN.id,
            })
          : await writeContract(config, {
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
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id, { timeoutMs: 180_000 });
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
        setState((s) => ({ ...s, phase: "error", error: humanError(e, MINT_ERRORS) }));
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
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id, { timeoutMs: 180_000 });
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
        setState((s) => ({ ...s, phase: "error", error: humanError(e, MINT_ERRORS) }));
        return null;
      }
    },
    [address, config, ensureChain],
  );

  const busy = state.phase === "pending" || state.phase === "confirming";
  // SIWE token getter for the authed backend calls the pages make alongside the writes.
  return { state, busy, mintOutput, mintAgent, reset, ensureChain, auth };
}
