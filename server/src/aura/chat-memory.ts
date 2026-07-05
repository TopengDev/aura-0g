// SERVER-ONLY. Chat relationship memory (Layer 2), wired onto the DUAL-WALL memory module
// (server/src/aura/memory/*), replacing the old flat AES store. The Aura remembers THIS owner's prior
// conversations; on resale the relationship re-seals (the buyer starts a fresh epoch, the seller's segments
// become structurally unreadable). Per the validated dual-wall design, the wall is enforced AT THE LOADER
// BY KEY CUSTODY (an epoch-keyring + immutable AES-256-GCM segments), not by a prompt.
//
// WHAT CHANGED FROM THE FLAT STORE (the de-mock this file closes):
//   - The seal/open + epoch-key custody now run through the shared memory module primitives
//     (memory/segment.ts sealSegment/tryOpenSegment + memory/keyring.ts epoch keys), the same mechanism the
//     module's dual-wall smoke test (18/18) and the on-chain secure transfer (AuraINFT) prove. The chat store
//     is one owner-relationship LAYER of that one module, not a parallel ad-hoc cipher.
//   - RELATIONSHIP is modelled as numbered EPOCHS, one per owner. On an owner change the module's dual-wall
//     policy fires (transfer.ts steps 3+4 for L2): a FRESH epoch key is minted + sealed to the new owner, and
//     the prior owner's epoch key is DROPPED from custody (its immutable segments stay on disk but become
//     opaque AES-GCM forever). That is the wall + forward secrecy, by key custody.
//   - THE OVERCLAIM IS CLOSED: the old header claimed the loader resolved the CURRENT on-chain owner
//     (ownerOf) before serving, but the shipped loader scoped only by the caller address, so a FORMER owner
//     who had sold the agent could still read their own past. loadOwnerMemory now RESOLVES ownerOf ON-CHAIN
//     and FAILS CLOSED unless caller == the current owner. Cross-owner isolation is preserved (a different
//     owner is a different epoch key), and a former owner is now also gated out (ownership moved on-chain).
//
// HONEST v1 BOUND (unchanged, carried into copy): for the jury-grade demo the server keeps a CUSTODY copy of
// each CURRENT epoch's L2 key (exactly like agent_brains today) so it can inject memory into the prompt
// without holding the user's private key, and the store is a DURABLE LOCAL cache. The module's own PoC path
// anticipates this (MemoryService.create returns the raw L2 key "for the PoC"). The retrieval wall
// (owner-scoped to the live on-chain owner) + forward secrecy (prior epoch key dropped) hold regardless of
// custody. Mainnet drops the custody copy + persists sealed segments on 0G Storage.
import { db } from "./db.js";
import { registryRead } from "./contracts.js";
import { pubkeyOf } from "./pubkey.js";
import { newEpochKey, sealEpochKey } from "./memory/keyring.js";
import { sealSegment, tryOpenSegment } from "./memory/segment.js";
import { zgBackend } from "./memory/zg-store.js";
import type { RelationshipRecord } from "./memory/types.js";

