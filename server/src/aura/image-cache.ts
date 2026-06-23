// SERVER-ONLY. Content-addressed image cache, keyed by the 0G Storage root hash.
//
// WHY THIS EXISTS (root-caused 2026-06-23): 0G Storage TESTNET does NOT durably retain image-sized
// blobs. A fresh upload round-trips immediately, but within minutes-to-an-hour the storage nodes evict
// it (expectedReplica:1 + finalityRequired:false land the data on too few nodes), so download() returns
// "No locations found". Verified live: a generated output's imageRoot and an agent's reference-image
// root both became unretrievable ~1h after upload, while a tiny (806B) brain envelope survived. The
// only reason the app shows real art today is that the 4 catalog portraits + 11 showpiece outputs are
// BAKED INTO the web image, not fetched from 0G.
//
// So: every image whose bytes pass through this server (create-time reference images + generated
// outputs) is ALSO persisted to a local content-addressed cache (a named docker volume). The
// image-by-root endpoint serves from here first; 0G is only a best-effort fallback. This is durable on
// testnet, where 0G is not.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { db } from "./db.js";
import { GEN_DIR } from "./config.js";

// Cache dir lives next to the generated-images dir (same named volume), so it persists across restarts.
const CACHE_DIR = path.join(path.dirname(GEN_DIR), "image-cache");

function ensureTable(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS image_blobs (
      root        TEXT PRIMARY KEY,   -- 0G Storage root hash (content address)
      file_path   TEXT NOT NULL,      -- absolute path to the cached bytes
      content_type TEXT NOT NULL DEFAULT 'image/png',
      source      TEXT,               -- 'reference' | 'output' | other provenance hint
      created_at  TEXT NOT NULL
    );
  `);
}

function sanitizeRoot(root: string): string {
  // roots are 0x-hex or 0g://... pseudo-roots; make a filesystem-safe filename.
  return root.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
}

/**
 * Persist image bytes under their 0G root so they can be served later regardless of 0G retention.
 * Idempotent: same root re-writes the same file. Best-effort (never throws into the caller's hot path).
 */
export function cacheImageByRoot(root: string, bytes: Buffer, opts?: { contentType?: string; source?: string }): void {
  if (!root || bytes.length === 0) return;
  try {
    ensureTable();
    mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, `${sanitizeRoot(root)}.bin`);
    writeFileSync(file, bytes);
    db()
      .prepare(
        `INSERT INTO image_blobs (root,file_path,content_type,source,created_at)
         VALUES (?,?,?,?,?)
         ON CONFLICT(root) DO UPDATE SET file_path=excluded.file_path, content_type=excluded.content_type`,
      )
      .run(root, file, opts?.contentType ?? "image/png", opts?.source ?? null, new Date().toISOString());
  } catch {
    /* cache is best-effort; a failure here must never break create/generate */
  }
}

export interface CachedImage {
  bytes: Buffer;
  contentType: string;
}

/**
 * Resolve image bytes for a root from the LOCAL cache only (no network). Checks the dedicated
 * image_blobs table, then falls back to the legacy jobs.image_path mapping (generated outputs recorded
 * before this cache existed: match a job whose result imageRoot == root).
 */
export function cachedImageByRoot(root: string): CachedImage | null {
  if (!root) return null;
  try {
    ensureTable();
    const row = db().prepare(`SELECT file_path, content_type FROM image_blobs WHERE root=?`).get(root) as
      | { file_path: string; content_type: string }
      | undefined;
    if (row?.file_path && existsSync(row.file_path)) {
      return { bytes: readFileSync(row.file_path), contentType: row.content_type || "image/png" };
    }
    // Legacy fallback: a generated output's bytes live at jobs.image_path; the job's result_json carries
    // the imageRoot. (Covers outputs generated before image_blobs was introduced.)
    const job = db()
      .prepare(`SELECT image_path FROM jobs WHERE json_extract(result_json,'$.imageRoot')=? AND image_path IS NOT NULL LIMIT 1`)
      .get(root) as { image_path?: string } | undefined;
    if (job?.image_path && existsSync(job.image_path)) {
      // opportunistically backfill the dedicated cache for next time
      try {
        db()
          .prepare(`INSERT OR IGNORE INTO image_blobs (root,file_path,content_type,source,created_at) VALUES (?,?,?,?,?)`)
          .run(root, job.image_path, "image/png", "output-backfill", new Date().toISOString());
      } catch { /* ignore */ }
      return { bytes: readFileSync(job.image_path), contentType: "image/png" };
    }
  } catch {
    /* fall through */
  }
  return null;
}
