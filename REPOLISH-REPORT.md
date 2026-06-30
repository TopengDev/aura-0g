# AURA webapp repolish report

Worktree branch `repolish/lexicon-copy-redirect` off `origin/v2` @ 08c1552. Web-only. Build verified clean (tsc + next build). Deploy GATED (main + Christopher).

Three parts: (1) the Aura/Relic lexicon, (2) copywriting elevation, (3) the slow agent/relic page redirect (diagnosed + fixed, measured before/after).

---

## 1. Lexicon (Aura / Relic)

Locked terms applied across every user-facing string in `web/src`:

- an **agent** is an **Aura** (instance). The brand/platform stays **AURA** (all caps).
- an **output / creation / piece** is a **Relic**.

Convention used to avoid the AURA-brand vs Aura-instance collision: brand is always all-caps `AURA`; an instance is `Aura` / `Auras` in prose, and lowercase `aura` / `relic` only inside the mono micro-label / activity-chip system (which renders uppercased anyway). Code identifiers, type names, route paths (`/agents`, `/outputs`), the `OutputNFT`/`AgentRegistry` contract labels, and API field names were intentionally left unchanged (not user copy).

### Surfaces updated (consistent, no mixed agent/Aura left)

- **Chrome**: Nav (`Agents` -> `Auras`), Footer (thesis line, columns, bottom tag).
- **Home**: Hero, Thesis, HowItWorks, FeaturedAgents (`Meet the Auras`), AgentTheatre, CharacterGallery (`Made by Auras. Owned by you.`), OutputsRail (`Recent relics`, `Each one a verifiable Relic.`), StatsLedger (`Living Auras` / `Relics minted`), ActivityTicker (`AURA MINT`), CtaClose.
- **Detail**: AgentDetailView (`Living Aura`, `Relics created`, trade/summon notes), OutputDetailView (`Verifiable Relic`, `Relic NFT`, creator/generative copy).
- **Product views**: AgentsBrowse, ExploreView, GenerateView, CreateView, DashboardView (tabs `My Auras` / `My Relics`, empty states, stats), FaucetView, VerifyView (`Verify any Relic.`, `Relic token id`, checklist), SummonPanel, TradePanel (kind -> `Aura`/`Relic` noun).
- **Metadata** (SEO + tab titles): all 8 page `metadata` blocks + the two dynamic detail pages' `generateMetadata` fallbacks (`Aura | AURA`, `Relic | AURA`).
- **Faux-OS hero flavor**: CliTerminal (`a living creative Aura`, `relic.png`, alt text), ProcessPanel (`verifiable Relic`), scene.ts (`nokturne-aura`).

Verified with a final sweep: no user-facing `agent` / `output` / `piece` / `creation` / `artifact` (as a creation synonym) string remains. The only `artifact` left is the CreateView negative-prompt placeholder `"artifacts, watermarks"` which correctly means image defects, not a creation.

---

## 2. Copywriting

Tightened the copy toward the thesis (verifiable creative Living Agents, "art you can prove") without overclaiming beyond what is live:

- Hero/Thesis lead on **provenance**: "Every Relic is created by an autonomous on-chain Aura, attested in a TEE, and stored on 0G."
- **Summon** framed as demand-pull commissioning ("Pay to summon ... it creates a TEE-attested 1/1 live, on demand").
- **Provable-Pulls** kept (`Standard Relic (no provable-pull seed) - reads as Common`, the provable-pull verify panel).
- **Income-follows** sharpened on the trade/royalty notes ("The royalty follows the work", "Own the Aura, earn from every summon").
- **TEE / 0G provenance** kept honest and concrete (the verify checklist, the provenance block).

Style: NO em/en dashes anywhere in `web/src` (verified zero, including two code comments that were cleaned). Replaced the prior em dashes with `,` / `-`.

---

## 3. The slow agent/relic page redirect — DIAGNOSIS + FIX

### Measurement BEFORE (live aura.topengdev.com)

Web detail page SSR (this is the "very slow redirect"):

| Route | TTFB |
|---|---|
| `/agents/20` | **5.5s** |
| `/outputs/23` | **6.8s** |

Backend per-route TTFB (the cause):

| Backend route | TTFB | |
|---|---|---|
| `/api/agents/:id` (indexer) | 0.085s | fast |
| **`/agents/:id` (ROOT on-chain DNA read)** | **5.75s** | THE bottleneck (0G RPC eth_calls for styleFingerprint / modelAttestation / encBrainRoot) |
| `/api/outputs/:id` | 0.078s | fast |
| `/provenance/:id` | 1.17s | |
| `/royalty/:id` | 1.44s | |
| `/marketplace` | 0.057s | fast |

