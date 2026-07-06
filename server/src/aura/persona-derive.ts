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

/** Strip a reasoning model's chain-of-thought so it never crowds out / corrupts the JSON we parse. GLM-5.1
 *  (the 0G mainnet chat model) is a REASONING model that emits <think>...</think> before its answer; a closed
 *  block is removed, and a DANGLING <think> (reasoning that ran until the token budget cut it off, with no
 *  answer) collapses to empty so we fall through to the floor rather than mis-parse the reasoning. */
function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/i, " ")
    .replace(/<\/?think>/gi, " ")
    .trim();
}

/** Pull the first balanced JSON object out of a possibly-fenced / reasoning-prefixed LLM reply. */
function extractJson(text: string): any | null {
  if (!text) return null;
  let t = stripReasoning(text.trim());
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

/** SALVAGE fallback for a TRUNCATED / malformed JSON reply (the token budget cut the object off mid-field, so
 *  JSON.parse fails): pull each requested key's string value directly with a tolerant regex. Reasoning is
 *  stripped first so a "personality" mentioned inside <think> is never harvested. Returns a partial object of
 *  whatever keys were recoverable (possibly empty). This is why a long GLM reply still yields a rich persona. */
function salvageJsonFields(text: string, keys: string[]): Record<string, string> {
  const t = stripReasoning(text || "");
  const out: Record<string, string> = {};
  for (const k of keys) {
    // "key" : "value with \" escapes" - non-greedy, honoring backslash escapes, tolerant of a missing close.
    const m = t.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "i"));
    if (m && m[1]) {
      try {
        out[k] = JSON.parse(`"${m[1]}"`); // unescape \n, \" etc.
      } catch {
        out[k] = m[1];
      }
    }
  }
  return out;
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
    "Keep each field TIGHT and within its sentence budget. No emoji. No long hyphens (em dash or en dash). " +
    "Output the JSON object IMMEDIATELY with no preamble, no explanation, and no reasoning before it.";
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

// The fused persona blends TWO rich parents into FIVE fields, and the 0G mainnet model (GLM-5.1) is a REASONING
// model that spends tokens on <think> before the JSON. So the fused derivation gets a HIGHER token ceiling (the
// reasoning + the whole object must both fit, or the JSON truncates -> floor, the verified failure) and a
// slightly longer timeout budget for two sequential reasoning calls. The single-agent derivePersona keeps its
// tighter budget (it works there). Reasoning is stripped + a truncated reply is salvaged field-by-field.
const FUSED_DERIVE_MAX_TOKENS = 3000;
// Hard cap for the fused derivation. It usually resolves in ONE ~30s call (GLM returns the full object) and
// breaks early; 3 attempts only trigger on GLM's length variance. 120s keeps the whole sponsor-paid pipeline
// (gen + stores + name + persona) comfortably under the nginx 300s proxy_read_timeout on the live route.
const FUSED_DERIVE_TIMEOUT_MS = 120_000;
const FUSED_DERIVE_ATTEMPTS = 3;
const FUSED_KEYS = ["personality", "lore", "tagline", "signatureCharacter", "aesthetic"];

/** Derive a rich BLENDED persona for a fused child; ALWAYS resolves (never throws). On any failure returns
 *  the floor. Same 0G TEE seam as derivePersona, with a reasoning-model-aware budget. GLM-5.1's reply length
 *  VARIES (one call may land personality but truncate lore; the next lands lore), so this ACCUMULATES the best
 *  non-empty value for each field ACROSS attempts and stops as soon as it holds BOTH personality AND lore (the
 *  two rich fields the feature needs), rather than returning the first partial reply. */
export async function deriveFusedPersona(input: DeriveFusedPersonaInput): Promise<DerivedFusedPersonaFields> {
  const floor = floorFusedPersona(input);
  try {
    const result = await Promise.race([
      (async (): Promise<DerivedFusedPersonaFields | null> => {
        const chosen = (await pickProvider()).provider;
        const messages = buildFusedMessages(input);
        const acc: { personality: string | null; lore: string | null; tagline: string | null; aesthetic: string | null; signatureCharacter: string | null } = {
          personality: null, lore: null, tagline: null, aesthetic: null, signatureCharacter: null,
        };
        for (let attempt = 0; attempt < FUSED_DERIVE_ATTEMPTS; attempt++) {
          const r = await runLlm(chosen, messages, undefined, { maxTokens: FUSED_DERIVE_MAX_TOKENS });
          // parse the JSON, falling back to a field-by-field salvage of a truncated/reasoning-wrapped reply.
          const parsed = extractJson(r.text ?? "") ?? salvageJsonFields(r.text ?? "", FUSED_KEYS);
          acc.personality ??= str(parsed.personality);
          acc.lore ??= str(parsed.lore);
          acc.tagline ??= str(parsed.tagline);
          acc.aesthetic ??= str(parsed.aesthetic);
          acc.signatureCharacter ??= str(parsed.signatureCharacter);
          if (acc.personality && acc.lore) break; // have the two rich fields -> done early
        }
        if (!acc.personality && !acc.lore) return null; // nothing usable across all attempts -> floor
        return {
          aesthetic: acc.aesthetic ?? floor.aesthetic,
          personality: acc.personality,
          lore: acc.lore,
          tagline: acc.tagline ?? floor.tagline,
          signatureCharacter: acc.signatureCharacter,
        };
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FUSED_DERIVE_TIMEOUT_MS)),
    ]);
    return result ?? floor;
  } catch {
    return floor;
  }
}

/** DIAGNOSTIC (used by verify-fusion-identity): run ONE raw fused-persona call and return the raw reply, its
 *  finish reason, the post-strip text, and what parsed/salvaged - so a floor fallback can be diagnosed live. */
export async function deriveFusedPersonaDebug(input: DeriveFusedPersonaInput): Promise<{
  provider: string;
  finishReason: string;
  rawLen: number;
  rawHead: string;
  rawTail: string;
  parsedKeys: string[];
  salvagedKeys: string[];
}> {
  const chosen = (await pickProvider()).provider;
  const messages = buildFusedMessages(input);
  const r = await runLlm(chosen, messages, undefined, { maxTokens: FUSED_DERIVE_MAX_TOKENS });
  const raw = r.text ?? "";
  const parsed = extractJson(raw);
  const salvaged = salvageJsonFields(raw, FUSED_KEYS);
  return {
    provider: r.provider,
    finishReason: r.finishReason,
    rawLen: raw.length,
    rawHead: raw.slice(0, 300),
    rawTail: raw.slice(-300),
    parsedKeys: parsed ? Object.keys(parsed) : [],
    salvagedKeys: Object.keys(salvaged),
  };
}
