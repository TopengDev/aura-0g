// SERVER-ONLY. The chat PERSONA store: the durable, chat-readable SOUL of every USER-created Aura.
//
// WHY THIS EXISTS (root cause): the chat system prompt (chat-persona.ts) is built from an AgentPublicMeta
// (aesthetic/personality/lore/signatureCharacter/tagline). agents.ts previously resolved that meta as
// `metaForName(name) ?? fallbackMeta(name)` - metaForName only matches the ~30 HARDCODED catalog auras, so
// a user-created aura (not in the catalog) fell through to the flat generic fallbackMeta and chatted with no
// personality/lore/signature. create-agent captured the user's styleDescriptor + signatureCharacter into the
// ENCRYPTED brain + the on-chain fingerprint, but nothing chat-readable. This store closes that gap.
//
// LIFECYCLE (mirrors agent_brains): staged by enc_brain_root at CREATE (agent_id NULL, because the on-chain
// agentId is not known until the user signs the mint), then PROMOTED to the concrete agent_id at
// /agents/confirm-mint. The chat lookup (personaMetaFor) falls back to enc_brain_root, so a persona still
// resolves even if confirm-mint was never called (belt + suspenders).
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import type { AgentPublicMeta } from "./types.js";

const MODEL = "qwen/qwen-image-edit-2511";
const DEFAULT_ACCENT = "#8A8AFF";

export interface PersonaRecord {
  refKey: string;
  agentId: number | null;
  encBrainRoot: string;
  name: string;
  aesthetic: string;
  signatureCharacter: string | null;
  personality: string | null;
  lore: string | null;
  tagline: string | null;
  rarity: string | null;
  derived: boolean; // true once the LLM enrichment landed; false = floor (raw style + signature) only
  createdAt: string;
  updatedAt: string;
}

/** The FLOOR + optional LLM-enriched fields for a persona. The floor (aesthetic + signatureCharacter +
 *  a simple tagline) alone already gives the chat a strong, non-generic voice. */
export interface PersonaFields {
  name: string;
  aesthetic: string;
  signatureCharacter?: string | null;
  personality?: string | null;
  lore?: string | null;
  tagline?: string | null;
  rarity?: string | null;
  derived?: boolean;
}

