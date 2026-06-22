// SERVER-ONLY. Async-job store for /api/generate (generation is ~45-50s — kick off + poll).
// Backed by a globalThis Map (shared across route bundles) AND persisted to data/jobs/<id>.json
// (survives dev recompiles + lets ANY route read the job). Generated PNGs land in data/generated/.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { GenerateJob, JobStatus, GenerateJobResult } from "./types";
import { jobsStore } from "./global-store";

const ROOT = process.cwd();
const GEN_DIR = path.join(ROOT, "data", "generated");
const JOBS_DIR = path.join(ROOT, "data", "jobs");

function jobFile(jobId: string): string {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

function persist(job: GenerateJob): void {
  try {
    mkdirSync(JOBS_DIR, { recursive: true });
    writeFileSync(jobFile(job.jobId), JSON.stringify(job, null, 2));
  } catch {
    /* disk persistence is best-effort; the in-memory store is authoritative while the process lives */
  }
}

export function newJobId(): string {
  return `gen_${globalThis.crypto.randomUUID().slice(0, 18)}`;
}

export function createJob(jobId: string, agentId: number, agentName: string, prompt: string, basePreset: string | null): GenerateJob {
  const now = new Date().toISOString();
  const job: GenerateJob = {
    jobId, status: "pending", agentId, agentName, prompt, basePreset,
    createdAt: now, updatedAt: now, progress: "queued", result: null, error: null, provenanceRecord: null,
  };
  jobsStore().set(jobId, job);
  persist(job);
  return job;
}

export function getJob(jobId: string): GenerateJob | null {
  const mem = jobsStore().get(jobId);
  if (mem) return mem;
  // fallback to disk (e.g. after a dev recompile cleared the in-memory map)
  try {
    if (existsSync(jobFile(jobId))) {
      const job = JSON.parse(readFileSync(jobFile(jobId), "utf8")) as GenerateJob;
      jobsStore().set(jobId, job);
      return job;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function updateJob(jobId: string, patch: Partial<GenerateJob>): GenerateJob | null {
  const j = getJob(jobId);
  if (!j) return null;
  Object.assign(j, patch, { updatedAt: new Date().toISOString() });
  jobsStore().set(jobId, j);
  persist(j);
  return j;
}

export function setStatus(jobId: string, status: JobStatus, progress: string): void {
  updateJob(jobId, { status, progress });
}

export function setResult(jobId: string, result: GenerateJobResult, provenanceRecord: unknown): void {
  updateJob(jobId, { status: "done", progress: "done", result, provenanceRecord });
}

export function setError(jobId: string, error: string): void {
  updateJob(jobId, { status: "error", progress: "error", error });
}

// ── generated image persistence ──
export function saveGeneratedImage(jobId: string, bytes: Buffer): string {
  mkdirSync(GEN_DIR, { recursive: true });
  const file = path.join(GEN_DIR, `${jobId}.png`);
  writeFileSync(file, bytes);
  return file;
}

export function generatedImagePath(jobId: string): string | null {
  const file = path.join(GEN_DIR, `${jobId}.png`);
  return existsSync(file) ? file : null;
}

export function readGeneratedImage(jobId: string): Buffer | null {
  const file = generatedImagePath(jobId);
  return file ? readFileSync(file) : null;
}
