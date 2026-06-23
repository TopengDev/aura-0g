// PROBE 7a: viem on 16602 — defineChain, connect, real write tx, value-call.
// FINDING: viem's waitForTransactionReceipt throws TransactionReceiptNotFoundError on this RPC
// (its watchBlockNumber→getTransactionReceipt path doesn't tolerate the indexing lag). The robust
// pattern for 0G is a manual getTransactionReceipt poll loop. We prove viem signs+sends+reads here.
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

const galileo = defineChain({
  id: 16602, name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
});
const pk = process.env.DEMO_PRIVATE_KEY || process.env.PRIVATE_KEY;
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
console.log("viem account:", account.address);
const publicClient = createPublicClient({ chain: galileo, transport: http() });
const walletClient = createWalletClient({ account, chain: galileo, transport: http() });

console.log("chainId via viem:", await publicClient.getChainId());
console.log("blockNumber via viem:", (await publicClient.getBlockNumber()).toString());
console.log("balance via viem:", (await publicClient.getBalance({ address: account.address })).toString(), "wei");

const SMOKE = "0x11f839391ebAac6975643397f0B173167fD787eD";
const abi = [
  { type: "function", name: "counter", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "bump", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] },
];
const before = await publicClient.readContract({ address: SMOKE, abi, functionName: "counter" });
console.log("counter() before (value-call):", before.toString());

console.log("sending bump() write tx via viem (legacy, 5 gwei) …");
const hash = await walletClient.writeContract({ address: SMOKE, abi, functionName: "bump", type: "legacy", gasPrice: 5_000_000_000n });
console.log("viem write tx hash:", hash);

// ROBUST manual poll (the 0G-safe pattern instead of waitForTransactionReceipt):
let rcpt = null;
for (let i = 0; i < 40; i++) {
  try { rcpt = await publicClient.getTransactionReceipt({ hash }); if (rcpt) break; }
  catch (e) { /* TransactionReceiptNotFoundError until indexed */ }
  await new Promise(r => setTimeout(r, 3000));
}
if (!rcpt) { console.log("=== PROBE 7a RED: receipt never indexed ==="); process.exit(1); }
console.log("✓ mined (manual poll): status", rcpt.status, "block", rcpt.blockNumber.toString(), "gasUsed", rcpt.gasUsed.toString());
const after = await publicClient.readContract({ address: SMOKE, abi, functionName: "counter" });
console.log("counter() after:", after.toString(), "| incremented:", after === before + 1n);
console.log(rcpt.status === "success" && after === before + 1n
  ? "\n=== PROBE 7a GREEN: viem signs+sends write tx + value-call on 16602 (manual receipt poll; waitForTransactionReceipt is the gotcha) ==="
  : "\n=== PROBE 7a RED ===");
