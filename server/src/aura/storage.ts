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
import { GALILEO } from "./config.js";

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
  try {
    const [res, upErr] = await idx.upload(mem, GALILEO.rpc, signer as any, {
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
