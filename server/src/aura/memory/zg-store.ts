// SERVER-ONLY. The 0G STORAGE segment backend - the "mainnet durability" swap for the dual-wall memory.
//
// local-store.ts proved the wall with a LOCAL content-addressed backend and states the production swap to
// 0G Storage is "a one-module change". THIS is that module: a SegmentBackend whose bytes live on 0G Storage
// (permanent + PoRA on mainnet; testnet round-trips today), so an agent's ENCRYPTED memory is EMBEDDED on
// 0G Storage exactly as the ERC-7857 iNFT model wants (encrypted metadata on decentralized storage). The
// dual wall is UNCHANGED: it is a property of KEY CUSTODY (the epoch keyring), independent of where bytes sit.
//
// Wiring, not new crypto: store()/download() are the proven storage.ts round-trip (merkle-verified download),
// wrapped to the SegmentBackend shape (root in -> bytes out). store() needs a funded signer, so this backend
// holds one. `has()` is a LOCAL advisory (a real 0G existence check is an async network call and NO consumer
// needs it synchronously): it honestly answers "has THIS process handled this root", not "is it live on 0G".
import { ethers } from "ethers";
import { store as zgStore, download as zgDownload } from "../storage.js";
import { sponsorSigner } from "../wallet.js";
import type { SegmentBackend } from "./local-store.js";

/** DI seam: the two ops this backend needs. Real impls bind storage.ts to a signer; tests inject in-memory fakes. */
export interface ZgStoreOps {
  store(bytes: Buffer): Promise<string>; // -> 0G merkle root (the content address)
  download(root: string): Promise<Buffer>; // merkle-proof-verified bytes for a root
}

/** A SegmentBackend whose immutable, content-addressed segments live on 0G Storage. Drop-in for MemoryBackend. */
export class ZgStorageBackend implements SegmentBackend {
  private readonly ops: ZgStoreOps;
  private readonly seen = new Set<string>(); // advisory local presence cache (see has())

  constructor(ops: ZgStoreOps) {
    this.ops = ops;
  }

  async store(bytes: Buffer): Promise<string> {
    const root = await this.ops.store(bytes);
    this.seen.add(root);
    return root;
  }

  async download(root: string): Promise<Buffer> {
    const b = await this.ops.download(root);
    this.seen.add(root);
    return b;
  }

  /** ADVISORY only: whether THIS process stored/fetched `root` (a real 0G check is async + no caller needs it). */
  has(root: string): boolean {
    return this.seen.has(root);
  }
}

/** Build the real ops from a funded signer + storage.ts (the finalityRequired:false round-trip). */
export function zgStoreOps(signer: ethers.Wallet, label = "mem-seg"): ZgStoreOps {
  return {
    async store(bytes: Buffer): Promise<string> {
      const res = await zgStore(signer, bytes, label);
      return res.rootHash;
    },
    download: (root: string) => zgDownload(root),
  };
}

/** The default production backend: 0G Storage via the sponsor signer. */
export function zgBackend(label = "mem-seg"): ZgStorageBackend {
  return new ZgStorageBackend(zgStoreOps(sponsorSigner(), label));
}
