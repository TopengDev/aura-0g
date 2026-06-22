// One minimal list + buy roundtrip on the LIVE Galileo chain, to generate a real `Listed` then `Sold`
// event so the indexer's earnings / activity-feed-sale / top-earners paths are exercised end-to-end.
//
// Self-trade is intentional and acceptable for this test: the funded wallet lists an output it owns
// and buys it back. The `Sold` event STILL fires (that is the point), and because proceeds are
// PULL-credited, the only real spend is gas + (briefly) the price, which is recoverable via withdraw().
// On this deploy, platform == royaltyReceiver == seller == buyer == the funded wallet, so every split
// (royalty / platform fee / seller proceeds / overpay) credits back to the funded wallet's pull
// balance. Net economic cost ~ gas only.
//
// NEVER prints the private key. Reads it from the repo-root .env (PRIVATE_KEY).
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

const D = JSON.parse(readFileSync(path.join(REPO_ROOT, "contracts", "deployed-v2.json"), "utf8"));
const RPC = D.rpcUrl as string;
const OUTPUT = D.outputNFT as string;
const MARKET = D.marketplace as string;

const PK = process.env.PRIVATE_KEY || process.env.SPONSOR_PRIVATE_KEY || process.env.DEMO_PRIVATE_KEY;
if (!PK) throw new Error("PRIVATE_KEY missing in repo-root .env");

const GAS = { gasPrice: 5_000_000_000n }; // Galileo min tip is 2 gwei; 5 gwei is safe.

// the token to trade (output #1) + a tiny price.
const TOKEN_ID = BigInt(process.env.TRADE_TOKEN_ID ?? "1");
const PRICE = ethers.parseEther(process.env.TRADE_PRICE ?? "0.001"); // 0.001 0G

const OUT_ABI = [
  "function ownerOf(uint256) view returns (address)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function setApprovalForAll(address,bool)",
];
const MKT_ABI = [
  "function allowedCollection(address) view returns (bool)",
  "function platform() view returns (address)",
  "function platformBps() view returns (uint16)",
  "function listingKey(address,uint256) pure returns (bytes32)",
  "function listings(bytes32) view returns (address seller,uint256 price,bool active)",
  "function pendingWithdrawals(address) view returns (uint256)",
  "function list(address,uint256,uint256)",
  "function buy(address,uint256) payable",
  "function withdraw()",
  "event Listed(address indexed collection,uint256 indexed tokenId,address indexed seller,uint256 price)",
  "event Sold(address indexed collection,uint256 indexed tokenId,address indexed buyer,address seller,uint256 price,address royaltyReceiver,uint256 royaltyPaid,uint256 platformFee,uint256 sellerProceeds)",
];

function fmt(wei: bigint): string {
  return ethers.formatEther(wei);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PK!, provider);
  const me = await wallet.getAddress();
  console.log("trader (funded wallet):", me);
  console.log("balance before:", fmt(await provider.getBalance(me)), "0G");

  const out = new ethers.Contract(OUTPUT, OUT_ABI, wallet);
  const mkt = new ethers.Contract(MARKET, MKT_ABI, wallet);

  // preflight
  const owner = await out.ownerOf(TOKEN_ID);
  console.log(`output #${TOKEN_ID} owner:`, owner);
  if (owner.toLowerCase() !== me.toLowerCase()) throw new Error(`funded wallet does not own output #${TOKEN_ID}`);

  const allowed = await mkt.allowedCollection(OUTPUT);
  console.log("output collection allowed on marketplace:", allowed);
  if (!allowed) throw new Error("output collection not allowlisted on marketplace - cannot list");

  const platform = await mkt.platform();
  const platformBps = Number(await mkt.platformBps());
  console.log("platform:", platform, "platformBps:", platformBps);

  const withdrawBefore: bigint = await mkt.pendingWithdrawals(me);
  console.log("pendingWithdrawals(me) before:", fmt(withdrawBefore), "0G");

  // 1. setApprovalForAll if needed
  const approved = await out.isApprovedForAll(me, MARKET);
  if (!approved) {
    console.log("\n[1/3] setApprovalForAll(marketplace, true) ...");
    const tx = await out.setApprovalForAll(MARKET, true, GAS);
    console.log("  tx:", tx.hash);
    const r = await tx.wait();
    console.log("  mined in block", r.blockNumber);
  } else {
    console.log("\n[1/3] already approved-for-all; skipping");
  }

  // 2. list
  console.log(`\n[2/3] list(output #${TOKEN_ID}, price ${fmt(PRICE)} 0G) ...`);
  const listTx = await mkt.list(OUTPUT, TOKEN_ID, PRICE, GAS);
  console.log("  LIST tx:", listTx.hash);
  const listRcpt = await listTx.wait();
  console.log("  mined in block", listRcpt.blockNumber);
  const listedEv = listRcpt.logs
    .map((l: any) => { try { return mkt.interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === "Listed");
  console.log("  Listed event:", listedEv ? { collection: listedEv.args[0], tokenId: listedEv.args[1].toString(), seller: listedEv.args[2], price: fmt(listedEv.args[3]) } : "NOT FOUND");

  // 3. buy (self-buy)
  console.log(`\n[3/3] buy(output #${TOKEN_ID}) with value ${fmt(PRICE)} 0G ...`);
  const buyTx = await mkt.buy(OUTPUT, TOKEN_ID, { value: PRICE, ...GAS });
  console.log("  BUY tx:", buyTx.hash);
  const buyRcpt = await buyTx.wait();
  console.log("  mined in block", buyRcpt.blockNumber);
  const soldEv = buyRcpt.logs
    .map((l: any) => { try { return mkt.interface.parseLog(l); } catch { return null; } })
    .find((p: any) => p?.name === "Sold");
  if (soldEv) {
    console.log("  Sold event:");
    console.log("    collection     :", soldEv.args[0]);
    console.log("    tokenId        :", soldEv.args[1].toString());
    console.log("    buyer          :", soldEv.args[2]);
    console.log("    seller         :", soldEv.args[3]);
    console.log("    price          :", fmt(soldEv.args[4]), "0G");
    console.log("    royaltyReceiver:", soldEv.args[5]);
    console.log("    royaltyPaid    :", fmt(soldEv.args[6]), "0G");
    console.log("    platformFee    :", fmt(soldEv.args[7]), "0G");
    console.log("    sellerProceeds :", fmt(soldEv.args[8]), "0G");
  } else {
    console.log("  Sold event: NOT FOUND");
  }

  const withdrawAfter: bigint = await mkt.pendingWithdrawals(me);
  console.log("\npendingWithdrawals(me) after:", fmt(withdrawAfter), "0G (recoverable via withdraw())");
  console.log("balance after (pre-withdraw):", fmt(await provider.getBalance(me)), "0G");

  console.log("\n=== TX HASHES ===");
  console.log("LIST:", listTx.hash);
  console.log("BUY :", buyTx.hash);
}

main().then(() => process.exit(0)).catch((e) => { console.error("TRADE FAILED:", e?.shortMessage ?? e?.message ?? e); process.exit(1); });
