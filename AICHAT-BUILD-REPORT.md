# AICHAT-BUILD-REPORT: live AI chat-with-an-Aura (the Living-Agents core)

**Worker:** `aura-aichat-build` (Opus, MAX) | **Parent:** `aura-zerocup-build` | **Date:** 2026-06-30
**Branch:** `feat/aura-aichat` off `ab2da4d` (origin/v2) in worktree `~/claude/Git/worktrees/aura-aichat-build`
**Status:** BUILT + VERIFIED LIVE. Additive, no contract change, low blast radius. NOT deployed (gated to main + Christopher).

---

## 0. What shipped (one breath)

You can now talk to an Aura on its detail page. It answers in character (grounded in its on-chain identity + the catalog persona), it remembers your prior conversations (owner-sealed L2 memory, dual-wall on resale), every reply is TEE-attested when 0G serves it (honestly labeled), and it can ACT: it reads its own on-chain stats and creates a Relic on request, which you mint NON-CUSTODIALLY by signing in your own wallet. If 0G is down, a provider seam transparently falls back to Anthropic behind a health check (and the reply is labeled NOT TEE-attested, never overclaimed).

All five components from the brief are built and verified against the LIVE 0G testnet.

---

## 1. The five components

### 1. CHAT backend (0G TEE chat)
- `server/src/aura/chat-compute.ts` - the text-LLM analogue of the proven image `compute.ts`. Discovers the 0G `chatbot` service (qwen2.5-omni-7b / TeeML), POSTs the OpenAI-shape `/chat/completions` with the broker billing header, captures the per-reply TEE attestation via the SAME `processResponse` path image gen uses, with the documented fund-and-retry (reuses `fundCompute`). Broker + service are cached (5 min TTL) so a chat does not re-list services every message.
- `server/src/aura/chat-persona.ts` - the system prompt assembles on-chain identity (the facts) + catalog meta (the voice: `lore`/`personality`/`aesthetic`/`signatureCharacter`) + retrieved owner memory + the honest hard-rules (dual-wall, non-custodial, no overclaim, no emoji, no long hyphens).
- `server/src/routes/chat.ts` - `POST /chat`.

### 2. COMMAND-SURFACE (the moat) - the Aura ACTS from chat
- `server/src/aura/chat-tools.ts` - OpenAI-style tool defs + the router:
  - `read_onchain({field})` - a pure on-chain/indexer READ (royalties, earnings, outputs, owner, worth). Safe, no signing, no cost.
  - `generate_and_mint({subject})` - a GUARDED creation. Kicks off a REAL TEE generation through the EXACT existing guarded path (per-user rate limit + the global cost guard + `runGeneration`/`generateAndProve`). It does NOT mint: minting stays a non-custodial wallet action the owner signs via the existing `/mint-args` -> `OutputNFT.mintOutput` flow. No on-chain state changes without the owner's signature; the orchestrator never holds a user key.

### 3. MEMORY (v2, Layer 2 - the relationship)
- `server/src/aura/chat-memory.ts` - per `(agentId, owner)` relationship. Each turn is sealed AES-256-GCM under a per-relationship data key; the data key is ECIES-sealed to the owner's secp256k1 pubkey (the same `sealing.ts` primitive the brain de-mock uses). THE DUAL-WALL is enforced at the loader by key custody: retrieval is scoped to the CALLER's wallet address. A different owner is a different address -> a different key -> their segments are never in the retrieval set and do not unseal. After a resale the buyer authenticates as a NEW address -> a fresh epoch -> the seller's relationship is structurally unreachable (forward-secret on resale). v1 keeps a server-custody copy of the AES key (exactly like `agent_brains` today) so memory can be injected without the user's private key, and persists to the durable local SQLite (testnet 0G Storage evicts blobs; permanence is a mainnet property). Tables are created lazily (no edit to the proven `db.ts` migration).

