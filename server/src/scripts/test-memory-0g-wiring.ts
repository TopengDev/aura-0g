// AURA memory v2 - HERMETIC unit test for the 0G STORAGE backend wiring (zg-store.ts). OFFLINE, no keys, no
// network: an INJECTED in-memory ZgStoreOps stands in for 0G Storage so this runs in `npm test`/CI. It proves
// (1) ZgStorageBackend is a correct SegmentBackend (store->root, download->bytes, has advisory), and (2) the
// full dual wall holds THROUGH it, even when the store root differs from the sha256 dataHash (the real 0G
// shape: merkle root != sha256), which is the invariant the live 0G demo relies on. The live network proof
// is src/scripts/demo-memory-0g-storage.ts (funded, testnet); this is its deterministic offline twin.
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { recoverSiwePubkey } from "../aura/pubkey.js";
import { ZgStorageBackend, type ZgStoreOps } from "../aura/memory/zg-store.js";
import { MemoryService, readIntrinsic, readRelationship } from "../aura/memory/core.js";
import { dualWallTransfer } from "../aura/memory/transfer.js";
import { tryOpenSegment } from "../aura/memory/segment.js";
import { openKeyring } from "../aura/memory/keyring.js";
import type { StyleVec } from "../aura/memory/types.js";

let pass = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error("  \x1b[31mFAIL:\x1b[0m", m);
    process.exit(1);
  }
  pass++;
  console.log("  \x1b[32mPASS:\x1b[0m", m);
};

async function siwePub(w: ethers.HDNodeWallet): Promise<string> {
  return recoverSiwePubkey(`AURA login: ${w.address}`, (await w.signMessage(`AURA login: ${w.address}`)) as `0x${string}`);
}

/**
 * In-memory ZgStoreOps that MIMICS 0G Storage: the "merkle root" is DELIBERATELY a different scheme from the
 * module's sha256 dataHash (keccak-ish domain-separated), so root != dataHash - exactly the real-0G shape.
 * Content-addressed + idempotent (same bytes -> same root), like storage.ts store().
 */
function fakeZgOps(): { ops: ZgStoreOps; uploads: () => number } {
  const blobs = new Map<string, Buffer>();
  let uploads = 0;
  const merkleRoot = (b: Buffer) => "0x" + createHash("sha256").update(Buffer.concat([Buffer.from("0g-merkle:"), b])).digest("hex");
  return {
    uploads: () => uploads,
    ops: {
      async store(bytes: Buffer): Promise<string> {
        const root = merkleRoot(bytes);
        if (!blobs.has(root)) {
          blobs.set(root, Buffer.from(bytes));
          uploads++;
        }
        return root;
      },
      async download(root: string): Promise<Buffer> {
        const b = blobs.get(root);
        if (!b) throw new Error(`fake-0g: no blob for root ${root}`);
        return Buffer.from(b);
      },
    },
  };
}

const STYLE_0: StyleVec = { descriptor: "chiaroscuro portraiture, deep shadow", identityLock: "same subject", negative: "no 3d render", basePolicy: "ref-anchor" };
const STYLE_1: StyleVec = { descriptor: "architectural, warm directional light", identityLock: "same subject", negative: "no 3d render", basePolicy: "ref-anchor" };

