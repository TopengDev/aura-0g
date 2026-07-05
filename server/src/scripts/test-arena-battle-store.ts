// OFFLINE test for the Creative Arena battle ART JOURNAL (battle-store.ts) - the phase-4 close of the
// phase-3-flagged read gap. Runs against a THROWAWAY temp SQLite DB (no chain, no 0G, no real .env DB touched):
// it saves a created battle's blind art + theme, reads it back (round-trip), proves INSERT-OR-REPLACE
// idempotency, and proves an unknown battle degrades to null (the read then serves on-chain-only). Exit 0 = all
// GREEN, 1 = any RED.
//
// run: cd server && npx tsx src/scripts/test-arena-battle-store.ts
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

// ── set env BEFORE importing db/config (they read process.env at module load) ──
process.env.SQLITE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "aura-battlestore-")), "test.db");

// type-only import is erased at runtime, so it does NOT load config before the env is set above.
import type { CreateBattleResult } from "../aura/game/arena.js";

let pass = 0;
const ok = (c: boolean, m: string) => {
  if (!c) {
    console.error("  \x1b[31mFAIL:\x1b[0m", m);
    process.exit(1);
  }
  pass++;
  console.log("  \x1b[32mPASS:\x1b[0m", m);
};

async function main(): Promise<void> {
  // dynamic import AFTER SQLITE_PATH is set so the store binds to the throwaway DB.
  const { saveBattleArt, getBattleArt } = await import("../aura/game/battle-store.js");

  console.log("\n=== AURA arena battle-store - blind-art journal (browsable-battle read gap) ===\n");

  const battle: CreateBattleResult = {
    battleId: 42,
    agentA: 3,
    agentB: 7,
    theme: { seed: "0xabc123", subjectProse: "a lone lighthouse against a bruised storm sky" },
    commitDur: 3600,
    revealDur: 3600,
    images: [
      { agentId: 3, imageRoot: "0g://root-A", seed: "111", provenanceHash: "0xpa", teeAttestation: "0xta", teeVerified: true, model: "qwen/qwen-image-edit-2511" },
      { agentId: 7, imageRoot: "0g://root-B", seed: "222", provenanceHash: "0xpb", teeAttestation: "0xtb", teeVerified: "n/a", model: "qwen/qwen-image-edit-2511" },
    ],
    seedBlind: true,
  };

  // 1. an unknown battle returns null (the read then serves on-chain-only = the pre-phase-4 behaviour).
  ok(getBattleArt(999) === null, "unknown battle -> null (read degrades to on-chain-only, honest)");

  // 2. save + round-trip the art + theme.
  saveBattleArt(battle);
  const got = getBattleArt(42);
  ok(got !== null, "saved battle art is retrievable by battleId");
  ok(got!.agentA === 3 && got!.agentB === 7, "agents A/B round-trip");
  ok(got!.theme.seed === "0xabc123" && got!.theme.subjectProse === battle.theme.subjectProse, "shared theme (seed + prose) round-trips");
  ok(got!.commitDur === 3600 && got!.revealDur === 3600, "commit/reveal durations round-trip");
  ok(got!.images.length === 2, "both blind art pieces round-trip");
  ok(got!.images[0].imageRoot === "0g://root-A" && got!.images[1].imageRoot === "0g://root-B", "each piece's imageRoot round-trips (the art the crowd judges)");
  ok(got!.images[0].agentId === 3 && got!.images[1].agentId === 7, "piece->agent mapping preserved (blinding is a UI concern; A/B are public on-chain)");
  ok(got!.images[1].teeVerified === "n/a", "non-boolean teeVerified (string) round-trips faithfully");

  // 3. INSERT OR REPLACE idempotency: re-saving the same battleId with new art overwrites (no dup row).
  const updated: CreateBattleResult = { ...battle, theme: { seed: "0xdef456", subjectProse: "a rewritten theme" } };
  saveBattleArt(updated);
  const got2 = getBattleArt(42);
  ok(got2!.theme.seed === "0xdef456" && got2!.theme.subjectProse === "a rewritten theme", "re-save overwrites (INSERT OR REPLACE, idempotent on re-create)");

  console.log(`\n=== arena-battle-store: ${pass}/${pass} assertions PASS (blind-art journal round-trip) ===\n`);
}

main().catch((e) => {
  console.error("\narena-battle-store TEST ERROR:", e);
  process.exit(1);
});