let _inited = false;
function ensureTables(): void {
  if (_inited) return;
  db().exec(`
    -- one row per RELATIONSHIP EPOCH (== one owner's stint). The module's per-owner keyring, persisted.
    CREATE TABLE IF NOT EXISTS chat_rel_epochs (
      agent_id    INTEGER NOT NULL,
      epoch       INTEGER NOT NULL,            -- monotonic per agent; a fresh epoch is minted on owner change
      owner       TEXT NOT NULL,               -- lowercased owner address this epoch is sealed to
      l2_key_hex  TEXT,                         -- raw L2 epoch key (server custody, v1 read path). NULL once
                                                --   DROPPED on the dual-wall reset -> forward secrecy in custody
      sealed_key  TEXT,                         -- module keyring form: ECIES seal of the L2 key to owner pubkey
      active      INTEGER NOT NULL DEFAULT 1,   -- 1 = the agent's CURRENT epoch; 0 = a superseded prior-owner epoch
      created_at  TEXT NOT NULL,
      PRIMARY KEY (agent_id, epoch)
    );
    CREATE INDEX IF NOT EXISTS idx_chatrel_active ON chat_rel_epochs(agent_id, active);

    -- one immutable, content-sealed segment per chat turn (AES-256-GCM under the epoch key, via the module).
    CREATE TABLE IF NOT EXISTS chat_rel_segments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    INTEGER NOT NULL,
      epoch       INTEGER NOT NULL,            -- which relationship epoch (== owner) this sealed turn belongs to
      envelope    TEXT NOT NULL,               -- hex of sealSegment(epochKey,[rec]) = iv||authTag||ciphertext
      created_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chatrel_seg ON chat_rel_segments(agent_id, epoch);
  `);
  // ADDITIVE (feat/memory-0g-storage): the 0G Storage content root each envelope is pinned to. Idempotent +
  // backward-compatible: pre-existing rows stay NULL until (re)pinned; the column enables the embedding proof.
  const segCols = db().prepare(`PRAGMA table_info(chat_rel_segments)`).all() as Array<{ name: string }>;
  if (!segCols.some((c) => c.name === "zg_root")) {
    db().exec(`ALTER TABLE chat_rel_segments ADD COLUMN zg_root TEXT`);
  }
  _inited = true;
}

/** OPT-IN: embed each sealed chat memory envelope on 0G Storage (durable, iNFT-embedded). Default OFF so
 *  tests/CI stay offline + existing behavior is unchanged. Set MEMORY_0G_PIN=1 on the live server to enable. */
