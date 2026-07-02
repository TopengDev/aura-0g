// PoC SUITE for the Stage-4 pre-mainnet hardening (audit findings B-1..B-6). OFFLINE + non-destructive:
// runs against a THROWAWAY temp SQLite DB (no 0G, no chain, no real .env DB touched). Each block proves
// the corresponding hole is now closed. Exit 0 = all GREEN, 1 = any RED.
//
//   B-1  fail-closed JWT: prod + unset/default secret THROWS; prod + strong secret ok; dev falls back.
//   B-2  Sybil gen-cap:  per-address lifetime quota + persisted global counter (a 2nd DB connection sees
//                        the committed count = it survives a restart) + one address cannot drain the cap.
//   B-3  create-agent:   a global createGuard bounds sponsor uploads; the refund path decrements.
//   B-4  watcher cap:    summonRetryDecision abandons at the attempt ceiling + backs off; terminal-revert
//                        classification is correct -> a looping revert stops regenerating.
//   B-5  TEE enforced:   the exact enforce guard treats false / "n/a" / "err:..." as NOT-passed (blocks mint).
//   B-6  key split:      3 distinct attestor/sponsor/oracle keys; attestor decoupled from the gas wallet.
//   M2   biz-logic:      genGuardRefund reopens a lifetime slot (a FAILED gen doesn't burn the cap); the
//                        Summon path has its OWN cost cap (isolated from the free-tier gen cap) + refund.
//
// run: cd server && npx tsx src/scripts/poc-hardening.ts
import { tmpdir } from "node:os";
import path from "node:path";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";
import { privateKeyToAccount } from "viem/accounts";

// ── set env BEFORE importing config/ratelimit (they read process.env at module load) ──
const DB_PATH = path.join(tmpdir(), `aura-poc-${process.pid}-${Date.now()}.db`);
process.env.SQLITE_PATH = DB_PATH;
// small, deterministic caps so the PoC is fast + legible.
process.env.AURA_MAX_GENERATIONS = "6";
process.env.AURA_PER_ADDRESS_GEN_QUOTA = "2";
process.env.AURA_MAX_CONCURRENT_GEN = "100"; // don't let concurrency gate the lifetime-cap test
process.env.AURA_MAX_CREATES = "6";
process.env.AURA_PER_ADDRESS_CREATE_QUOTA = "2";
process.env.AURA_MAX_CONCURRENT_CREATE = "100";
// M2: small, deterministic SUMMON caps (separate budget from the free-tier gen cap).
process.env.AURA_MAX_SUMMON_GENERATIONS = "4";
process.env.AURA_PER_ADDRESS_SUMMON_QUOTA = "2";
process.env.AURA_MAX_CONCURRENT_SUMMON_GEN = "100";
// three DISTINCT keys for the B-6 split (deterministic test vectors, NOT real funds).
const SPONSOR_PK = "0x0000000000000000000000000000000000000000000000000000000000000001";
const ATTESTOR_PK = "0x0000000000000000000000000000000000000000000000000000000000000002";
const ORACLE_PK = "0x0000000000000000000000000000000000000000000000000000000000000003";
process.env.SPONSOR_PRIVATE_KEY = SPONSOR_PK;
process.env.ATTESTOR_PRIVATE_KEY = ATTESTOR_PK;
process.env.ORACLE_PRIVATE_KEY = ORACLE_PK;

