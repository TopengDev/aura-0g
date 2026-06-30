// SERVER-ONLY. The SPONSOR wallet - the ONLY key on the tx-sending (gas) path. It:
//   1) pays 0G Compute + 0G Storage for generation (it signs the compute-ledger funding txs).
//   2) sends the Summon watcher's fulfill() tx.
// It NEVER signs a user's mintOutput / mintAgent / list / buy. Those are returned as args for the user's
// own wallet to submit.
//
// B-6 (split the hot key): the EIP-712 MintAuth ATTESTOR is now a DISTINCT key (config.attestorPrivateKey(),
// used SIGN-ONLY in attestation.ts via viem - never put on an ethers signer that sends a tx). It falls back
// to the sponsor key only when ATTESTOR_PRIVATE_KEY is unset, so the current single-key testnet deploy is
// unchanged. `attestorWalletForCheck()` below is a read-only convenience for verification/health to confirm
// the split; it is NEVER connected to a provider and never sends a tx (keeps the attestor key off the gas path).
import { ethers } from "ethers";
import { readProvider } from "./contracts.js";
import { sponsorPrivateKey, attestorPrivateKey } from "./config.js";

export function sponsorSigner(): ethers.Wallet {
  return new ethers.Wallet(sponsorPrivateKey(), readProvider());
}

export function sponsorAddress(): string {
  return new ethers.Wallet(sponsorPrivateKey()).address;
}

export async function sponsorBalance(): Promise<string> {
  return ethers.formatEther(await readProvider().getBalance(sponsorAddress()));
}

/** The attestor address (defaults to the sponsor address until ATTESTOR_PRIVATE_KEY is split off). */
export function attestorWalletAddress(): string {
  return new ethers.Wallet(attestorPrivateKey()).address;
}