async function main() {
  console.log("\n=== AURA memory v2 - 0G STORAGE backend wiring (HERMETIC, injected ops) ===\n");
  const { ops, uploads } = fakeZgOps();
  const backend = new ZgStorageBackend(ops);
  const A = ethers.Wallet.createRandom();
  const B = ethers.Wallet.createRandom();
  const aPub = await siwePub(A);
  const bPub = await siwePub(B);

  // ── backend contract: store -> root, download -> exact bytes, root address is 0G-shaped (!= sha256) ──
  const probe = Buffer.from("hello-0g-memory");
  const r = await backend.store(probe);
  ok(r.startsWith("0x") && r.length === 66, "store() returns a 0x 0G-shaped root");
  ok(Buffer.compare(await backend.download(r), probe) === 0, "download(root) returns byte-identical bytes");
  ok(backend.has(r) === true, "has(root) advisory is true after store");
  ok(backend.has("0x" + "00".repeat(32)) === false, "has(unknown) advisory is false");
  const sha = "0x" + createHash("sha256").update(probe).digest("hex");
  ok(r !== sha, "0G root differs from the sha256 dataHash (faithful 0G shape: merkle root != dataHash)");

  // ── the FULL dual wall must hold THROUGH the 0G backend (segments addressed by 0G root, not dataHash) ──
  const { service, ownerL2Key: aL2Key } = MemoryService.create({ agentId: "WIRE-TEST", ownerAddr: A.address, ownerPubkey: aPub, backend });
  await service.appendIntrinsic([
    { kind: "style_delta", before: STYLE_0, after: STYLE_1, ts: "d0" },
    { kind: "work_public", workRoot: "0g://out-1", outputNftId: "1", techniqueTags: ["chiaroscuro"], ts: "d0" },
  ]);
  await service.appendRelationship([
    { kind: "chat", turns: [{ role: "owner", text: "Alice: no faces" }, { role: "agent", text: "noted" }], ts: "2026-06-30T10:00:00Z" },
  ], aL2Key);

  // the SegRef root (0G address) must NOT equal its sha256 dataHash - proves readLayer downloads by root, not hash
  const l1ref = service.manifest.intrinsic.segments[0]!;
  ok(l1ref.root !== l1ref.dataHash, "SegRef.root (0G address) != SegRef.dataHash (sha256) - the real-0G split");

  const aL1 = await readIntrinsic(service.manifest, A.privateKey, backend);
  const aL2 = await readRelationship(service.manifest, A.privateKey, backend);
  ok(aL1.length === 2, "A reads its full intrinsic catalog back from the 0G backend");
  ok(aL2.length === 1, "A reads its relationship memory back from the 0G backend");

  // grab A's L2 ciphertext straight from the backend (as an adversary B would) for the crypto wall check
  const aL2Root = service.manifest.relationship.segments[0]!.root;
  const aL2Ciphertext = await backend.download(aL2Root);

  // ── the sale: A -> B (dual-wall re-seal; touches only the keyring, backend bytes are immutable) ──
  const { manifestB, freshL2KeyB } = dualWallTransfer(service, { toAddr: B.address, toPubkey: bPub });
  await service.appendRelationship([{ kind: "chat", turns: [{ role: "owner", text: "Bob: love it" }], ts: "2026-07-01T09:00:00Z" }], freshL2KeyB);

  const bL1 = await readIntrinsic(manifestB, B.privateKey, backend);
  ok(bL1.length === aL1.length, "WALL-1: B inherits the FULL intrinsic catalog from 0G (re-sealed)");
  const bL2 = await readRelationship(manifestB, B.privateKey, backend);
  ok(bL2.length === 1 && !JSON.stringify(bL2).includes("Alice"), "WALL-2: B reads ONLY its own clean relationship (A's prefs absent)");

  const bAllKeys = [
    ...openKeyring(B.privateKey, manifestB.intrinsic.keyring).values(),
    ...openKeyring(B.privateKey, manifestB.relationship.keyring).values(),
    freshL2KeyB,
  ];
  ok(!bAllKeys.some((k) => tryOpenSegment(k, aL2Ciphertext) !== null), `WALL-3 (CRYPTO): B holds ${bAllKeys.length} keys; NONE opens A's L2 bytes fetched from 0G`);

  ok(uploads() >= 4, `evidence: ${uploads()} distinct segments were pushed through the 0G store() path`);
  console.log(`\n=== 0G wiring test: ${pass}/${pass} PASS - ZgStorageBackend is a correct SegmentBackend; dual wall holds on 0G-addressed bytes ===\n`);
}

main().catch((e) => {
  console.error("\n0G WIRING TEST ERROR:", e?.message ?? e);
  process.exit(1);
});
