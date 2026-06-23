import { publicClient, CONTRACTS, OUT_ABI } from "./lib.mjs";
import { decodeEventLog } from "viem";
const hash = "0xcc44d8fcfe841d92e9c395fb2e698ae1853ae9d32caae29fc73728835978e78f";
const rcpt = await publicClient.getTransactionReceipt({ hash });
console.log("logs from outputNFT:");
for (const log of rcpt.logs) {
  if (log.address.toLowerCase() !== CONTRACTS.outputNFT.toLowerCase()) continue;
  console.log("  topics:", log.topics.map((t,i)=>`[${i}]${t.slice(0,18)}`).join(" "));
  try {
    const d = decodeEventLog({ abi: OUT_ABI, data: log.data, topics: log.topics });
    if (d.eventName === "OutputMinted") console.log("  -> OutputMinted tokenId:", d.args.tokenId.toString(), "creatorAgentId:", d.args.creatorAgentId.toString());
  } catch (_) {}
}
const next = await publicClient.readContract({ address: CONTRACTS.outputNFT, abi: OUT_ABI, functionName: "nextTokenId" });
console.log("nextTokenId now:", next.toString());
// Who owns 7?
try { console.log("ownerOf(7):", await publicClient.readContract({address:CONTRACTS.outputNFT, abi:OUT_ABI, functionName:"ownerOf", args:[7n]})); } catch(e){ console.log("ownerOf(7) err", e.shortMessage); }
