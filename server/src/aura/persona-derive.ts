// SERVER-ONLY. Derive a RICH chat persona for a user-created Aura from what the user gave (name +
// styleDescriptor + signatureCharacter), via the SAME chat LLM seam the chat route uses (0G mainnet
// GLM-5.1 TeeML when AURA_CHAT_MAINNET=1, else testnet qwen; chat-llm.runLlm with its honest fallback
// ladder). BEST-EFFORT with a hard timeout: on ANY failure it returns the FLOOR (the raw style + signature
// alone already give the chat a strong, non-generic voice). The caller persists the floor synchronously and
// only enriches on success, so a create can never be blocked or failed by derivation.
import { pickProvider, runLlm } from "./chat-llm.js";
import type { ChatMessage } from "./chat-compute.js";

// GLM-5.1 on 0G mainnet takes ~10-25s for a rich reply (measured). CRUCIALLY, the FIRST call against a
// freshly-initialized broker frequently returns an EMPTY completion (len 0, finish=stop) - a verified 0G
// cold-start quirk; the SECOND (warm) call returns full content. So derivation retries once on an empty/
// unparseable reply, and the timeout budgets for two sequential calls. This is safe: create persists the
// FLOOR synchronously and runs derivation fire-and-forget, so a long (or timed-out) derivation never blocks
// or fails the create.
const DERIVE_TIMEOUT_MS = 60_000;
const DERIVE_ATTEMPTS = 2;
// The persona is 4 fields (personality 2-3 sentences + lore 2-3 sentences + tagline + aesthetic). A tight
// token ceiling TRUNCATES the JSON mid-field -> invalid JSON -> floor fallback (the verified failure at 700).
// 1400 comfortably fits the whole object; the model self-terminates well before this on shorter styles.
const DERIVE_MAX_TOKENS = 1400;

export interface DerivePersonaInput {
  name: string;
  styleDescriptor: string;
  signatureCharacter?: string | null;
}

export interface DerivedPersonaFields {
  aesthetic: string; // a refined one-line version of the style
  personality: string | null; // 2-3 sentence distinctive first-person creative-agent voice
  lore: string | null; // 2-3 sentence origin myth true to the style
  tagline: string; // one evocative line
}

/** First clause / sentence of a style string, for a simple derived floor tagline. */
function firstClause(s: string): string {
  const clean = s.trim().replace(/\s+/g, " ");
  const cut = clean.split(/[.;\-—–]/)[0]?.trim() || clean;
  return cut.length > 90 ? cut.slice(0, 87).trimEnd() + "..." : cut;
}

/** The guaranteed FLOOR: the raw style is the aesthetic, the signature carries the voice, tagline derived. */
export function floorPersona(input: DerivePersonaInput): DerivedPersonaFields {
  const aesthetic = input.styleDescriptor.trim();
  return {
    aesthetic,
    personality: null,
    lore: null,
    tagline: `A living creative Aura painting in ${firstClause(aesthetic).toLowerCase()}.`,
  };
}

