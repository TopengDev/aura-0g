# CHAT-PAGE-DEPLOY-PLAN — the CONVERGENCE deploy (v2 + chat + /cli + dedicated /chat page)

**Branch:** `feat/chat-page` off `080853c` (origin/v2). **GATED** — main + Christopher trigger this; the worker did NOT deploy or push.

This is the **convergence** deploy: `feat/chat-page` carries EVERYTHING in one shot — v2 (`080853c`: gacha + repolish + seedfix + CLI binary) **+ the chat backend** (`feat/aura-aichat`) **+ the /cli docs page** (`feat/cli-docs-page`) **+ the dedicated /chat page** (this work). It SUPERSEDES the separate `AICHAT-DEPLOY-PLAN.md` / cli-docs / repolish deploys — deploying this one branch is sufficient; do not also run those.

Reference runbook: `project_aura_vps_deploy_live` (the live stack, the `.env` UID gotcha, the WEB-REBUILD trap, surgical git-checkout vs `reset --hard`).

**Blast radius:** MODERATE but well-bounded. Backend: only the additive chat modules + `app.ts` (+2 lines) — no contract change, no contract redeploy, registry `0xb596` never touched. Web: the new `/chat` page + the `/cli` page + the repolish/seedfix UI + the detail-page CTA swap. Indexer: UNCHANGED.

---

## 1. What deploys

- **Backend (rebuild `aura-server:latest`)** — the chat backend: `server/src/aura/chat-{compute,llm,persona,memory,tools}.ts` + `server/src/routes/chat.ts`, registered via `app.ts` (+2 lines). Endpoints: `POST /chat`, `GET /chat/:agentId/history`, `GET /chat/health`. Server image MUST be rebuilt (backend TS changed). If the live server is ALREADY on the aichat build (i.e. `/chat/health` already 200s live), the server is unchanged by THIS branch and the rebuild is a no-op-safe re-deploy.
- **Web (rebuild `aura-web:prod`)** — the dedicated `/chat` page (`app/chat/page.tsx` + `ChatView.tsx`), the refactored `AuraChat.tsx` (shared engine + new `AuraChatThread`), the `AgentDetailView` CTA swap (inline panel -> "Chat with this Aura" -> `/chat?agent=<id>`), the `/cli` docs page + Nav/Footer CLI links, and the repolish/seedfix UI. Web image MUST be rebuilt (the WEB-REBUILD trap: the prod compose runs a PRE-BUILT image, so `--build` on compose does NOT rebuild the code).
- **Indexer**: UNCHANGED. Do not rebuild or recreate it.
- **DB**: the `chat_memory_keys` + `chat_memory_segments` tables are created LAZILY on the first `/chat` call into the existing `aura.db` (named volume `aura_server-data`). No migration step; survives restart. If aichat already ran live, they already exist.

---

## 2. Env (no NEW secret for the chat page)

- **`AURA_CHAT_ANTHROPIC_KEY`** — the provider-seam fallback key. **Already present in the VPS `~/apps/aura/.env`** (added during the aichat work). Confirm it is still there (chmod 600, owned **1000:1000** — never edit as root or you reintroduce the UID-mismatch boot crash). Verify after deploy via `/chat/health` -> `fallbackConfigured: true`.
- Optional knobs (defaults fine): `AURA_CHAT_ANTHROPIC_MODEL` (default `claude-haiku-4-5-20251001`), `AURA_CHAT_PROVIDER` (unset = auto: 0G first, anthropic on health-fail).
- **No web env change** — the chat page uses the existing `NEXT_PUBLIC_AURA_API`. No new compose edit required.

---

## 3. Deploy mechanism (git bundle + surgical checkout — VPS has no rsync)

1. **Commit + push the branch** (main/Christopher own the push; the /commit skill was used for the build commit). main pushes `feat/chat-page` and, after the live smoke passes, fast-forwards `v2`. Then, to ship to the VPS, on local:
   ```
   git bundle create /tmp/chatpage.bundle 080853c..feat/chat-page
   scp /tmp/chatpage.bundle <vps>:~/apps/aura/
   ```
   (If the VPS repo base does NOT contain `080853c`, bundle the full branch instead: `git bundle create /tmp/chatpage.bundle feat/chat-page`.)
