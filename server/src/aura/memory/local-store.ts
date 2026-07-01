// SERVER-ONLY. A LOCAL, content-addressed segment backend for the memory MVP.
//
// WHY LOCAL: the dual wall is a property of KEY CUSTODY, not of where the bytes live. Permanence is a
// MAINNET property (0G Storage, M5 — out of scope here). This backend mirrors the store/download SHAPE of
// the shipped storage.ts (root in -> bytes out) so the production swap to 0G is a one-module change, but
// it NEVER touches a network — no testnet, no mainnet, no funds, no keys. The honesty ledger: this proves
// the wall, not durability.
//
// Content addressing: root = sha256(bytes), exactly like oracle.ts dataHashOf. Same bytes => same root =>
// idempotent, just like storage.ts store(). Backed by an on-disk dir so a PoC can persist across a run.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export interface SegmentBackend {
  store(bytes: Buffer): Promise<string>; // -> content root
  download(root: string): Promise<Buffer>;
  has(root: string): boolean;
}

/** root = 0x-prefixed sha256, identical to oracle.ts dataHashOf (one addressing scheme everywhere). */
export function rootOf(bytes: Buffer): string {
  return "0x" + createHash("sha256").update(bytes).digest("hex");
}

/** Pure in-memory backend — fastest for unit tests; nothing hits disk. */
export class MemoryBackend implements SegmentBackend {
  private blobs = new Map<string, Buffer>();
  async store(bytes: Buffer): Promise<string> {
    const root = rootOf(bytes);
    if (!this.blobs.has(root)) this.blobs.set(root, Buffer.from(bytes)); // immutable copy
    return root;
  }
  async download(root: string): Promise<Buffer> {
    const b = this.blobs.get(root);
    if (!b) throw new Error(`local-store: no blob for root ${root}`);
    return Buffer.from(b);
  }
  has(root: string): boolean {
    return this.blobs.has(root);
  }
}

/** On-disk content-addressed backend — durable across a process (the "interim durable cache" framing). */
export class DiskBackend implements SegmentBackend {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }
  private p(root: string): string {
    return path.join(this.dir, root.replace(/^0x/, "") + ".seg");
  }
  async store(bytes: Buffer): Promise<string> {
    const root = rootOf(bytes);
    const fp = this.p(root);
    if (!existsSync(fp)) writeFileSync(fp, bytes); // immutable: never overwrite an existing root
    return root;
  }
  async download(root: string): Promise<Buffer> {
    const fp = this.p(root);
    if (!existsSync(fp)) throw new Error(`local-store: no blob on disk for root ${root}`);
    return readFileSync(fp);
  }
  has(root: string): boolean {
    return existsSync(this.p(root));
  }
}