### 4. RELIABILITY (provider seam + fallback)
- `server/src/aura/chat-llm.ts` - one normalized `LlmResult` over two backends: `zerog` (TEE-attested, the on-thesis default) and `anthropic` (the fallback, NOT TEE-attested -> attestation null, labeled honestly). `pickProvider()` runs a cheap 0G health probe and falls back to Anthropic on health-fail; `runLlm()` ALSO falls back transparently if a 0G call errors mid-turn. The Anthropic key is server-side only (`AURA_CHAT_ANTHROPIC_KEY`, falls back to `ANTHROPIC_API_KEY`) - never `NEXT_PUBLIC`, never logged, never returned to the client. OpenAI tool/message shapes are reshaped to/from the Anthropic Messages API.

### 5. UI (the chat panel)
- `web/src/components/product/AuraChat.tsx` - a premium, on-brand (Technical-Editorial) chat panel on the Aura detail page: owner/Aura bubbles, a per-reply verifiable badge (green "TEE-verified . <model>" when 0G served it, muted "Fallback . not TEE-attested" otherwise), command-surface tool cards, a non-custodial `RelicMintCard` (polls the gen job, previews the TEE image, then signs `mintOutput` via the existing `useMint`), an honest framing footer, and a SIWE sign-in gate. Uses the shared CSS tokens so light + dark both inherit the polished theme.
- `web/src/lib/api.ts` - chat fetchers (`sendChat`, `fetchChatHistory`, `fetchChatHealth`) added.
- `web/src/components/product/AgentDetailView.tsx` - the panel wired in under the on-chain Identity panel.

---

## 2. The verifiable framing (HONEST - this is sacred)

What is TRUE and demonstrated, and what is NOT, stated plainly (and rendered in the UI):

- **Per-reply TEE attestation is REAL.** When 0G serves a reply, `processResponse` returns `true` (verifiability `TeeML`, a TEE signer) - the reply provably ran in a 0G TEE, the same provenance class as image gen. The badge says "TEE-verified" only then.
- **The fallback is NOT TEE-attested.** When Anthropic serves (0G down), `attestation` is null and the badge says "Fallback . not TEE-attested." We never label a fallback reply as attested.
- **A full turn is not one proof.** A turn = on-chain identity read (verifiable: a chain read) + private owner-gated memory retrieval (NOT publicly provable, by design) + the LLM call (TEE-attested when on 0G) + any tool action (the on-chain action it routes to is separately verifiable when signed). The UI footer states exactly this. We do NOT claim a single end-to-end proof of the whole conversation.
- **Memory is private + owner-scoped.** A third party cannot verify what the Aura "remembered" - that is the point of the dual-wall. The provable line is "a being that does not gossip about its past owners," and that one holds.

---

## 3. Live evidence (verified against 0G Galileo testnet, via `server/src/scripts/verify-chat.ts`, app.inject())

Agent under test: **#1 NOKTURNE**. Owner = sponsor wallet `0x2537..5540`.

| Check | Result |
|---|---|
| **T0 /chat/health** | `{zerogHealthy:true, zerogModel:"qwen/qwen2.5-omni-7b", fallbackConfigured:true, preferred:"zerog"}` |
| **T1 TEE chat** | HTTP 200, `provider=zerog`, **`teeAttested=TRUE`**, in-character reply ("I am Nokturne, an Aura on AURA...") |
| **T2 command-surface READ** | `read_onchain` executed a REAL on-chain read (NOKTURNE: 0 Relics, 7% royalty); Aura narrated it in character |
| **T3 memory recall** | Aura recalled "empty cathedral at midnight" across turns; `/chat/:id/history` round-tripped 4 sealed turns |
| **T3b dual-wall** | owner reads 5 records; a STRANGER address reads **0** records, blocked=5 (segments opaque). PASS |
| **T4 fallback** | forced Anthropic served the reply, `provider=anthropic`, `attestation=null`, badge would read NOT TEE-attested. PASS |
| **T5 command-surface CREATE** | `generate_and_mint("a lone figure on a rain-slick bridge at midnight")` -> REAL TEE gen job -> **done, `teeVerified=true`**, model qwen/qwen-image-edit-2511, imageRoot `0x55a406ab..`, mintable; `/mint-args` produced the non-custodial unsigned mint (attestationSig `0x1a200f73..`). The owner signs `mintOutput` (the existing-proven user step). |

