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

// ── agent-display curation (throwaway / internal test agents hidden from public BROWSE surfaces) ──────
// The AGENT analog of the output curation above. Two independent hide rules are OR'd:
//   1. by NAME - internal test / e2e-proof agents. Kept BYTE-FOR-BYTE in lockstep with the web's
//      web/src/lib/api.ts isTestAgentName so every surface (web render + the raw /agents + /api/agents
//      the webapp and any client hit directly) hides the SAME set. Verified NOT to match any real aura
//      name (NOKTURNE/MIRAI/RISO/SCRIPTORIUM/SUMI/UKIYO/RIOT/AUREON/NYXARA/AETHAINE/VELLUM/VANTABLOOM/
//      AURA-FUSION-1/...).
//   2. by ID   - AURA_HIDDEN_AGENT_IDS="35,36,37,38" surgically hides specific agentIds REGARDLESS of
//      name. The general primitive for one-offs whose on-chain NAME is immutable / unrecoverable (e.g. a
//      fused throwaway that cannot be renamed or burned). Unset / "" hides none. Env-driven + reversible,
//      exactly like AURA_HIDDEN_OUTPUT_TOKENS.
//
// WHY (2026-07-07): the Flow-B mainnet agent-sale e2e minted 4 throwaway agents all named
// "SALE-E2E-THROWAWAY" (agentIds 35,36,37,38). #35 and #37 are orphaned (owner keys gone, AuraINFT has no
// burn) and #36/#38 are platform-owned but their on-chain name is immutable, so none can be removed on-
// chain. They are curated OUT of the public browse/count surfaces (name catches these + any future e2e
// artifact; the id list is the belt-and-suspenders for immutable-name one-offs) while staying on-chain
// and DIRECTLY resolvable by id (the agent DETAIL read is not masked -> /agents/:id still works).
const HIDDEN_AGENT_IDS = new Set(
  (process.env.AURA_HIDDEN_AGENT_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n)),
);

/** Internal test / e2e-proof agent by NAME. In lockstep with web/src/lib/api.ts isTestAgentName. */
export function isTestAgentName(name: string | null | undefined): boolean {
  return /^(TESTAGENT|BRAINTEST|SALE-E2E)|THROWAWAY/i.test(name ?? "");
}

/** True when this agentId is surgically hidden via AURA_HIDDEN_AGENT_IDS. null/non-numeric => not hidden. */
export function isHiddenAgentId(agentId: number | bigint | string | null | undefined): boolean {
  if (agentId === null || agentId === undefined) return false;
  return HIDDEN_AGENT_IDS.has(Number(agentId));
}

/** True when an agent is curated OUT of the public browse surfaces (hidden by name OR by id). */
export function isHiddenAgent(a: {
  agentId?: number | bigint | string | null;
  name?: string | null;
}): boolean {
  return isHiddenAgentId(a?.agentId) || isTestAgentName(a?.name);
}
