// AURA chat relationship-memory ADAPTER test - the dual wall + the OWNERSHIP GATE, deterministic + offline.
//
// Proves the wiring of chat-memory.ts onto the dual-wall module: (D) the owner's chat round-trips through the
// module segments; (B) the ownerOf GATE fails closed for a stranger AND a FORMER owner (the overclaim this
// task closes); (A) cross-owner isolation - a new owner cannot decrypt the prior owner's segments; (C) the
// dual-wall reset on resale drops the seller's epoch key from custody (forward secrecy, even server-side).
//
// The on-chain ownerOf is driven via the __setOwnerResolver test seam, so ownership + a simulated A->B->A
// resale are deterministic with NO chain. Uses a throwaway temp SQLite DB (nothing real is touched).
// Run:  npx tsx src/scripts/test-chat-memory-wall.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ethers } from "ethers";

// Point the DB at a throwaway file BEFORE anything imports config/db (SQLITE_PATH is read at module load).
process.env.SQLITE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "aura-chatmem-")), "test.db");

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error("  \x1b[31mFAIL:\x1b[0m", msg);
    process.exit(1);
  }
  passed++;
  console.log("  \x1b[32mPASS:\x1b[0m", msg);
};

async function main() {
  console.log("\n=== AURA chat-memory ADAPTER - dual wall + ownership gate (offline, deterministic) ===\n");
  const { appendTurn, loadOwnerMemory, __setOwnerResolver } = await import("../aura/chat-memory.js");
  const { db } = await import("../aura/db.js");

  const agentId = 1;
  const A = ethers.Wallet.createRandom().address.toLowerCase();
  const B = ethers.Wallet.createRandom().address.toLowerCase();
  const stranger = ethers.Wallet.createRandom().address.toLowerCase();
  console.log(`owner A ${A}\nowner B ${B}\nstranger ${stranger}\n`);

  // helper: force the "on-chain" owner the gate sees.
  const setOwner = (o: string) => __setOwnerResolver(async () => o);

  // ── A owns the agent: write two turns, read them back (chat round-trip through the module segments) ──
  setOwner(A);
  await appendTurn(agentId, A, { ts: "2026-07-01T10:00:00Z", ownerText: "my safeword is bluejay", auraText: "noted, kept private", tools: [] });
  await appendTurn(agentId, A, { ts: "2026-07-01T10:01:00Z", ownerText: "make it architectural", auraText: "on it", tools: ["generate_and_mint"] });
  const aView = await loadOwnerMemory(agentId, A);
  ok(!aView.notOwner && aView.records.length === 2, `A (current owner) reads its 2 relationship turns (got ${aView.records.length})`);
  ok(aView.records.some((r) => r.ownerText.includes("bluejay")) && aView.records.some((r) => r.tools.includes("generate_and_mint")), "A's turns round-trip fully (text + tool invocations preserved)");
  ok(aView.blockedSegments === 0, "A has no blocked segments (it is the only epoch so far)");

  // ── GATE: a stranger (never an owner) is failed closed - no records, everything blocked ──
  const strangerView = await loadOwnerMemory(agentId, stranger);
  ok(strangerView.notOwner && strangerView.records.length === 0, "GATE: a stranger (caller != ownerOf) reads NOTHING (fail closed)");
  ok(strangerView.blockedSegments === 2, "GATE: the stranger sees the 2 segments as blocked (memory exists but is not theirs)");

  // a stranger's turn is NOT persisted (a non-owner builds no owner-relationship).
  await appendTurn(agentId, stranger, { ts: "2026-07-01T10:02:00Z", ownerText: "let me in", auraText: "no", tools: [] });
  const segCountAfterStranger = (db().prepare(`SELECT COUNT(*) AS n FROM chat_rel_segments WHERE agent_id=?`).get(agentId) as { n: number }).n;
  ok(segCountAfterStranger === 2, "GATE: the stranger's turn was NOT persisted (still 2 segments)");

  // ── snapshot A's ciphertext + confirm A's epoch key exists (for the forward-secrecy check after resale) ──
  const aSeg = (db().prepare(`SELECT envelope FROM chat_rel_segments WHERE agent_id=? ORDER BY id ASC LIMIT 1`).get(agentId) as { envelope: string }).envelope;
  const aEpochBefore = db().prepare(`SELECT epoch, l2_key_hex, active FROM chat_rel_epochs WHERE agent_id=? AND owner=?`).get(agentId, A) as { epoch: number; l2_key_hex: string | null; active: number };
  ok(aEpochBefore.l2_key_hex !== null && aEpochBefore.active === 1, "A's epoch key is in custody + active while A owns the agent");

  // ── THE RESALE A -> B (simulate the on-chain ownership move) ──
  console.log("\n  --- simulating the A->B resale (dual-wall reset) ---\n");
  setOwner(B);

  // GATE (the overclaim closed): A is now a FORMER owner -> can no longer read its own past.
  const aAfterSale = await loadOwnerMemory(agentId, A);
  ok(aAfterSale.notOwner && aAfterSale.records.length === 0, "GATE: the FORMER owner A reads NOTHING after selling (the closed overclaim)");

  // B gets a fresh, clean, EMPTY relationship epoch; A's segments are counted blocked.
  const bView0 = await loadOwnerMemory(agentId, B);
  ok(!bView0.notOwner && bView0.records.length === 0, "WALL-2: B (new owner) starts a CLEAN, empty relationship");
  ok(bView0.blockedSegments === 2, "WALL-2: A's 2 segments are sealed/blocked to B (not inherited)");

  await appendTurn(agentId, B, { ts: "2026-07-02T09:00:00Z", ownerText: "hello, new here", auraText: "welcome", tools: [] });
  const bView1 = await loadOwnerMemory(agentId, B);
  ok(bView1.records.length === 1 && bView1.records[0].ownerText.includes("new here"), "WALL-2: B reads its OWN clean relationship, and only its own");
  ok(!bView1.records.some((r) => r.ownerText.includes("bluejay")), "WALL-3: A's private 'bluejay' safeword is ABSENT from everything B can load");

  // ── FORWARD SECRECY / DUAL WALL (crypto): A's epoch key is DROPPED from custody; B's key can't open A's seg ──
  const aEpochAfter = db().prepare(`SELECT l2_key_hex, active FROM chat_rel_epochs WHERE agent_id=? AND owner=?`).get(agentId, A) as { l2_key_hex: string | null; active: number };
  ok(aEpochAfter.l2_key_hex === null && aEpochAfter.active === 0, "WALL (forward secrecy): A's epoch key was DROPPED from custody on the resale");
  const bEpoch = db().prepare(`SELECT l2_key_hex FROM chat_rel_epochs WHERE agent_id=? AND owner=? AND active=1`).get(agentId, B) as { l2_key_hex: string };
  const { tryOpenSegment } = await import("../aura/memory/segment.js");
  const bKey = Buffer.from(bEpoch.l2_key_hex, "hex");
  ok(tryOpenSegment(bKey, Buffer.from(aSeg, "hex")) === null, "WALL-3 (crypto): B's epoch key CANNOT decrypt A's segment (opaque AES-GCM by key custody)");

  // ── B sells BACK to A: A does NOT regain the old memory (a fresh epoch, forward-secret across re-acquisition) ──
  console.log("\n  --- simulating B->A resale (A re-acquires) ---\n");
  setOwner(A);
  const aReacquired = await loadOwnerMemory(agentId, A);
  ok(!aReacquired.notOwner && aReacquired.records.length === 0, "FORWARD SECRECY: A re-acquiring the agent does NOT resurrect A's old relationship (fresh epoch)");

  console.log(`\n=== CHAT-MEMORY ADAPTER: ${passed}/${passed} assertions PASS ===`);
  console.log("    Chat runs on the dual-wall module (epoch-keyring + AES-GCM segments); the ownerOf gate is");
  console.log("    resolved on-chain and fails closed; cross-owner isolation + forward secrecy hold by key custody.\n");
  __setOwnerResolver(null); // restore default
}

main().catch((e) => {
  console.error("\nADAPTER TEST ERROR:", e);
  process.exit(1);
});
