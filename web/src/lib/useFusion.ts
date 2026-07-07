"use client";

// The wallet-signed FUSION flow, driven entirely off the backend's computed call-args (non-custodial: the
// server signs nothing; it returns the exact requestFusion / executeFusion / registerGenesis arguments and
// this hook submits them with the user's wallet). Same write discipline as useSummon: writeContract via
// wagmi on APP_CHAIN, then poll getTransactionReceipt manually (NEVER waitForTransactionReceipt, which hangs
// on the 0G RPC), then the caller asserts receipt.status. The contract ADDRESS comes from the backend arg
// block (args.contract), so a mis-set NEXT_PUBLIC_* never diverges from what the server is wired to.
//
// GRACEFUL-OFF: when the backend returns 501 (AuraFusion not configured on this deploy) the fetch resolves
// to { state: "gated" } and this hook enters the "gated" phase, so the UI shows the honest "activates at the
// mainnet deploy" state instead of a wallet prompt. No fake result is ever produced.

import { useCallback, useState } from "react";
import { readContract, writeContract } from "wagmi/actions";
import { decodeEventLog } from "viem";
import { useAccount, useConfig } from "wagmi";
import { APP_CHAIN } from "@/lib/chains";
import { auraFusionAbi, fusionExecutedEvent, fusionRequestedEvent, GAME_CONTRACTS } from "@/lib/game-contracts";
import { humanError, pollReceipt, useEnsureChain } from "@/lib/tx";
import {
  fetchExecuteFusion,
  fetchFinalizeFusion,
  fetchGenesisArgs,
  fetchRequestFusionArgs,
  type FuseExecuteResult,
  type GameResult,
} from "@/lib/game";

const FUSION_ERRORS: Array<[RegExp, string]> = [
  [/not fusable|registerGenesis|genome/i, "A parent needs a one-time genesis registration before it can fuse."],
  [/do not own|owner/i, "You must own both parents to fuse them."],
  [/cooldown/i, "A parent is still on its fusion cooldown. Try again later."],
  [/self-fuse|itself/i, "A parent cannot fuse with itself."],
  [/insufficient funds/i, "Insufficient 0G balance for the fusion fee + gas."],
  [/sign in first/i, "Sign in first: the child iNFT seals its brain to your wallet key."],
];

export type FusePhase = "idle" | "preparing" | "gated" | "signing" | "confirming" | "success" | "error";
export type FuseAction = "genesis" | "request" | "execute";

export interface FuseState {
  phase: FusePhase;
  action: FuseAction | null;
  txHash: `0x${string}` | null;
  error: string | null;
  step: string | null;
  gatedError: string | null;
}

const IDLE: FuseState = { phase: "idle", action: null, txHash: null, error: null, step: null, gatedError: null };

/** Turn a discriminated GameResult into either the data or a set phase (gated/down) + null. */
function isGate<T>(r: GameResult<T>): r is Extract<GameResult<T>, { state: "gated" }> {
  return r.state === "gated";
}

