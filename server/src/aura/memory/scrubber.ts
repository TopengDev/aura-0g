// SERVER-ONLY. The BASIC fail-closed scrubber — the backstop on the only free text that enters Layer 1.
//
// Per the design (MEMORY-DESIGN-owner-safety §3.3) + the MVP cut (research report §3): this is the
// MINIMAL scrubber — deterministic FORMAT rules + an EPOCH-LOCAL DENYLIST. The full semantic NER pass and
// the complete fail-closed matrix are M3-full / fast-follow, NOT this stage. The load-bearing guarantee
// for the MVP is still STRUCTURAL: the dataflow membrane (selfReflect-only writer) + the no-owner-field
// schema mean PII has no code path into L1; this scrubber catches the residual free-text leak.
//
// HONESTY (RS1): a content filter is never provably complete. A determined seller has a low-bandwidth
// covert channel via obfuscated free text. We minimize L1 free text and FAIL CLOSED: anything the scrubber
// cannot certify clean is DROPPED or downgraded to L2 — never admitted to the transferable layer.

export type ScrubVerdict = { ok: true } | { ok: false; reason: string };

/** Format rules (deterministic): literal-identity shapes that must never enter L1. */
const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "wallet-address", re: /0x[a-fA-F0-9]{40}\b/ },
  { name: "ens-name", re: /\b[a-z0-9-]+\.eth\b/i },
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { name: "phone", re: /(?:\+?\d[\d\s().-]{7,}\d)/ },
  { name: "url-with-handle", re: /https?:\/\/\S*[@/](?:user|profile|@)\S+/i },
  { name: "url", re: /https?:\/\/\S+/i },
  { name: "at-handle", re: /(?:^|\s)@[A-Za-z0-9_]{2,}\b/ },
];

/**
 * Scrub a free-text field destined for Layer 1.
 * @param text          the candidate free text
 * @param epochDenylist the CURRENT epoch's owner-identity values (displayName, handle, walletAddr, ...).
 *                      Because scrubbing happens contemporaneously during that owner's epoch, the owner's
 *                      own name never enters L1 in the first place — no cross-epoch PII retention needed.
 */
export function scrubText(text: string, epochDenylist: string[] = []): ScrubVerdict {
  if (text == null) return { ok: true };
  for (const { name, re } of PATTERNS) {
    if (re.test(text)) return { ok: false, reason: `format:${name}` };
  }
  const hay = normalize(text);
  for (const raw of epochDenylist) {
    const needle = normalize(raw);
    if (needle.length >= 3 && hay.includes(needle)) {
      return { ok: false, reason: `denylist:${raw}` };
    }
  }
  return { ok: true };
}

/** Lowercase + strip common leet/spacing obfuscation so trivial evasions still hit the denylist. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4@]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^a-z0-9]/g, ""); // drop spaces/punctuation used to break up a name
}

/** Convenience: is this free text admissible to Layer 1? (Fail-closed at the call site.) */
export function isCleanForL1(text: string | undefined, epochDenylist: string[] = []): boolean {
  if (text === undefined) return true;
  return scrubText(text, epochDenylist).ok;
}
