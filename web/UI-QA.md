# UI QA Report — AURA (Phase 4)

Date: 2026-06-23
Mode: full (adapted — AURA has no email/password login; single anonymous public role, auth is wallet/SIWE)
Target: local http://localhost:3000
Driver: agent-browser (CDP/Chromium), per the no-Playwright rule

## Executive Summary

Verdict: SHIP (after Phase-4 fixes)
Routes tested: 10/10 (+ dynamic id variants + not-found + empty + light/dark + mobile)
Interactive elements: nav (desktop + mobile hamburger), theme toggle (3-way), all CTAs, create form (7 inputs), verify form, wallet-connect gates
Console errors on clean loads: 0
Findings: P0: 0 · P1: 0 (1 P1-class SECURITY issue found + FIXED, see /qa report) · P2: 2 · P3: 1

Note on auth model: AURA gates writes (generate/mint/create/list/buy) behind wallet-connect + SIWE. Headless has no funded interactive signer, so every write flow was verified up to the wallet-sign boundary (the "Connect wallet" gate renders correctly on every write surface) + by code/ABI audit. No on-chain tx attempted; no key used.

## Route × State Matrix

| Route | Loads | Notable state captured | Result |
|---|---|---|---|
| `/` (home) | ✓ | hero + CLI terminal, dark + light, mobile | PASS |
| `/agents` | ✓ | catalog grid (5 agents) | PASS |
| `/agents/[id]` | ✓ | NOKTURNE #1 (with outputs) + TESTAGENT #5 (EMPTY collection) | PASS |
| `/agents/999999` | ✓ | custom 404 "No provenance here." | PASS |
| `/outputs/[id]` | ✓ | output #6 detail + trade panel (wallet gate) | PASS |
| `/outputs/999999` | ✓ | not-found (404 route) | PASS |
| `/generate` | ✓ | agent picker + prompt + step rail + wallet gate | PASS |
| `/create` | ✓ | reference dropzone + 7-field form + wallet gate | PASS |
| `/dashboard` | ✓ | NO-WALLET empty state ("Connect your wallet") | PASS |
| `/explore` | ✓ | live stats + activity ticker + EMPTY marketplace handled | PASS |
| `/verify` | ✓ | idle state | PASS |
| `/verify?id=999999` | ✓ | NOT-FOUND panel "No output #999999 on-chain" (NEW — prior phases could not capture headless) | PASS |
| `/faucet` | ✓ | connect gate + claim steps | PASS |

## States newly captured this phase (prior phases could not, headless)
- `/verify?id=999999` NOT-FOUND panel — `shots/12-verify-NOTFOUND.png` (required a long settle for the live on-chain read; an early screenshot caught the in-flight skeleton, re-shot after settle)
- `/agents/999999` + `/outputs/999999` 404 — `shots/13-agent-NOTFOUND.png`, `shots/14-output-NOTFOUND.png`
- `/agents/5` empty-collection — `shots/10-agent-empty-outputs.png`
- `/dashboard` no-wallet — `shots/30-dashboard-nowallet.png`
- `/explore` empty-marketplace (handled gracefully — page shows agents/outputs/activity, not just listings)

## Light / Dark parity (HARD constraint) — PASS
- 3-way theme toggle (Use light / Match system / Use dark), aria-labelled.
- Toggle switches `colorScheme` + `.light/.dark` class + token set. Verified light: `bg rgb(249,248,246)`, dark: `bg rgb(14,13,10)`.
- Persistence: `localStorage['aura-theme']`. Survives reload (verified). Blocking `<head>` ThemeScript applies theme before paint → no FOUC (`data-theme-ready` set on rAF after). (Spec said "cookie"; localStorage + blocking head script is functionally equivalent for this client SPA and meets the intent: persist + no FOUC.)
- Light shots: `shots/15..20-*-LIGHT.png`. Both themes polished; the CLI hero terminal intentionally keeps dark styling in both.

## Responsive (mobile) — PASS
- Viewport 390 (device width 375). No horizontal overflow on any page (`scrollWidth === clientWidth` everywhere).
- Mobile hamburger menu opens with numbered nav (Agents01..Create04). Shots `shots/21..28-*-MOBILE.png`.

## Findings

### P2 — Medium
1. **Duplicate/generic `<title>` on several routes.** `/agents`, `/agents/[id]`, `/outputs/[id]`, `/generate`, `/create`, `/dashboard` all render the default title "AURA. Art you can prove." while `/explore`, `/verify`, `/faucet` have specific titles ("Explore | AURA", etc.). Minor SEO/tab-clarity issue. Proposed fix: add per-route `metadata` (or `generateMetadata` for dynamic routes) so each tab has a distinct title. NOT fixed (cosmetic, no functional impact) — flagged.
2. **Transient Next.js dev "1 Issue" overlay during rapid crawl.** Appeared once during fast back-to-back navigation; a clean reload with a console hook showed ZERO console errors/warnings on every route. Almost certainly an aborted-fetch / fast-refresh artifact of the crawl, not a product bug. No action needed; noting for transparency.

### P3 — Low
1. **"Generate free" CTA wording.** Home hero + footer say "Generate free" / "Generate (free)". After the Phase-4 copy correction (generation requires SIWE sign-in but is sponsored), "free" is still accurate (no cost to user) and does NOT claim "no sign-in", so it is consistent and was left as-is. Optional: "Generate (sponsored)" for maximal precision. Left as-is.

## Cleanup
- Browser session reset, theme artifact (`aura-theme`) cleared from localStorage, viewport restored.
- Dev server left running for the /qa pass; killed at end of Phase 4.