function rowToPersona(r: any): PersonaRecord {
  return {
    refKey: r.ref_key,
    agentId: r.agent_id ?? null,
    encBrainRoot: r.enc_brain_root,
    name: r.name,
    aesthetic: r.aesthetic,
    signatureCharacter: r.signature_character ?? null,
    personality: r.personality ?? null,
    lore: r.lore ?? null,
    tagline: r.tagline ?? null,
    rarity: r.rarity ?? null,
    derived: !!r.derived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Stage a persona BEFORE the user mints (agentId unknown). Keyed by enc_brain_root; promoted later.
 *  Persists the FLOOR synchronously so a persona ALWAYS exists the moment create returns (the LLM
 *  enrichment is a best-effort UPDATE that lands moments later). Returns the pending ref key. */
export function stagePersona(input: PersonaFields & { encBrainRoot: string }): string {
  const refKey = `pending:${randomUUID()}`;
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO agent_personas
         (ref_key,agent_id,enc_brain_root,name,aesthetic,signature_character,personality,lore,tagline,rarity,derived,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      refKey,
      null,
      input.encBrainRoot,
      input.name,
      input.aesthetic,
      input.signatureCharacter ?? null,
      input.personality ?? null,
      input.lore ?? null,
      input.tagline ?? null,
      input.rarity ?? null,
      input.derived ? 1 : 0,
      now,
      now,
    );
  return refKey;
}

/** Promote a staged persona to a concrete agentId once the user has minted it. Keyed by enc_brain_root
 *  (mirror promoteBrainByRoot). Idempotent: only promotes an as-yet-unpromoted row. */
export function promotePersonaByRoot(encBrainRoot: string, agentId: number): boolean {
  const r = db()
    .prepare(
      `UPDATE agent_personas SET ref_key='agent:'||?, agent_id=?, updated_at=?
         WHERE enc_brain_root=? AND agent_id IS NULL`,
    )
    .run(agentId, agentId, new Date().toISOString(), encBrainRoot);
  return r.changes > 0;
}

/** Best-effort LLM enrichment landed later: update the derived fields on the row (matches pending OR
 *  promoted, since it is keyed by enc_brain_root). Never touches the floor aesthetic/signature. */
export function enrichPersonaByRoot(
  encBrainRoot: string,
  fields: { personality: string | null; lore: string | null; tagline: string | null; aesthetic?: string | null },
): boolean {
  const now = new Date().toISOString();
  // aesthetic is refined-optional: only overwrite it if the LLM returned a non-empty refinement.
  if (fields.aesthetic && fields.aesthetic.trim()) {
    const r = db()
      .prepare(
        `UPDATE agent_personas SET aesthetic=?, personality=?, lore=?, tagline=?, derived=1, updated_at=?
           WHERE enc_brain_root=?`,
      )
      .run(fields.aesthetic.trim(), fields.personality, fields.lore, fields.tagline, now, encBrainRoot);
    return r.changes > 0;
  }
  const r = db()
    .prepare(
      `UPDATE agent_personas SET personality=?, lore=?, tagline=?, derived=1, updated_at=?
         WHERE enc_brain_root=?`,
    )
    .run(fields.personality, fields.lore, fields.tagline, now, encBrainRoot);
  return r.changes > 0;
}

/** Direct upsert keyed by a KNOWN agentId (the BACKFILL path: the aura already minted). Replaces any
 *  existing 'agent:<id>' row for that id. */
export function upsertPersonaForAgent(agentId: number, encBrainRoot: string, fields: PersonaFields): void {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO agent_personas
         (ref_key,agent_id,enc_brain_root,name,aesthetic,signature_character,personality,lore,tagline,rarity,derived,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(ref_key) DO UPDATE SET
         enc_brain_root=excluded.enc_brain_root, name=excluded.name, aesthetic=excluded.aesthetic,
         signature_character=excluded.signature_character, personality=excluded.personality,
         lore=excluded.lore, tagline=excluded.tagline, rarity=excluded.rarity,
         derived=excluded.derived, updated_at=excluded.updated_at`,
    )
    .run(
      `agent:${agentId}`,
      agentId,
      encBrainRoot,
      fields.name,
      fields.aesthetic,
      fields.signatureCharacter ?? null,
      fields.personality ?? null,
      fields.lore ?? null,
      fields.tagline ?? null,
      fields.rarity ?? null,
      fields.derived ? 1 : 0,
      now,
      now,
    );
}

export function personaByAgentId(agentId: number): PersonaRecord | null {
  const r = db().prepare(`SELECT * FROM agent_personas WHERE agent_id=? LIMIT 1`).get(agentId) as any;
  return r ? rowToPersona(r) : null;
}

export function personaByEncBrainRoot(encBrainRoot: string): PersonaRecord | null {
  // prefer a promoted row (agent_id NOT NULL) over a still-pending one for the same root.
  const r = db()
    .prepare(`SELECT * FROM agent_personas WHERE enc_brain_root=? ORDER BY agent_id IS NULL LIMIT 1`)
    .get(encBrainRoot) as any;
  return r ? rowToPersona(r) : null;
}

/** Build a chat/display AgentPublicMeta from a stored persona. Tries agentId first, then enc_brain_root
 *  (handles an un-promoted persona). Returns null if this aura has no stored persona (caller then hits the
 *  generic fallbackMeta). This is the single seam agents.ts uses to give user auras their soul. */
export function personaMetaFor(agentId: number, encBrainRoot?: string | null): AgentPublicMeta | null {
  const rec = personaByAgentId(agentId) ?? (encBrainRoot ? personaByEncBrainRoot(encBrainRoot) : null);
  if (!rec) return null;
  const meta: AgentPublicMeta = {
    name: rec.name,
    tagline: rec.tagline || "A living creative Aura on 0G.",
    aesthetic: rec.aesthetic,
    signatureCharacter: rec.signatureCharacter,
    model: MODEL,
    accent: DEFAULT_ACCENT,
    sampleImages: [],
  };
  if (rec.personality) meta.personality = rec.personality;
  if (rec.lore) meta.lore = rec.lore;
  if (rec.rarity) meta.rarity = rec.rarity;
  return meta;
}
