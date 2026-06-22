// CP3 - 0G STORAGE round-trip on Turbo (server-side, Node).
// Fund-free first (local merkle root + indexer reachability), then a REAL upload→download→byte-verify.
import { ethers } from "ethers";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
// GOTCHA: @0glabs/0g-ts-sdk@0.3.3 (npm "latest") is STALE - its submit ABI (selector 0xef3e12dc)
// no longer matches the live Galileo flow contract (expects 0xbc8c11f8) → every upload reverts.
// The MAINTAINED storage SDK is @0gfoundation/0g-ts-sdk@1.2.8. Use it.
import { Indexer, MemData, defaultUploadOption } from "@0gfoundation/0g-ts-sdk";
import { GALILEO, privateKey } from "./config.js";

mkdirSync("storage-out", { recursive: true });

const provider = new ethers.JsonRpcProvider(GALILEO.rpc);
const signer = new ethers.Wallet(privateKey(), provider);
const indexer = new Indexer(GALILEO.storageIndexerTurbo);

// A representative provenance record (what the build stores alongside each artwork).
const provenance = {
  agentId: 1, agentName: "NOKTURNE",
  model: "qwen/qwen-image-edit-2511",
  prompt: "a small coffee shop at night, chiaroscuro noir…",
  seed: 42,
  teeAttestation: "TeeML/dstack (smoke-test placeholder)",
  ts: "2026-06-21T00:00:00Z",
};
const payload = Buffer.from(JSON.stringify(provenance, null, 2), "utf8");
writeFileSync("storage-out/provenance.json", payload);

// --- FUND-FREE: local merkle root hash ---
const mem = new MemData(payload);
const [tree, mErr] = await mem.merkleTree();
if (mErr) throw mErr;
const localRoot = tree?.rootHash();
console.log("=== FUND-FREE ===");
console.log("payload bytes:", payload.length);
console.log("local merkle rootHash:", localRoot);

// --- FUND-FREE: indexer reachability ---
try {
  const nodes = await indexer.getShardedNodes();
  const n = (nodes as any)?.trusted?.length ?? (nodes as any)?.length ?? "?";
  console.log("indexer reachable (Turbo). sharded/trusted nodes:", n);
} catch (e: any) {
  console.log("indexer reachability note:", e?.message?.slice(0, 140));
}

console.log("\n=== REAL UPLOAD (needs gas + storage fee) ===");
console.log("balance:", ethers.formatEther(await provider.getBalance(signer.address)), "0G");

// GOTCHA: with fee=0 the SDK auto-computes via calculatePrice(), but the flow contract's submit()
// reverts require(false) on the exact amount (rounding/padding). Override with a small padded fee.
const uploadOpt = { ...(defaultUploadOption as any) }; // fee:0 → SDK auto-computes from market price
// cast: 0g-ts-sdk's Signer type comes from a duplicate ethers instance (ESM vs CJS) - runtime-fine.
const [res, upErr] = await indexer.upload(mem, GALILEO.rpc, signer as any, uploadOpt);
if (upErr) {
  console.log("UPLOAD ERROR:", String(upErr).slice(0, 300));
} else {
  const r = res as any; // 1.2.8 returns single {txHash,rootHash,txSeq} | batch {…es[]}
  console.log("✅ uploaded. rootHash:", r.rootHash, "txHash:", r.txHash);
  console.log("rootHash matches local merkle:", r.rootHash === localRoot);

  // --- DOWNLOAD by root hash → byte-verify ---
  const outPath = "storage-out/downloaded-provenance.json";
  const dErr = await indexer.download(r.rootHash, outPath, true);
  if (dErr) {
    console.log("DOWNLOAD ERROR:", String(dErr).slice(0, 300));
  } else {
    const got = readFileSync(outPath);
    const identical = Buffer.compare(got, payload) === 0;
    console.log("✅ downloaded", got.length, "bytes. byte-identical round-trip:", identical);
    writeFileSync("storage-out/storage-result.json", JSON.stringify(
      { rootHash: r.rootHash, txHash: r.txHash, bytes: payload.length, byteIdentical: identical,
        localRootMatches: r.rootHash === localRoot }, null, 2));
  }
}
console.log("\nbalance after:", ethers.formatEther(await provider.getBalance(signer.address)), "0G");