2. **On the VPS** (`~/apps/aura`): FIRST `git status` (the documented trap — if there is an uncommitted runtime-critical local change such as `DATABASE_SCHEMA` in the compose, do NOT `git reset --hard`). Apply SURGICALLY:
   ```
   git fetch ./chatpage.bundle feat/chat-page
   git checkout FETCH_HEAD -- server/ web/        # only the code dirs; leaves .env / deploy/.env / compose untracked-local intact
   ```
3. **Confirm the fallback key** is in `~/apps/aura/.env` (section 2; 1000:1000 / 600). It should already be there.
4. **Rebuild the server image** (backend changed):
   ```
   cd ~/apps/aura
   docker build -f deploy/server.Dockerfile -t aura-server:latest server
   ```
5. **Rebuild the web image** (WEB-REBUILD trap — the 5 prod `NEXT_PUBLIC` args are load-bearing; confirm them from the live image if unsure):
   ```
   docker build -f deploy/web.Dockerfile -t aura-web:prod \
     --build-arg NEXT_PUBLIC_AURA_API=https://api-aura.topengdev.com \
     --build-arg NEXT_PUBLIC_SIWE_DOMAIN=aura.topengdev.com \
     --build-arg NEXT_PUBLIC_AURA_CHAIN_ID=16602 \
     --build-arg NEXT_PUBLIC_DISPLAY_FONT=ethereal \
     --build-arg NEXT_PUBLIC_WC_PROJECT_ID=8587a9582464416581ee66bc24063ac9 \
     web
   ```
6. **Recreate server + web only** (indexer untouched):
   ```
   cd ~/apps/aura/deploy
   docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate server web
   ```

---

## 4. Verify live (after deploy)

- `curl https://api-aura.topengdev.com/chat/health` -> `{zerogHealthy:true, zerogModel:"qwen/qwen2.5-omni-7b", fallbackConfigured:true, ...}` (fallbackConfigured TRUE confirms the key is loaded).
- **The dedicated page**: open `https://aura.topengdev.com/chat` -> the sidebar lists your Auras; open `https://aura.topengdev.com/chat?agent=1` -> NOKTURNE preselected. Connect + SIWE, send "who are you?" -> reply with the green "TEE-verified" badge. "check your royalties" -> the read_onchain tool card. "make me a piece: <subject>" -> the RelicMintCard generates (TEE) then "Mint this Relic" signs in the wallet.
- **The entry point**: `https://aura.topengdev.com/agents/1` -> the "Chat with NOKTURNE ->" CTA routes to `/chat?agent=1` (the inline panel is gone).
- **Convergence intact**: `curl .../verify` 200, `/cli` 200, the summon/gacha proof endpoints 200, `/health` 200; the seedfix CopyValue on an output page. Other VPS vhosts (aenoxa/billing/bithour) unaffected.

---

## 5. Rollback

Before deploy, tag the live images:
```
docker tag aura-server:latest aura-server:rollback-chatpage-20260630
docker tag aura-web:prod aura-web:rollback-chatpage-20260630
```
To roll back: retag the rollback images back and recreate:
```
docker tag aura-server:rollback-chatpage-20260630 aura-server:latest
docker tag aura-web:rollback-chatpage-20260630 aura-web:prod
docker compose -f deploy/docker-compose.prod.yml up -d --no-deps --force-recreate server web
```
The `chat_memory_*` tables are additive (no existing table altered) so they need no rollback; the `aura.db` volume is unaffected by a code rollback. Registry `0xb596` is never touched. The fallback key line in `.env` is harmless to leave.

---

## 6. Demo-day notes

- **Pre-fund** the sponsor 0G compute ledger before the demo (a cold ledger 400s the first calls until topped up).
- **Decide the provider on the day**: if 0G is healthy, demo on 0G for the verifiable thesis (TEE-attested replies); if it wobbles, set `AURA_CHAT_PROVIDER=anthropic` to force the honestly-labeled fallback. The auto health-check already does this without intervention.
- The /chat page is the cleanest demo surface: open it, the sidebar shows the roster, click an Aura, talk — "TEE-attested replies + TEE-attested generations + on-chain actions, all from one conversation."
