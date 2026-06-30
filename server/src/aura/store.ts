// SERVER-ONLY. SQLite-backed stores: the per-agent brain key/meta + the runtime mint index.
// (Replaces the v1 flat-JSON data/mint-index.json + the implicit brain-key handling.)
import { randomUUID } from "node:crypto";
import { db } from "./db.js";

// ── agent brains (AES key custody + meta) ──
export interface BrainRecord {
  refKey: string;
  agentId: number | null;
  owner: string | null;
  name: string;
  encBrainRoot: string;
  brainKeyHex: string;
  canonicalBaseRoot: string;
  styleFingerprint: string | null;
  modelAttestation: string | null;
  sealedKey: string | null;  // ERC-7857: ECIES seal of brainKey to the owner's pubkey (0x-hex), if known
  dataHash: string | null;   // sha256 of the envelope (the contract's dataHash), 0x-hex
  createdAt: string;
}

/** Stage a brain BEFORE the user mints (agentId unknown). Returns the pending ref key. */
export function stageBrain(input: {
  owner: string;
  name: string;
  encBrainRoot: string;
  brainKeyHex: string;
  canonicalBaseRoot: string;
  styleFingerprint: string;
  modelAttestation: string;
  sealedKey?: string | null;  // ERC-7857 per-owner seal (null if the owner has no recovered pubkey yet)
  dataHash?: string | null;
}): string {
  const refKey = `pending:${randomUUID()}`;
  db()
    .prepare(
      `INSERT INTO agent_brains (ref_key,agent_id,owner,name,enc_brain_root,brain_key_hex,canonical_base_root,style_fingerprint,model_attestation,sealed_key,data_hash,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      refKey,
      null,
      input.owner.toLowerCase(),
      input.name,
      input.encBrainRoot,
      input.brainKeyHex,
      input.canonicalBaseRoot,
      input.styleFingerprint,
      input.modelAttestation,
      input.sealedKey ?? null,
      input.dataHash ?? null,
      new Date().toISOString(),
    );
  return refKey;
}

/** Promote a staged brain to a concrete agentId once the user has minted it. Keyed by encBrainRoot. */
export function promoteBrainByRoot(encBrainRoot: string, agentId: number, owner: string): boolean {
  const r = db()
    .prepare(
      `UPDATE agent_brains SET ref_key='agent:'||?, agent_id=?, owner=? WHERE enc_brain_root=? AND agent_id IS NULL`,
    )
    .run(agentId, agentId, owner.toLowerCase(), encBrainRoot);
  return r.changes > 0;
}

/** Look up a brain by the on-chain encBrainRoot (the generalized generator's path). */
export function brainByRoot(encBrainRoot: string): BrainRecord | null {
  const r = db().prepare(`SELECT * FROM agent_brains WHERE enc_brain_root=? ORDER BY agent_id IS NULL LIMIT 1`).get(encBrainRoot) as any;
  return r ? rowToBrain(r) : null;
}

export function brainByAgentId(agentId: number): BrainRecord | null {
  const r = db().prepare(`SELECT * FROM agent_brains WHERE agent_id=? LIMIT 1`).get(agentId) as any;
  return r ? rowToBrain(r) : null;
}

function rowToBrain(r: any): BrainRecord {
  return {
    refKey: r.ref_key,
    agentId: r.agent_id ?? null,
    owner: r.owner ?? null,
    name: r.name,
    encBrainRoot: r.enc_brain_root,
    brainKeyHex: r.brain_key_hex,
    canonicalBaseRoot: r.canonical_base_root,
    styleFingerprint: r.style_fingerprint ?? null,
    modelAttestation: r.model_attestation ?? null,
    sealedKey: r.sealed_key ?? null,
    dataHash: r.data_hash ?? null,
    createdAt: r.created_at,
  };
}

// ── runtime mint index (outputs minted THROUGH this backend, recorded after the user submits) ──
export interface MintRecord {
  tokenId: number;
  jobId: string | null;
  owner: string | null;
  creatorAgentId: number;
  imageRoot: string;
  provenanceHash: string;
  teeAttestation: string;
  seed: string;
  mintTx: string | null;
  imagePath: string | null;
  createdAt: string;
}

export function recordMint(rec: MintRecord): void {
  db()
    .prepare(
      `INSERT INTO mint_index (token_id,job_id,owner,creator_agent,image_root,provenance_hash,tee_attestation,seed,mint_tx,image_path,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(token_id) DO UPDATE SET mint_tx=excluded.mint_tx, owner=excluded.owner`,
    )
    .run(
      rec.tokenId,
      rec.jobId,
      rec.owner ? rec.owner.toLowerCase() : null,
      rec.creatorAgentId,
      rec.imageRoot,
      rec.provenanceHash,
      rec.teeAttestation,
      rec.seed,
      rec.mintTx,
      rec.imagePath,
      rec.createdAt,
    );
}

export function mintRecordByToken(tokenId: number): MintRecord | null {
  const r = db().prepare(`SELECT * FROM mint_index WHERE token_id=?`).get(tokenId) as any;
  if (!r) return null;
  return {
    tokenId: r.token_id,
    jobId: r.job_id ?? null,
    owner: r.owner ?? null,
    creatorAgentId: r.creator_agent,
    imageRoot: r.image_root,
    provenanceHash: r.provenance_hash,
    teeAttestation: r.tee_attestation,
    seed: r.seed,
    mintTx: r.mint_tx ?? null,
    imagePath: r.image_path ?? null,
    createdAt: r.created_at,
  };
}
