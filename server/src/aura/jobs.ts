// SERVER-ONLY. Async-job store for POST /generate (generation is ~45-50s - kick off + poll).
// SQLite-backed (replaces the v1 globalThis Map + data/jobs/*.json). Jobs are OWNED by the JWT
// address; reads are owner-scoped. A completed-but-unpolled result survives a restart.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { GEN_DIR } from "./config.js";
import type { GenerateJob, JobStatus, GenerateJobResult } from "./types.js";

function rowToJob(r: any): GenerateJob {
  return {
    jobId: r.job_id,
    owner: r.owner,
    status: r.status as JobStatus,
    agentId: r.agent_id,
    agentName: r.agent_name,
    prompt: r.prompt,
    progress: r.progress ?? "",
    result: r.result_json ? (JSON.parse(r.result_json) as GenerateJobResult) : null,
    provenanceRecord: r.provenance_json ? JSON.parse(r.provenance_json) : null,
    error: r.error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function newJobId(): string {
  return `gen_${randomUUID().slice(0, 18)}`;
}

export function createJob(jobId: string, owner: string, agentId: number, agentName: string, prompt: string): GenerateJob {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO jobs (job_id,owner,status,agent_id,agent_name,prompt,progress,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(jobId, owner.toLowerCase(), "pending", agentId, agentName, prompt, "queued", now, now);
  return getJob(jobId)!;
}

export function getJob(jobId: string): GenerateJob | null {
  const r = db().prepare(`SELECT * FROM jobs WHERE job_id=?`).get(jobId);
  return r ? rowToJob(r) : null;
}

/** Owner-scoped read - returns null if the job exists but belongs to someone else. */
export function getJobForOwner(jobId: string, owner: string): GenerateJob | null {
  const r = db().prepare(`SELECT * FROM jobs WHERE job_id=? AND owner=?`).get(jobId, owner.toLowerCase());
  return r ? rowToJob(r) : null;
}

export function setStatus(jobId: string, status: JobStatus, progress: string): void {
  db()
    .prepare(`UPDATE jobs SET status=?, progress=?, updated_at=? WHERE job_id=?`)
    .run(status, progress, new Date().toISOString(), jobId);
}

export function setResult(jobId: string, result: GenerateJobResult, provenanceRecord: unknown): void {
  db()
    .prepare(
      `UPDATE jobs SET status='done', progress='done', result_json=?, provenance_json=?, updated_at=? WHERE job_id=?`,
    )
    .run(JSON.stringify(result), JSON.stringify(provenanceRecord), new Date().toISOString(), jobId);
}

export function setError(jobId: string, error: string): void {
  db()
    .prepare(`UPDATE jobs SET status='error', progress='error', error=?, updated_at=? WHERE job_id=?`)
    .run(error.slice(0, 300), new Date().toISOString(), jobId);
}

// ── generated image persistence (on disk; the path is recorded on the job row) ──
export function saveGeneratedImage(jobId: string, bytes: Buffer): string {
  mkdirSync(GEN_DIR, { recursive: true });
  const file = path.join(GEN_DIR, `${jobId}.png`);
  writeFileSync(file, bytes);
  db().prepare(`UPDATE jobs SET image_path=?, updated_at=? WHERE job_id=?`).run(file, new Date().toISOString(), jobId);
  return file;
}

export function readGeneratedImage(jobId: string): Buffer | null {
  const r = db().prepare(`SELECT image_path FROM jobs WHERE job_id=?`).get(jobId) as { image_path?: string } | undefined;
  const file = r?.image_path;
  if (file && existsSync(file)) return readFileSync(file);
  // fallback to the conventional path
  const conv = path.join(GEN_DIR, `${jobId}.png`);
  return existsSync(conv) ? readFileSync(conv) : null;
}
