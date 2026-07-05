// AURA persistent-memory v2 - THE DUAL WALL, EMBEDDED ON LIVE 0G STORAGE (the on-network headline proof).
//
// The on-network twin of demo-memory-dualwall.ts (which is LOCAL). Same moat, same four walls, but every
// encrypted memory segment is now STORED ON + RETRIEVED FROM real 0G Storage (Galileo testnet): the agent's
// memory is provably EMBEDDED on decentralized storage (the ERC-7857 iNFT model), and the dual wall is shown
// to hold on the REAL 0G bytes. The wall is KEY CUSTODY (ECIES + AES-GCM), unchanged by where bytes live.
//
// Run:   npm run verify:memory:0g          (needs the funded sponsor key in ../.env; spends a little testnet gas)
// Every EVIDENCE_ROOT printed below is a public 0G content address: anyone can download it and see OPAQUE
// AES-GCM ciphertext (embedded proof), and NOBODY without the epoch key can read it (the wall).
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { ethers } from "ethers";
import { recoverSiwePubkey } from "../aura/pubkey.js";
import { zgBackend } from "../aura/memory/zg-store.js";
import { sponsorAddress, sponsorBalance } from "../aura/wallet.js";
import { MemoryService, readIntrinsic, readRelationship } from "../aura/memory/core.js";
import { dualWallTransfer } from "../aura/memory/transfer.js";
import { tryOpenSegment } from "../aura/memory/segment.js";
import { openKeyring } from "../aura/memory/keyring.js";
import { selfReflect } from "../aura/memory/reflect.js";
import type { Manifest, StyleVec } from "../aura/memory/types.js";

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error("  \x1b[31mFAIL:\x1b[0m", msg);
    process.exit(1);
  }
  passed++;
  console.log("  \x1b[32mPASS:\x1b[0m", msg);
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
async function siwePub(w: ethers.HDNodeWallet): Promise<string> {
  return recoverSiwePubkey(`AURA login: ${w.address}`, (await w.signMessage(`AURA login: ${w.address}`)) as `0x${string}`);
}

const STYLE_0: StyleVec = { descriptor: "chiaroscuro portraiture, deep shadow", identityLock: "same subject", negative: "no 3d render", basePolicy: "ref-anchor" };
const STYLE_1: StyleVec = { descriptor: "architectural, warm directional light", identityLock: "same subject", negative: "no 3d render", basePolicy: "ref-anchor" };