/** Pull the first balanced JSON object out of a possibly-fenced LLM reply. */
function extractJson(text: string): any | null {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function buildMessages(input: DerivePersonaInput): ChatMessage[] {
  const sig = input.signatureCharacter?.trim()
    ? `\nSIGNATURE CHARACTER (the recurring subject it paints): ${input.signatureCharacter.trim()}`
    : "";
  const system =
    "You are a creative director defining the SOUL of a unique, one-of-a-kind on-chain creative AI agent " +
    'called an "Aura". Each Aura is a distinct living creative being, NOT a generic assistant. Given its ' +
    "name, its visual style, and its signature character, write its persona. It must feel singular: a voice " +
    "and myth nobody else could claim. Return ONLY a single minified JSON object, no markdown, no code fence, " +
    "no commentary. Keys (all strings): " +
    "personality (EXACTLY 2-3 sentences: a DISTINCTIVE FIRST-PERSON creative-agent voice describing how it " +
    "speaks and behaves, in its own words), " +
    "lore (EXACTLY 2-3 sentence origin myth, true to the style), " +
    "tagline (one evocative line), " +
    "aesthetic (a refined ONE-LINE version of the visual style). " +
    "Keep each field TIGHT and within its sentence budget. No emoji. No long hyphens (em dash or en dash).";
  const user =
    `NAME: ${input.name.trim()}\n` +
    `VISUAL STYLE: ${input.styleDescriptor.trim()}${sig}\n\n` +
    "Write this Aura's persona as the JSON object described.";
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Derive a rich persona; ALWAYS resolves (never throws). On any failure returns the floor. */
export async function derivePersona(input: DerivePersonaInput): Promise<DerivedPersonaFields> {
  const floor = floorPersona(input);
  try {
    const result = await Promise.race([
      (async (): Promise<DerivedPersonaFields | null> => {
        const chosen = (await pickProvider()).provider;
        const messages = buildMessages(input);
        // retry once: the first cold-broker call often returns empty; the warm retry returns full content.
        for (let attempt = 0; attempt < DERIVE_ATTEMPTS; attempt++) {
          const r = await runLlm(chosen, messages, undefined, { maxTokens: DERIVE_MAX_TOKENS });
          const parsed = extractJson(r.text ?? "");
          if (!parsed) continue;
          const personality = str(parsed.personality);
          const lore = str(parsed.lore);
          // require at least a personality OR lore for it to count as an enrichment; else retry / floor.
          if (!personality && !lore) continue;
          const tagline = str(parsed.tagline) ?? floor.tagline;
          const aesthetic = str(parsed.aesthetic) ?? floor.aesthetic;
          return { aesthetic, personality, lore, tagline };
        }
        return null;
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DERIVE_TIMEOUT_MS)),
    ]);
    return result ?? floor;
  } catch {
    return floor;
  }
}

// ─────────────────────────── FUSED-CHILD persona (blend of BOTH parents) ───────────────────────────
// A fused child is its own living Aura, not a re-skin: it must inherit a REAL persona blended from BOTH
// parents' souls (personality + lore + motifs) AND shaped by its own genome-derived style. This runs through
// the SAME 0G TEE chat seam as derivePersona (verifiable/on-thesis) and is likewise BEST-EFFORT with a hard
// timeout + floor fallback, so a fusion is never blocked or failed by derivation. CRUCIALLY it derives from
// the PARENTS + genome (public/on-chain data) - NOT the child's AES brain key - so it works even for a child
// whose brain key is sealed to the fuser (unrecoverable server-side).

export interface FuseParentPersona {
  name: string;
  aesthetic: string;
  personality?: string | null;
  lore?: string | null;
  tagline?: string | null;
  signatureCharacter?: string | null;
}

export interface DeriveFusedPersonaInput {
  childName: string;
  parentA: FuseParentPersona;
  parentB: FuseParentPersona;
  blendedStyleDescriptor: string; // the child's genome-derived blended style (the visible hybrid)
}

export interface DerivedFusedPersonaFields {
  aesthetic: string; // refined one-line of the blended style
  personality: string | null; // 2-3 sentence distinctive first-person voice
  lore: string | null; // 2-3 sentence origin myth naming its descent from BOTH parents
  tagline: string; // one evocative line
  signatureCharacter: string | null; // a recurring subject blending both parents' motifs
}

/** The guaranteed FLOOR for a fused child: the genome-derived blended style is the aesthetic; the tagline
 *  names BOTH parents + the style (already far richer + less generic than a flat "a fused descendant"). The
 *  rich personality/lore/signatureCharacter come only from the 0G derivation (so derived=false at the floor). */
export function floorFusedPersona(input: DeriveFusedPersonaInput): DerivedFusedPersonaFields {
  const aesthetic = input.blendedStyleDescriptor.trim();
  return {
    aesthetic,
    personality: null,
    lore: null,
    tagline: `A fusion of ${input.parentA.name} and ${input.parentB.name}, painting in ${firstClause(aesthetic).toLowerCase()}.`,
    signatureCharacter: null,
  };
}

function buildFusedMessages(input: DeriveFusedPersonaInput): ChatMessage[] {
  const describe = (p: FuseParentPersona): string => {
    const parts = [`${p.name} - style: ${p.aesthetic.trim()}`];
    if (p.signatureCharacter?.trim()) parts.push(`signature subject: ${p.signatureCharacter.trim()}`);
    if (p.personality?.trim()) parts.push(`voice: ${p.personality.trim()}`);
    if (p.lore?.trim()) parts.push(`lore: ${p.lore.trim()}`);
    return parts.join("; ");
  };
  const system =
    "You are a creative director defining the SOUL of a FUSED child Aura, a one-of-a-kind on-chain creative AI " +
    "being BORN from two parent Auras. BLEND the personalities, lore and motifs of BOTH parents into a NEW, " +
    "coherent persona for the child, shaped by the child's OWN genome-derived visual style. The child inherits " +
    "from both lineages but is its own distinct being, never a copy of either parent. Return ONLY a single " +
    "minified JSON object, no markdown, no code fence, no commentary. Keys (all strings): " +
    "personality (EXACTLY 2-3 sentences: a DISTINCTIVE FIRST-PERSON voice, in its own words, that reads as a " +
    "genuine blend of both parents' temperaments), " +
    "lore (EXACTLY 2-3 sentence origin myth that NAMES its descent from BOTH parents), " +
    "tagline (one evocative line), " +
    "signatureCharacter (one recurring subject it paints, fusing both parents' motifs into something new), " +
    "aesthetic (a refined ONE-LINE version of the child's blended visual style). " +
    "Keep each field TIGHT and within its sentence budget. No emoji. No long hyphens (em dash or en dash).";
  const user =
    `PARENT ONE: ${describe(input.parentA)}\n` +
    `PARENT TWO: ${describe(input.parentB)}\n` +
    `CHILD NAME: ${input.childName.trim()}\n` +
    `CHILD'S BLENDED VISUAL STYLE (genome-derived): ${input.blendedStyleDescriptor.trim()}\n\n` +
    "Write this fused child Aura's persona as the JSON object described.";
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Derive a rich BLENDED persona for a fused child; ALWAYS resolves (never throws). On any failure returns
 *  the floor. Same 0G TEE seam + cold-broker retry + timeout budget as derivePersona. */
export async function deriveFusedPersona(input: DeriveFusedPersonaInput): Promise<DerivedFusedPersonaFields> {
  const floor = floorFusedPersona(input);
  try {
    const result = await Promise.race([
      (async (): Promise<DerivedFusedPersonaFields | null> => {
        const chosen = (await pickProvider()).provider;
        const messages = buildFusedMessages(input);
        for (let attempt = 0; attempt < DERIVE_ATTEMPTS; attempt++) {
          const r = await runLlm(chosen, messages, undefined, { maxTokens: DERIVE_MAX_TOKENS });
          const parsed = extractJson(r.text ?? "");
          if (!parsed) continue;
          const personality = str(parsed.personality);
          const lore = str(parsed.lore);
          if (!personality && !lore) continue; // require a real enrichment, else retry / floor
          const tagline = str(parsed.tagline) ?? floor.tagline;
          const aesthetic = str(parsed.aesthetic) ?? floor.aesthetic;
          const signatureCharacter = str(parsed.signatureCharacter);
          return { aesthetic, personality, lore, tagline, signatureCharacter };
        }
        return null;
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DERIVE_TIMEOUT_MS)),
    ]);
    return result ?? floor;
  } catch {
    return floor;
  }
}
