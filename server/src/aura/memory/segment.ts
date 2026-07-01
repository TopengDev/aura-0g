// SERVER-ONLY. The immutable memory SEGMENT primitive — a batch of records, AES-256-GCM sealed.
//
// This generalizes brain.ts (which seals one BrainPlain JSON) to seal an arbitrary array of memory
// records under an EPOCH key. The envelope layout is byte-identical to brain.ts —
//   envelope = iv(12) || authTag(16) || ciphertext — so the proven round-trip + the dataHash scheme
// carry over unchanged. A segment is content-addressed (root = sha256(envelope)) and IMMUTABLE: memory is
// append-only (the spike's log-structured model), so a segment is never edited in place.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MemoryRecord } from "./types.js";

/** AES-256-GCM seal a record batch under an epoch key. Returns the on-storage envelope. */
export function sealSegment(epochKey: Buffer, records: MemoryRecord[]): Buffer {
  if (epochKey.length !== 32) throw new Error(`sealSegment: expected a 32-byte epoch key, got ${epochKey.length}`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", epochKey, iv);
  const plain = Buffer.from(JSON.stringify(records), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

/**
 * AES-256-GCM open a segment envelope with an epoch key -> the record batch.
 * Throws (GCM auth-tag failure) if the key is wrong — this is the cryptographic wall in primitive form:
 * an owner WITHOUT the epoch key cannot read the segment, by the cipher, not by a prompt.
 */
export function openSegment(epochKey: Buffer, envelope: Buffer): MemoryRecord[] {
  const iv = envelope.subarray(0, 12);
  const tag = envelope.subarray(12, 28);
  const ct = envelope.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", epochKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as MemoryRecord[];
}

/** Safe variant: returns null instead of throwing when the key cannot open the segment (the wall, soft). */
export function tryOpenSegment(epochKey: Buffer, envelope: Buffer): MemoryRecord[] | null {
  try {
    return openSegment(epochKey, envelope);
  } catch {
    return null;
  }
}