async function main() {
  console.log("\n=== AURA persistent-memory v2 - DUAL WALL on LIVE 0G STORAGE (Galileo testnet) ===\n");
  console.log("sponsor:", sponsorAddress(), "| balance:", await sponsorBalance(), "0G");
  const backend = zgBackend("mem-demo");
  const A = ethers.Wallet.createRandom();
  const B = ethers.Wallet.createRandom();
  const aPub = await siwePub(A);
  const bPub = await siwePub(B);
  console.log(`owner A ${A.address}\nbuyer B ${B.address}\n`);
  const evidence: string[] = [];

  // ── A owns the agent: seed memory, write L1 intrinsic + L2 relationship (segments -> LIVE 0G Storage) ──
  const { service, ownerL2Key: aL2Key } = MemoryService.create({ agentId: "NOKTURNE-0G", ownerAddr: A.address, ownerPubkey: aPub, backend });
  const aVault = { walletAddr: A.address, displayName: "Alice", handle: "alice_arts" };
  const aDenylist = [aVault.displayName, aVault.handle, aVault.walletAddr];

  const reflect = selfReflect(
    {
      style: { before: STYLE_0, after: STYLE_1, note: "shifted warmer + architectural over the season" },
      skills: [{ tag: "chiaroscuro", proficiency: 0.9 }],
      tasteNotes: ["leans toward warm, structural compositions", "because my owner Alice kept asking for it"],
      publicWorks: [{ workRoot: "0g://out-1-stairwell-3am", outputNftId: "1", techniqueTags: ["chiaroscuro", "long-exposure"] }],
    },
    "d-epoch0",
    aDenylist,
  );
  console.log("  [0G] uploading A's L1 intrinsic segment...");
  const l1 = await service.appendIntrinsic(reflect.intrinsic);
  console.log(`  [0G] L1 intrinsic embedded at root ${l1.root}`);
  evidence.push(`L1-intrinsic(A) ${l1.root}`);
  ok(l1.root.startsWith("0x"), "A: L1 intrinsic segment is embedded on 0G Storage (got a merkle root)");
  ok(l1.root !== l1.dataHash, "A: SegRef.root is the 0G merkle address, distinct from the sha256 dataHash");

  console.log("  [0G] uploading A's L2 relationship segment...");
  const l2 = await service.appendRelationship(
    [
      { kind: "owner_identity_vault", vault: aVault, ts: "2026-06-30T10:00:00Z" },
      { kind: "chat", turns: [{ role: "owner", text: "Alice: keep it architectural, no faces" }, { role: "agent", text: "noted, no faces" }], ts: "2026-06-30T10:01:00Z" },
      { kind: "preference", subject: "<<OWNER>>", pref: "architectural, no faces", ts: "2026-06-30T10:02:00Z" },
      ...reflect.downgradedToL2,
    ],
    aL2Key,
  );
  console.log(`  [0G] L2 relationship embedded at root ${l2.root}`);
  evidence.push(`L2-relationship(A) ${l2.root}`);

  // A reads its whole world back FROM 0G (download + merkle-verify + decrypt).
  const aL1 = await readIntrinsic(service.manifest, A.privateKey, backend);
  const aL2 = await readRelationship(service.manifest, A.privateKey, backend);
  ok(aL1.length === reflect.intrinsic.length, `A reads its full intrinsic catalog back FROM 0G (${aL1.length} records)`);
  ok(aL2.length >= 3, `A reads its full relationship memory back FROM 0G (${aL2.length} records)`);
  ok(JSON.stringify(aL1).indexOf("Alice") === -1, "WALL-0 (structural): NO owner identity in the transferable L1 layer on 0G");

  const aManifestBefore: Manifest = clone(service.manifest);
  const aL2Ciphertext = await backend.download(l2.root); // pull A's L2 ciphertext straight off 0G (as B could)
  ok(tryOpenSegment(aL2Key, aL2Ciphertext) !== null, "the L2 bytes ON 0G are real, openable ONLY with A's epoch key");

  // ── THE SALE: A -> B. The dual-wall re-seal (keyring only; the immutable 0G bytes are untouched). ──
  console.log("\n  --- A -> B sale: dual-wall re-seal ---\n");
  const { manifestB, freshL2KeyB, newEpoch } = dualWallTransfer(service, { toAddr: B.address, toPubkey: bPub });
  console.log("  [0G] uploading B's fresh L2 relationship segment...");
  const bSeg = await service.appendRelationship([{ kind: "chat", turns: [{ role: "owner", text: "Bob: I love your architectural work" }], ts: "2026-07-01T09:00:00Z" }], freshL2KeyB);
  console.log(`  [0G] B's L2 embedded at root ${bSeg.root}`);
  evidence.push(`L2-relationship(B) ${bSeg.root}`);

  // ── WALL 1: B inherits the FULL intrinsic history, re-downloaded + decrypted FROM 0G ──
  const bL1 = await readIntrinsic(manifestB, B.privateKey, backend);
  ok(bL1.length === aL1.length, `WALL-1: B decrypts the FULL inherited intrinsic catalog FROM 0G (${bL1.length}/${aL1.length})`);
  ok(bL1.some((r) => r.kind === "work_public" && (r as any).workRoot === "0g://out-1-stairwell-3am"), "WALL-1: B sees the agent's actual catalog (OUT-1) from 0G");
  ok(JSON.stringify(bL1).indexOf("Alice") === -1, "WALL-1: the inherited L1 on 0G carries NO prior-owner identity");

  // ── WALL 2: B has a FRESH, clean relationship epoch ──
  const bL2 = await readRelationship(manifestB, B.privateKey, backend);
  ok(bL2.length === 1 && (bL2[0] as any).turns?.[0]?.text.includes("Bob"), "WALL-2: B reads its own clean relationship from 0G, and ONLY its own");
  ok(!JSON.stringify(bL2).includes("Alice") && !JSON.stringify(bL2).includes("no faces"), "WALL-2: A's prefs/identity are ABSENT from everything B can load");

  // ── WALL 3 (THE DUAL WALL, cryptographic): B CANNOT read A's L2 bytes that live on 0G ──
  const bAllKeys = [
    ...openKeyring(B.privateKey, manifestB.intrinsic.keyring).values(),
    ...openKeyring(B.privateKey, manifestB.relationship.keyring).values(),
    freshL2KeyB,
  ];
  ok(!bAllKeys.some((k) => tryOpenSegment(k, aL2Ciphertext) !== null), `WALL-3 (CRYPTO): B holds ${bAllKeys.length} keys; NONE opens A's L2 ciphertext pulled from 0G (opaque AES-GCM)`);
  ok(!Object.keys(manifestB.relationship.keyring).includes(String(aManifestBefore.currentEpoch)), "WALL-3: A's relationship epoch key was NEVER placed in B's keyring");

  // ── WALL 4: A is FORWARD-SECRET ──
  const aL1EpochKey = aManifestBefore.intrinsic.keyring; // A's snapshot has no key for B's fresh epoch
  ok(!Object.keys(aL1EpochKey).includes(String(newEpoch)), "WALL-4: A's retained manifest has NO key for B's fresh epoch (forward secrecy)");
  const bNewL2 = await backend.download(bSeg.root);
  const aOldKeys = [...openKeyring(A.privateKey, aManifestBefore.intrinsic.keyring).values(), ...openKeyring(A.privateKey, aManifestBefore.relationship.keyring).values()];
  ok(!aOldKeys.some((k) => tryOpenSegment(k, bNewL2) !== null), "WALL-4 (CRYPTO): A's OLD keys CANNOT decrypt B's new segment fetched from 0G");

  console.log(`\n=== RESULT: ${passed}/${passed} assertions PASS - the dual wall holds on LIVE 0G Storage ===`);
  console.log("\n  EVIDENCE (public 0G content addresses - download any to see the embedded encrypted memory):");
  for (const e of evidence) console.log("   -", e);
  console.log("\n  Honesty ledger: L2 privacy = CRYPTOGRAPHIC (cipher) | L1 owner-agnosticism = STRUCTURAL (scrubber, RS1)");
  console.log("  Durability = 0G Storage (permanent + PoRA on mainnet; this run is Galileo testnet). The wall is KEY CUSTODY, not a prompt.\n");
}

main().catch((e) => {
  console.error("\nDEMO ERROR:", e?.message ?? e);
  process.exit(1);
});
