# syntax=docker/dockerfile:1
# AURA web (Next.js 15 App Router, standalone output). Build context = web/ (self-contained: own
# pnpm-lock.yaml + outputFileTracingRoot pinned to itself). pnpm via corepack.
#
# NEXT_PUBLIC_* are BUILD-TIME (inlined into the client bundle), passed as build args. The browser-
# facing public API base + SIWE domain are baked here. AURA_API_INTERNAL is a RUNTIME env (the in-
# cluster backend address used by SSR + the Next rewrites); it is set in compose, NOT baked.

# ---- deps: install with the lockfile ----
FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# pnpm 10+ hard-fails when a dep's build script is skipped (ERR_PNPM_IGNORED_BUILDS). The skipped ones
# here (bufferutil, keccak, sharp, utf-8-validate) all ship prebuilt binaries and work without their
# build step (sharp is not even exercised: next.config sets images.unoptimized). strictDepBuilds=false
# downgrades the hard error to a warning. (Build-config only; nothing committed is changed.)
RUN pnpm install --frozen-lockfile --prod=false --config.strictDepBuilds=false

# ---- build: compile Next in standalone mode ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public (browser-inlined) config. Provided by docker-compose build args; sane defaults for a local run.
# NEXT_PUBLIC_AURA_API="" => same-origin (the browser hits nginx, which proxies the backend paths).
ARG NEXT_PUBLIC_AURA_API=""
ARG NEXT_PUBLIC_SIWE_DOMAIN=""
ARG NEXT_PUBLIC_AURA_CHAIN_ID=16602
ARG NEXT_PUBLIC_DISPLAY_FONT=ethereal
ARG NEXT_PUBLIC_WC_PROJECT_ID=8587a9582464416581ee66bc24063ac9

# CONTRACT-ADDRESS + GAME build args (Flag #1 fix). The committed Dockerfile forwarded ONLY the 5 base args
# above, so `--build-arg NEXT_PUBLIC_OUTPUT_NFT=…` (and the 7 others) were SILENTLY DROPPED by docker and the
# rebuilt image shipped STALE testnet contracts + a DARK game layer. Declaring + ENV-exporting them here makes
# a rebuild actually bake the deploy's addresses. The 4 economy defaults MIRROR the web's own `??` fallbacks in
# web/src/lib/contracts.ts EXACTLY, so an un-passed build is byte-identical to today (zero regression); auraINFT
# + the 3 game vars default to "" (matching contracts.ts / game-contracts.ts graceful-off). For the mainnet
# cutover, pass ALL of them (the DeployCutover run prints the fusion/arena/reputation values; add the AuraINFT/
# OutputNFT/Marketplace/SummonEscrow it deploys + NEXT_PUBLIC_AURA_CHAIN_ID=16661).
ARG NEXT_PUBLIC_AGENT_REGISTRY=0xb5960cc08caa5195095cfb8aa270f122be09ba0a
ARG NEXT_PUBLIC_OUTPUT_NFT=0xEecED1e6965f00a5f7cA459631370c886FAEFd3b
ARG NEXT_PUBLIC_MARKETPLACE=0x815115Eb39987d3fAdb3b373f89fa0096433f228
ARG NEXT_PUBLIC_SUMMON_ESCROW=0xa5CeFBc097d84beE09b12fc1569B6CcA56992838
ARG NEXT_PUBLIC_AURA_INFT=""
ARG NEXT_PUBLIC_AURA_FUSION=""
ARG NEXT_PUBLIC_ARENA_VOTE=""
ARG NEXT_PUBLIC_ARENA_REPUTATION=""

ENV NEXT_PUBLIC_AURA_API=$NEXT_PUBLIC_AURA_API \
    NEXT_PUBLIC_SIWE_DOMAIN=$NEXT_PUBLIC_SIWE_DOMAIN \
    NEXT_PUBLIC_AURA_CHAIN_ID=$NEXT_PUBLIC_AURA_CHAIN_ID \
    NEXT_PUBLIC_DISPLAY_FONT=$NEXT_PUBLIC_DISPLAY_FONT \
    NEXT_PUBLIC_WC_PROJECT_ID=$NEXT_PUBLIC_WC_PROJECT_ID \
    NEXT_PUBLIC_AGENT_REGISTRY=$NEXT_PUBLIC_AGENT_REGISTRY \
    NEXT_PUBLIC_OUTPUT_NFT=$NEXT_PUBLIC_OUTPUT_NFT \
    NEXT_PUBLIC_MARKETPLACE=$NEXT_PUBLIC_MARKETPLACE \
    NEXT_PUBLIC_SUMMON_ESCROW=$NEXT_PUBLIC_SUMMON_ESCROW \
    NEXT_PUBLIC_AURA_INFT=$NEXT_PUBLIC_AURA_INFT \
    NEXT_PUBLIC_AURA_FUSION=$NEXT_PUBLIC_AURA_FUSION \
    NEXT_PUBLIC_ARENA_VOTE=$NEXT_PUBLIC_ARENA_VOTE \
    NEXT_PUBLIC_ARENA_REPUTATION=$NEXT_PUBLIC_ARENA_REPUTATION \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# ---- runtime: lean standalone server (no pnpm, no full node_modules) ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone output: server.js + the minimal traced node_modules. public/ and .next/static are copied
# separately (standalone does not include them). chown to the unprivileged `node` user.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
# server.js honors PORT + HOSTNAME (set above). It serves SSR pages, the /images route, and /_next/*.
CMD ["node", "server.js"]
