// SERVER-ONLY. The SPONSOR wallet. It does TWO things, both non-custodial-to-the-user:
//   1) pays 0G Compute + 0G Storage for generation (it signs the compute-ledger funding txs only).
//   2) IS the OutputNFT.attestor - it signs the EIP-712 MintAuth that the contract verifies.
// It NEVER signs a user's mintOutput / mintAgent / list / buy. Those are returned as args for the
// user's own wallet to submit. (Renamed from the v1 "demo/custodial" role -> SPONSOR semantics.)
import { ethers } from "ethers";
import { readProvider } from "./contracts.js";
import { sponsorPrivateKey } from "./config.js";

export function sponsorSigner(): ethers.Wallet {
  return new ethers.Wallet(sponsorPrivateKey(), readProvider());
}

export function sponsorAddress(): string {
  return new ethers.Wallet(sponsorPrivateKey()).address;
}

export async function sponsorBalance(): Promise<string> {
  return ethers.formatEther(await readProvider().getBalance(sponsorAddress()));
}
