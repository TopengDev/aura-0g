// SERVER-ONLY. Signers. The DEMO wallet (capped, dedicated) does all API writes (gen+mint).
// The MAIN wallet is only used by the setup script to fund the demo wallet — never by API routes.
import { ethers } from "ethers";
import { readProvider } from "./contracts";
import { demoPrivateKey, mainPrivateKey } from "./config";

export function demoSigner(): ethers.Wallet {
  return new ethers.Wallet(demoPrivateKey(), readProvider());
}

export function mainSigner(): ethers.Wallet {
  return new ethers.Wallet(mainPrivateKey(), readProvider());
}

export function demoAddress(): string {
  return new ethers.Wallet(demoPrivateKey()).address;
}

export async function demoBalance(): Promise<string> {
  return ethers.formatEther(await readProvider().getBalance(demoAddress()));
}
