// Generate N throwaway helper wallets for faucet-cooldown bypass. Keys saved gitignored, never printed.
// After Toper claims into each, run 92-sweep.ts to consolidate into the main wallet.
import { ethers } from "ethers";
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const FILE = ".helpers.json"; // gitignored
const N = 3;

let helpers: { address: string; privateKey: string }[] = existsSync(FILE)
  ? JSON.parse(readFileSync(FILE, "utf8"))
  : [];

while (helpers.length < N) {
  const w = ethers.Wallet.createRandom();
  helpers.push({ address: w.address, privateKey: w.privateKey });
}
writeFileSync(FILE, JSON.stringify(helpers, null, 2));

console.log(`${helpers.length} helper wallets ready (keys in ${FILE}, gitignored).`);
console.log("ADDRESSES (safe to share - claim 0.5 0G into each):");
helpers.forEach((h, i) => console.log(`  ${i + 1}. ${h.address}`));
