// SERVER-ONLY. Recover + persist each owner's secp256k1 PUBLIC KEY.
//
// WHY: ECIES sealing (sealing.ts) needs the owner's PUBKEY, but on-chain you only ever have their
// ADDRESS (the keccak hash of the pubkey - not invertible). The pubkey must be recovered from a
// signature the owner produced. AURA already has one at login: the SIWE message is an EIP-191
// personal_sign, so recoverPublicKey(hashMessage(siweMessage), signature) yields the uncompressed
// secp256k1 pubkey. We persist it keyed to the address so the re-encryption oracle can seal a
// transferred key to a buyer who has logged in at least once.
//
// VERIFIED: viem.recoverPublicKey over hashMessage(message) == ethers Wallet.signingKey.publicKey
// (uncompressed 0x04..), and eciesjs seals/open round-trips with it.
import { recoverPublicKey, hashMessage } from "viem";
import { computeAddress } from "ethers";
import { db } from "./db.js";

/** Recover the uncompressed secp256k1 pubkey (0x04..) from a SIWE message + its EIP-191 signature. */
export async function recoverSiwePubkey(message: string, signature: `0x${string}`): Promise<`0x${string}`> {
  return recoverPublicKey({ hash: hashMessage(message), signature });
}

/** Upsert the pubkey for an address (lower-cased). Idempotent. */
export function storePubkey(address: string, pubkeyHex: string): void {
  db()
    .prepare(
      `INSERT INTO wallet_pubkeys (address, pubkey, updated_at) VALUES (?,?,?)
       ON CONFLICT(address) DO UPDATE SET pubkey=excluded.pubkey, updated_at=excluded.updated_at`,
    )
    .run(address.toLowerCase(), pubkeyHex.toLowerCase(), new Date().toISOString());
}

/** Look up a stored pubkey by address. Returns null if the owner has never signed in. */
export function pubkeyOf(address: string): string | null {
  const r = db().prepare(`SELECT pubkey FROM wallet_pubkeys WHERE address=?`).get(address.toLowerCase()) as
    | { pubkey: string }
    | undefined;
  return r?.pubkey ?? null;
}

/** Defense-in-depth: confirm a recovered pubkey actually hashes to the claimed address. */
export function pubkeyMatchesAddress(pubkeyHex: string, address: string): boolean {
  // computeAddress = keccak256(pubkey[1:])[12:]; must equal the claimed address.
  try {
    return computeAddress(pubkeyHex).toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}
