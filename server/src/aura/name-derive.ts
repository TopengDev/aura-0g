// SERVER-ONLY. 0G-TEE-backed generation of a beautiful, ORIGINAL name for a FUSED child Aura, via the SAME
// chat LLM seam the chat + persona paths use (pickProvider + runLlm -> 0G mainnet GLM-5.1 when AURA_CHAT_MAINNET=1,
// else 0G testnet qwen; both TEE-attested/verifiable, on-thesis). BEST-EFFORT with a hard timeout: on ANY
// failure it returns null and the caller falls back to a DETERMINISTIC, genome-seeded mythic coinage (NEVER the
// ugly AURA-FUSION-N, NEVER a bare "-2" counter). Every derived name is sanitized to a clean, on-chain-safe
// string (<=48 chars, single line, whitespace-deduped, punctuation-stripped, uppercased to match the roster).
import { ethers } from "ethers";
import { pickProvider, runLlm } from "./chat-llm.js";
import type { ChatMessage } from "./chat-compute.js";
import type { Genome } from "./game/fuse-genome.js";

// GLM-5.1 on 0G mainnet takes ~10-25s for a reply (measured). A name is a handful of tokens, but the FIRST
// call against a freshly-initialized broker frequently returns an EMPTY completion (a verified 0G cold-start
// quirk; the warm retry returns content), so derivation retries once and the timeout budgets for two calls.
const NAME_TIMEOUT_MS = 45_000;
const NAME_ATTEMPTS = 2; // retry once on an empty/unusable reply (cold-broker quirk; mirrors persona-derive)
const NAME_MAX_TOKENS = 64; // a name is short; headroom for a stray label/sentence we then strip
const MAX_NAME_LEN = 48; // matches create-agent's on-chain name ceiling + the child-name slice in fuse.ts

export interface FuseNameParent {
  name: string;
  aesthetic: string;
  signatureCharacter?: string | null;
}

export interface DeriveFusedNameInput {
  parentA: FuseNameParent;
  parentB: FuseNameParent;
  blendedStyleDescriptor: string; // the child's genome-derived blended style (the visible hybrid)
  avoid?: string[]; // names to steer the model AWAY from (already-taken / already-tried)
}

/**
 * Clean an LLM (or fallback) name into a tasteful, on-chain-safe string. Robust to the model wrapping the
 * name in a label ("Name: X"), quotes, markdown, or a trailing sentence: takes the first line, strips a
 * leading label, removes quotes/markdown/punctuation, keeps only letters (incl. accented) + digits + spaces
 * + hyphen + apostrophe, dedupes whitespace, caps at 48, and uppercases to match the existing roster
 * (NYXARA / VELLUM / ARCANUM are all uppercase). Returns "" if nothing usable remains.
 */
