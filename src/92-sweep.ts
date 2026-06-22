// Sweep all helper-wallet balances into the main wallet (cooldown-bypass consolidation).
// Sends (balance - gasReserve) from each helper to the main ADDRESS. Never prints private keys.
import { ethers } from "ethers";
import { existsSync, readFileSync } from "node:fs";
import { GALILEO } from "./config.js";

const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const mainAddr = readFileSync(".env", "utf8").match(/ADDRESS=(0x[0-9a-fA-F]{40})/)?.[1];
if (!mainAddr) throw new Error("main ADDRESS not in .env");
console.log("sweeping into main:", mainAddr);

if (!existsSync(".helpers.json")) throw new Error("no .helpers.json");
const helpers: { address: string; privateKey: string }[] = JSON.parse(readFileSync(".helpers.json", "utf8"));

const gasPrice = 5_000_000_000n; // 5 gwei (Galileo min tip is 2 gwei)
const gasLimit = 21_000n;
const gasCost = gasPrice * gasLimit;

for (const h of helpers) {
  const bal = await provider.getBalance(h.address);
  if (bal <= gasCost) { console.log(`${h.address}: ${ethers.formatEther(bal)} 0G (too low, skip)`); continue; }
  const value = bal - gasCost;
  const w = new ethers.Wallet(h.privateKey, provider);
  const tx = await w.sendTransaction({ to: mainAddr, value, gasPrice, gasLimit });
  await tx.wait();
  console.log(`${h.address}: swept ${ethers.formatEther(value)} 0G -> main (tx ${tx.hash})`);
}
console.log("main balance now:", ethers.formatEther(await provider.getBalance(mainAddr)), "0G");
