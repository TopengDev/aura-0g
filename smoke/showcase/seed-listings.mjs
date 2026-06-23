// Seed marketplace listings for chosen outputs (+ optionally one agent) at low demo prices.
// usage: node seed-listings.mjs '[{"kind":"output","tokenId":7,"price":"0.001"}, {"kind":"agent","tokenId":3,"price":"0.05"}]'
// Resume-safe: skips a (collection,tokenId) that already has an active listing.
import { decodeEventLog } from "viem";
import {
  walletClient, publicClient, account, CONTRACTS, MKT_ABI, OUT_ABI, pollReceipt, parseEther,
} from "./lib.mjs";

const spec = JSON.parse(process.argv[2] || "[]");
if (!spec.length) { console.error("pass a JSON array of {kind,tokenId,price}"); process.exit(1); }

const REG_ERC = [
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
];

const collFor = (kind) => (kind === "agent" ? CONTRACTS.agentRegistry : CONTRACTS.outputNFT);

async function ensureApproval(kind) {
  const coll = collFor(kind);
  const abi = kind === "agent" ? REG_ERC : OUT_ABI;
  const approved = await publicClient.readContract({ address: coll, abi, functionName: "isApprovedForAll", args: [account.address, CONTRACTS.marketplace] });
  if (approved) { console.log(`  approval(${kind}): already true`); return; }
  console.log(`  approval(${kind}): setting...`);
  const h = await walletClient.writeContract({ address: coll, abi, functionName: "setApprovalForAll", args: [CONTRACTS.marketplace, true] });
  const r = await pollReceipt(h);
  console.log(`  approval(${kind}) tx ${h.slice(0, 18)} status=${r.status}`);
}

async function alreadyListed(kind, tokenId) {
  const coll = collFor(kind);
  const key = await publicClient.readContract({ address: CONTRACTS.marketplace, abi: MKT_ABI, functionName: "listingKey", args: [coll, BigInt(tokenId)] });
  const [, , active] = await publicClient.readContract({ address: CONTRACTS.marketplace, abi: MKT_ABI, functionName: "listings", args: [key] });
  return Boolean(active);
}

// approve each kind once up front
const kinds = [...new Set(spec.map((s) => s.kind))];
for (const k of kinds) await ensureApproval(k);

for (const s of spec) {
  const coll = collFor(s.kind);
  console.log(`--- list ${s.kind} #${s.tokenId} @ ${s.price} 0G ---`);
  if (await alreadyListed(s.kind, s.tokenId)) { console.log(`  SKIP (already active listing)`); continue; }
  const h = await walletClient.writeContract({
    address: CONTRACTS.marketplace, abi: MKT_ABI, functionName: "list",
    args: [coll, BigInt(s.tokenId), parseEther(String(s.price))],
  });
  console.log(`  list tx ${h.slice(0, 18)}`);
  const r = await pollReceipt(h);
  console.log(`  status=${r.status} block=${r.blockNumber}`);
}

console.log("=== listings seeded ===");
process.exit(0);
