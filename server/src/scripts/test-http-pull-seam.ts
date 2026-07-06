// Offline smoke for the HTTP /generate PULL-MODE subject seam (no network, no 0G).
// Proves:
//   1. httpPullSeedRoot is deterministic per (subject, agentId, nonce), varies across nonces, and is a
//      full-width seed (>= PULL_SEED_FLOOR) so it never reads as a legacy decorative seed.
//   2. resolveGenConfig(..., { pullSubject }) on the SEEDED-CATALOG path builds the style-lock-only
//      pullModePrompt (fresh subject rendered, NO "Change only this" subject-lock).
//   3. WITHOUT pullSubject the catalog path keeps its legacy fallback prompt (zero regression).
// The brain path uses the IDENTICAL `pullSubject ? pullModePrompt(...) : legacy` branch (generate.ts
// resolveGenConfig L125-127), so proving the catalog branch proves the seam wiring for both.
import assert from "node:assert";
import { httpPullSeedRoot } from "../aura/gacha.js";
import { PULL_SEED_FLOOR } from "../aura/gacha.js";
import { resolveGenConfig } from "../aura/generate.js";

async function main() {
  // ── 1. httpPullSeedRoot ────────────────────────────────────────────────────────────────────────
  const nonceA = "0x" + "11".repeat(32);
  const nonceB = "0x" + "22".repeat(32);
  const s1 = httpPullSeedRoot("a lone lighthouse in a storm", 3, nonceA);
  const s1again = httpPullSeedRoot("a lone lighthouse in a storm", 3, nonceA);
  const s2 = httpPullSeedRoot("a lone lighthouse in a storm", 3, nonceB); // same subject, diff nonce
  const s3 = httpPullSeedRoot("a quiet tea house at dusk", 3, nonceA); // diff subject
  assert.strictEqual(s1, s1again, "seed must be deterministic for identical (subject, agentId, nonce)");
  assert.notStrictEqual(s1, s2, "a fresh nonce must yield a distinct seed (so imageRoots differ)");
  assert.notStrictEqual(s1, s3, "a distinct subject must yield a distinct seed");
  assert.ok(s1 >= PULL_SEED_FLOOR, "http pull seed must be full-width (>= PULL_SEED_FLOOR), not decorative");
  assert.ok(s1 < (1n << 256n), "seed must fit in uint256");
  console.log("[1] httpPullSeedRoot OK  seed=" + s1.toString().slice(0, 12) + "...  floor-ok  deterministic  varies-by-nonce+subject");

  // ── 2. catalog PULL path -> pullModePrompt ─────────────────────────────────────────────────────
  const subject = "a solitary lighthouse against a storm";
  const pulled = await resolveGenConfig(999, "NOKTURNE", "0x", "edit my avatar", { pullSubject: subject });
  assert.ok(pulled.prompt.includes("In the EXACT signature style of NOKTURNE"), "pull prompt must style-lock to the agent");
  assert.ok(pulled.prompt.includes(subject), "pull prompt must render the supplied SUBJECT");
  assert.ok(/invent a brand-new scene/i.test(pulled.prompt), "pull prompt must forbid reproducing the reference subject");
  assert.ok(!/Change only this/i.test(pulled.prompt), "pull prompt must NOT use the subject-LOCK template");
  console.log("[2] catalog PULL prompt OK  ->  " + pulled.prompt.slice(0, 90) + "...");

  // ── 3. no pullSubject -> legacy fallback (zero regression) ──────────────────────────────────────
  const legacy = await resolveGenConfig(999, "NOKTURNE", "0x", "a cat on a roof", {});
  assert.ok(!/In the EXACT signature style of/i.test(legacy.prompt), "default path must NOT be pull-mode");
  assert.ok(legacy.prompt.includes("a cat on a roof"), "default path renders the user prompt");
  console.log("[3] default (no subject) legacy prompt OK  ->  " + legacy.prompt.slice(0, 90) + "...");

  // ── 4. two distinct subjects -> two distinct pull prompts (=> distinct art) ─────────────────────
  const pA = await resolveGenConfig(4, "NOKTURNE", "0x", "x", { pullSubject: "a lone lighthouse in a storm" });
  const pB = await resolveGenConfig(4, "NOKTURNE", "0x", "x", { pullSubject: "a quiet tea house at dusk" });
  assert.notStrictEqual(pA.prompt, pB.prompt, "distinct subjects must yield distinct prompts");
  console.log("[4] distinct subjects -> distinct prompts OK");

  console.log("\nALL PASS: HTTP pull seam routes `subject` -> pullModePrompt (style-lock-only), seed varies -> distinct art.");
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