export function sanitizeName(raw: string): string {
  if (!raw) return "";
  let s = String(raw).split(/\r?\n/)[0] ?? ""; // first line only
  s = s.trim();
  // a labelled reply ("Name: Aetheris", "The name is: X") -> keep the part after the LAST colon.
  if (s.includes(":")) s = s.slice(s.lastIndexOf(":") + 1).trim();
  s = s.replace(/[*_`~]+/g, "").trim(); // markdown emphasis
  s = s.replace(/^["'“”‘’(){}\[\]«»]+|["'“”‘’(){}\[\]«»]+$/g, "").trim(); // surrounding quotes/brackets
  s = s.replace(/[.,;:!?]+$/g, "").trim(); // trailing sentence punctuation
  // keep letters (any script), digits, spaces, hyphen, apostrophe; drop everything else.
  s = s.replace(/[^\p{L}\p{N} '\-]/gu, "").replace(/\s+/g, " ").trim();
  if (!s || !/\p{L}/u.test(s)) return ""; // must contain at least one letter
  if (s.length > MAX_NAME_LEN) s = s.slice(0, MAX_NAME_LEN).trim();
  return s.toUpperCase();
}

function buildNameMessages(input: DeriveFusedNameInput): ChatMessage[] {
  const sig = (p: FuseNameParent) => (p.signatureCharacter?.trim() ? ` Its signature subject: ${p.signatureCharacter.trim()}.` : "");
  const avoid = input.avoid && input.avoid.length
    ? `\nDo NOT use, and stay clearly distinct from, any of these already-taken names: ${input.avoid.slice(0, 40).join(", ")}.`
    : "";
  const system =
    'You NAME a brand-new, one-of-a-kind on-chain creative AI agent called an "Aura", born from FUSING two ' +
    "parent Auras. Invent ONE original, evocative, mythic and artful COINAGE that captures the blend of both " +
    "parents and the child's own visual style. Hard rules: a single invented word (or at most two tight words), " +
    "3 to 16 letters, pronounceable and beautiful, NOT a common real English word, NOT either parent's name, no " +
    "numbers, no punctuation, no quotes, no explanation. Return ONLY the name itself, nothing else.";
  const user =
    `PARENT ONE: ${input.parentA.name} - ${input.parentA.aesthetic}.${sig(input.parentA)}\n` +
    `PARENT TWO: ${input.parentB.name} - ${input.parentB.aesthetic}.${sig(input.parentB)}\n` +
    `THE CHILD'S BLENDED STYLE (genome-derived): ${input.blendedStyleDescriptor}\n\n` +
    `Coin the child's name.${avoid}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/**
 * Derive ONE beautiful name via 0G TEE compute. ALWAYS resolves (never throws): returns a sanitized name on
 * success, or null on any failure/timeout/empty-reply/collision-with-avoid (the caller then uses the
 * deterministic genome-seeded fallback). Retries once on the cold-broker empty-reply quirk.
 */
export async function deriveFusedName(input: DeriveFusedNameInput): Promise<string | null> {
  const avoidSet = new Set((input.avoid ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const forbidden = new Set([input.parentA.name.trim().toLowerCase(), input.parentB.name.trim().toLowerCase()]);
  try {
    return await Promise.race([
      (async (): Promise<string | null> => {
        const chosen = (await pickProvider()).provider;
        const messages = buildNameMessages(input);
        for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
          const r = await runLlm(chosen, messages, undefined, { maxTokens: NAME_MAX_TOKENS });
          const name = sanitizeName(r.text ?? "");
          if (!name || name.length < 2) continue; // empty/too-short -> retry (cold-broker quirk)
          const lc = name.toLowerCase();
          if (forbidden.has(lc) || avoidSet.has(lc)) continue; // a parent's name / a taken name -> retry
          return name;
        }
        return null;
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), NAME_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

// ─────────────────────────── deterministic genome-seeded fallback ───────────────────────────
// A tasteful mythic-coinage generator used when 0G is unavailable OR to produce a UNIQUE variant after the
// 0G attempts all collided. Fully deterministic in (genome, parents, attempt) so it is recomputable, and it
// varies by `attempt` so the uniqueness loop can walk to a free name WITHOUT ever appending a bare "-2".
// prefix x infix x suffix = a large space (well over a thousand combos), so a free variant is always found.
const NAME_PREFIX = [
  "AUR", "NYX", "VEL", "LUM", "UMBR", "CAEL", "RYO", "NOCT", "THER", "ZEPH",
  "OBSI", "IGNI", "MYR", "SOL", "VESP", "CYAN", "EMB", "ASH", "KESTR", "ORIN",
  "HALC", "SABL", "AETH", "VYR", "ELD", "SYL", "QUOR", "DRAV", "FENN", "LIRA",
]; // 30
const NAME_INFIX = ["", "A", "E", "I", "O", "YR", "EL", "AR"]; // 8 (optional connective)
const NAME_SUFFIX = [
  "YX", "ORA", "IEL", "UNE", "ITH", "ARA", "EON", "YRA", "ALIS", "WEN",
  "ION", "ESSA", "MIR", "ELLE", "YRIA", "ENNA", "OSK", "AINE",
]; // 18

/**
 * Deterministic, tasteful, genome-seeded fusion name. `attempt` walks the space for the uniqueness loop.
 * Guaranteed non-empty + sanitized (uppercase, <=48). Recomputable: same (genome, parents, attempt) => same
 * name. NOT the AURA-FUSION-N sentinel and NOT a "-2" counter.
 */
export function deterministicFusedName(genome: Genome, parentAName: string, parentBName: string, attempt = 0): string {
  const seed = ethers.keccak256(
    ethers.toUtf8Bytes(`AURA-FUSE-NAME-v1|${genome.join(",")}|${parentAName}|${parentBName}|${attempt}`),
  );
  const h = BigInt(seed);
  const pick = (shift: bigint, mod: number): number => Number((h / shift) % BigInt(mod));
  const p = NAME_PREFIX[pick(1n, NAME_PREFIX.length)]!;
  const inf = NAME_INFIX[pick(31n, NAME_INFIX.length)]!;
  const s = NAME_SUFFIX[pick(4099n, NAME_SUFFIX.length)]!;
  // avoid an awkward triple-vowel seam at the prefix/infix/suffix joins by dropping the infix if it would
  // duplicate the neighbouring vowel (purely cosmetic; keeps the coinage pronounceable).
  const isVowel = (c: string) => "AEIOUY".includes(c);
  let mid = inf;
  if (mid && isVowel(p[p.length - 1]!) && isVowel(mid[0]!)) mid = mid.slice(1);
  const composed = `${p}${mid}${s}`;
  return sanitizeName(composed) || `AUR${s}`; // sanitize is a no-op here but keeps one clean exit
}
