// Probe: does the LEDGER CONTRACT actually require 3 0G, or is that only the SDK client guard?
// Uses estimateGas (simulates, reveals revert WITHOUT spending) for a sub-3-0G ledger creation.
import { ethers } from "ethers";
import { GALILEO, privateKey } from "./config.js";

const LEDGER = "0xE70830508dAc0A97e6c087c75f402f9Be669E406"; // testnet ledger contract
const ABI = [
  "function addLedger(string additionalInfo) payable returns (uint256,uint256)",
  "function depositFund() payable",
];

const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const wallet = new ethers.Wallet(privateKey(), provider);
const c = new ethers.Contract(LEDGER, ABI, wallet);

for (const og of ["0.25", "0.3"]) {
  const value = ethers.parseEther(og);
  try {
    const g = await c.addLedger.estimateGas("", { value });
    console.log(`addLedger('') value=${og} 0G → estimateGas OK (${g}) → CONTRACT ALLOWS sub-3-0G ✅`);
  } catch (e: any) {
    console.log(`addLedger('') value=${og} 0G → REVERT: ${(e?.shortMessage || e?.message || "").slice(0, 200)}`);
  }
  try {
    const g2 = await c.depositFund.estimateGas({ value });
    console.log(`depositFund()  value=${og} 0G → estimateGas OK (${g2}) → CONTRACT ALLOWS sub-3-0G ✅`);
  } catch (e: any) {
    console.log(`depositFund()  value=${og} 0G → REVERT: ${(e?.shortMessage || e?.message || "").slice(0, 200)}`);
  }
}