function memory0gPinEnabled(): boolean {
  const v = (process.env.MEMORY_0G_PIN ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/**
 * Best-effort, FAIL-OPEN pin of one sealed envelope to 0G Storage, recording its content root on the row.
 * NEVER throws + never blocks the chat write: 0G embedding is a durability ENHANCEMENT, so a pin failure
 * (network, funds, testnet eviction) must not break relationship memory. The SQLite envelope stays the read copy.
 */
async function pinSegmentTo0G(segId: number, envelope: Buffer): Promise<void> {
  try {
    const root = await zgBackend("chat-mem").store(envelope);
    db().prepare(`UPDATE chat_rel_segments SET zg_root=? WHERE id=?`).run(root, segId);
  } catch {
    /* fail-open: the local envelope remains the durable read copy; the pin is a best-effort embedding */
  }
}

/** One stored relationship record (the decrypted per-turn payload) - the adapter shape the chat route uses. */
export interface MemoryRecord {
  ts: string;
  ownerText: string; // what the owner said
  auraText: string; // what the Aura replied (final text)
  tools: string[]; // tool names the Aura invoked this turn (e.g. ["generate_and_mint"])
  facts?: string[]; // optional distilled durable facts (kept simple in v1)
}

// ── adapter <-> module record mapping (the chat turn is a module RelationshipRecord of kind "chat") ──
function toModuleRecord(r: MemoryRecord): RelationshipRecord {
  return {
    kind: "chat",
    turns: [
      { role: "owner", text: r.ownerText },
      { role: "agent", text: r.auraText },
    ],
    tools: r.tools?.length ? r.tools : undefined,
    ts: r.ts,
  };
}
function fromModuleRecord(m: RelationshipRecord): MemoryRecord | null {
  if (m.kind !== "chat") return null;
  const ownerText = m.turns.find((t) => t.role === "owner")?.text ?? "";
  const auraText = m.turns.find((t) => t.role === "agent")?.text ?? "";
  return { ts: m.ts, ownerText, auraText, tools: m.tools ?? [] };
}

interface EpochRow {
  epoch: number;
  owner: string;
  l2KeyHex: string | null;
  sealedKey: string | null;
}

/**
 * Resolve the agent's CURRENT owner LIVE on-chain (ownerOf). The gate + the epoch model both key off this.
 * FAILS CLOSED (returns null) on any read error: a gate that cannot verify ownership must not serve memory.
 */
type OwnerResolver = (agentId: number) => Promise<string | null>;
const onChainResolver: OwnerResolver = async (agentId) => {
  try {
    const owner = (await registryRead().ownerOf(agentId)) as string;
    return owner ? owner.toLowerCase() : null;
  } catch {
    return null; // unresolved -> treat as "not the owner" (fail closed)
  }
};
let _ownerResolver: OwnerResolver = onChainResolver;

/** TEST SEAM: override how the gate resolves the current on-chain owner (default = registry ownerOf). Pass
 *  null to restore the default. Lets the adapter test drive the ownerOf gate deterministically off-chain. */
export function __setOwnerResolver(fn: OwnerResolver | null): void {
  _ownerResolver = fn ?? onChainResolver;
}

async function resolveOwnerOnChain(agentId: number): Promise<string | null> {
  return _ownerResolver(agentId);
}

/** The agent's active (current) relationship epoch row, or null if it has none yet. */
function activeEpoch(agentId: number): EpochRow | null {
  const r = db()
    .prepare(`SELECT epoch, owner, l2_key_hex, sealed_key FROM chat_rel_epochs WHERE agent_id=? AND active=1`)
    .get(agentId) as { epoch: number; owner: string; l2_key_hex: string | null; sealed_key: string | null } | undefined;
  return r ? { epoch: r.epoch, owner: r.owner, l2KeyHex: r.l2_key_hex, sealedKey: r.sealed_key } : null;
}

/**
 * Ensure the agent's CURRENT relationship epoch is owned by `ownerLower`, minting a fresh one if the owner
 * changed (or if none exists). THE DUAL-WALL L2 RESET, by key custody (memory/transfer.ts steps 3 + 4):
 *   (3) mint a FRESH L2 epoch key, seal it to the new owner (a clean bond starts empty)
 *   (4) DROP the prior epoch's raw key from custody (its segments become opaque AES-GCM forever)
 * Runs in a single synchronous transaction (better-sqlite3) so concurrent turns cannot double-advance.
 */
function ensureEpochForOwner(agentId: number, ownerLower: string): EpochRow {
  ensureTables();
  const d = db();
  const advance = d.transaction((): EpochRow => {
    const cur = activeEpoch(agentId);
    if (cur && cur.owner === ownerLower && cur.l2KeyHex) return cur; // already the current owner's epoch

    // owner changed (or first epoch): supersede + DROP the prior active epoch's raw key (forward secrecy).
    if (cur) {
      d.prepare(`UPDATE chat_rel_epochs SET active=0, l2_key_hex=NULL WHERE agent_id=? AND epoch=?`).run(agentId, cur.epoch);
    }
    const maxRow = d.prepare(`SELECT MAX(epoch) AS m FROM chat_rel_epochs WHERE agent_id=?`).get(agentId) as { m: number | null };
    const nextEpoch = (maxRow.m ?? -1) + 1;

    // mint the fresh L2 epoch key; keep the raw custody copy (v1 read path) + the module keyring seal to owner.
    const rawKey = newEpochKey();
    const rawHex = rawKey.toString("hex");
    let sealedKey: string | null = null;
    try {
      const pk = pubkeyOf(ownerLower);
      if (pk) sealedKey = sealEpochKey(pk, rawKey); // module keyring form (ECIES seal to the owner's wallet pubkey)
    } catch {
      /* sealing is best-effort in v1; the custody copy + the owner-scoped loader are the wall */
    }
    d.prepare(
      `INSERT INTO chat_rel_epochs (agent_id, epoch, owner, l2_key_hex, sealed_key, active, created_at) VALUES (?,?,?,?,?,1,?)`,
    ).run(agentId, nextEpoch, ownerLower, rawHex, sealedKey, new Date().toISOString());
    return { epoch: nextEpoch, owner: ownerLower, l2KeyHex: rawHex, sealedKey };
  });
  return advance();
}

/** Count this agent's segments that do NOT belong to `epoch` (prior owners' - sealed + unreadable this session). */
function blockedSegmentCount(agentId: number, epoch: number | null): number {
  const total = (db().prepare(`SELECT COUNT(*) AS n FROM chat_rel_segments WHERE agent_id=?`).get(agentId) as { n: number }).n;
  if (epoch === null) return total;
  const mine = (db().prepare(`SELECT COUNT(*) AS n FROM chat_rel_segments WHERE agent_id=? AND epoch=?`).get(agentId, epoch) as { n: number }).n;
  return Math.max(0, total - mine);
}

/**
 * Append one chat turn to the CURRENT owner's relationship epoch (sealed via the module). GATED: only the
 * agent's live on-chain owner writes relationship memory (a non-owner chatting builds no owner-relationship).
 */
export async function appendTurn(agentId: number, caller: string, record: MemoryRecord): Promise<void> {
  ensureTables();
  const callerLower = caller.toLowerCase();
  const owner = await resolveOwnerOnChain(agentId);
  if (!owner || owner !== callerLower) {
    // fail closed: do not persist a turn for a caller who is not the current on-chain owner.
    return;
  }
  const ep = ensureEpochForOwner(agentId, owner);
  const key = Buffer.from(ep.l2KeyHex!, "hex");
  const envelope = sealSegment(key, [toModuleRecord(record)]); // module AES-256-GCM segment (iv||tag||ct)
  const info = db()
    .prepare(`INSERT INTO chat_rel_segments (agent_id, epoch, envelope, created_at) VALUES (?,?,?,?)`)
    .run(agentId, ep.epoch, envelope.toString("hex"), new Date().toISOString());
  // ADDITIVE: when enabled, embed the sealed envelope on 0G Storage in the background (fail-open, non-blocking).
  if (memory0gPinEnabled()) void pinSegmentTo0G(Number(info.lastInsertRowid), envelope);
}

/**
 * Load the records the CALLER can open. THE DUAL WALL + THE OWNERSHIP GATE:
 *   1. resolve the agent's CURRENT owner ON-CHAIN (ownerOf). If caller != owner -> serve NOTHING (fail
 *      closed). This closes the overclaim: a former owner who sold the agent can no longer read their past.
 *   2. otherwise read ONLY the caller's CURRENT epoch's segments, unsealed with that epoch's key. A prior
 *      owner's segments live under a DIFFERENT (dropped) epoch key -> never in the retrieval set, opaque bytes.
 * Returns { records, blockedSegments, notOwner } - notOwner + a blockedSegments count let the UI/persona be
 * honest that memory exists here but is sealed to the current owner.
 */
export async function loadOwnerMemory(
  agentId: number,
  caller: string,
): Promise<{ records: MemoryRecord[]; blockedSegments: number; notOwner: boolean }> {
  ensureTables();
  const callerLower = caller.toLowerCase();
  const owner = await resolveOwnerOnChain(agentId);
  if (!owner || owner !== callerLower) {
    // GATE: not the current on-chain owner (or ownership unresolvable) -> no memory; count everything blocked.
    return { records: [], blockedSegments: blockedSegmentCount(agentId, null), notOwner: true };
  }

  // caller IS the owner: make sure their epoch exists (advancing past any prior owner), then read it.
  const ep = ensureEpochForOwner(agentId, owner);
  const key = ep.l2KeyHex ? Buffer.from(ep.l2KeyHex, "hex") : null;
  const rows = db()
    .prepare(`SELECT envelope FROM chat_rel_segments WHERE agent_id=? AND epoch=? ORDER BY id ASC`)
    .all(agentId, ep.epoch) as Array<{ envelope: string }>;

  const records: MemoryRecord[] = [];
  if (key) {
    for (const r of rows) {
      const recs = tryOpenSegment(key, Buffer.from(r.envelope, "hex")); // null if the key cannot open it (the wall)
      if (!recs) continue;
      for (const m of recs) {
        const mapped = fromModuleRecord(m as RelationshipRecord);
        if (mapped) records.push(mapped);
      }
    }
  }
  return { records, blockedSegments: blockedSegmentCount(agentId, ep.epoch), notOwner: false };
}

/**
 * The DUAL-WALL re-seal hook, called by the ERC-7857 secure-transfer flow AFTER ownership moves on-chain
 * (see routes/agent-transfer.ts). Forces the relationship epoch to advance to `newOwner`: the buyer gets a
 * fresh, empty relationship epoch and the seller's epoch key is dropped from custody. Idempotent - if the
 * active epoch is already the new owner's, it is a no-op. (The lazy check in load/append is the safety net;
 * this is the intentional, immediate reset that pairs with the on-chain brain re-key.)
 */
export function resealRelationshipForNewOwner(agentId: number, newOwner: string): { epoch: number } {
  const ep = ensureEpochForOwner(agentId, newOwner.toLowerCase());
  return { epoch: ep.epoch };
}

/**
 * PROOF-OF-EMBEDDING (read-only): for the caller's CURRENT epoch, re-download each 0G-pinned segment and
 * assert it is byte-identical to the local sealed envelope. GATED identically to loadOwnerMemory (only the
 * live on-chain owner). It does NOT decrypt - it proves the ENCRYPTED bytes are embedded + retrievable on
 * 0G Storage (the ERC-7857 "intelligence on decentralized storage" leg), never anything about their contents.
 */
export async function verifyOwnerMemoryOn0G(
  agentId: number,
  caller: string,
): Promise<{ notOwner: boolean; checked: number; embedded: number; mismatched: number; roots: string[] }> {
  ensureTables();
  const callerLower = caller.toLowerCase();
  const owner = await resolveOwnerOnChain(agentId);
  if (!owner || owner !== callerLower) return { notOwner: true, checked: 0, embedded: 0, mismatched: 0, roots: [] };

  const ep = ensureEpochForOwner(agentId, owner);
  const rows = db()
    .prepare(`SELECT envelope, zg_root FROM chat_rel_segments WHERE agent_id=? AND epoch=? AND zg_root IS NOT NULL ORDER BY id ASC`)
    .all(agentId, ep.epoch) as Array<{ envelope: string; zg_root: string }>;

  const backend = zgBackend("chat-mem");
  const roots: string[] = [];
  let embedded = 0;
  let mismatched = 0;
  for (const r of rows) {
    try {
      const on0G = await backend.download(r.zg_root);
      if (Buffer.compare(on0G, Buffer.from(r.envelope, "hex")) === 0) {
        embedded++;
        roots.push(r.zg_root);
      } else {
        mismatched++;
      }
    } catch {
      /* a root that will not download counts as neither embedded-verified nor mismatched (transient/evicted) */
    }
  }
  return { notOwner: false, checked: rows.length, embedded, mismatched, roots };
}

// ── retrieval (v1: keyword + recency top-k over the decrypted set; scale = embedding index) ──
function recordText(r: MemoryRecord): string {
  return [r.ownerText, r.auraText, ...(r.facts ?? []), ...(r.tools ?? [])].join(" ").toLowerCase();
}

/** Top-k retrieval for the system prompt. Recent turns are always lightly in play (recency tiebreak). */
export function retrieve(records: MemoryRecord[], query: string, k = 8): MemoryRecord[] {
  const q = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = records.map((rec, i) => {
    const text = recordText(rec);
    let score = 0;
    for (const term of q) if (text.includes(term)) score += 1;
    score += Math.min(0.4, i / Math.max(1, records.length)) * 0.5; // mild recency bias
    return { rec, score, i };
  });
  scored.sort((a, b) => b.score - a.score || b.i - a.i);
  const top = scored.filter((s) => s.score > 0).slice(0, k).map((s) => s.rec);
  if (top.length) return top;
  // nothing matched: ground with the most recent few turns so the relationship still feels continuous.
  return records.slice(-Math.min(4, records.length));
}

/** Render retrieved memory into compact lines for the system prompt. */
export function renderMemory(records: MemoryRecord[]): string {
  return records
    .map((r) => {
      const tools = r.tools?.length ? ` [acted: ${r.tools.join(", ")}]` : "";
      const owner = r.ownerText ? `owner: ${r.ownerText.slice(0, 160)}` : "";
      const aura = r.auraText ? ` | you: ${r.auraText.slice(0, 160)}` : "";
      return `- ${owner}${aura}${tools}`.trim();
    })
    .join("\n");
}

/** History for the UI (chronological, decrypted for the current owner only; gated identically to load). */
export async function historyForOwner(agentId: number, jwtOwner: string): Promise<MemoryRecord[]> {
  const { records } = await loadOwnerMemory(agentId, jwtOwner);
  return records;
}
