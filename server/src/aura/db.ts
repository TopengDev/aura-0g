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

    -- B-2/B-3: PERSISTED lifetime cost counters (the sponsor-spend budget), scope-keyed:
    --   'gen:global'            -> total lifetime generations (bounds sponsor compute spend)
    --   'gen:addr:<address>'    -> per-address lifetime generations (anti-Sybil on the shared gen cap)
    --   'create:global'         -> total lifetime create-agents (bounds sponsor 0G-storage spend)
    --   'create:addr:<address>' -> per-address lifetime create-agents (anti-Sybil on the create cap)
    -- Persisted (not in-process) so a restart is NOT a reset-and-replay of the spend budget.
    CREATE TABLE IF NOT EXISTS cost_counters (
      scope  TEXT PRIMARY KEY,
      count  INTEGER NOT NULL DEFAULT 0
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

    -- Summon fulfillment watcher (CP2). One row per on-chain Summoned request; the on-chain
    -- requests(id).settled flag is the source of truth, this table is the off-chain work journal
    -- (idempotent + retry-safe). status: pending|generating|fulfilling|fulfilled|refunded|expired|failed.
    CREATE TABLE IF NOT EXISTS summon_requests (
      request_id      INTEGER PRIMARY KEY,
      agent_id        INTEGER NOT NULL,
      agent_name      TEXT,
      buyer           TEXT NOT NULL,
      fee             TEXT NOT NULL,            -- wei, as a decimal string
      deadline        INTEGER NOT NULL,         -- unix seconds
      status          TEXT NOT NULL DEFAULT 'pending',
      progress        TEXT,                     -- human-readable stage line for the ~42s summon UX
      image_root      TEXT,
      provenance_hash TEXT,
      tee_attestation TEXT,
      seed            TEXT,
      nonce           TEXT,                     -- the bytes32 used for the fulfill mint (replay guard)
      token_id        INTEGER,                  -- minted output tokenId once fulfilled
      fulfill_tx      TEXT,
      attempts        INTEGER NOT NULL DEFAULT 0,
      error           TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_summon_status ON summon_requests(status);

    -- single-row scan cursor (last fully-scanned block) so a restart resumes, never re-scans from 0.
    CREATE TABLE IF NOT EXISTS summon_watcher_state (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      cursor_block  INTEGER NOT NULL
    );

    -- Creative Arena: the off-chain ART JOURNAL for a battle (the on-chain ArenaVote state is the source of
    -- truth for the VOTE; this table holds the blind art + shared theme generated at createBattle so a battle
    -- BROWSED later - not just freshly created in-session - can render the two pieces + the theme, not only the
    -- on-chain tally. Keyed by the on-chain battleId. Nothing here is secret (the theme derives from the public
    -- createBattle block hash; the agents A/B are public on-chain); the VOTE stays blind via commit-reveal.
    CREATE TABLE IF NOT EXISTS arena_battles (
      battle_id     INTEGER PRIMARY KEY,
      agent_a       INTEGER NOT NULL,
      agent_b       INTEGER NOT NULL,
      theme_seed    TEXT NOT NULL,
      subject_prose TEXT NOT NULL,
      commit_dur    INTEGER NOT NULL,
      reveal_dur    INTEGER NOT NULL,
      images_json   TEXT NOT NULL,            -- JSON of BattleImage[] [A,B] (imageRoot + provenance + tee)
      created_at    TEXT NOT NULL
    );

    -- Chat PERSONA store (the Aura's SOUL for chat). Mirrors agent_brains: staged by enc_brain_root at
    -- create (agent_id NULL), promoted to the concrete agent_id at /agents/confirm-mint. This is the
    -- chat-readable meta (voice/lore/aesthetic) for USER-created auras, which are NOT in the hardcoded
    -- catalog and would otherwise fall through to the flat generic fallbackMeta. Catalog auras keep their
    -- hand-written meta and never touch this table. Nothing here is secret (it is public display voice).
    CREATE TABLE IF NOT EXISTS agent_personas (
      ref_key             TEXT PRIMARY KEY,       -- 'agent:<id>' once minted, or 'pending:<uuid>' before
      agent_id            INTEGER,
      enc_brain_root      TEXT NOT NULL,          -- the join key used to promote pending -> agent_id
      name                TEXT NOT NULL,
      aesthetic           TEXT NOT NULL,          -- refined one-line style (the FLOOR = raw styleDescriptor)
      signature_character TEXT,                   -- the user's signatureCharacter (a strong voice on its own)
      personality         TEXT,                   -- LLM-derived first-person voice (null = floor only)
      lore                TEXT,                   -- LLM-derived origin myth (null = floor only)
      tagline             TEXT,                   -- one-line tagline (floor: a simple derived line)
      rarity              TEXT,
      derived             INTEGER NOT NULL DEFAULT 0, -- 1 once the LLM enrichment landed, 0 = floor only
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_personas_agent ON agent_personas(agent_id);
    CREATE INDEX IF NOT EXISTS idx_personas_root ON agent_personas(enc_brain_root);

    -- ERC-7857 de-mock: each owner's recovered secp256k1 PUBKEY (recovered from their SIWE login sig).
    -- ECIES sealing (sealing.ts) seals the data-key to this pubkey; the re-encryption oracle needs the
    -- BUYER's pubkey to seal a transferred key to them.
    CREATE TABLE IF NOT EXISTS wallet_pubkeys (
      address     TEXT PRIMARY KEY,               -- lowercased
      pubkey      TEXT NOT NULL,                  -- uncompressed secp256k1 pubkey (0x04..)
      updated_at  TEXT NOT NULL
    );

    -- Paid open-market AGENT SALE (Flow B, server-custodian escrow). A LISTING is the seller's standing
    -- priced offer for one agent (AuraINFT tokenId); at most one active listing per agent. Recorded by
    -- POST /agents/:id/sale/list (owner-only); read by GET /market/agents. Off-chain (the priced open
    -- market runs through the custodian, NOT the AuraMarketplace, whose safeTransferFrom reverts on AuraINFT).
    CREATE TABLE IF NOT EXISTS agent_sale_listings (
      agent_id    INTEGER PRIMARY KEY,            -- the AuraINFT tokenId (one active listing per agent)
      seller      TEXT NOT NULL,                  -- lowercased on-chain owner at list time
      price_wei   TEXT NOT NULL,                  -- decimal wei string (money => exact integer, NEVER a float)
      active      INTEGER NOT NULL DEFAULT 1,     -- 1 = for sale; 0 = sold / cancelled / superseded
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- One buyer's IN-FLIGHT purchase. It holds REAL FUNDS between commit and settle, so it is PERSISTENT
    -- here (SQLite, survives restart) - NEVER the in-memory transfer pending map. Lifecycle:
    --   committed -> (buyer pays custodian) -> settle verifies payment -> transfer -> split -> settled
    --                                        \-> deadline passes, unsettled -> refund -> refunded/expired
    -- rekey_json persists the prepared re-encryption (PendingRekey) so a crash mid-settle is resumable.
    CREATE TABLE IF NOT EXISTS agent_sale_escrows (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id           INTEGER NOT NULL,
      seller             TEXT NOT NULL,           -- lowercased seller (snapshot at commit)
      buyer              TEXT NOT NULL,           -- lowercased buyer
      price_wei          TEXT NOT NULL,           -- decimal wei snapshot at commit (the listing price then)
      custodian          TEXT NOT NULL,           -- lowercased platform wallet the buyer pays
      deadline           INTEGER NOT NULL,        -- unix seconds; refundable after this if unsettled
      status             TEXT NOT NULL DEFAULT 'committed', -- committed|settled|refunded|expired|failed
      payment_tx         TEXT,                    -- the buyer->custodian funding tx (verified before settle)
      rekey_json         TEXT,                    -- the prepared PendingRekey (money-adjacent; persisted)
      transfer_tx        TEXT,                    -- the platform-submitted AuraINFT.transfer tx
      splits_json        TEXT,                    -- the settled split legs (royalty/platformFee/seller)
      relationship_epoch INTEGER,                 -- the buyer's fresh memory epoch after confirm
      error              TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sale_escrow_agent ON agent_sale_escrows(agent_id);
    CREATE INDEX IF NOT EXISTS idx_sale_escrow_status ON agent_sale_escrows(status);
    CREATE INDEX IF NOT EXISTS idx_sale_escrow_buyer ON agent_sale_escrows(buyer);
    -- A single buyer->custodian funding tx may back AT MOST ONE escrow (double-spend guard). Partial unique
    -- index so many NULL (pre-payment) rows coexist while a set payment_tx is globally unique.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_escrow_paytx ON agent_sale_escrows(payment_tx) WHERE payment_tx IS NOT NULL;
  `);

  // ERC-7857 de-mock: per-owner sealed key + the envelope data-hash on agent_brains. Added via guarded
  // ALTER so existing DBs upgrade in place (CREATE TABLE IF NOT EXISTS won't add columns).
  addColumnIfMissing(d, "agent_brains", "sealed_key", "TEXT");  // ECIES seal of the AES key to the owner
  addColumnIfMissing(d, "agent_brains", "data_hash", "TEXT");   // sha256 of the envelope (contract dataHash)

  // gacha-depth: the BLOCK NUMBER the Summoned event landed in (captured at scan-time from the event).
  // The watcher fetches that block's hash at gen-time to root the deterministic pull seed (closes buyer
  // grinding). Nullable so a pre-cutover row (no captured block) cleanly falls back. Idempotent ALTER.
  addColumnIfMissing(d, "summon_requests", "summon_block", "INTEGER");

  // Human-readable progress line for the summon status UX (persisted by SummonWatcher.setStatus, served by
  // GET /summon/:id/status). Idempotent ALTER so existing DBs upgrade in place. Nullable (old rows -> null).
  addColumnIfMissing(d, "summon_requests", "progress", "TEXT");

  // M2 (single-mint sentinel): a done job may be minted AT MOST ONCE. mint-args records the single
  // attestation nonce it issued for a job (+ the bound recipient) so it never signs a SECOND distinct
  // nonce - one generation can back at most one OutputNFT (on-chain usedNonce is the ultimate backstop;
  // this stops a second sig from ever being minted). Nullable so pre-M2 jobs (no attestation yet) upgrade
  // cleanly. Idempotent ALTER.
  addColumnIfMissing(d, "jobs", "mint_nonce", "TEXT");     // the single bytes32 nonce issued for this job
  addColumnIfMissing(d, "jobs", "mint_to", "TEXT");        // the recipient bound into that attestation (lowercased)
  addColumnIfMissing(d, "jobs", "mint_issued_at", "TEXT"); // ISO time the attestation was first issued
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
