# QA Report — AURA dapp (web/)

Date: 2026-06-23
Mode: full (10 dimensions, adapted for a Next.js dapp with no unit-test suite — verification is live + code/ABI audit)
Project: ~/claude/Git/repositories/zerog-smoke/web
Type: TypeScript / Next.js 15 App Router (wagmi/viem web3)

## Executive Summary

Verdict: SHIP (after Phase-4 fixes — 1 CRITICAL security issue found and FIXED this phase)
Total findings: 8 (P0: 1 [FIXED], P1: 0, P2: 3, P3: 4)

Headline: a reflected-XSS sink in `/images/[root]` (the SVG placeholder reflected the request-controlled `root` unescaped into an `image/svg+xml` response) was found, exploited live, and FIXED + verified. The rest of the app's security posture is strong: write flows are well-guarded (chain-switch + setApprovalForAll pre-step + receipt assertion), React escaping holds on every user-input field, no secret leaks, no hardcoded secrets.

## Dimension Results

| Dimension | Status | Findings |
|---|---|---|
| 1. Functional | PASS | 0 (all 10 routes load + render correct states; see UI-QA.md) |
| 2. Edge Cases | PASS | bad ids → custom 404 / not-found panel; empty data → graceful empty states; numeric-only verify input validated |
| 3. Cross-Platform | PASS (web) | responsive 375→1440 no overflow; both color schemes |
| 4. Regression | PASS | copy fixes + image-route fix are additive; tsc clean; no behavior removed |
| 5. Destructive (simulated) | PASS | API fetchers fail-soft (return null) → sections degrade to skeleton/empty, never crash (verified live: empty marketplace, no-wallet dashboard) |
| 6. UX Audit | PARTIAL | P3 focus-visibility, P2 duplicate titles |
| 7. Performance | PASS | no N+1 in client; read fetchers are per-section, cache:no-store is intentional for live chain data; no unbounded client loops |
| 8. Security | FIXED | 1 CRITICAL (SVG XSS) fixed; create/generate XSS safe; SIWE bound correctly; no secret leak; write-flow guards correct |
| 9. State | PASS | no-wallet, empty-collection, not-found, wrong-chain (code) all handled |
| 10. Visual | PASS | light+dark polished parity; Technical Editorial system consistent (see shots/) |

## Findings

### P0 — Critical (1) — FIXED THIS PHASE

