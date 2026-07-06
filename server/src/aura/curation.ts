// Shared output-display curation. ONE parse of AURA_HIDDEN_OUTPUT_TOKENS, shared by every surface that can
// expose a Relic, so a superseded token is hidden CONSISTENTLY across LIST feeds AND single-token direct reads:
//   - routes/indexer.ts      curateOutputs()  -> gallery / discover / agent-detail LIST feeds
//   - routes/reads.ts        /outputs/:id + /provenance/:id  -> single-token direct provenance reads
//   - routes/verify-public.ts /api/verify?token=  -> the public keyless provenance surface
// Without a shared predicate a hidden token drops out of the galleries but a DIRECT read still served it - and
// worse, MIS-LABELED it (a z-image relic shown under the site's advertised qwen provenance). Masking every
// direct read to a not-found state keeps one consistent provenance story.
//
// WHY hide (2026-07-06): the first showcase Relics were minted while image-gen ran on 0G MAINNET z-image-turbo
// (enclave signer 0x592056...). Image-gen was then reverted to 0G TESTNET qwen-image-edit and OutputNFT.teeSigner
// re-pinned to 0x2A94D671..., so those relics' stored enclave signature no longer matches the advertised qwen
// provenance. They stay on-chain (immutable) but are curated OUT of the DISPLAY. Env-driven + fully reversible:
// AURA_HIDDEN_OUTPUT_TOKENS="1,2,3,4" hides those ids; unset / "" shows everything again.
const HIDDEN_OUTPUT_TOKENS = new Set(
  (process.env.AURA_HIDDEN_OUTPUT_TOKENS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n)),
);

/** True when at least one token is curated out (lets a list filter early-return as a pure no-op). */
export function hasHiddenOutputs(): boolean {
  return HIDDEN_OUTPUT_TOKENS.size > 0;
}

/** True when this tokenId is curated out of the public display. null/undefined/non-numeric => not hidden. */
export function isHiddenOutput(tokenId: number | bigint | string | null | undefined): boolean {
  if (tokenId === null || tokenId === undefined) return false;
  return HIDDEN_OUTPUT_TOKENS.has(Number(tokenId));
}
