// SERVER-ONLY. The agent "brain" = the PRIVATE style-DNA, AES-256-GCM encrypted and sealed on 0G
// Storage (encBrainRoot). Envelope layout = iv(12) || authTag(16) || ciphertext  (proven in smoke/p3,
// byte-identical round-trip + drove a verified gen). The AES key is stored server-side keyed to the
// agent for now; per-owner sealing (ERC-7857 secure transfer) is the DEFERRED milestone.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface BrainPlain {
  agent: string;
  model: string;
  // canonical base image content root on 0G Storage - reconstructed at gen time (download -> baseBytes).
  canonicalBaseRoot: string;
  // the style/character prompt fragments the generalized generator reassembles.
  styleDescriptor: string; // e.g. "Style: risograph duotone, fluorescent pink + blue, halftone grain"
  identityLock: string; // e.g. "Keep the EXACT same subject (same shape, features, composition)"
  negative: string; // e.g. "no photorealism, no gradients, no 3d render"
  basePolicy: string; // how the base is used (determinism anchor note)
  createdAt: string;
}

export interface EncryptedBrain {
  envelope: Buffer; // iv || tag || ciphertext  (what gets stored on 0G Storage)
  keyHex: string; // 0x-prefixed 32-byte AES key (stored server-side keyed to the agent)
}

/** AES-256-GCM encrypt a brain object -> envelope + key. */
export function encryptBrain(brain: BrainPlain): EncryptedBrain {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(brain), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { envelope: Buffer.concat([iv, tag, ct]), keyHex: "0x" + key.toString("hex") };
}

/** AES-256-GCM decrypt an envelope (iv||tag||ct) with the stored key -> brain object. */
export function decryptBrain(envelope: Buffer, keyHex: string): BrainPlain {
  const key = Buffer.from(keyHex.replace(/^0x/, ""), "hex");
  const iv = envelope.subarray(0, 12);
  const tag = envelope.subarray(12, 28);
  const ct = envelope.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as BrainPlain;
}
