# AURA web/ — Phase 1 Build Spec (foundation + design system + chrome + Home)

Authoritative spec. Build EXACTLY to this. Archetype = Technical Editorial. Light-first + dark.
English-only. NO em-dashes / long hyphens ANYWHERE (code, content, comments). Do NOT commit/push.

## 0. Location, branch, stack
- App root: `~/claude/Git/repositories/zerog-smoke/web/` (NEW Next.js app, on the `v2` branch). Leave repo-root `app/` (v1) UNTOUCHED.
- This is a SEPARATE Next app with its own package.json + node_modules inside `web/` (do not entangle with the root monolith's 0G SDK deps).
- Next.js 15 App Router, React 18 (use 18 for RainbowKit/wagmi peer stability, matching arca), TypeScript, Tailwind v4 (`@theme`).
- Deps: `next@^15`, `react@^18.3` + `react-dom@^18.3`, `@rainbow-me/rainbowkit@^2.2`, `wagmi@^2.12`, `viem@^2.53`, `@tanstack/react-query@^5`, `framer-motion@^11`, `gsap@^3.12`, `lenis@^1.1`. Dev: `tailwindcss@^4`, `@tailwindcss/postcss@^4`, `postcss`, `@types/*`, `typescript`.
- Use **pnpm** (repo uses pnpm 10).
- `next.config.ts`: standard app (NOT static export — we use route handlers for image proxy + API rewrite). `reactStrictMode: true`. `images: { remotePatterns: [...] }` if needed, else `unoptimized` for the demo is fine.

## 1. The backend it talks to (ALREADY RUNNING locally during this build)
- Single base URL = the Fastify server: `http://localhost:8787` (env `NEXT_PUBLIC_AURA_API` default `http://localhost:8787`).
- The indexer (Ponder) is on `http://localhost:42069`; the server proxies it under `/api/*`. The webapp should ONLY talk to 8787.
- CORS: the server allows `http://localhost:3000` by default (`CORS_ORIGIN`). Run `web/` dev on port 3000.

### Exact endpoints + verified shapes (capture these into `web/src/lib/api.ts` types)
- `GET /health` ->
  `{ ok, chainId: 16602, contracts:{agentRegistry,outputNFT,marketplace}, sponsor, attestor, attestorMatchesContract:true, onChainAttestor, sponsorBalance:"1.56...", gen:{totalGenerations,inFlight,cap,maxConcurrent}, time }`
- `GET /api/_indexer` -> `{ ok, service:"aura-indexer", counts:{agents:5, outputs:6, activeListings:0, events:14} }`
- `GET /agents` -> `{ agents: Agent[], source }` where Agent =
  `{ agentId:number, name:"NOKTURNE", owner, creator, royaltyBps, royaltyPct, creatorResaleBps, styleVersion, minted, outputCount, salesCount, royaltiesEarned:"0.00007", royaltiesEarnedWei, mintedAt, style:"noir", meta:{ tagline, aesthetic, accent:"#C8A24B", signatureCharacter } }`
- `GET /outputs?limit=8` -> `{ outputs: Output[], nextCursor, source }` where Output =
  `{ tokenId:number, owner, creatorAgentId, agentName, imageRoot, imageUrl:"/images/0x..", storageScanUrl, seed:"468301020", provenanceHash:"0x..", teeAttestation:"0x..", mintedAt, style }`
- `GET /api/activity?limit=10` -> `{ items: Activity[], nextCursor, source }` where Activity =
  `{ id, kind:"mint"|"sale"|"transfer"|"listing", timestamp, blockNumber, logIndex, txHash, collection, collectionKind, tokenId, agentId, agentName, actor, counterparty, price:"0.001"|null, priceWei, royaltyReceiver, royaltyPaid, platformFee, sellerProceeds, imageRoot, imageUrl, storageScanUrl }`
- `GET /api/discover?sort=trending` -> `{ sort, weights, windowSeconds, items: [{ agentId, name, owner, style, trendingScore, window:{sales,mints,listings}, outputCount, royaltiesEarned, meta:{accent,tagline} }], source }`
  (also `?sort=newest` -> {items: Output[]}, `?sort=top-earners` -> {byAgent[], byWallet[]})

### The 5 agents (REAL, on-chain). Feature the 4 CURATED catalog agents on Home; agentId 5 is `TESTAGENT_039386` (style "custom", 0 outputs) — EXCLUDE it from "featured" (filter to agents with a non-"custom" style OR whose name is in the catalog), but it MAY appear in raw counts.
| id | name | style | accent | tagline | royalty | outputs |
|----|------|-------|--------|---------|---------|---------|
| 1 | NOKTURNE | noir | #C8A24B | Chiaroscuro noir, painted in shadow. | 7% | 3 (1 sale) |
| 2 | MIRAI | cyberpunk | #FF2EC4 | Neon cyberpunk, rain-slick and electric. | 8% | 1 |
| 3 | RISO | risograph | #FF5FA2 | Risograph duotone. Meet Fennic. | 6% | 1 |
| 4 | SCRIPTORIUM | illuminated | #D4AF37 | Illuminated manuscript, gilt and jewel-toned. | 9% | 1 |

> Accents are the AGENT's brand color (used as a card tint / chip), NOT the site accent. The SITE accent stays ink-navy/periwinkle. Tint agent accents subtly (e.g. a 10-14% color-mix wash + the chip), never let them override the warm palette.

### IMAGE SERVING (known gap — handle it)
`/images/{root}` 404s on BOTH backends (the indexer emits the URL but neither streams bytes).
For Phase-1 Home, implement a Next route handler `app/images/[root]/route.ts` that:
  1. Maps the 4 curated agents to their portrait in `web/public/agents/<NAME>.png` (COPY from repo `images/NOKTURNE.png|MIRAI.png|RISO.png|SCRIPTORIUM.png`).
  2. For output roots: try the local generated PNGs (repo `data/generated/*.png` + `server/data/generated/*.png`) via a small static manifest you build at copy-time (copy a couple into `web/public/outputs/` and map known tokenIds), else return a deterministic styled SVG placeholder tinted by the output's `style` (noir/cyberpunk/risograph/illuminated) so the gallery NEVER shows broken images.
  3. Real 0G-Storage byte streaming is a documented Phase-2 integration point — do NOT pull the heavy 0G SDK into `web/`.
Featured-agent cards therefore show REAL agent portraits; output cards show real metadata (agent, seed, TEE attestation, storage root, provenanceHash) with image bytes resolved-or-graceful-placeholder. This satisfies "renders real data" for the data that matters (counts, agents, outputs provenance, activity, trending are all live).

## 2. Design system (port + adapt arca; do NOT copy arca's consent/sound layers)
Copy the TOKEN SYSTEM and motion vocabulary from `~/claude/Git/repositories/arca/dashboard/`:
- `app/globals.css` — copy the `@theme` block, the dark token swap (both `@media prefers-color-scheme` AND `html.dark`), the oklab ambient gradient body wash + `.ambient-wash`, the Lenis CSS, the reduced-motion block, and the `font-display`/`font-mono-x` utilities. RENAME the brand from arca. Keep the warm palette EXACTLY (cream `#f9f8f6`, near-black `#0e0d0a`, inks `#0e0d0a/#46443d/#8c887e`, accent `#2a3858` light / `#93a7d6` dark, warm shadows). Drop the legacy Arca component classes you do not use (or keep a trimmed set).
- `lib/motion.ts` — `EASE = [0.22, 1, 0.36, 1]`, DUR scale. Copy verbatim.
- `components/Reveal.tsx` — the blur-into-focus entrance primitive. Copy.
- Theme system: copy `components/theme/ThemeProvider.tsx`, `ThemeScript.tsx`, `ThemeToggle.tsx`, `constants.ts` BUT remove the `useConsent` dependency (persist to localStorage directly under a `aura-theme` key; no consent gate). Keep the FOUC-safe inline `ThemeScript` (it is load-bearing for no-flash). Keep light as the implicit default.
- Container: `--container-wrap: 1140px`. Cards rounded 22-24px. Warm-tinted shadows only.

### Fonts (self-host; prototype BOTH display faces)
- **Body = Switzer** (Fontshare). Self-host woff2 in `web/public/fonts/switzer/` (download from fontshare or use the variable woff2). Wire via `@font-face` in globals.css OR `next/font/local`. Var `--font-body`.
- **Labels/eyebrows/tags/metadata = Geist Mono** — use `next/font/google` Geist_Mono (exact). Var `--font-mono`.
- **Display = TWO options the owner will pick between, shown side by side in screenshots:**
  - Option A (house default) **Ethereal Glamour**: self-host the .ttf — COPY `~/.local/share/fonts/EtherealGlamour-Regular.ttf` to `web/public/fonts/EtherealGlamour-Regular.ttf`, wire via `next/font/local` or `@font-face`, single weight 400. Var `--font-display`.
  - Option B **Playfair Display**: `next/font/google` Playfair_Display (normal + italic).
  - Implement a build-time switch: read `NEXT_PUBLIC_DISPLAY_FONT` (`ethereal` | `playfair`, default `ethereal`) and set `--font-display` accordingly, so you can render the SAME Home in both for the screenshots. Default to Ethereal Glamour.
  - The arca hero uses italic display for the swap word — Ethereal Glamour is single-weight (no italic); use upright + accent color for the keyword instead of italic when on Ethereal.

## 3. Chrome (every page)
- **Nav**: fixed top bar (arca Navbar pattern: transparent -> frosted hairline on scroll). Left = `AURA` wordmark (display or bold Switzer, letterspaced). Center (md+) = 5 mono links: **Agents, Explore, Generate, Create, Dashboard**. Dashboard link shows ONLY when wallet connected (use `useAccount().isConnected`). Right = **Connect Wallet** (RainbowKit CustomConnectButton, arca pattern) + **theme toggle** (light/dark/system). Active-route state on links (`usePathname`). **Mobile: collapse into a clean slide-down/overlay menu** (hamburger -> full-width panel with the 5 links + connect + theme), no horizontal overflow.
- **Footer**: AURA wordmark + one-line thesis, columns (Explore / Build / Network), the live chainId + contract addresses (mono, linking to `chainscan-galileo.0g.ai/address/<addr>`), a "0G Galileo Testnet" badge, a faucet helper link (`https://faucet.0g.ai`).
- **Faucet helper**: a small mono note/button near connect or in footer linking the 0G faucet ("Need test 0G? Faucet ->").
- **Designed loading / empty / 404**: a shared skeleton (shimmer on the warm surface), an empty-state (mono "no outputs yet" with the provenance line), and `app/not-found.tsx` (on-brand 404 with the line motif). Reusable.

## 4. Web3 wiring (wagmi + viem + RainbowKit, arca pattern)
- `lib/chains.ts`: viem `defineChain` for **0G Galileo Testnet id 16602**, name "0G Galileo Testnet", native `0G` 18 decimals, rpc `https://evmrpc-testnet.0g.ai`, explorer `https://chainscan-galileo.0g.ai`, `testnet:true`. (Copy arca's `zgTestnet`; also include `zgMainnet` 16661 for completeness but the app runs on testnet.)
- `Web3Provider`: `getDefaultConfig({ appName:"AURA", projectId: <WC id>, chains:[zgTestnet], ssr:true, wallets:[injected,metaMask,rainbow,coinbase,walletConnect] })`. WC projectId from `NEXT_PUBLIC_WC_PROJECT_ID` (fallback to arca's public id `8587a9582464416581ee66bc24063ac9` is acceptable for the demo). Wrap in WagmiProvider + QueryClientProvider + RainbowKitProvider (`initialChain: zgTestnet`, theme-aware light/dark RK theme matching the accent, `modalSize:"compact"`). RainbowKit auto-prompts add/switch to Galileo when the wallet is elsewhere.
- **Connect**: balance shown in the connected chip (arca pattern shows displayName + network; extend to show `useBalance` 0G amount).
- **SIWE on connect (MINT-gating only)**: generation is SPONSORED (no connect needed). SIWE is required only to MINT. For Phase-1 (Home only), WIRE the SIWE scaffolding but it is not exercised by Home:
  - `lib/siwe.ts` client helper that, on connect, can request a nonce, build a SIWE message (domain must match `SIWE_DOMAIN=localhost:3000`, uri `http://localhost:3000`), `signMessage` via wagmi, POST to the server's auth route to get a JWT, store it (memory/in a context). The server auth route is `POST /auth/...` (see `server/src/routes/auth.ts` for exact path/shape — read it). Provide an `AuthProvider` exposing `{ token, signIn, signOut, address }`. Home does not block on it. Document that connect != SIWE; SIWE fires at mint time.
  - CONFIRMED auth contract (verified): `GET /auth/nonce` -> `{ nonce }` (single-use). Then build a SIWE message with that nonce (domain `localhost:3000`, uri `http://localhost:3000`, chainId 16602), `signMessage` via wagmi, `POST /auth/verify { message, signature }` -> `{ token, address, expiresIn }`. Store the JWT in the AuthProvider. (Read `server/src/aura/siwe.ts` only if you need the exact SIWE message field format.)

  - CONFIRMED: the 4 curated agent portraits exist as 1024x1024 PNGs at repo `images/NOKTURNE.png|MIRAI.png|RISO.png|SCRIPTORIUM.png` — copy them to `web/public/agents/` for the image route fallback.

## 5. The Home page — sections (build to the Variance Map in VARIANCE-AUDIT.md)
Order + the locked technique per section (see audit). Build STATIC-FIRST (all 8 sections laid out, content in, effects OFF, 60fps, legible), THEN layer motion (Lenis + Reveal + the per-section signature + the provenance-line motif), THEN reduced-motion/coarse-pointer downgrades.

1. **Faux-OS hero** — port arca's `components/hero/os/` (OsScene + ProcessPanel + CliTerminal + BrowserChat + logos) and RE-SKIN the content to AURA's pipeline:
   - The terminal = an AGENT generating: a prompt typed, a tool call `generate(agent: NOKTURNE, prompt: "...")`, art resolving.
   - The process panel "behind the scenes" steps = AURA's real pipeline: `sign (EIP-712 mint auth) -> generate (0G Compute, TEE) -> attest (TeeML signer) -> store (0G Storage, root 0x..) -> mint (OutputNFT, tx 0x..)`. Use REAL-looking values from the data (a real root prefix `0xe3cd..`, a real tee attestation, NOKTURNE).
   - The "recall/browse" phase = an Explore-style gallery card showing the minted output with its provenance chip (agent, seed, TEE, storage root) + a "Verify" affordance.
   - The provenance line draws across the menubar (the motif origin).
   - Around the OS window: oversized display headline (the value prop), a mono kicker, and the primary CTAs (Explore the gallery / Generate free). The headline can swap a word like arca (e.g. "art you can **prove**" / "**own**" / "**trade**" / "**verify**") — upright accent on Ethereal, italic ok on Playfair.
   - Hero is DOM-only (no WebGL). Reduced-motion: show the process panel in its completed state.
2. **Thesis strip** — one architectural sentence stating the thesis (every piece is generated by an autonomous on-chain creative agent, attested in a TEE, stored on 0G, minted with provenance + royalties that follow the work). The load-bearing keyword gets the provenance-line underline drawing on enter.
3. **Live stats ledger** — `split-asymmetric`. Real figures count up: `agents` (5), `outputs minted` (6), `on-chain events` (14), `creator royalty` (avg or a headline like "6-9% royalties"), `chainId 16602`, `sponsor balance` (optional). Pull from `/health` + `/api/_indexer`. Set as an accounting ledger with the hairline as each baseline rule. Use `clamp()` count-up numbers contained in `w-full` blocks.
4. **Featured agents** — `bento-grid`. The 4 curated agents (filter out TESTAGENT). One hero card (NOKTURNE, most outputs) larger; 3 smaller. Each: real portrait (`/images/<resolved>`), name (display), tagline (mono/body), style chip tinted by the agent accent, live `outputCount` + `salesCount` + `royaltyPct`. Subtle tilt-to-cursor (transform only; off on coarse pointer). Link each to `/agents/[id]` (route may 404 in Phase-1 — that is fine, the link is correct).
5. **Recent outputs rail** — `horizontal-rail`, pinned via CSS `position:sticky` (NOT GSAP pin), ScrollTrigger scrub only, opaque full-viewport bg, flick-tested. Cards = recent `/outputs?limit=8`, each a provenance chip (image-or-placeholder, agent name, seed, short TEE attestation, short storage root, "Verify ->"). Reduced-motion / mobile: normal wrapped grid or native snap-scroll.
6. **Activity ticker** — `full-bleed-marquee`. Real `/api/activity?limit=12` events strung on ONE moving line (the motif in motion). Each chip: kind (mint/sale/transfer), agent name, tokenId, price (if sale, e.g. "0.001 0G"), short tx. Autoplay continuous (CSS/transform marquee, pausable on hover, NOT scroll-scrubbed -> keeps the scrollytelling count at 1). Reduced-motion: static row.
7. **How it works** — `index-numbered-vertical-timeline` on the provenance spine. 4 steps with oversized 01-04 markers, alternating L/R: (01) Pick an agent. (02) Generate free (sponsored, no wallet needed). (03) It is attested in a TEE + stored on 0G. (04) Connect + mint when you want to own it (royalties follow the work). Call out "sponsored, no connect to generate" explicitly.
8. **CTA close** — `centered-form`/color-field settle. Invert to a calm ink field. Headline + two CTAs (Explore the gallery / Generate free). The provenance line returns as a steady underscore bookend. -> footer.

## 6. Data fetching
- Server Components fetch the live data where possible (`fetch('http://localhost:8787/...', { cache: 'no-store' })`) and pass to client section components, OR a small `useEffect`+`react-query` client fetch for the live/animated sections (stats count-up, activity, rail). Either is fine; prefer RSC fetch for first paint + a client refresh for activity. Handle fetch failure gracefully (skeleton -> empty state, never a crash). Note: server-side fetch from RSC to `localhost:8787` works in dev.
- Put all fetchers + types in `web/src/lib/api.ts`. Base URL from `NEXT_PUBLIC_AURA_API`.

## 7. Verification + screenshots (REQUIRED deliverable)
- Boot `web/` dev on port 3000 (`pnpm dev`). The backend (8787) + indexer (42069) are ALREADY running — confirm with `curl http://localhost:8787/health`.
- Confirm Home renders REAL data: the stats show 5 agents / 6 outputs / 14 events; featured agents show NOKTURNE/MIRAI/RISO/SCRIPTORIUM with real taglines + counts; activity shows the real mint + sale; trending shows NOKTURNE.
- Capture LIVE screenshots (Playwright headless OR /agent-browser) at desktop width (1440) AND mobile (390):
  - Home LIGHT + Ethereal Glamour
  - Home DARK + Ethereal Glamour
  - Home LIGHT + Playfair
  - Home DARK + Playfair
  - The faux-OS hero close-up (light + dark)
  - The mobile nav menu open
  Save to `/tmp/aura-build/shots/` with descriptive names. Toggle the display font via `NEXT_PUBLIC_DISPLAY_FONT` (restart dev or read it at runtime via a cookie/query so you can switch without rebuild — simplest: a `?font=playfair` query the layout reads to set the class, plus the env default).
- Self-check against VARIANCE-AUDIT.md: confirm no skeleton/technique drift, hard-bans still 0, no em-dashes anywhere (grep the codebase for `—` and the unicode em-dash + en-dash before finishing), light is default, both themes polished, no FOUC.

## 8. Hard constraints (re-state)
- NO em-dashes / long hyphens anywhere (use a period, comma, colon, or parentheses). Grep `—` and `–` before done.
- Light = default theme. Dark via toggle. BOTH polished (owner checks both).
- English-only. No i18n.
- Do NOT commit or push (owner reviews + commits).
- Kill nothing the owner did not start — but DO leave the backend/indexer running for the owner's review (main session started them; main will kill them).