### Root cause (NOT the image-perf issue, a separate navigation cost)

Both detail pages were `export const dynamic = "force-dynamic"`, every fetch was `cache: "no-store"`, there was **no `loading.tsx`**, and both pages **blocked their SSR on the 5.75s `/agents/:id` on-chain DNA read**:

- **Agent page**: blocks directly inside `fetchAgentById` (`Promise.all([/api/agents/:id 85ms, /agents/:id 5.75s])` takes the max).
- **Relic page**: a two-stage waterfall. Stage A (output + provenance + royalty + marketplace, ~1.4s) then a blocking **stage-B `fetchAgentById(creatorAgentId)`** that pays the same 5.75s chain read -> 1.4 + 5.75 ~= 6.8s.

With no `loading.tsx` and `force-dynamic`, the browser shows the old page (or nothing) for the entire TTFB on navigation = the perceived "very slow redirect."

### The fix (web-only, no backend / indexer / DATABASE_SCHEMA change)

1. **`loading.tsx` skeletons** for `/agents/[id]` and `/outputs/[id]` — Next streams an instant skeleton the moment navigation starts, so the page paints in ~30ms instead of blocking on the data. This alone removes the perceived redirect.
2. **`fetchAgentById(id, includeDna = false)`** on the relic page — the creator link only needs the display identity (name/accent/aesthetic) from the **fast 85ms indexer read**; the unforgeable model + style attestations already render from `provenance.agent` (the view already prefers them). This removes the ~5.75s stage-B chain read from the relic page entirely.
3. **Next data-cache (`revalidate`)** on the immutable / slow reads in `lib/api.ts` (`getJson` gained an opt-in `revalidate`): the DNA chain read is cached 300s (it is immutable once minted), per-Relic mint reads 300s, provenance 30s, royalty 20s, marketplace 15s. So the slow RPC is amortized across visitors, not re-paid on every navigation.
4. **ISR instead of `force-dynamic`** (`export const revalidate = 30`) on both detail pages — rendered on demand then cached, so warm hits are instant. The inline Verify action still re-checks live on-chain, so the trust claims stay fresh regardless of the page cache. `/verify` + the gacha/summon flows are untouched.

### Measurement AFTER (local production build, pointed at the live backend)

| Route | BEFORE TTFB | AFTER TTFB | AFTER full content (cold) | AFTER full content (warm) |
|---|---|---|---|---|
| `/outputs/[id]` (relic) | 6.8s | **0.05s** | **1.9s** (was 6.8s) | **0.52s** |
| `/agents/[id]` (aura) | 5.5s | **0.02s** | 5.5s (first uncached render only) | **0.40s** |

- **Time-to-first-paint** (the actual "redirect" feeling): **5.5-6.8s -> ~0.03s** (a ~100x improvement) on every navigation, from `loading.tsx` streaming.
- **Relic page full content**: **6.8s -> 1.9s cold** (3.5x) from removing the DNA waterfall; **0.52s warm**.
- **Aura page**: warm **0.40s** (14x) from ISR. The cold full-content is still ~5.5s because the agent's OWN page legitimately needs its DNA, and that 5.75s is a backend RPC cost (see follow-up). But TTFB is instant (skeleton) and the jury clicking around hits the warm path.

### Honesty / residual

The one remaining cold cost is the agent's own page first render (~5.5s) when the 300s DNA cache is cold, because that page genuinely renders the on-chain DNA panel. It is hidden behind the instant skeleton and amortized by the cache, but the true root is the backend `/agents/:id` RPC latency. **Follow-up (out of web scope, backend):** cache the immutable DNA fields server-side (or stream the DNA panel behind its own Suspense boundary) to make even the cold agent page sub-second. Not required for this jury-facing pass.

---

## Verification summary

- `npx tsc --noEmit` -> exit 0.
- `pnpm build` (next build) -> compiled + linted + type-checked clean; both detail routes `ƒ (Dynamic)` (ISR on-demand).
- Lexicon final sweep -> no user-facing agent/output/piece/creation strings remain.
- Em/en dash sweep -> zero in `web/src`.
- Redirect fix measured before/after on the same backend data (table above).
- `/verify`, content-addressing (`/images/[root]`), and the gacha/summon flows untouched.
