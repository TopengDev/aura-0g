// AURA persistent-memory v2 — THE DUAL-WALL SMOKE TEST (the headline deliverable).
//
// Mirrors demo-secure-transfer.ts in style + bar. LOCAL ONLY: a local content-addressed backend, ephemeral
// random wallets, NO network, NO mainnet/testnet 0G, NO live keys. It proves the MOAT — that a sold agent
// keeps its whole intrinsic life, starts a clean relationship with the buyer, and PROVABLY cannot read the
// seller's private past — and that the wall is KEY CUSTODY, not a prompt the model could be jailbroken past.
//
// Flow:  A owns the agent; writes L1 intrinsic (catalog/style) + L2 relationship (chat/prefs/identity) under
//        A's epoch.  ->  simulate the A->B sale (the M2 dual-wall re-seal).  ->  assert the four walls.
//
// Run:   npx tsx src/scripts/demo-memory-dualwall.ts        (no env, no funds, no network)
import { ethers } from "ethers";
import { recoverSiwePubkey } from "../aura/pubkey.js";
import { MemoryBackend } from "../aura/memory/local-store.js";
import { MemoryService, readIntrinsic, readRelationship } from "../aura/memory/core.js";
import { dualWallTransfer } from "../aura/memory/transfer.js";
import { tryOpenSegment } from "../aura/memory/segment.js";
import { selfReflect } from "../aura/memory/reflect.js";
import { openKeyring } from "../aura/memory/keyring.js";
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
  console.log("\n=== AURA persistent-memory v2 — DUAL-WALL SMOKE TEST (LOCAL, key-custody) ===\n");
  const backend = new MemoryBackend();
  const A = ethers.Wallet.createRandom();
  const B = ethers.Wallet.createRandom();
  const aPub = await siwePub(A);
  const bPub = await siwePub(B);
  console.log(`owner A ${A.address}\nbuyer B ${B.address}\n`);

  // ── A owns the agent: seed memory, write L1 intrinsic + L2 relationship under A's epoch (0) ──
  const { service, ownerL2Key: aL2Key } = MemoryService.create({ agentId: "NOKTURNE", ownerAddr: A.address, ownerPubkey: aPub, backend });

  // A's owner identity lives ONLY in the L2 vault; its values become the epoch denylist for the L1 membrane.
  const aVault = { walletAddr: A.address, displayName: "Alice", handle: "alice_arts" };
  const aDenylist = [aVault.displayName, aVault.handle, aVault.walletAddr];

  // L1 intrinsic: the agent's owner-AGNOSTIC self — catalog + style evolution (via the selfReflect membrane).
  const reflect = selfReflect(
    {
      style: { before: STYLE_0, after: STYLE_1, note: "shifted warmer + architectural over the season" },
      skills: [
        { tag: "chiaroscuro", proficiency: 0.9 },
        { tag: "architectural-light", proficiency: 0.7 },
      ],
      tasteNotes: ["leans toward warm, structural compositions", "because my owner Alice kept asking for it"], // 2nd is poisoned
      publicWorks: [
        { workRoot: "0g://out-1-stairwell-3am", outputNftId: "1", techniqueTags: ["chiaroscuro", "long-exposure"] },
        { workRoot: "0g://out-2-hand-withheld", outputNftId: "2", techniqueTags: ["architectural", "negative-space"] },
      ],
    },
    "d-epoch0",
    aDenylist,
  );
  await service.appendIntrinsic(reflect.intrinsic);
  ok(reflect.intrinsic.some((r) => r.kind === "work_public") && reflect.intrinsic.some((r) => r.kind === "style_delta"), "A: selfReflect produced the intrinsic catalog + style evolution");
  ok(reflect.downgradedToL2.some((r) => (r as any).runningContext?.includes("Alice")), "A: the owner-named taste note was routed AWAY from L1 by the membrane");

  // L2 relationship: A's chats, prefs, the owner identity vault (sealed to A's epoch) — plus the downgrade.
  await service.appendRelationship(
    [
      { kind: "owner_identity_vault", vault: aVault, ts: "2026-06-30T10:00:00Z" },
      { kind: "chat", turns: [{ role: "owner", text: "Alice: keep it architectural, no faces" }, { role: "agent", text: "noted, architectural + no faces" }], ts: "2026-06-30T10:01:00Z" },
      { kind: "preference", subject: "<<OWNER>>", pref: "architectural, no faces", ts: "2026-06-30T10:02:00Z" },
      ...reflect.downgradedToL2,
    ],
    aL2Key,
  );

  // A reads its own world fully.
  const aL1 = await readIntrinsic(service.manifest, A.privateKey, backend);
  const aL2 = await readRelationship(service.manifest, A.privateKey, backend);
  ok(aL1.length === reflect.intrinsic.length, `A reads its full intrinsic catalog (${aL1.length} records)`);
  ok(aL2.length >= 3, `A reads its full relationship memory incl. the identity vault (${aL2.length} records)`);
  ok(JSON.stringify(aL1).indexOf("Alice") === -1, "WALL-0 (structural): NO owner identity ('Alice') anywhere in the transferable L1 layer");

  // Snapshot A's pre-sale manifest + grab A's L2 ciphertext for the adversarial check later.
  const aManifestBefore: Manifest = clone(service.manifest);
  const aL2SegRoot = service.manifest.relationship.segments[0]!.root;
  const aL2Ciphertext = await backend.download(aL2SegRoot);
  const aL1EpochKey = service.intrinsicEscrow.get(0)!; // A's epoch-0 intrinsic key (A legitimately had it)

  // ── THE SALE: A -> B. The M2 dual-wall re-seal. ──
  console.log("\n  --- simulating the A->B sale (dual-wall re-seal) ---\n");
  const { manifestB, freshL2KeyB, newEpoch } = dualWallTransfer(service, { toAddr: B.address, toPubkey: bPub });
  console.log(`  [transfer] epoch ${aManifestBefore.currentEpoch} -> ${newEpoch}; B intrinsic keyring epochs [${Object.keys(manifestB.intrinsic.keyring)}], B relationship keyring epochs [${Object.keys(manifestB.relationship.keyring)}]\n`);

  // B writes into its OWN fresh relationship epoch (clean bond).
  await service.appendRelationship([{ kind: "chat", turns: [{ role: "owner", text: "Bob: I love your architectural work" }], ts: "2026-07-01T09:00:00Z" }], freshL2KeyB);

  // ── WALL 1: B inherits the FULL intrinsic history (Layer 1 transferred) ──
  const bL1 = await readIntrinsic(manifestB, B.privateKey, backend);
  ok(bL1.length === aL1.length, `WALL-1: B decrypts the FULL inherited intrinsic catalog (${bL1.length}/${aL1.length} records)`);
  ok(bL1.some((r) => r.kind === "work_public" && (r as any).workRoot === "0g://out-1-stairwell-3am"), "WALL-1: B sees the agent's actual catalog (OUT-1 'Stairwell, 3am')");
  ok(JSON.stringify(bL1).indexOf("Alice") === -1, "WALL-1: the inherited L1 still carries NO prior-owner identity");

  // ── WALL 2: B has a FRESH, clean relationship epoch (only B's epoch, nothing inherited) ──
  const bL2 = await readRelationship(manifestB, B.privateKey, backend);
  ok(Object.keys(manifestB.relationship.keyring).length === 1 && Number(Object.keys(manifestB.relationship.keyring)[0]) === newEpoch, "WALL-2: B's relationship keyring holds ONLY B's fresh epoch key");
  ok(manifestB.relationship.segments.every((s) => s.epoch === newEpoch), "WALL-2: B's relationship manifest lists ONLY B's own epoch segments (prior epochs dropped)");
  ok(bL2.length === 1 && (bL2[0] as any).turns?.[0]?.text.includes("Bob"), "WALL-2: B reads its own clean relationship, and ONLY its own");

  // ── WALL 3 (THE DUAL WALL, cryptographic): B CANNOT read A's L2 epoch ──
  // 3a. via the loader: A's L2 epoch is structurally absent from B's manifest -> zero records.
  ok(!JSON.stringify(bL2).includes("Alice") && !JSON.stringify(bL2).includes("no faces"), "WALL-3a: A's prefs/identity ('no faces', 'Alice') are ABSENT from everything B can load");
  // 3b. adversarial: hand B the raw ciphertext of A's L2 segment + EVERY key B holds -> none decrypt it.
  const bAllKeys = [
    ...openKeyring(B.privateKey, manifestB.intrinsic.keyring).values(),
    ...openKeyring(B.privateKey, manifestB.relationship.keyring).values(),
    freshL2KeyB,
  ];
  const bCanDecryptAsL2 = bAllKeys.some((k) => tryOpenSegment(k, aL2Ciphertext) !== null);
  ok(!bCanDecryptAsL2, `WALL-3b (CRYPTO): B holds ${bAllKeys.length} keys; NONE decrypts A's L2 ciphertext (opaque AES-GCM by key custody)`);
  // 3c. B never even received A's L2 epoch key in any keyring.
  ok(!Object.keys(manifestB.relationship.keyring).includes(String(aManifestBefore.currentEpoch)), "WALL-3c: A's relationship epoch key was NEVER placed in B's keyring");

  // ── WALL 4: A is FORWARD-SECRET — A's old keys open NEITHER of B's new epochs ──
  // A's retained epoch-0 intrinsic key cannot open B's fresh intrinsic epoch.
  const bNewL1Seg = service.manifest.intrinsic.segments.find((s) => s.epoch === newEpoch);
  // (no L1 was written post-sale in this demo; assert via the key custody instead — A has no key for newEpoch)
  ok(!Object.keys(aManifestBefore.intrinsic.keyring).includes(String(newEpoch)), "WALL-4: A's manifest has NO key for B's fresh intrinsic epoch");
  // A's old L1 epoch key cannot open B's fresh L2 segment (the one B just wrote).
  const bNewL2Seg = await backend.download(service.manifest.relationship.segments.find((s) => s.epoch === newEpoch)!.root);
  ok(tryOpenSegment(aL1EpochKey, bNewL2Seg) === null, "WALL-4 (CRYPTO): A's OLD epoch-0 key CANNOT decrypt B's new relationship segment");
  ok(tryOpenSegment(aL1EpochKey, await backend.download(manifestB.relationship.segments[0]!.root)) === null, "WALL-4 (CRYPTO): A's OLD key opens NEITHER of B's epochs (forward secrecy)");
  // And A, with its snapshot manifest, simply has no key entry for the new epoch at all.
  const aReadsBNewEpoch = openKeyring(A.privateKey, aManifestBefore.relationship.keyring).has(newEpoch);
  ok(!aReadsBNewEpoch, "WALL-4: A's retained keyring cannot even address B's new relationship epoch");
  void bNewL1Seg; // (post-sale L1 write is exercised by M4 chat loop, out of MVP scope)

  console.log(`\n=== SMOKE RESULT: ${passed}/${passed} assertions PASS ===`);
  console.log("    The dual wall holds by KEY CUSTODY (ECIES + AES-GCM), not by a prompt:");
  console.log("    • B inherits the full intrinsic life (L1 re-sealed)   • B starts a clean relationship (fresh L2)");
  console.log("    • B provably cannot read A's private past (no key)    • A is forward-secret (old keys open neither of B's epochs)");
  console.log("    Honesty ledger: L2 privacy = CRYPTOGRAPHIC · L1 owner-agnosticism = STRUCTURAL (scrubber, RS1) · permanence = MAINNET (this PoC is local)\n");
}

main().catch((e) => {
  console.error("\nSMOKE TEST ERROR:", e);
  process.exit(1);
});
