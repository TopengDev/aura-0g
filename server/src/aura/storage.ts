// SERVER-ONLY. 0G Storage round-trip (Turbo). Ported from lib/aura/storage.ts + src/04-storage.ts.
// @0gfoundation/0g-ts-sdk@1.2.8 is the proven storage SDK (the @0glabs one is stale - submit ABI
// mismatch reverts every upload). Loaded via dynamic import (native SDK, unbundled server runtime).
//
// CHANGE vs the prod lib: ADDS download(root) -> Buffer (the prod lib lacked it). Pattern proven in
// src/04-storage.ts / smoke/p3 via indexer.download(root, path, true) then read + (implicit) verify.
import { ethers } from "ethers";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GALILEO,
  STORAGE_TESTNET_RPC,
  STORAGE_TESTNET_CHAIN_ID,
  storageTestnetKey,
  storageTestnetSeamActive,
} from "./config.js";

// dynamic import keeps the native SDK out of the module graph until first use (server runtime only).
async function sdk() {
  return await import("@0gfoundation/0g-ts-sdk");
}

let _indexer: any = null;
async function indexer() {
  if (!_indexer) {
    const { Indexer } = await sdk();
    _indexer = new Indexer(GALILEO.storageIndexerTurbo);
  }
  return _indexer;
}

/** Local merkle root (deterministic content address) - fund-free. */
export async function localRoot(bytes: Buffer): Promise<string> {
  const { MemData } = await sdk();
  const mem = new MemData(bytes);
  const [tree, err] = await mem.merkleTree();
  if (err || !tree) throw err ?? new Error("merkleTree returned no tree");
  const r = tree.rootHash();
  if (!r) throw new Error("merkleTree rootHash null");
  return r;
}

export interface StoreResult {
  rootHash: string;
  txHash: string | null;
  dedup: boolean;
}

/**
 * Resolve the (rpc, signer) the 0G-Storage fee tx + node sync run against. When the STORAGE-TESTNET SEAM is
 * engaged (AURA_STORAGE_TESTNET set OR AURA_STORAGE_RPC present) AND a testnet-funded key is available, build
 * a DEDICATED testnet provider+signer so the upload targets the fast + proven 0G TESTNET storage node even
 * though the economy (GALILEO.rpc) is now 0G mainnet - the mirror of compute.ts imageSigner('testnet'). Paired
 * with AURA_STORAGE_INDEXER_TURBO pointed at the testnet turbo indexer, all three (indexer + rpc + signer)
 * are testnet-consistent, so the SDK stops looping "Waiting for storage node to sync".
 *
 * Falls back to the passed sponsor `signer` on GALILEO.rpc == today's EXACT behavior (zero regression) when
 * the seam is unset. If the seam is flagged but no testnet key resolves it also falls back (misconfiguration)
 * with a one-line warn, never crashing the upload path. The passed `signer` arg is always the fallback.
 */
function uploadContext(fallback: ethers.Wallet): { rpc: string; signer: ethers.Wallet } {
  if (storageTestnetSeamActive()) {
    const key = storageTestnetKey();
    if (key) {
      // explicit chainId => fail-closed if the testnet RPC ever answers with the wrong network.
      const provider = new ethers.JsonRpcProvider(STORAGE_TESTNET_RPC, STORAGE_TESTNET_CHAIN_ID);
      return { rpc: STORAGE_TESTNET_RPC, signer: new ethers.Wallet(key, provider) };
    }
    console.warn(
      "[storage] storage-testnet seam is ON but neither AURA_STORAGE_TESTNET_KEY nor AURA_IMAGE_TESTNET_KEY is set - " +
        "falling back to the economy sponsor signer + GALILEO.rpc (upload will target the economy storage node).",
    );
  }
  return { rpc: GALILEO.rpc, signer: fallback };
}

/**
 * Deterministic, idempotent upload to 0G Storage. Same bytes => same root, so re-running is safe.
 * finalityRequired:false => return as soon as the root is known (the root is the content address;
 * the on-chain mint only needs the root, not a per-node finality flag that can lag on testnet).
 */
export async function store(signer: ethers.Wallet, bytes: Buffer, label: string): Promise<StoreResult> {
  const { MemData, defaultUploadOption } = await sdk();
  const idx = await indexer();
  const mem = new MemData(bytes);
  const merkle = await mem.merkleTree();
  const tree = merkle[0];
  const mErr = merkle[1];
  if (mErr || !tree) throw mErr ?? new Error("merkleTree returned no tree");
  const root: string = tree.rootHash() ?? "";
  if (!root) throw new Error("merkleTree rootHash null");
  // STORAGE-TESTNET SEAM: pin the fee tx + node sync to 0G testnet (fast + proven) when engaged; else the
  // passed sponsor signer + GALILEO.rpc == today's exact behavior. `idx` (the turbo indexer) is separately
  // network-selected via AURA_STORAGE_INDEXER_TURBO, so indexer + rpc + signer stay testnet-consistent.
  const { rpc: upRpc, signer: upSigner } = uploadContext(signer);
  try {
    const [res, upErr] = await idx.upload(mem, upRpc, upSigner as any, {
      ...(defaultUploadOption as any),
      finalityRequired: false,
    });
    if (upErr) {
      const es = String(upErr);
      if (/already|exist|Data root/i.test(es)) return { rootHash: root, txHash: null, dedup: true };
      throw new Error(`upload ${label}: ${es.slice(0, 200)}`);
    }
    const r = res as any;
    return { rootHash: (r.rootHash as string) ?? root, txHash: (r.txHash ?? null) as string | null, dedup: false };
  } catch (e: any) {
    const es = String(e?.message ?? e);
    if (/already|exist|Data root/i.test(es)) return { rootHash: root, txHash: null, dedup: true };
    throw e;
  }
}

/**
 * Download by content root -> Buffer. Proven pattern (src/04-storage.ts, smoke/p3): indexer.download
 * writes to a path with proof verification, returning an Error (null = success). We download to a temp
 * file, read the bytes, then clean up. Needed by create-agent (re-load the brain) + generalized gen.
 */
export async function download(root: string): Promise<Buffer> {
  const idx = await indexer();
  const dir = mkdtempSync(path.join(tmpdir(), "aura-dl-"));
  const outPath = path.join(dir, "blob.bin");
  try {
    const dErr = await idx.download(root, outPath, true); // withProof = true (verifies the merkle proof)
    if (dErr) throw new Error(`download ${root}: ${String(dErr).slice(0, 200)}`);
    return readFileSync(outPath);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
}

/** Reachability probe (fund-free) - used by health/gate checks. */
export async function shardedNodeCount(): Promise<number | string> {
  try {
    const idx = await indexer();
    const sharded: any = await idx.getShardedNodes();
    return sharded?.trusted?.length ?? sharded?.length ?? "reachable";
  } catch (e: any) {
    return `note: ${String(e?.message ?? e).slice(0, 100)}`;
  }
}
