import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "./zg-compute.js";
import { GALILEO, privateKey } from "./config.js";
const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const wallet = new ethers.Wallet(privateKey(), provider);
const broker = await createZGComputeNetworkBroker(wallet);
try {
  const l = await broker.ledger.getLedger();
  console.log("LEDGER:", JSON.stringify(l, (k,v)=> typeof v==="bigint"? v.toString(): v, 2).slice(0,1200));
} catch(e:any){ console.log("getLedger err:", e?.message?.slice(0,200)); }
await provider.destroy?.(); process.exit(0);
