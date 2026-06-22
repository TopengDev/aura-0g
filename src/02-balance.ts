// CP1 - check testnet balance + RPC reachability. Never prints the private key.
import { ethers } from "ethers";
import { GALILEO, privateKey } from "./config.js";

const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const wallet = new ethers.Wallet(privateKey(), provider);

const net = await provider.getNetwork();
console.log("RPC:", GALILEO.rpc);
console.log("chainId:", net.chainId.toString(), "(expected 16601)");
const block = await provider.getBlockNumber();
console.log("latest block:", block);

const bal = await provider.getBalance(wallet.address);
console.log("address:", wallet.address);
console.log("balance:", ethers.formatEther(bal), "0G");
if (bal === 0n) console.log("\n⚠️  UNFUNDED - fund at", GALILEO.faucet);
else console.log("\n✅ FUNDED");
