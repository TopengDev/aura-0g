// SERVER-ONLY. Off-chain enrichment index: maps tokenIds to their image file, label, and the
// TEE generation record. Two sources:
//   1) demo/proof.json — the canonical journal of the proven legacy mints (#1-#11)
//   2) data/mint-index.json — runtime record of outputs minted THROUGH this API (gitignored)
// On-chain provenance (creatorAgentId, imageRoot, provenanceHash, teeAttestation, seed) is always
// read live from the contract; this index only adds display + generation context off-chain.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PROOF_PATH = path.join(ROOT, "demo/proof.json");
const DATA_DIR = path.join(ROOT, "data");
const MINT_INDEX = path.join(DATA_DIR, "mint-index.json");

export interface EnrichRecord {
  tokenId: number;
  label: string | null;
  imageKey: string | null;   // key into /api/image/<key>; null => use output-<tokenId>
  model: string;
  prompt: string | null;
  teeSigner: string | null;
  teeVerifiability: string;
  teeVerified: boolean | string;
  chatId: string | null;
  mintTx: string | null;
  provenanceRecord: unknown | null; // the exact stored provenance object (if known) — lets us recompute the hash
}

const MODEL = "qwen/qwen-image-edit-2511";

// ── legacy (proof.json) ──
let _legacy: Map<number, EnrichRecord> | null = null;

function buildLegacy(): Map<number, EnrichRecord> {
  const m = new Map<number, EnrichRecord>();

  // NOKTURNE early test mints (#1 placeholder, #2 real) — not in proof.json; minimal honest record.
  m.set(1, { tokenId: 1, label: "genesis (placeholder)", imageKey: "output-1", model: MODEL, prompt: null, teeSigner: null, teeVerifiability: "TeeML", teeVerified: "n/a", chatId: null, mintTx: null, provenanceRecord: null });
  m.set(2, { tokenId: 2, label: "NOKTURNE output", imageKey: "output-2", model: MODEL, prompt: null, teeSigner: null, teeVerifiability: "TeeML", teeVerified: "n/a", chatId: null, mintTx: null, provenanceRecord: null });

  try {
    const proof = JSON.parse(readFileSync(PROOF_PATH, "utf8"));
    const h = proof?.phases?.hero;
    if (h?.mint?.tokenId) {
      m.set(Number(h.mint.tokenId), {
        tokenId: Number(h.mint.tokenId), label: "genesis hero", imageKey: "output-3",
        model: h.generation?.model ?? MODEL, prompt: proof?.phases?.hero?.storage?.provenanceRecord?.prompt ?? null,
        teeSigner: h.generation?.teeSigner ?? null, teeVerifiability: h.generation?.verifiability ?? "TeeML",
        teeVerified: h.generation?.teeVerified ?? "n/a", chatId: h.generation?.chatId ?? null,
        mintTx: h.mint?.mintTx ?? null, provenanceRecord: h.storage?.provenanceRecord ?? null,
      });
    }
    // royalty market piece reuses the hero's stored image/provenance
    const r = proof?.phases?.royalty;
    if (r?.marketTokenId) {
      m.set(Number(r.marketTokenId), {
        tokenId: Number(r.marketTokenId), label: "market piece (sold — royalty demo)", imageKey: "output-4",
        model: h?.generation?.model ?? MODEL, prompt: h?.storage?.provenanceRecord?.prompt ?? null,
        teeSigner: h?.generation?.teeSigner ?? null, teeVerifiability: "TeeML",
        teeVerified: h?.generation?.teeVerified ?? "n/a", chatId: h?.generation?.chatId ?? null,
        mintTx: null, provenanceRecord: null,
      });
    }
    // collection pieces
    const pieces: any[] = proof?.phases?.collection?.pieces ?? [];
    for (const p of pieces) {
      const key = `output-${p.tokenId}`;
      m.set(Number(p.tokenId), {
        tokenId: Number(p.tokenId), label: p.label ?? null, imageKey: key,
        model: MODEL, prompt: null, teeSigner: h?.generation?.teeSigner ?? null, teeVerifiability: "TeeML",
        teeVerified: p.teeVerified ?? "n/a", chatId: null, mintTx: p.mintTx ?? null, provenanceRecord: null,
      });
    }
  } catch {
    /* proof.json missing — legacy enrichment limited to the NOKTURNE stubs above */
  }
  return m;
}

export function legacyByToken(): Map<number, EnrichRecord> {
  if (!_legacy) _legacy = buildLegacy();
  return _legacy;
}

// ── runtime mint index (outputs minted through THIS API) ──
export interface MintRecord extends EnrichRecord {
  jobId: string | null;
  imageFile: string | null;  // absolute path to the generated PNG (served via output route)
  imageRoot: string;
  provenanceHash: string;
  teeAttestation: string;
  seed: number;
  creatorAgentId: number;
  owner: string;
  createdAt: string;
}

export function readMintIndex(): MintRecord[] {
  try {
    if (!existsSync(MINT_INDEX)) return [];
    return JSON.parse(readFileSync(MINT_INDEX, "utf8"));
  } catch {
    return [];
  }
}

export function appendMintIndex(rec: MintRecord): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const all = readMintIndex();
  const filtered = all.filter((r) => r.tokenId !== rec.tokenId);
  filtered.push(rec);
  writeFileSync(MINT_INDEX, JSON.stringify(filtered, null, 2));
}

export function mintRecordByToken(tokenId: number): MintRecord | null {
  return readMintIndex().find((r) => r.tokenId === tokenId) ?? null;
}

/** Resolve the absolute image file for an API-minted output (for the image route). */
export function generatedImageFile(tokenId: number): string | null {
  return mintRecordByToken(tokenId)?.imageFile ?? null;
}
