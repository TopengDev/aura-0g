// SERVER-ONLY. The PER-OWNER ECIES SEALING primitive (the first half of the ERC-7857 de-mock).
//
// THE MOCK THIS REPLACES: brain.ts encrypts the brain with a per-agent AES key that lived ONLY in
// server custody (agent_brains.brain_key_hex) - there was NO per-owner sealing at all. Here we seal
// that AES data-key to the OWNER's secp256k1 wallet public key via ECIES (eciesjs, secp256k1 = the
// exact curve Ethereum wallets use). The sealed key is the `sealedKey` published on-chain
// (AuraINFT.sealedKey) so the custody handoff is provable; only the owner's wallet private key can
// ECIES-open it. This is the SAME primitive 0G's fine-tuning flow ships (encryptedSecret) and
// ZeroArena uses. No custom crypto - eciesjs + the secp256k1 pubkey.
import { encrypt as eciesEncrypt, decrypt as eciesDecrypt } from "eciesjs";

/**
 * ECIES-seal an AES data-key to an owner's secp256k1 public key.
 * @param ownerPubkeyHex uncompressed (0x04..) or compressed secp256k1 pubkey hex (the wallet pubkey)
 * @param aesKey         the raw 32-byte AES-256 data-key to seal
 * @returns the sealed-key ciphertext (opaque bytes; published on-chain + stored per (agent,owner))
 */
export function sealKeyToPubkey(ownerPubkeyHex: string, aesKey: Buffer): Buffer {
  if (aesKey.length !== 32) throw new Error(`sealKeyToPubkey: expected a 32-byte AES key, got ${aesKey.length}`);
  return Buffer.from(eciesEncrypt(ownerPubkeyHex, aesKey));
}

/**
 * ECIES-open a sealed key with the owner's wallet PRIVATE key -> the raw AES data-key.
 * (Used in the demo / by an owner-side client; the server never needs a user private key in prod.)
 */
export function openSealedKey(ownerPrivkeyHex: string, sealed: Buffer): Buffer {
  return Buffer.from(eciesDecrypt(ownerPrivkeyHex, sealed));
}

/** 0x-hex helpers for storing the sealed key in SQLite / passing it to the contract. */
export function sealedToHex(sealed: Buffer): `0x${string}` {
  return ("0x" + sealed.toString("hex")) as `0x${string}`;
}
export function sealedFromHex(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, ""), "hex");
}
