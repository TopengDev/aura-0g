import { createPublicClient, http, getAddress } from "viem";
import "dotenv/config";
const RPC = "https://evmrpc-testnet.0g.ai";
const client = createPublicClient({ transport: http(RPC) });
const MKT = "0xc57d182fec6555a946795821b2e58be9a6385e18";
const OUT = "0xc73a63726f5365646fdeb052164b18db836030d7";
const REG = "0xb5960cc08caa5195095cfb8aa270f122be09ba0a";
const deployer = getAddress("0x253727ac3cE3Bc06C164A253Ad5CDF118cdD5540");
const mktAbi = [
  { type:"function", name:"allowedCollection", stateMutability:"view", inputs:[{type:"address"}], outputs:[{type:"bool"}] },
  { type:"function", name:"platformBps", stateMutability:"view", inputs:[], outputs:[{type:"uint16"}] },
];
const ercAbi = [
  { type:"function", name:"isApprovedForAll", stateMutability:"view", inputs:[{type:"address"},{type:"address"}], outputs:[{type:"bool"}] },
  { type:"function", name:"nextTokenId", stateMutability:"view", inputs:[], outputs:[{type:"uint256"}] },
];
const bal = await client.getBalance({ address: deployer });
console.log("chainId:", await client.getChainId());
console.log("deployer balance 0G:", Number(bal)/1e18);
console.log("env ADDRESS matches deployer:", (process.env.ADDRESS||"").toLowerCase() === deployer.toLowerCase(), "| has PRIVATE_KEY:", !!process.env.PRIVATE_KEY);
console.log("outputNFT allowedCollection:", await client.readContract({address:MKT, abi:mktAbi, functionName:"allowedCollection", args:[OUT]}));
console.log("agentRegistry allowedCollection:", await client.readContract({address:MKT, abi:mktAbi, functionName:"allowedCollection", args:[REG]}));
console.log("platformBps:", await client.readContract({address:MKT, abi:mktAbi, functionName:"platformBps"}));
console.log("isApprovedForAll(deployer, MKT) on OUT:", await client.readContract({address:OUT, abi:ercAbi, functionName:"isApprovedForAll", args:[deployer, MKT]}));
console.log("isApprovedForAll(deployer, MKT) on REG:", await client.readContract({address:REG, abi:ercAbi, functionName:"isApprovedForAll", args:[deployer, MKT]}));
console.log("OUT nextTokenId:", (await client.readContract({address:OUT, abi:ercAbi, functionName:"nextTokenId"})).toString());
