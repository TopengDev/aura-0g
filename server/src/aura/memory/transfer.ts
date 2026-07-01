// SERVER-ONLY. The DUAL-WALL transfer re-seal (M2-core) — the moat made mechanical.
//
// This GENERALIZES the shipped oracle.ts reencryptForTransfer (which re-keys ONE brain envelope) to the
// TWO-POLICY keyring re-seal (MEMORY-DESIGN-owner-safety §8 = "a branch in the keyring loop"). On a sale
// A -> B the oracle, holding the INTRINSIC escrow:
//
//   1. RE-SEALS every L1 (intrinsic) epoch key to B        -> B inherits the FULL intrinsic life.
//   2. MINTS a fresh L1 epoch key sealed to B              -> B's future intrinsic writes; A forward-secret.
//   3. MINTS a fresh L2 (relationship) epoch key sealed to B -> B's clean relationship.
//   4. TOUCHES NO prior L2 epoch key                       -> A's relationship epochs are absent from B's
//                                                             keyring; their bytes are opaque AES-GCM
//                                                             forever. THE DUAL WALL, by key custody.
//
// The on-chain half (rotate memoryRoot + the EIP-191 transfer proof) is unchanged in SHAPE from the proven
// oracle.ts/AuraINFT path (19/19 on Galileo) and is M2-full / out of this MVP's scope. This module proves
// the KEY-CUSTODY wall, which is the part that makes the demo visceral.
import { newEpochKey, sealEpochKey } from "./keyring.js";
import type { MemoryService } from "./core.js";
import type { Epoch, Manifest, SealedKeyHex } from "./types.js";

export interface TransferInput {
  toAddr: string;
  toPubkey: string; // buyer B's secp256k1 pubkey (recovered SIWE-style, pubkey.ts)
}

export interface TransferResult {
  manifestB: Manifest; // B's new per-owner view
  freshL2KeyB: Buffer; // B's fresh relationship epoch key (no-escrow: handed to B, never kept server-side)
  newEpoch: Epoch;
}

/**
 * Perform the dual-wall re-seal on a MemoryService, advancing it to B's ownership. The service's escrow is
 * extended with the fresh L1 epoch key (intrinsic stays escrowed); NO L2 key is ever escrowed. A's
 * pre-transfer manifest must be snapshotted by the caller BEFORE this runs if A's retained view is needed
 * (the canonical manifest is mutated in place to B's view).
 */
export function dualWallTransfer(service: MemoryService, input: TransferInput): TransferResult {
  const { toAddr, toPubkey } = input;
  const m = service.manifest;
  const newEpoch: Epoch = m.currentEpoch + 1;

  // (1) re-seal EVERY intrinsic epoch key (from escrow) to B — B reads the full inherited L1 history.
  const intrinsicKeyring: Record<Epoch, SealedKeyHex> = {};
  for (const [epoch, rawKey] of service.intrinsicEscrow) {
    intrinsicKeyring[epoch] = sealEpochKey(toPubkey, rawKey);
  }

  // (2) mint a FRESH intrinsic epoch key, escrow it, seal to B — B's future L1; A never gets this key.
  const freshL1 = newEpochKey();
  service.intrinsicEscrow.set(newEpoch, freshL1);
  intrinsicKeyring[newEpoch] = sealEpochKey(toPubkey, freshL1);

  // (3) mint a FRESH relationship epoch key, seal to B ONLY (no-escrow) — B's clean bond.
  const freshL2 = newEpochKey();
  const relationshipKeyring: Record<Epoch, SealedKeyHex> = { [newEpoch]: sealEpochKey(toPubkey, freshL2) };

  // (4) prior L2 keys are NOT re-sealed and prior L2 segments are DROPPED from B's manifest (option (a)):
  //     B sees no pointer, no count, no key for any prior relationship epoch. The wall is total.
  const manifestB: Manifest = {
    agentId: m.agentId,
    currentEpoch: newEpoch,
    owner: toAddr.toLowerCase(),
    intrinsic: {
      segments: [...m.intrinsic.segments], // FULL intrinsic history transfers
      keyring: intrinsicKeyring,
    },
    relationship: {
      segments: [], // fresh — B's relationship starts empty; prior epochs are not listed
      keyring: relationshipKeyring,
    },
  };

  // Advance the canonical service state to B's ownership.
  m.agentId = manifestB.agentId;
  m.currentEpoch = newEpoch;
  m.owner = manifestB.owner;
  m.intrinsic.segments = manifestB.intrinsic.segments;
  m.intrinsic.keyring = manifestB.intrinsic.keyring;
  m.relationship.segments = manifestB.relationship.segments;
  m.relationship.keyring = manifestB.relationship.keyring;

  return { manifestB, freshL2KeyB: freshL2, newEpoch };
}
