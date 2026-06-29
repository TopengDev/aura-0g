// SERVER-ONLY. SQLite (better-sqlite3, WAL) - replaces the v1 globalThis Map + flat-JSON files.
// Persists: jobs (per-user owned, survive restart), rate-limit counters, the mint index, and the
// per-agent brain AES key + meta. On boot, orphaned in-flight jobs (pending/generating/verifying/
// storing) are marked failed (the process that was driving them is gone).
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SQLITE_PATH } from "./config.js";

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  mkdirSync(path.dirname(SQLITE_PATH), { recursive: true });
  const d = new Database(SQLITE_PATH);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  d.pragma("busy_timeout = 5000");
  migrate(d);
  _db = d;
  return d;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      job_id            TEXT PRIMARY KEY,
      owner             TEXT NOT NULL,           -- lowercased JWT address
      status            TEXT NOT NULL,           -- pending|generating|verifying|storing|done|error
      agent_id          INTEGER NOT NULL,
      agent_name        TEXT NOT NULL,
      prompt            TEXT NOT NULL,
      progress          TEXT NOT NULL DEFAULT '',
      result_json       TEXT,                    -- GenerateJobResult JSON when done
      provenance_json   TEXT,                    -- exact provenance record (for mint-args hashing)
      image_path        TEXT,                    -- absolute path to the generated PNG
      error             TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_owner ON jobs(owner);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

    CREATE TABLE IF NOT EXISTS rate_counters (
      bucket_key  TEXT PRIMARY KEY,
      count       INTEGER NOT NULL,
      reset_at    INTEGER NOT NULL              -- epoch ms
    );

    CREATE TABLE IF NOT EXISTS siwe_nonces (
      nonce       TEXT PRIMARY KEY,
      created_at  INTEGER NOT NULL,             -- epoch ms
      used        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS mint_index (
      token_id        INTEGER PRIMARY KEY,
      job_id          TEXT,
      owner           TEXT,
      creator_agent   INTEGER,
      image_root      TEXT,
      provenance_hash TEXT,
      tee_attestation TEXT,
      seed            TEXT,
      mint_tx         TEXT,
      image_path      TEXT,
      created_at      TEXT
    );

    -- per-agent brain key + meta. Keyed by agentId AFTER the user mints (we also stage by a temp key
    -- BEFORE the agentId is known, then promote). The AES key is server-side custody for now
    -- (per-owner ERC-7857 sealing is the deferred milestone).
    CREATE TABLE IF NOT EXISTS agent_brains (
      ref_key            TEXT PRIMARY KEY,       -- 'agent:<id>' once minted, or 'pending:<uuid>' before
      agent_id           INTEGER,
      owner              TEXT,
      name               TEXT,
      enc_brain_root     TEXT NOT NULL,
      brain_key_hex      TEXT NOT NULL,          -- AES-256 key (server custody)
      canonical_base_root TEXT NOT NULL,
      style_fingerprint  TEXT,
      model_attestation  TEXT,
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_brains_agent ON agent_brains(agent_id);
    CREATE INDEX IF NOT EXISTS idx_brains_root ON agent_brains(enc_brain_root);

    -- ERC-7857 de-mock: each owner's recovered secp256k1 PUBKEY (recovered from their SIWE login sig).
    -- ECIES sealing (sealing.ts) seals the data-key to this pubkey; the re-encryption oracle needs the
    -- BUYER's pubkey to seal a transferred key to them.
    CREATE TABLE IF NOT EXISTS wallet_pubkeys (
      address     TEXT PRIMARY KEY,               -- lowercased
      pubkey      TEXT NOT NULL,                  -- uncompressed secp256k1 pubkey (0x04..)
      updated_at  TEXT NOT NULL
    );
  `);

  // ERC-7857 de-mock: per-owner sealed key + the envelope data-hash on agent_brains. Added via guarded
  // ALTER so existing DBs upgrade in place (CREATE TABLE IF NOT EXISTS won't add columns).
  addColumnIfMissing(d, "agent_brains", "sealed_key", "TEXT");  // ECIES seal of the AES key to the owner
  addColumnIfMissing(d, "agent_brains", "data_hash", "TEXT");   // sha256 of the envelope (contract dataHash)
}

/** Idempotently add a column (better-sqlite3 ALTER throws if it already exists). */
function addColumnIfMissing(d: Database.Database, table: string, column: string, type: string): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** On boot: any job that was mid-flight when the process died can never complete -> mark it failed. */
export function reapOrphanJobs(): number {
  const d = db();
  const now = new Date().toISOString();
  const res = d
    .prepare(
      `UPDATE jobs SET status='error', progress='orphaned', error='service restarted mid-generation',
         updated_at=? WHERE status IN ('pending','generating','verifying','storing')`,
    )
    .run(now);
  return res.changes;
}
