// SERVER-ONLY live verification that CREATE-AGENT rejects a duplicate name with a 409 (the same global name
// uniqueness the fusion pipeline enforces). Calls createAgent() directly with a TAKEN name; the uniqueness
// check fires BEFORE any sponsor-paid 0G upload, so this test mints nothing and spends nothing. A synthetic
// wallet's pubkey is injected first so the request clears the "sign in first" seal gate and actually reaches
// the name check. Run inside the container:
//   docker exec aura-server-1 node dist/scripts/verify-createagent-dup.js [takenName]
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { ethers } from "ethers";
import { createAgent } from "../aura/create-agent.js";
import { storePubkey } from "../aura/pubkey.js";
import { isNameTaken } from "../aura/agents.js";

/** A minimal PNG whose IHDR declares WxH (imageDimensions parses only the header; a 409-on-duplicate returns
 *  BEFORE any real image use, so a header-valid buffer is enough to clear validation). Padded past the 100-byte
 *  floor create-agent requires. */
function headerPng(w: number, h: number): Buffer {
  const b = Buffer.alloc(120);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // PNG signature
  b.writeUInt32BE(13, 8); // IHDR length
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b[24] = 8; // bit depth
  b[25] = 2; // color type (RGB)
  return b;
}

async function main(): Promise<void> {
  const takenName = process.argv[2] ?? "RIOT";
  console.log(`\n=== CREATE-AGENT duplicate-name rejection (name="${takenName}") ===\n`);

  const wallet = ethers.Wallet.createRandom();
  storePubkey(wallet.address, wallet.signingKey.publicKey); // clear the ERC-7857 seal "sign in first" gate
  console.log(`[setup] synthetic owner ${wallet.address.slice(0, 10)}... pubkey injected (test-only).`);
  console.log(`[check] isNameTaken(${JSON.stringify(takenName)}) = ${await isNameTaken(takenName)}  (expect true)`);

  const res = await createAgent({
    owner: wallet.address,
    name: takenName,
    royaltyBps: 700,
    creatorResaleBps: 1000,
    styleDescriptor: "a test blended style descriptor for the duplicate-name gate",
    imageBytes: headerPng(512, 512),
    imageMime: "image/png",
  });
  console.log(`[dup] createAgent(name=${JSON.stringify(takenName)}) -> ${JSON.stringify(res)}`);
  const rejected =
    typeof res === "object" && res !== null && "ok" in res && (res as any).ok === false &&
    (res as any).status === 409 && /already taken/i.test((res as any).error);
  console.log(`[dup] REJECTED with 409 "already taken"? ${rejected}  (expect true)`);

  const novel = "AETHERWYN-" + Date.now().toString(36).toUpperCase();
  const novelTaken = await isNameTaken(novel);
  console.log(`[novel] isNameTaken(${JSON.stringify(novel)}) = ${novelTaken}  (expect false -> a novel-named create would pass the gate)`);

  console.log(`\n=== RESULT: duplicate rejected=${rejected}, novel free=${!novelTaken} ===\n`);
  process.exit(rejected && !novelTaken ? 0 : 1);
}

main().catch((e) => {
  console.error("[verify-createagent-dup] fatal:", e);
  process.exit(1);
});
