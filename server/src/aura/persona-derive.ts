// SERVER-ONLY. Derive a RICH chat persona for a user-created Aura from what the user gave (name +
// styleDescriptor + signatureCharacter), via the SAME chat LLM seam the chat route uses (0G mainnet
// GLM-5.1 TeeML when AURA_CHAT_MAINNET=1, else testnet qwen; chat-llm.runLlm with its honest fallback
// ladder). BEST-EFFORT with a hard timeout: on ANY failure it returns the FLOOR (the raw style + signature
// alone already give the chat a strong, non-generic voice). The caller persists the floor synchronously and
// only enriches on success, so a create can never be blocked or failed by derivation.
import { pickProvider, runLlm } from "./chat-llm.js";
import type { ChatMessage } from "./chat-compute.js";

// GLM-5.1 on 0G mainnet takes ~15-25s for a rich reply (measured), and a fresh process also pays broker/
// ledger init on the first call. 40s keeps derivation best-effort without truncating a slow-but-valid reply.
// This is safe: create persists the FLOOR synchronously and runs derivation fire-and-forget, so a long (or
// timed-out) derivation never blocks or fails the create.
const DERIVE_TIMEOUT_MS = 40_000;
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
        const r = await runLlm(chosen, buildMessages(input), undefined, { maxTokens: DERIVE_MAX_TOKENS });
        const parsed = extractJson(r.text ?? "");
        if (!parsed) return null;
        const personality = str(parsed.personality);
        const lore = str(parsed.lore);
        const tagline = str(parsed.tagline) ?? floor.tagline;
        const aesthetic = str(parsed.aesthetic) ?? floor.aesthetic;
        // require at least a personality OR lore for it to count as an enrichment; else fall to floor.
        if (!personality && !lore) return null;
        return { aesthetic, personality, lore, tagline };
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), DERIVE_TIMEOUT_MS)),
    ]);
    return result ?? floor;
  } catch {
    return floor;
  }
}
