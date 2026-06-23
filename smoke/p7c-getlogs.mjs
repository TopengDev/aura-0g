// PROBE 7c: eth_getLogs regression — address+topic0 filter over a block range from the DEPLOY block
// (NOT 0 — genesis is pruned). GREEN = known events return.
import { ethers } from "ethers";
const provider = new ethers.JsonRpcProvider("https://evmrpc-testnet.0g.ai");
const OUT = "0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb";
const REG = "0xEf948192c22957Eaa24a08782163b30037bA34bC";
const DEPLOY_BLOCK = 39935616; // from broadcast receipt
const latest = await provider.getBlockNumber();
console.log("deploy block:", DEPLOY_BLOCK, "latest:", latest, "range:", latest - DEPLOY_BLOCK, "blocks");

// topic0 for OutputMinted + AgentMinted
const outIface = new ethers.Interface(["event OutputMinted(uint256 indexed tokenId,uint256 indexed creatorAgentId,string imageRoot,bytes32 provenanceHash,bytes32 teeAttestation)"]);
const regIface = new ethers.Interface(["event AgentMinted(uint256 indexed agentId,address indexed owner,string name,bytes32 styleFingerprint)"]);
const outTopic0 = outIface.getEvent("OutputMinted").topicHash;
const regTopic0 = regIface.getEvent("AgentMinted").topicHash;
console.log("OutputMinted topic0:", outTopic0);
console.log("AgentMinted  topic0:", regTopic0);

// 1) try a FULL range from deploy → latest first (the build's real query shape)
async function tryRange(label, addr, topic0, iface, evName, from, to) {
  try {
    const logs = await provider.getLogs({ address: addr, topics: [topic0], fromBlock: from, toBlock: to });
    console.log(`\n[${label}] getLogs ${from}..${to} → ${logs.length} logs`);
    logs.slice(0,3).forEach(l => { const p = iface.parseLog(l); console.log(`   ${evName} blk=${l.blockNumber} args0=${p.args[0]?.toString?.()}`); });
    return logs.length;
  } catch (e) {
    console.log(`[${label}] getLogs ${from}..${to} ERROR: ${String(e?.message).slice(0,140)}`);
    return -1;
  }
}

let outN = await tryRange("OutputNFT full", OUT, outTopic0, outIface, "OutputMinted", DEPLOY_BLOCK, latest);
let regN = await tryRange("Registry full", REG, regTopic0, regIface, "AgentMinted", DEPLOY_BLOCK, latest);

// 2) if the full range was rejected (range cap), chunk it — note the cap behavior for the build.
if (outN < 0 || regN < 0) {
  console.log("\n[note] full-range rejected — testing a tight window near deploy + a chunked sweep…");
  const window = 10000;
  await tryRange("OutputNFT tight", OUT, outTopic0, outIface, "OutputMinted", DEPLOY_BLOCK, DEPLOY_BLOCK + window);
}

// 3) prove genesis (fromBlock 0) is the failing pattern → confirms 'start at deploy block' guidance
try {
  const logs0 = await provider.getLogs({ address: OUT, topics: [outTopic0], fromBlock: 0, toBlock: latest });
  console.log("\n[from 0] returned", logs0.length, "logs (genesis NOT pruned for this query?)");
} catch (e) {
  console.log("\n[from 0] ERROR (expected if genesis pruned / range too large):", String(e?.message).slice(0,140));
}
