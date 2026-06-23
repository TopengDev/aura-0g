import { ethers } from "ethers";
import "dotenv/config";
const RPC = "https://evmrpc-testnet.0g.ai";
const provider = new ethers.JsonRpcProvider(RPC);
const net = await provider.getNetwork();
console.log("chainId (live):", net.chainId.toString());
const block = await provider.getBlockNumber();
console.log("current block:", block);
const pk = process.env.DEMO_PRIVATE_KEY || process.env.PRIVATE_KEY;
const w = new ethers.Wallet(pk, provider);
console.log("DEMO wallet addr:", w.address);
console.log("DEMO balance:", ethers.formatEther(await provider.getBalance(w.address)), "0G");
if (process.env.PRIVATE_KEY) {
  const wm = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log("PRIVATE_KEY wallet addr:", wm.address, "bal:", ethers.formatEther(await provider.getBalance(wm.address)), "0G");
}
console.log("DEMO === MAIN ?", (process.env.DEMO_PRIVATE_KEY||"") === (process.env.PRIVATE_KEY||""));
const fee = await provider.getFeeData();
console.log("gasPrice:", fee.gasPrice?.toString());
