// SERVER-ONLY. Epoch-key generation + the two keyrings (intrinsic / relationship).
//
// Reuses sealing.ts UNCHANGED (the shipped ECIES primitive): every epoch key is a raw 32-byte AES key,
// sealed to the CURRENT owner's secp256k1 pubkey. The manifest stores the SEALED form; only the owner's
// wallet private key can open it (sealing.ts openSealedKey). This is the same custody primitive the
// de-mock proved on-chain (19/19), applied per-epoch instead of once-per-brain.
//
// Custody model (honest, per the design):
//   - INTRINSIC keys are ESCROWED server-side (a MemoryService holds the raw keys) because the oracle must
//     re-seal ALL of them to the buyer on a sale. Same trust as today's per-agent brain key.
//   - RELATIONSHIP keys are NOT escrowed (the "no-escrow hardening", RS3): the oracle never re-seals them,
//     so it never needs them. Relationship privacy then holds even against the server. The owner unseals
//     their current L2 key client-side to write. (Trade: owner key loss = relationship loss. Acceptable.)
import { randomBytes } from "node:crypto";
import { sealKeyToPubkey, openSealedKey, sealedToHex, sealedFromHex } from "../sealing.js";
import type { Epoch, SealedKeyHex } from "./types.js";

/** Fresh 32-byte epoch key. */
export function newEpochKey(): Buffer {
  return randomBytes(32);
}

/** raw epoch key -> sealed-to-owner hex (what lands in a manifest keyring). */
export function sealEpochKey(ownerPubkeyHex: string, rawKey: Buffer): SealedKeyHex {
  return sealedToHex(sealKeyToPubkey(ownerPubkeyHex, rawKey));
}

/** sealed-to-owner hex + owner privkey -> raw epoch key (owner-side unseal). */
export function openEpochKey(ownerPrivkeyHex: string, sealedHex: string): Buffer {
  return openSealedKey(ownerPrivkeyHex, sealedFromHex(sealedHex));
}

/** A raw keyring a single party holds (server escrow for intrinsic; an owner client for either layer). */
export type RawKeyring = Map<Epoch, Buffer>;

/** Open every epoch key in a manifest's sealed keyring that this owner can unseal -> raw keys. */
export function openKeyring(ownerPrivkeyHex: string, sealed: Record<Epoch, SealedKeyHex>): RawKeyring {
  const out: RawKeyring = new Map();
  for (const [epochStr, sealedHex] of Object.entries(sealed)) {
    try {
      out.set(Number(epochStr), openEpochKey(ownerPrivkeyHex, sealedHex));
    } catch {
      // An entry this owner cannot unseal contributes nothing — the wall, in keyring form.
    }
  }
  return out;
}
