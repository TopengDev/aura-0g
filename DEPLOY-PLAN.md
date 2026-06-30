# DEPLOY-PLAN — AURA webapp repolish (web-only)

GATED. Do NOT run until main + Christopher approve. This is a **web-only** change (lexicon + copy + the redirect fix). No backend, no indexer, no contract, no schema change.

## Scope / blast radius

- **Changed**: `web/` only (38 files modified + 2 new `loading.tsx`). All on branch `repolish/lexicon-copy-redirect`.
- **Untouched**: `server/`, `indexer/`, `contracts/`, the deploy compose, nginx, certbot, all env/secrets.
- **No `DATABASE_SCHEMA` bump** — the indexer is not rebuilt or restarted; `DATABASE_SCHEMA: public` is unchanged.
- **No new env vars** — the redirect fix uses only in-code ISR (`revalidate`) + the Next data cache + the existing runtime `AURA_API_INTERNAL`. Nothing to add to `~/apps/aura/.env` or the compose.
- Only the `aura-web:prod` image is rebuilt and swapped. `server` + `indexer` containers keep running.

## Deploy model (from `deploy/docker-compose.prod.yml` + `deploy/web.Dockerfile`)

Pre-built images, transferred via `docker save | docker load` (no build on the VPS). The web image bakes the prod `NEXT_PUBLIC_*` at build time; SSR uses runtime `AURA_API_INTERNAL=http://server:8787`. Web publishes to `127.0.0.1:3330`; the host nginx (`aura.topengdev.com`) is the sole ingress.

## Path to live (after the gate)

### 0. Merge the branch to the deploy line first
The branch is off `origin/v2`. Land it the same way the stack is deployed (merge `repolish/lexicon-copy-redirect` into the branch the prod images are built from — confirm with main which branch that is; `v2` per the build context).

```bash
cd ~/claude/Git/repositories/zerog-smoke
git fetch origin
git checkout v2 && git merge --no-ff repolish/lexicon-copy-redirect
# (or cherry-pick the worktree commit; keep it a clean single feature commit)
```

### 1. Build the prod web image locally (same prod build args as the live image)

```bash
cd ~/claude/Git/repositories/zerog-smoke/web
docker build -f ../deploy/web.Dockerfile \
  --build-arg NEXT_PUBLIC_AURA_API=https://api-aura.topengdev.com \
  --build-arg NEXT_PUBLIC_SIWE_DOMAIN=aura.topengdev.com \
  --build-arg NEXT_PUBLIC_AURA_CHAIN_ID=16602 \
  --build-arg NEXT_PUBLIC_DISPLAY_FONT=ethereal \
  -t aura-web:prod .
```
(Confirm the exact prod build args against the values used for the current live `aura-web:prod` — match them so the client bundle is identical except for the code change. `NEXT_PUBLIC_WC_PROJECT_ID` defaults in the Dockerfile.)

### 2. Transfer the image to the VPS

```bash
docker save aura-web:prod | gzip | \
  sshpass -p "$VPS_PASSWORD" ssh -o StrictHostKeyChecking=accept-new "$VPS_USER@$VPS_HOST" \
  'gunzip | docker load'
```

### 3. Swap ONLY the web container (off-peak; flag timing to Christopher)

```bash
sshpass -p "$VPS_PASSWORD" ssh "$VPS_USER@$VPS_HOST" \
  'cd ~/apps/aura && docker compose -f docker-compose.prod.yml up -d --no-deps web'
```
`--no-deps web` swaps the web container without touching `server`/`indexer`. The `web-imgcache` named volume (the AVIF/WebP transcode cache from the image-perf fix) persists across the swap — content-addressed, so no re-warm needed.

### 4. Verify on prod (evidence, not assumption)

```bash
# a) container healthy + correct image
sshpass -p "$VPS_PASSWORD" ssh "$VPS_USER@$VPS_HOST" 'docker ps --filter name=web --format "{{.Image}} {{.Status}}"'

# b) the redirect fix — TTFB should be sub-100ms (instant skeleton), not 5-7s
for u in /agents/20 /outputs/23 /outputs/12; do
  printf "%-16s " "$u"; curl -s -m 30 "https://aura.topengdev.com$u" -o /dev/null -w "http=%{http_code} TTFB=%{time_starttransfer}s total=%{time_total}s\n"
done
# expect: TTFB ~0.05s on all; relic-page total ~1-2s cold then <0.6s warm; aura-page warm <0.5s.

# c) lexicon spot-check on rendered HTML (should say Aura/Relic, not agent/output)
curl -s https://aura.topengdev.com/agents/20 | grep -oiE 'Living Aura|All Auras|Relics created' | head
curl -s https://aura.topengdev.com/outputs/23 | grep -oiE 'Verifiable Relic|Relic NFT' | head
```

Manual smoke (qutebrowser / browser): click into an Aura and a Relic from the home gallery — confirm the navigation feels instant (skeleton, no 5s hang), the copy reads Aura/Relic everywhere, the inline **Verify** still runs live, and a **Summon** + **gacha/provable-pull** panel still works.

## Rollback

The previous `aura-web:prod` is replaced by the new one with the same tag, so keep the prior image to roll back instantly:

- **Before step 3**, on the VPS tag the current image: `docker tag aura-web:prod aura-web:prerepolish`.
- **Rollback** (if anything regresses): `docker tag aura-web:prerepolish aura-web:prod && docker compose -f docker-compose.prod.yml up -d --no-deps web`.
- Because nothing else (server/indexer/schema/env) changed, rollback is a single web-container swap with zero data implications. The `web-imgcache` volume is unaffected either way.

## Risk notes

- **ISR cache + the cold agent page**: the first uncached render of a given agent page still pays the ~5.5s backend DNA RPC (hidden behind the instant skeleton, then cached 300s). If a fully sub-second cold agent page is wanted, the follow-up is backend-side (cache the immutable DNA read) — out of scope for this web-only deploy.
- **Timing**: prod swap during off-peak; flag the (brief, single-container) restart to Christopher first per the prod-deploy-timing rule.
