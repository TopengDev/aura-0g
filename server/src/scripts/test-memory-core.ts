// AURA memory v2 — UNIT tests for the M1 core + M3 membrane/scrubber (mechanics, not the transfer).
//
// LOCAL ONLY. No network, no keys beyond ephemeral random wallets. Mirrors the repo's verify-*.ts style
// (no test runner — a runnable tsx assertion script). The dual-wall TRANSFER assertions live in the
// headline smoke test (demo-memory-dualwall.ts); this file proves the layered store + scrubber in isolation.
import { ethers } from "ethers";
import { recoverSiwePubkey } from "../aura/pubkey.js";
import { MemoryBackend } from "../aura/memory/local-store.js";
import { MemoryService, readIntrinsic, readRelationship } from "../aura/memory/core.js";
import { sealSegment, openSegment, tryOpenSegment } from "../aura/memory/segment.js";
import { newEpochKey } from "../aura/memory/keyring.js";
import { scrubText } from "../aura/memory/scrubber.js";
import { selfReflect } from "../aura/memory/reflect.js";
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

async function pubkeyOf(w: ethers.HDNodeWallet): Promise<string> {
  return recoverSiwePubkey(`login:${w.address}`, (await w.signMessage(`login:${w.address}`)) as `0x${string}`);
}

const STYLE_A: StyleVec = { descriptor: "chiaroscuro, deep shadow", identityLock: "same subject", negative: "no 3d", basePolicy: "ref-anchor" };
const STYLE_B: StyleVec = { descriptor: "architectural, warm light", identityLock: "same subject", negative: "no 3d", basePolicy: "ref-anchor" };

async function main() {
  console.log("\n=== AURA memory v2 — M1 core + M3 membrane UNIT tests ===\n");
  const backend = new MemoryBackend();
  const A = ethers.Wallet.createRandom();
  const aPub = await pubkeyOf(A);

  // ── segment primitive: round-trip + the wall in primitive form ──
  const k = newEpochKey();
  const env = sealSegment(k, [{ kind: "skill", tag: "halftone", proficiency: 0.7, ts: "d1" }]);
  ok(openSegment(k, env).length === 1, "segment seals + opens a record batch round-trip");
  ok(tryOpenSegment(newEpochKey(), env) === null, "tryOpenSegment with a WRONG key returns null (the wall, soft)");

  // ── M1: two layers, two keyrings, append + read ──
  const { service, ownerL2Key } = MemoryService.create({ agentId: "AGT-1", ownerAddr: A.address, ownerPubkey: aPub, backend });
  await service.appendIntrinsic([
    { kind: "style_delta", before: STYLE_A, after: STYLE_B, note: "warmed up", ts: "d1" },
    { kind: "skill", tag: "risograph", proficiency: 0.8, ts: "d1" },
  ]);
  await service.appendRelationship(
    [
      { kind: "owner_identity_vault", vault: { walletAddr: A.address, displayName: "Alice", handle: "alice_eth" }, ts: "2026-06-30T10:00:00Z" },
      { kind: "chat", turns: [{ role: "owner", text: "make it warmer" }], ts: "2026-06-30T10:01:00Z" },
    ],
    ownerL2Key,
  );

  const l1 = await readIntrinsic(service.manifest, A.privateKey, backend);
  const l2 = await readRelationship(service.manifest, A.privateKey, backend);
  ok(l1.length === 2, "owner A reads both intrinsic (L1) records");
  ok(l2.length === 2, "owner A reads both relationship (L2) records");
  ok(service.manifest.intrinsic.segments.length === 1 && service.manifest.relationship.segments.length === 1, "manifest tracks one segment per layer");
  ok(Object.keys(service.manifest.intrinsic.keyring).length === 1 && Object.keys(service.manifest.relationship.keyring).length === 1, "two independent keyrings, epoch 0 each");

  // L1 segment must NOT be readable by the L2 key and vice-versa (independent epoch keys per layer).
  const l1Seg = await backend.download(service.manifest.intrinsic.segments[0]!.root);
  ok(tryOpenSegment(ownerL2Key, l1Seg) === null, "the L2 key CANNOT open an L1 segment (keyrings are independent)");

  // a STRANGER (no keys) reads nothing from either layer.
  const S = ethers.Wallet.createRandom();
  ok((await readIntrinsic(service.manifest, S.privateKey, backend)).length === 0, "a stranger reads ZERO intrinsic records (no key)");
  ok((await readRelationship(service.manifest, S.privateKey, backend)).length === 0, "a stranger reads ZERO relationship records (no key)");

  // ── M3: scrubber fail-closed routing ──
  ok(scrubText("leans warm and architectural").ok === true, "scrubber passes clean abstract taste text");
  ok(scrubText("0x1234567890abcdef1234567890abcdef12345678").ok === false, "scrubber rejects a wallet address (format rule)");
  ok(scrubText("ping me at alice@example.com").ok === false, "scrubber rejects an email (format rule)");
  ok(scrubText("vibes like Alice wanted", ["Alice"]).ok === false, "scrubber rejects an epoch-denylisted owner name");
  ok(scrubText("vibes like A l i c e wanted", ["Alice"]).ok === false, "scrubber defeats spaced-out denylist evasion");
  ok(scrubText("ALICE energy", ["Alice"]).ok === false, "scrubber denylist is case-insensitive");
  // HONESTY (RS1): the BASIC scrubber is NOT a complete filter. Ambiguous leet (1-for-l) slips past it.
  // This is the named structural residual — full NER is the fast-follow (M3-full), out of MVP scope.
  ok(scrubText("loves A1ice energy", ["Alice"]).ok === true, "RS1 documented: ambiguous leet (A1ice) SLIPS PAST the basic scrubber (needs M3-full NER)");

  // selfReflect routes a poisoned taste note to L2, keeps clean ones in L1 (fail-closed membrane).
  const r = selfReflect(
    {
      style: { before: STYLE_A, after: STYLE_B, note: "evolved warmer" },
      skills: [{ tag: "architectural-light", proficiency: 0.6 }],
      tasteNotes: ["leans warm and structural", "because my owner Alice loves it"],
    },
    "d2",
    ["Alice"],
  );
  ok(r.intrinsic.some((x) => x.kind === "taste" && (x as any).descriptor.includes("warm and structural")), "selfReflect keeps the CLEAN taste note in L1");
  ok(!r.intrinsic.some((x) => x.kind === "taste" && (x as any).descriptor.includes("Alice")), "selfReflect keeps the owner-named taste note OUT of L1");
  ok(r.downgradedToL2.some((x) => (x as any).runningContext?.includes("Alice")), "selfReflect routes the owner-named note to L2 (not dropped silently)");
  ok(r.dropped.some((d) => d.reason.startsWith("denylist:")), "selfReflect records the membrane catch in the audit trail");
  ok(r.intrinsic.some((x) => x.kind === "style_delta") && r.intrinsic.some((x) => x.kind === "skill"), "selfReflect emits the clean style_delta + skill to L1");

  console.log(`\n=== UNIT RESULT: ${pass}/${pass} assertions PASS (M1 core + M3 membrane) ===\n`);
}

main().catch((e) => {
  console.error("\nUNIT TEST ERROR:", e);
  process.exit(1);
});