#### Reflected XSS in `/images/[root]` SVG placeholder
- **Dimension**: Security
- **Description**: When `root` did not match a known showcase/output map, the route returned a placeholder SVG with the request-controlled `root` interpolated RAW into `<text>` markup, served as `content-type: image/svg+xml`. An SVG served that way and opened as a top-level document executes script → reflected XSS in the app origin.
- **Reproduction (verified live)**: `curl '/images/'$(urlenc '<image href=x onerror=alert(1)>')'?style=noir'` → HTTP 200, `image/svg+xml`, body contained raw `<image href=x `. (Payloads with `/` 404 on Next's single-segment route; a slash-free payload is the working vector.)
- **Affected**: `src/app/images/[root]/route.ts` (`placeholderSvg`).
- **Fix applied**: added `escapeXml()` around both interpolations of `root` (and `tint.label` defensively); added response headers `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` + `x-content-type-options: nosniff`.
- **Verified after fix (live)**: payload now reflects as `&lt;image href=x ` (0 raw `<image`), CSP + nosniff headers present, valid showcase/output PNGs + benign placeholder still HTTP 200, tsc clean. Defense in depth also holds at call sites: every `/images/...` URL is built with `encodeURIComponent(name|imageRoot)`.

### P2 — Medium (3)

#### P2-1. Focus indicator was invisible on all text inputs/textareas (CSS specificity bug) — FIXED
- **Dimension**: UX / Accessibility (WCAG 2.4.7 Focus Visible)
- **Description**: `TextInput` + `TextArea` (primitives.tsx) and the `/verify` input set `outline-none` AND a `focus:border-[var(--color-accent)]` class, but `borderColor` was also set via the inline `style` attribute, and inline styles win over Tailwind classes by specificity, so the focus border NEVER changed. Verified live: focusing the generate prompt textarea left `borderColor` identical before === after.
- **Affected**: `src/components/product/primitives.tsx` (TextInput, TextArea), `src/components/product/VerifyView.tsx`.
- **Fix applied**: (1) moved the resting border color out of inline `style` into the className in all three inputs; (2) added a global, robust accessible focus style in `globals.css` `@layer base` — a `:focus-visible` accent ring (box-shadow, which an inline borderColor can never override) on every `a/button/input/textarea/select/[tabindex]`, keyboard-only. Verified live: Tab navigation now shows `:focus-visible` with the accent ring + accent border (`#93a7d6`) on the verify input + generate textarea (`shots/31-focus-ring-verify.png`).

#### P2-2. Duplicate / generic page titles on several routes — FIXED
- **Dimension**: UX / SEO
- **Description**: `/agents`, `/agents/[id]`, `/outputs/[id]`, `/generate`, `/create`, `/dashboard` all rendered the default `<title>` "AURA. Art you can prove." while `/explore`, `/verify`, `/faucet` had specific titles.
- **Affected**: the `page.tsx` files of the above routes (were missing `metadata` / `generateMetadata`).
- **Fix applied**: added `export const metadata` to the 4 static routes and `generateMetadata` to the 2 dynamic routes. Verified live: "Agents | AURA", "Generate | AURA", "Create an agent | AURA", "Dashboard | AURA", "NOKTURNE #1 | AURA", "NOKTURNE #6 | AURA"; not-found falls back to "Agent | AURA".

#### P2-3. SIWE domain/uri hardcoded to `localhost:3000` (deploy-time correctness)
- **Dimension**: Security / State (config)
- **Description**: `src/lib/siwe.ts` hardcodes `SIWE_DOMAIN = "localhost:3000"` and `SIWE_URI = "http://localhost:3000"`. The server parses + binds the SIWE message to these. On deploy to a real domain, these MUST be updated (or derived from `window.location`) or SIWE verification will fail against the production origin.
- **Affected**: `src/lib/siwe.ts` L13-14.
- **Proposed fix**: derive from `window.location.host`/`origin` (client component) or an env var, falling back to localhost in dev. NOT changed (could break the verified-working local flow; this is a deploy checklist item the owner controls — flagged, not silently changed).

### P3 — Low (4)

#### P3-1. `outline-none` with no replacement on the verify "Verify provenance" submit and other buttons
- Secondary to P2-1: ActionButtons rely on color/opacity hover, not a keyboard focus ring. Low impact (buttons are large, high-contrast), but a `focus-visible` ring would harden keyboard nav. Proposed: global `:focus-visible` ring utility.

#### P3-2. "Generate free" CTA wording
- After the Phase-4 copy fix, "Generate free" (home hero + footer) is still accurate (no cost to user) and does not claim "no sign-in", so it's consistent. Optional precision: "Generate (sponsored)". Left as-is.

#### P3-3. `dangerouslySetInnerHTML` in CliTerminal — safe but fragile
- `CliTerminal.tsx:159` uses `dangerouslySetInnerHTML` to render `**bold**` markdown from `item.text`. Verified SAFE: `item.text` comes only from the static `CLI_EXCHANGES`/`CLI_REPLY` constants in `lib/scene.ts` (no user input). Flagged so a future change that routes user/remote content through `exchanges` does not silently become an XSS sink. The other `dangerouslySetInnerHTML` (ThemeScript anti-FOUC) is the standard required pattern.

#### P3-4. `?style=` param not URL-encoded in image src construction
- Image URLs use `?style=${a.style}` un-encoded. Currently safe because the route only uses `style` as a lookup-map key (falls back to `custom`), never interpolating it raw. Low risk; encoding it would be belt-and-suspenders.

## Security audit summary (Dimension 8 detail)
- **XSS**: 1 CRITICAL found+fixed (image route). `/generate` prompt + `/create` name/style/signature: injected live, React escapes — `alertFired: 0`, `liveMaliciousEls: 0`. No `innerHTML` misuse; both `dangerouslySetInnerHTML` uses are static-content-only.
- **Secrets**: no hardcoded private keys / API secrets / mnemonics. All `NEXT_PUBLIC_*` are legitimately public (API base URL, contract addresses, WalletConnect projectId, display font, chainId). `.env.local` contains only `NEXT_PUBLIC_*`. No server secret reaches the client bundle.
- **SIWE integrity**: message binds domain + uri + chainId(16602) + single-use nonce via viem `createSiweMessage`; nonce is server-issued (10-min TTL, single-use); JWT is short-lived (~1h). The SIWE statement was corrected this phase to be accurate for generate+mint+create (was mint-only). (Deploy-domain caveat = P2-3.)
- **Write-flow guards (code/ABI audit, no tx executed)**: `useTrade.ts` + `useMint.ts` — every write calls `ensureChain()` (prompts switch to 16602 if wrong) → `ensureSignedIn()` (SIWE) → action; `list` reads `isApprovedForAll` and only sends `setApprovalForAll` (confirmed via receipt) when needed BEFORE `list`; every tx polls the receipt and throws on revert; `if (!address)` guard on each; all calls pin `chainId: APP_CHAIN.id`. Errors funnel through `humanError()` — no raw stack traces to users. This is correct and safe.
- **Auth bypass / IDOR**: client cannot bypass the SIWE gate (backend is owner-scoped + JWT-verified per the api.ts contract); the dapp is read-public / write-gated by design.

## Constraint checks
- chainId 16602: confirmed (backend health + every contract call pins APP_CHAIN.id=16602).
- Em/en-dashes in code+copy: scanned, 0 (see report footer in final message).
- tsc: clean (0) after all fixes.
- light+dark parity + persistence + no-FOUC: verified (see UI-QA.md).

## Recommendations (priority order)
1. (DONE) Fix the image-route XSS — shipped + verified this phase.
2. (Phase-4 polish) Fix the focus-visibility specificity bug (P2-1) — one shared-primitive change, real a11y win.
3. (Phase-4 polish) Add per-route static titles (P2-2).
4. (Owner / deploy checklist) Make SIWE domain/uri deploy-aware (P2-3) before going to a real domain.
5. (Optional) global `:focus-visible` ring (P3-1), encode `?style=` (P3-4).
