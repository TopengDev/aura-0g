// CP1 - generate a FRESH testnet wallet. Idempotent: never overwrites an existing key.
// SECURITY: writes PRIVATE_KEY to .env (gitignored). NEVER prints the private key.
import { ethers } from "ethers";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { GALILEO } from "./config.js";

const ENV = ".env";

function hasKey(): string | null {
  if (!existsSync(ENV)) return null;
  const m = readFileSync(ENV, "utf8").match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m);
  return m ? m[1] : null;
}

const existing = hasKey();
if (existing) {
  const w = new ethers.Wallet(existing);
  console.log("Wallet already exists (idempotent - not regenerating).");
  console.log("Address:", w.address);
} else {
  const w = ethers.Wallet.createRandom();
  const line = `PRIVATE_KEY=${w.privateKey}\nADDRESS=${w.address}\n`;
  if (existsSync(ENV)) appendFileSync(ENV, line);
  else writeFileSync(ENV, line);
  console.log("Fresh wallet generated and saved to .env (gitignored).");
  console.log("Address:", w.address);
}
console.log("\nFund this address at:", GALILEO.faucet, "(Galileo testnet, chain", GALILEO.chainId + ")");
console.log("Explorer:", GALILEO.explorer + "/address/" + (existing ? new ethers.Wallet(existing).address : ""));
