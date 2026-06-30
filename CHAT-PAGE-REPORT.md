# CHAT-PAGE-REPORT — dedicated /chat page (Claude-AI style) + the WEB CONVERGENCE

Branch: `feat/chat-page` (off `origin/v2` = `080853c`). Worktree: `~/claude/Git/worktrees/aura-chat-page`.
Status: DONE, verified. NOT pushed / NOT deployed (gated for main + Christopher).

## TL;DR

1. **The convergence** is done: `feat/chat-page` = v2 (080853c: gacha + repolish + seedfix + CLI) **+ chat backend/UI** (`feat/aura-aichat`) **+ /cli docs page** (`feat/cli-docs-page`). Both merges were **clean, zero conflicts**.
2. **The dedicated /chat page** replaces the inline chat panel: a Claude-AI layout (left sidebar of your Auras-as-conversations + a full-height chat main area), LEAN per-Aura (one persistent owner-scoped thread per Aura, the existing sealed memory, no new backend concept).
3. The chat **backend is unchanged**. tsc + next build clean. Spot-checked live against the prod backend.

## Part 1 — the convergence (CP1, load-bearing)

| Step | Result |
|---|---|
| `git worktree add ... origin/v2 -b feat/chat-page` | base = `080853c` |
| `git merge feat/aura-aichat` | **CLEAN** — 13 files (chat backend `server/src/aura/chat-*.ts` + `routes/chat.ts` + `app.ts`; web `AuraChat.tsx`, `AgentDetailView` panel, `api.ts` chat fetchers) |
| `git merge feat/cli-docs-page` | **CLEAN** — 4 files (`/cli` page + `CliView.tsx` + Nav/Footer CLI links). No conflict, so the keep-both-links concern was moot. |

Verified present on the converged base: chat backend files, `/cli` page + `CliView`, **seedfix `CopyValue`** in `OutputDetailView.tsx`, `AuraChat.tsx`, Nav + Footer CLI links. Server `tsc` exit 0; web `next build` exit 0 with all routes (`/`, `/agents`, `/agents/[id]`, `/cli`, `/create`, `/dashboard`, `/explore`, `/faucet`, `/generate`, `/outputs/[id]`, `/verify`).

## Part 2 — the dedicated /chat page

### What changed (4 files: 2 new, 2 edited)

- **NEW `web/src/app/chat/page.tsx`** — server component, `force-dynamic`. Reads `?agent=<id>`, fetches `featuredAgents(await fetchAgents())`, hands them to the client view. Full-viewport app surface (no Footer).
- **NEW `web/src/components/product/ChatView.tsx`** — the Claude-AI layout:
  - **Left sidebar** = your Auras-as-conversations. Lists every chattable Aura (portrait + name + last-message snippet, or its tagline before any conversation). Once signed in, it reads each Aura's owner-scoped `GET /chat/:id/history` (parallel, fail-soft) to populate snippets and sort **conversations-with-history first** (most recent), then the rest in catalog order. A search filter, a count, and a "Browse all Auras ->" footer link.
  - **Main area** = the selected Aura's chat (`AuraChatThread`). Deep-link `?agent=<id>` preselects an Aura; selection is client-only and reflected to the URL via `replaceState` (shareable, no server round-trip per click).
  - **SIWE gate**: not-connected shows the shared `ConnectGate` ("Connect to chat"); connected mounts the thread whose composer signs in on send.
  - **Responsive**: on mobile it collapses to a list <-> chat flow (the sidebar is the list; opening an Aura shows the chat with a "<- Auras" back bar). Both panes side-by-side on `md+`.
- **EDITED `web/src/components/product/AuraChat.tsx`** — refactored so **one engine drives two surfaces** (no behavior drift, no duplicated logic):
  - Extracted `useAuraChat(agentId)` (all state + history load + the send/tool loop) and the shared renderers (`ChatBody`, `ChatComposer`, `HealthBadge`, plus the existing `ChatBubble` / `ReplyBadge` / `ToolCard` / `RelicMintCard` kept verbatim).
  - `AuraChat` (the inline Panel) is preserved and now consumes the hook.
  - **NEW `AuraChatThread`** — the full-height column the /chat page mounts: same bubbles, the **per-reply TEE-verified badge** (honest fallback labeling), the **tool cards**, the **non-custodial `RelicMintCard`**, and the composer — laid out to fill the page instead of a fixed `max-h`.
- **EDITED `web/src/components/product/AgentDetailView.tsx`** — the inline `<AuraChat>` panel is **replaced** with a "Chat with {name}" CTA panel linking to `/chat?agent=<id>` (and the now-unused `AuraChat` import removed).

### Honest TEE labeling preserved

Per-reply attestation is shown only when 0G served the reply (`TEE-verified · <model>`); the fallback is labeled `Fallback · not TEE-attested`. The header `HealthBadge` shows "0G TEE-attested" vs "Fallback active". The no-long-hyphen house rule is already enforced server-side (`sanitizeReply`) and respected in all new copy.

## Verification (evidence)

- **Server tsc**: exit 0. **Web tsc**: exit 0. **Web `next build`**: exit 0 — new route `/chat` 7.33 kB / 341 kB First Load; `/agents/[id]` dropped 12.1 -> 8.55 kB (inline chat moved out).
- **Runtime** (web dev server pointed at the live prod backend `api-aura.topengdev.com`, real Auras):
  - `GET /chat` -> 200; sidebar renders "Your Auras (24)", search, and Aura rows with portraits + snippets (screenshot).
  - `GET /chat?agent=1` -> 200; main area shows the SIWE `ConnectGate` referencing **NOKTURNE** (correct deep-link). When connected, `AuraChatThread` mounts (same proven rendering as the inline chat).
  - `GET /agents/1` -> 200; the chat CTA links `href="/chat?agent=1"`.
  - `GET /cli` -> 200, `GET /verify` -> 200 — convergence intact. Gacha/summon (`/agents/[id]` SummonPanel) + seedfix `CopyValue` build clean and present.
- Screenshots: `chat-desktop.png` (deep-linked connect gate), `chat-empty-light.png` (empty "Pick an Aura to start talking").

## Notes / constraints honored

- **EXISTING design only** (Technical-Editorial tokens + existing primitives; design-polish OFF). No new design system, no em/en dashes.
- **Backend UNCHANGED** — `POST /chat`, `GET /chat/:id/history`, `GET /chat/health` reused as-is. Lean per-Aura = the existing per-(agent, owner) sealed memory; no "sessions" table.
- Chat is available for **any on-chain Aura** (the route checks existence, memory is owner-scoped), so the sidebar lists the featured catalog, not only owned Auras — matches the brief's "Auras the user can chat with".

## Possible follow-ups (non-blocking)

- Auto-scroll the deep-linked Aura into view in the sidebar (cosmetic; the main area already shows the right Aura).
- Optional: a per-row unread/last-active timestamp once history snippets are loaded.