Build gates:
- **server tsc**: clean (exit 0).
- **web tsc**: clean. **`next build`**: clean (all 12 routes; `/agents/[id]` now 12.1 kB / 384 kB first load).
- **In-browser render**: the chat panel renders on the NOKTURNE detail page (screenshot `/tmp/aichat-detail.png`), on-brand, dark polished. No errors from chat code in the dev logs (the only dev errors were environmental: the indexer was not running locally, so pre-existing endpoints fell back to chain-scan + hit the public RPC rate limit).
- **/verify + summon/gacha UNTOUCHED**: the only change to an existing server file is `app.ts` (+2 additive lines: import + register `chatRoutes`). The server booted with every existing route serving.

---

## 4. Guards + safety

- **Non-custodial**: no tool signs for the user. `generate_and_mint` returns an unsigned mint the owner signs in their wallet. `read_onchain` is read-only.
- **Cost guards intact**: `generate_and_mint` goes through the SAME per-user rate limit + global cost guard + per-address quota as `POST /generate`, so chat cannot bypass the sponsor-spend budget. `POST /chat` is itself rate-limited per user (each 0G reply settles a ledger fee).
- **TEE enforced on creations**: a chat-created Relic inherits `ENFORCE_TEE_VERIFICATION` from `generateAndProve` (an unverified gen is never made mintable).
- **Keys**: the Anthropic key is server-side only; never printed, never `NEXT_PUBLIC`. The sponsor key is unchanged (the existing tx-sending path).
- **No long hyphens**: model replies are dash-sanitized server-side (em/en dash -> comma) so user-facing output honors the house rule even when the LLM does not.

---

## 5. Files

New (8): `server/src/aura/chat-compute.ts`, `chat-llm.ts`, `chat-persona.ts`, `chat-memory.ts`, `chat-tools.ts`, `server/src/routes/chat.ts`, `server/src/scripts/verify-chat.ts`, `web/src/components/product/AuraChat.tsx`.
Modified (3, all additive): `server/src/app.ts` (+2), `web/src/lib/api.ts` (chat fetchers), `web/src/components/product/AgentDetailView.tsx` (import + panel).

Endpoints added: `POST /chat`, `GET /chat/:agentId/history`, `GET /chat/health`.

---

## 6. Honest bounds (carry into the pitch)

- 0G serves ONE chat model and it is a 7B (omni). Tool-calling was clean on the verified turns; a 7B can degrade on hard multi-tool disambiguation. Mitigation: few + unambiguous tools, the fallback for the live demo, a stronger mainnet model later.
- Single third-party 0G provider = a single point of failure on demo day. Mitigation: the provider seam + the pre-reply health check that auto-switches to the fallback.
- Memory permanence is a mainnet property (testnet 0G Storage evicts); v1 is a durable LOCAL cache, framed as "remembers within the cache," never as free-testnet permanence.
- Forward-secrecy is bounded (no "the seller is wiped" claim). The provable line is the no-gossip dual-wall.

---

## 7. Post-jury / mainnet follow-ups

- Move chat to a stronger mainnet-served model (fixes the 7B tool-reliability worry).
- Full on-chain sealed L2 memory (drop the server-custody key copy) + an embedding-index RAG built inside the owner-gated boundary, rebuilt on transfer.
- Optional sealed `personaDescriptor` so the talking-voice is itself transferable on-chain.
- Streaming replies + mid-stream tool-confirmation cards.
