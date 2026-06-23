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
ENV NEXT_PUBLIC_AURA_API=$NEXT_PUBLIC_AURA_API \
    NEXT_PUBLIC_SIWE_DOMAIN=$NEXT_PUBLIC_SIWE_DOMAIN \
    NEXT_PUBLIC_AURA_CHAIN_ID=$NEXT_PUBLIC_AURA_CHAIN_ID \
    NEXT_PUBLIC_DISPLAY_FONT=$NEXT_PUBLIC_DISPLAY_FONT \
    NEXT_PUBLIC_WC_PROJECT_ID=$NEXT_PUBLIC_WC_PROJECT_ID \
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
