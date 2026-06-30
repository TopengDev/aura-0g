# AICHAT-DEPLOY-PLAN: chat-with-an-Aura (additive backend + web)

**Branch:** `feat/aura-aichat` off `ab2da4d` (origin/v2). **GATED** - main + Christopher trigger this; the worker did NOT deploy.
**Blast radius:** LOW. New backend routes + new modules + one web panel. The only edit to an existing server file is `app.ts` (+2 additive lines). No contract change, no contract redeploy, no change to gen/mint/summon/gacha/verify. Registry `0xb596` is never touched -> agents always safe.

Reference runbook: project_aura_vps_deploy_live (the live stack, the .env UID gotcha, the WEB-REBUILD trap, the surgical git-checkout vs reset --hard rule).

---

## 1. What deploys

- **Backend (rebuild `aura-server:latest`)**: new files `chat-compute/chat-llm/chat-persona/chat-memory/chat-tools.ts` + `routes/chat.ts`, registered via `app.ts` (+2 lines). New endpoints: `POST /chat`, `GET /chat/:agentId/history`, `GET /chat/health`. The server image must be rebuilt because backend TS changed.
- **Web (rebuild `aura-web:prod`)**: new `AuraChat.tsx`, chat fetchers in `api.ts`, the panel wired into `AgentDetailView.tsx`. The web image must be rebuilt (per the documented WEB-REBUILD trap - the prod compose runs a pre-built image, so `--build` on compose does NOT rebuild the code).
- **Indexer**: UNCHANGED. Do not rebuild or recreate it.
- **DB**: the `chat_memory_keys` + `chat_memory_segments` tables are created LAZILY on the first `/chat` call into the existing `aura.db` (named volume `aura_server-data`). No migration step, survives restart. No edit to the proven `db.ts` migration.

---

## 2. New env (the one new secret)

The provider-seam fallback needs an Anthropic key, server-side ONLY:

- **`AURA_CHAT_ANTHROPIC_KEY`** - add ONE line to `~/apps/aura/.env` (the bind-mounted `/app/.env`, chmod 600, **owned 1000:1000** - do NOT edit it as root or you reintroduce the UID-mismatch boot crash). The server reads it via dotenv from `/app/.env`, same as `PRIVATE_KEY`. It is NEVER baked into an image, NEVER `NEXT_PUBLIC`, NEVER logged.
- Optional knobs (defaults fine): `AURA_CHAT_ANTHROPIC_MODEL` (default `claude-haiku-4-5-20251001`), `AURA_CHAT_PROVIDER` (unset = auto: 0G first, anthropic on health-fail; set `zerog` or `anthropic` to force for the live demo).

No web env change (the chat panel uses the existing `NEXT_PUBLIC_AURA_API`). No compose edit strictly required (the key rides in the bind-mounted `.env`). If you prefer it explicit in compose, add `AURA_CHAT_ANTHROPIC_KEY: ${AURA_CHAT_ANTHROPIC_KEY}` to the server `environment:` block AND put it in `deploy/.env` too.

---

## 3. Deploy mechanism (git bundle + surgical checkout - VPS has no rsync)

1. **Commit** the build on `feat/aura-aichat` (main/Christopher own the commit; use the /commit skill). Then on local:
   ```
   git bundle create /tmp/aichat.bundle ab2da4d..feat/aura-aichat
   scp /tmp/aichat.bundle <vps>:~/apps/aura/
   ```
2. **On the VPS** (`~/apps/aura`): FIRST `git status` (the documented trap: if there is an uncommitted runtime-critical local change such as `DATABASE_SCHEMA` in the compose, do NOT `git reset --hard`). Apply SURGICALLY:
   ```
   git fetch ./aichat.bundle feat/aura-aichat
   git checkout FETCH_HEAD -- server/ web/        # surgical: only the code dirs; leaves .env / deploy/.env / compose untracked-local intact
   ```
3. **Add the fallback key** to `~/apps/aura/.env` (see section 2; keep 1000:1000 / 600).
4. **Rebuild the server image** (backend changed):
   ```
   cd ~/apps/aura
   docker build -f deploy/server.Dockerfile -t aura-server:latest server
   ```
5. **Rebuild the web image** (per the WEB-REBUILD trap - the 5 prod NEXT_PUBLIC args are load-bearing; confirm them from the live bundle first if unsure):
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

- `curl https://api-aura.topengdev.com/chat/health` -> `{zerogHealthy:true, zerogModel:"qwen/qwen2.5-omni-7b", fallbackConfigured:true, ...}` (fallbackConfigured TRUE confirms the key landed).
- Open `https://aura.topengdev.com/agents/1`, sign in (SIWE), send "who are you?" -> a reply with the green "TEE-verified" badge.
- Send "check your royalties" -> the read_onchain tool card.
- Send "make me a piece: <subject>" -> the RelicMintCard generates (TEE), then "Mint this Relic" signs in the wallet.
- Untouched: `curl .../verify` 200, the summon/gacha proof endpoints 200, `/health` 200. Other VPS vhosts (aenoxa/billing/bithour) unaffected.

---

## 5. Rollback

Before deploy, tag the live images:
```
docker tag aura-server:latest aura-server:rollback-aichat-20260630
docker tag aura-web:prod aura-web:rollback-aichat-20260630
```
To roll back: retag the rollback images back and recreate:
```
docker tag aura-server:rollback-aichat-20260630 aura-server:latest
docker tag aura-web:rollback-aichat-20260630 aura-web:prod
docker compose -f deploy/docker-compose.prod.yml up -d --no-deps --force-recreate server web
```
The new `chat_memory_*` tables are additive (no existing table altered) so they need no rollback; the `aura.db` volume is unaffected by a code rollback. Registry `0xb596` is never touched. The fallback key line in `.env` is harmless to leave.

---

## 6. Demo-day notes

- **Pre-fund** the sponsor 0G compute ledger before the demo (the funding ritual is finicky; reuse is built-in but a cold ledger 400s the first calls until topped up).
- **Decide the provider on the day**: if 0G is healthy, demo on 0G for the verifiable thesis (TEE-attested replies). If it wobbles, set `AURA_CHAT_PROVIDER=anthropic` to force the fallback - the story is unchanged, the UI honestly labels it NOT TEE-attested. The auto health-check already does this without intervention.
- Lead the pitch with "TEE-attested replies + TEE-attested generations + on-chain actions, all from one conversation" - all true and all demonstrated.