// ── tiny assert harness ──
let pass = 0;
let fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    fails.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  // dynamic imports AFTER env is set, so config picks up the temp DB + caps.
  const config = await import("../aura/config.js");
  const ratelimit = await import("../aura/ratelimit.js");
  const watcher = await import("../aura/summon-watcher.js");
  const generate = await import("../aura/generate.js");
  const jobs = await import("../aura/jobs.js");

  // ────────────────────────────────────────────────────────────── B-1 (fail-closed JWT)
  console.log("\n[B-1] fail-closed JWT (resolveJwtSecret)");
  check("prod + JWT_SECRET unset -> throws", throws(() => config.resolveJwtSecret({ NODE_ENV: "production" } as NodeJS.ProcessEnv)));
  check(
    "prod + JWT_SECRET = dev default -> throws",
    throws(() =>
      config.resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "dev-only-insecure-secret-change-in-prod" } as NodeJS.ProcessEnv),
    ),
  );
  check("prod + JWT_SECRET blank -> throws", throws(() => config.resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: "   " } as NodeJS.ProcessEnv)));
  {
    const strong = "a".repeat(64);
    const got = !throws(() => config.resolveJwtSecret({ NODE_ENV: "production", JWT_SECRET: strong } as NodeJS.ProcessEnv));
    check("prod + strong JWT_SECRET -> ok (no throw)", got);
  }
  check("dev (no NODE_ENV) + unset -> falls back to dev default (no throw)", config.resolveJwtSecret({} as NodeJS.ProcessEnv) === "dev-only-insecure-secret-change-in-prod");

  // ────────────────────────────────────────────────────────────── B-6 (split the hot key)
  console.log("\n[B-6] split the hot key (3 distinct accessors, attestor off the gas wallet)");
  const sAddr = privateKeyToAccount(config.sponsorPrivateKey() as `0x${string}`).address.toLowerCase();
  const aAddr = privateKeyToAccount(config.attestorPrivateKey() as `0x${string}`).address.toLowerCase();
  const oAddr = privateKeyToAccount(config.oraclePrivateKey() as `0x${string}`).address.toLowerCase();
  check("sponsor / attestor / oracle resolve to 3 DISTINCT addresses", sAddr !== aAddr && aAddr !== oAddr && sAddr !== oAddr, `${sAddr.slice(0, 8)} / ${aAddr.slice(0, 8)} / ${oAddr.slice(0, 8)}`);
  check("attestorIsSplitFromSponsor() true when ATTESTOR_PRIVATE_KEY is set distinctly", config.attestorIsSplitFromSponsor());
  check("attestor key == ATTESTOR_PRIVATE_KEY (not the sponsor key)", config.attestorPrivateKey().toLowerCase() === ATTESTOR_PK.toLowerCase());
  // attestor decoupled-from-sponsor fallback: with ATTESTOR_PRIVATE_KEY UNSET, it falls back to sponsor (zero regression).
  {
    const saved = process.env.ATTESTOR_PRIVATE_KEY;
    delete process.env.ATTESTOR_PRIVATE_KEY;
    check("attestor FALLS BACK to sponsor when ATTESTOR_PRIVATE_KEY unset (zero regression)", config.attestorPrivateKey().toLowerCase() === config.sponsorPrivateKey().toLowerCase());
    check("attestorIsSplitFromSponsor() false when unset", !config.attestorIsSplitFromSponsor());
    process.env.ATTESTOR_PRIVATE_KEY = saved;
  }

  // ────────────────────────────────────────────────────────────── B-2 (Sybil gen-cap)
  console.log("\n[B-2] Sybil gen-cap (per-address quota + persisted global counter)");
  const A = "0x" + "a".repeat(40);
  const B = "0x" + "b".repeat(40);
  const C = "0x" + "c".repeat(40);
  const D = "0x" + "d".repeat(40);
  // address A: quota = 2 -> first two ok, third REJECTED with the per-address reason (cannot drain the cap alone).
  check("addr A gen #1 ok", ratelimit.genGuardAcquire(A).ok);
  ratelimit.genGuardRelease();
  check("addr A gen #2 ok", ratelimit.genGuardAcquire(A).ok);
  ratelimit.genGuardRelease();
  {
    const r = ratelimit.genGuardAcquire(A);
    check("addr A gen #3 BLOCKED by per-address quota (cannot drain shared cap alone)", !r.ok && /per-address/.test(r.reason ?? ""), r.reason ?? "");
  }
  // B + C each take their 2 -> global total now 6 = the cap. A 4th distinct address hits the GLOBAL cap.
  for (const addr of [B, C]) {
    check(`addr ${addr.slice(0, 4)} gen #1 ok`, ratelimit.genGuardAcquire(addr).ok);
    ratelimit.genGuardRelease();
    check(`addr ${addr.slice(0, 4)} gen #2 ok`, ratelimit.genGuardAcquire(addr).ok);
    ratelimit.genGuardRelease();
  }
  {
    const r = ratelimit.genGuardAcquire(D);
    check("addr D BLOCKED by GLOBAL cap once 6 consumed across 3 addrs", !r.ok && /global generation cap/.test(r.reason ?? ""), r.reason ?? "");
  }
  // PERSISTENCE: a SECOND independent DB connection sees the committed global counter (= a restart sees 6, not 0).
  {
    const ro = new Database(DB_PATH, { readonly: true });
    const row = ro.prepare(`SELECT count FROM cost_counters WHERE scope = 'gen:global'`).get() as { count: number } | undefined;
    ro.close();
    check("global gen counter PERSISTED on disk (restart is not a reset-and-replay)", (row?.count ?? -1) === 6, `cost_counters[gen:global]=${row?.count}`);
  }
  // M2-1: genGuardRefund - a FAILED generation must REFUND the lifetime slot, not permanently burn the cap.
  // The gen cap is fully consumed (6/6) and D is blocked (asserted above). One refund reopens exactly one
  // global slot (simulates a transient TEE/0G failure), so a run of failed gens can never starve generation.
  {
    ratelimit.genGuardRefund(A); // simulate one failed generation
    const r = ratelimit.genGuardAcquire(D);
    check("genGuardRefund reopens a global gen slot (a failed gen doesn't burn the lifetime cap)", r.ok, r.reason ?? "");
    if (r.ok) ratelimit.genGuardRelease(); // re-consumes the slot -> gen:global back to 6 for the isolation check below
  }

  // ────────────────────────────────────────────────────────────── B-3 (create-agent global cap)
  console.log("\n[B-3] create-agent global cost cap (createGuard) + refund");
  const E = "0x" + "e".repeat(40);
  const F = "0x" + "f".repeat(40);
  const G = "0x" + "1".repeat(40);
  const H = "0x" + "2".repeat(40);
  check("create addr E #1 ok", ratelimit.createGuardAcquire(E).ok);
  ratelimit.createGuardRelease();
  check("create addr E #2 ok", ratelimit.createGuardAcquire(E).ok);
  ratelimit.createGuardRelease();
  {
    const r = ratelimit.createGuardAcquire(E);
    check("create addr E #3 BLOCKED by per-address create quota", !r.ok && /per-address create/.test(r.reason ?? ""), r.reason ?? "");
  }
  for (const addr of [F, G]) {
    check(`create ${addr.slice(0, 4)} #1 ok`, ratelimit.createGuardAcquire(addr).ok);
    ratelimit.createGuardRelease();
    check(`create ${addr.slice(0, 4)} #2 ok`, ratelimit.createGuardAcquire(addr).ok);
    ratelimit.createGuardRelease();
  }
  {
    const r = ratelimit.createGuardAcquire(H);
    check("create addr H BLOCKED by GLOBAL create cap (sponsor uploads globally bounded)", !r.ok && /global create-agent cap/.test(r.reason ?? ""), r.reason ?? "");
  }
  // refund decrements: after a refund, one slot opens back up for the global cap.
  {
    ratelimit.createGuardRefund(F); // give one slot back (simulates a pre-upload validation failure)
    const r = ratelimit.createGuardAcquire(H);
    check("createGuardRefund frees a global slot (validation-failure path doesn't burn budget)", r.ok);
    if (r.ok) ratelimit.createGuardRelease();
  }

  // ────────────────────────────────────────────────────────────── B-4 (watcher retry cap)
  console.log("\n[B-4] watcher regen amplifier (summonRetryDecision + terminal-revert)");
  const MAX = config.MAX_SUMMON_ATTEMPTS;
  const BACKOFF = config.SUMMON_RETRY_BACKOFF_MS;
  check(`attempts >= MAX (${MAX}) -> ABANDON (stops regenerating, terminal)`, watcher.summonRetryDecision({ attempts: MAX, status: "failed", updatedAtMs: 0, nowMs: BACKOFF * 10 }) === "abandon");
  check("recently-failed (within backoff) -> BACKOFF (not re-generated this poll)", watcher.summonRetryDecision({ attempts: 1, status: "failed", updatedAtMs: 1000, nowMs: 1000 + BACKOFF - 1 }) === "backoff");
  check("failed but past backoff + under cap -> PROCEED", watcher.summonRetryDecision({ attempts: 1, status: "failed", updatedAtMs: 1000, nowMs: 1000 + BACKOFF + 1 }) === "proceed");
  check("pending + under cap -> PROCEED", watcher.summonRetryDecision({ attempts: 0, status: "pending", updatedAtMs: 0, nowMs: BACKOFF * 10 }) === "proceed");
  check('terminal revert "execution reverted: nonce used" -> terminal', watcher.isTerminalRevert("execution reverted: nonce used"));
  check('terminal revert "already settled" -> terminal', watcher.isTerminalRevert("Error: already settled"));
  check('transient revert "bad attestation" -> NOT terminal (a fresh regen makes a fresh sig)', !watcher.isTerminalRevert("execution reverted: bad attestation"));

  // ────────────────────────────────────────────────────────────── B-5 (TEE enforced)
  console.log("\n[B-5] TEE verification enforced (the exact mint-blocking guard)");
  check("ENFORCE_TEE_VERIFICATION default = ON", config.ENFORCE_TEE_VERIFICATION === true);
  check("teeVerifyPassed(true) = true (the only pass verdict)", generate.teeVerifyPassed(true));
  check("teeVerifyPassed(false) = false", !generate.teeVerifyPassed(false));
  check('teeVerifyPassed("n/a") = false', !generate.teeVerifyPassed("n/a"));
  check('teeVerifyPassed("err:timeout") = false', !generate.teeVerifyPassed("err:timeout"));
  // the EXACT condition generateAndProve uses to throw TeeVerificationError (block mint + attestation):
  const wouldBlock = (v: boolean | string) => config.ENFORCE_TEE_VERIFICATION && !generate.teeVerifyPassed(v);
  check('guard BLOCKS mint for verified="n/a"', wouldBlock("n/a"));
  check('guard BLOCKS mint for verified="err:..."', wouldBlock("err:processResponse failed"));
  check("guard BLOCKS mint for verified=false", wouldBlock(false));
  check("guard ALLOWS mint for verified=true", !wouldBlock(true));

  // ────────────────────────────────────────────────────────────── M2 (summon cost guard)
  console.log("\n[M2] summon cost guard (SEPARATE cap + refund; isolated from the free-tier gen cap)");
  const BUYER1 = "0x" + "7".repeat(40);
  const BUYER2 = "0x" + "8".repeat(40);
  const BUYER3 = "0x" + "9".repeat(40);
  // ISOLATION: the free-tier gen cap is fully consumed (6/6 from B-2), yet a summon still acquires -> the
  // paid path draws from a DIFFERENT budget and cannot be starved by free-tier failures (the core M2 fix).
  {
    const r = ratelimit.summonGuardAcquire(BUYER1);
    check("summon acquires even though the free-tier gen cap is exhausted (separate budget)", r.ok, r.reason ?? "");
    if (r.ok) ratelimit.summonGuardRelease();
    ratelimit.summonGuardRefund(BUYER1); // undo that probe so the quota tests below start clean (summon:global -> 0)
  }
  // per-address summon quota (2): BUYER1 twice ok, third blocked by the per-address reason.
  check("summon BUYER1 #1 ok", ratelimit.summonGuardAcquire(BUYER1).ok);
  ratelimit.summonGuardRelease();
  check("summon BUYER1 #2 ok", ratelimit.summonGuardAcquire(BUYER1).ok);
  ratelimit.summonGuardRelease();
  {
    const r = ratelimit.summonGuardAcquire(BUYER1);
    check("summon BUYER1 #3 BLOCKED by per-address summon quota", !r.ok && /per-address summon/.test(r.reason ?? ""), r.reason ?? "");
  }
  // global summon cap (4): BUYER2 takes its 2 -> total 4 = cap -> BUYER3 hits the GLOBAL summon cap.
  check("summon BUYER2 #1 ok", ratelimit.summonGuardAcquire(BUYER2).ok);
  ratelimit.summonGuardRelease();
  check("summon BUYER2 #2 ok", ratelimit.summonGuardAcquire(BUYER2).ok);
  ratelimit.summonGuardRelease();
  {
    const r = ratelimit.summonGuardAcquire(BUYER3);
    check("summon BUYER3 BLOCKED by GLOBAL summon cap once 4 consumed", !r.ok && /global summon generation cap/.test(r.reason ?? ""), r.reason ?? "");
  }
  // refund reopens a global summon slot: a non-fulfilling attempt (transient failure / settled-elsewhere)
  // must not permanently burn the summon cap.
  {
    ratelimit.summonGuardRefund(BUYER2);
    const r = ratelimit.summonGuardAcquire(BUYER3);
    check("summonGuardRefund reopens a global summon slot (non-fulfilling attempt doesn't burn the cap)", r.ok, r.reason ?? "");
    if (r.ok) ratelimit.summonGuardRelease();
  }
  // ISOLATION (persisted): all the summon churn above did NOT touch the free-tier gen counter -> two fully
  // separate on-disk budgets, so free-tier failures can never starve summons (or vice-versa).
  {
    const ro = new Database(DB_PATH, { readonly: true });
    const g = ro.prepare(`SELECT count FROM cost_counters WHERE scope='gen:global'`).get() as { count: number } | undefined;
    const s = ro.prepare(`SELECT count FROM cost_counters WHERE scope='summon:global'`).get() as { count: number } | undefined;
    ro.close();
    check(
      "gen:global untouched by summon churn (fully separate persisted budgets)",
      (g?.count ?? -1) === 6 && s !== undefined,
      `gen:global=${g?.count} summon:global=${s?.count}`,
    );
  }

  // ────────────────────────────────────────────────────────────── M2b (single-mint sentinel)
  console.log("\n[M2b] single-mint sentinel (claimMintAttestation is single-writer -> 1 generation = 1 Relic)");
  {
    const JOB = "gen_poc_singlemint";
    const OWNER = "0x" + "a".repeat(40);
    const N1 = "0x" + "11".repeat(32); // first attestation nonce
    const N2 = "0x" + "22".repeat(32); // a would-be SECOND distinct nonce (must be rejected)
    jobs.createJob(JOB, OWNER, 1, "NOKTURNE", "a test piece");
    check("no attestation before first mint-args (happy path is open)", jobs.getMintAttestation(JOB) === null);
    const first = jobs.claimMintAttestation(JOB, N1, OWNER);
    check("first claim records + returns the fresh nonce (legit first mint)", first === N1);
    // a SECOND call (concurrent first call, or a re-issue attempt with a NEW nonce) must NOT create a
    // second distinct attestation - it returns the ALREADY-issued nonce, so only one sig can ever exist.
    const second = jobs.claimMintAttestation(JOB, N2, "0x" + "b".repeat(40));
    check("second claim CANNOT mint a new distinct nonce (returns the original -> 1 gen = 1 Relic)", second === N1, `returned ${second.slice(0, 10)}`);
    const rec = jobs.getMintAttestation(JOB);
    check("stored attestation is the FIRST nonce + FIRST recipient (second recipient ignored)", rec?.nonce === N1 && rec?.to === OWNER, `${rec?.nonce?.slice(0, 10)} / ${rec?.to?.slice(0, 10)}`);
  }

  // ── summary ──
  console.log(`\n================  ${fail === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${fail} failed  ================`);
  if (fail > 0) console.log("FAILED:", fails.join(", "));
}

main()
  .then(() => {
    try {
      rmSync(DB_PATH, { force: true });
      rmSync(`${DB_PATH}-wal`, { force: true });
      rmSync(`${DB_PATH}-shm`, { force: true });
    } catch {
      /* best-effort temp cleanup */
    }
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error("PoC harness crashed:", e);
    process.exit(2);
  });
