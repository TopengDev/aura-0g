// SERVER-ONLY. 0G Storage round-trip (Turbo). Ported from demo/run-aura.ts store() + src/04-storage.ts.
// @0gfoundation/0g-ts-sdk@1.2.8 is the MAINTAINED storage SDK (the @0glabs one is stale — submit ABI
// mismatch reverts every upload). Listed in serverExternalPackages so Next loads it at runtime.
import { ethers } from "ethers";
import { GALILEO } from "./config";

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

/** Local merkle root (deterministic content address) — fund-free. */
export async function localRoot(bytes: Buffer): Promise<string> {
  const { MemData } = await sdk();
  const mem = new MemData(bytes);
  const [tree, err] = await mem.merkleTree();
  if (err) throw err;
  return tree.rootHash();
}

export interface StoreResult {
  rootHash: string;
  txHash: string | null;
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
  const [tree, mErr] = await mem.merkleTree();
  if (mErr) throw mErr;
  const root = tree.rootHash();
  try {
    const [res, upErr] = await idx.upload(mem, GALILEO.rpc, signer as any, { ...(defaultUploadOption as any), finalityRequired: false });
    if (upErr) {
      const es = String(upErr);
      if (/already|exist|Data root/i.test(es)) return { rootHash: root, txHash: null };
      throw new Error(`upload ${label}: ${es.slice(0, 200)}`);
    }
    const r = res as any;
    return { rootHash: (r.rootHash as string) ?? root, txHash: (r.txHash ?? null) as string | null };
  } catch (e: any) {
    const es = String(e?.message ?? e);
    if (/already|exist|Data root/i.test(es)) return { rootHash: root, txHash: null };
    throw e;
  }
}

/** Reachability probe (fund-free) — used by health/gate checks. */
export async function shardedNodeCount(): Promise<number | string> {
  try {
    const idx = await indexer();
    const sharded: any = await idx.getShardedNodes();
    return sharded?.trusted?.length ?? sharded?.length ?? "reachable";
  } catch (e: any) {
    return `note: ${String(e?.message ?? e).slice(0, 100)}`;
  }
}