export function useFusion() {
  const config = useConfig();
  const { address } = useAccount();
  const ensureChain = useEnsureChain();
  const [state, setState] = useState<FuseState>(IDLE);
  const reset = useCallback(() => setState(IDLE), []);

  // ── checkFusable (cheap public view: has this parent's genome been anchored yet?) ──
  // Proactive genesis-needed detection: AuraFusion.isFusable(agentId) is a keyless view that returns false for
  // every agent minted before AuraFusion deployed (its genome is still zero) and true once registerGenesis has
  // landed. The Fusion UI reads it per picked parent to surface the "Register genesis" backfill BEFORE the user
  // pays for requestFusion, instead of dead-ending on the on-chain "parent genome unset" revert. Returns null on
  // a read hiccup (or when Fusion is not wired) so the caller can fall back to the error-triggered path.
  const checkFusable = useCallback(
    async (agentId: number): Promise<boolean | null> => {
      if (!GAME_CONTRACTS.auraFusion) return null;
      try {
        const ok = await readContract(config, {
          address: GAME_CONTRACTS.auraFusion as `0x${string}`,
          abi: auraFusionAbi,
          functionName: "isFusable",
          args: [BigInt(agentId)],
          chainId: APP_CHAIN.id,
        });
        return Boolean(ok);
      } catch {
        return null;
      }
    },
    [config],
  );

  // ── checkCooldown (per-parent fusion cooldown gate) ──
  // requestFusion consumes a per-Aura cooldown: on-chain it reverts "A/B on cooldown" while
  // block.timestamp < lastFusedAt + cooldown() (lastFusedAt == 0 => the Aura was never used as a parent =>
  // fusable now). This reads each picked parent's lastFusedAt (lineageOf) + the global cooldown() and returns
  // the unix-seconds timestamp when the Aura is fusable AGAIN (readyAt): 0 => not on cooldown, any value > now
  // => on cooldown until then. The Fusion UI reads it per parent to DISABLE requestFusion with a live
  // countdown, so the user never fires a tx that reverts on cooldown. Returns null on a read hiccup (or when
  // Fusion is not wired) so the caller falls back to the existing error-triggered path (humanError maps the
  // on-chain "cooldown" revert to a friendly message).
  const checkCooldown = useCallback(
    async (agentId: number): Promise<number | null> => {
      if (!GAME_CONTRACTS.auraFusion) return null;
      try {
        const [lineage, cooldownSec] = await Promise.all([
          readContract(config, {
            address: GAME_CONTRACTS.auraFusion as `0x${string}`,
            abi: auraFusionAbi,
            functionName: "lineageOf",
            args: [BigInt(agentId)],
            chainId: APP_CHAIN.id,
          }),
          readContract(config, {
            address: GAME_CONTRACTS.auraFusion as `0x${string}`,
            abi: auraFusionAbi,
            functionName: "cooldown",
            chainId: APP_CHAIN.id,
          }),
        ]);
        const lastFusedAt = Number(lineage.lastFusedAt);
        // Mirrors the on-chain guard: lastFusedAt == 0 => never used as a parent => not on cooldown (readyAt 0).
        return lastFusedAt === 0 ? 0 : lastFusedAt + Number(cooldownSec);
      } catch {
        return null;
      }
    },
    [config],
  );

  // ── registerGenesis (owner backfills a parent's genome so it becomes fusable) ──
  const registerGenesis = useCallback(
    async (token: string, agentId: number): Promise<boolean> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        setState({ ...IDLE, action: "genesis", phase: "preparing", step: "Computing the genesis args" });
        const r = await fetchGenesisArgs(token, agentId);
        if (isGate(r)) {
          setState((s) => ({ ...s, phase: "gated", gatedError: r.error }));
          return false;
        }
        if (r.state !== "ok") throw new Error(r.error);
        await ensureChain();
        const g = r.data.genome;
        const genome = [g[0], g[1], g[2], g[3], g[4], g[5], g[6], g[7]] as const;
        setState((s) => ({ ...s, phase: "signing", step: "Confirm registerGenesis in your wallet" }));
        const hash = await writeContract(config, {
          address: r.data.contract as `0x${string}`,
          abi: auraFusionAbi,
          functionName: "registerGenesis",
          args: [BigInt(agentId), genome],
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Registering the genome on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("registerGenesis reverted on-chain.");
        setState((s) => ({ ...s, phase: "success", step: "Genesis registered" }));
        return true;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, FUSION_ERRORS) }));
        return false;
      }
    },
    [address, config, ensureChain],
  );

  // ── requestFusion (COMMIT): lock the pairing to a future block; send the fusion fee ──
  const requestFusion = useCallback(
    async (token: string, parentA: number, parentB: number): Promise<{ requestId: number; fee: string } | null> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        setState({ ...IDLE, action: "request", phase: "preparing", step: "Computing the requestFusion args" });
        const r = await fetchRequestFusionArgs(token, parentA, parentB);
        if (isGate(r)) {
          setState((s) => ({ ...s, phase: "gated", gatedError: r.error }));
          return null;
        }
        if (r.state !== "ok") throw new Error(r.error);
        await ensureChain();
        const fee = r.data.fee;
        setState((s) => ({ ...s, phase: "signing", step: "Confirm the fusion (fee + commit) in your wallet" }));
        const hash = await writeContract(config, {
          address: r.data.contract as `0x${string}`,
          abi: auraFusionAbi,
          functionName: "requestFusion",
          args: [BigInt(parentA), BigInt(parentB)],
          value: BigInt(fee),
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Committing the pairing on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("requestFusion reverted on-chain.");
        let requestId: number | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = decodeEventLog({ abi: [fusionRequestedEvent], data: log.data, topics: log.topics });
            if (parsed.eventName === "FusionRequested") {
              requestId = Number((parsed.args as { requestId: bigint }).requestId);
              break;
            }
          } catch {
            /* not our event */
          }
        }
        setState((s) => ({ ...s, phase: "success", step: "Pairing committed" }));
        return requestId !== null ? { requestId, fee } : null;
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, FUSION_ERRORS) }));
        return null;
      }
    },
    [address, config, ensureChain],
  );

  // ── executeFusion (REVEAL): run the TEE child pipeline (server) + submit executeFusion (wallet) ──
  const executeFusion = useCallback(
    async (token: string, requestId: number, childName?: string): Promise<{ result: FuseExecuteResult; childId: number | null } | null> => {
      try {
        if (!address) throw new Error("Connect a wallet first.");
        setState({ ...IDLE, action: "execute", phase: "preparing", step: "Generating the descendant in a 0G TEE" });
        const r = await fetchExecuteFusion(token, requestId, childName);
        if (isGate(r)) {
          setState((s) => ({ ...s, phase: "gated", gatedError: r.error }));
          return null;
        }
        if (r.state !== "ok") throw new Error(r.error);
        const result = r.data;
        const c = result.executeArgs.call;
        await ensureChain();
        setState((s) => ({ ...s, phase: "signing", step: "Confirm executeFusion in your wallet" }));
        const hash = await writeContract(config, {
          address: result.executeArgs.contract as `0x${string}`,
          abi: auraFusionAbi,
          functionName: "executeFusion",
          args: [
            BigInt(c.requestId),
            c.childName,
            c.childStyleFingerprint as `0x${string}`,
            c.childEncBrainRoot,
            c.childDataHash as `0x${string}`,
            c.childModelAttestation as `0x${string}`,
            c.royaltyBps,
            c.creatorResaleBps,
            c.childSealedKey as `0x${string}`,
          ],
          chainId: APP_CHAIN.id,
        });
        setState((s) => ({ ...s, txHash: hash, phase: "confirming", step: "Minting the descendant on-chain" }));
        const receipt = await pollReceipt(config, hash, APP_CHAIN.id);
        if (receipt.status !== "success") throw new Error("executeFusion reverted on-chain.");
        let childId: number | null = null;
        for (const log of receipt.logs) {
          try {
            const parsed = decodeEventLog({ abi: [fusionExecutedEvent], data: log.data, topics: log.topics });
            if (parsed.eventName === "FusionExecuted") {
              childId = Number((parsed.args as { childId: bigint }).childId);
              break;
            }
          } catch {
            /* not our event */
          }
        }
        // FINALIZE: promote the staged child brain to the minted childId (the FUSION analog of the create-agent
        // confirm-mint step), so the child's portrait resolves on its detail page. Best-effort + non-blocking:
        // the mint already succeeded, so a transient finalize failure must not flip this to "error" (the brain
        // can be promoted later via a backfill). fetchFinalizeFusion never throws (it returns a GameResult).
        if (childId !== null) {
          await fetchFinalizeFusion(token, c.childEncBrainRoot, childId);
        }
        setState((s) => ({ ...s, phase: "success", step: "Descendant minted" }));
        return { result, childId };
      } catch (e) {
        setState((s) => ({ ...s, phase: "error", error: humanError(e, FUSION_ERRORS) }));
        return null;
      }
    },
    [address, config, ensureChain],
  );

  const busy = state.phase === "preparing" || state.phase === "signing" || state.phase === "confirming";
  return { state, busy, checkFusable, checkCooldown, registerGenesis, requestFusion, executeFusion, reset };
}
