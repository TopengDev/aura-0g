# syntax=docker/dockerfile:1
# AURA indexer (Ponder 0.16 + embedded PGlite). Build context = REPO ROOT (ponder.config.ts reads
# indexer/../contracts/deployed-v2.json, so /app/contracts must exist). The indexer needs NO private
# key (read-only chain access: eth_getLogs / eth_call). It syncs from the deploy block (40164233) on
# first boot and serves the read APIs (src/api/index.ts) from the Ponder process.
#
# pnpm via corepack (the indexer uses pnpm-lock.yaml). Ponder is pure JS (no native compile), so a
# single stage is fine; we still prune to a runtime that only carries what `ponder start` needs.

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# Enable pnpm (pinned-by-corepack) without a global install.
RUN corepack enable
WORKDIR /app/indexer

# pnpm 10+ HARD-FAILS an install when a dependency's build script is skipped (ERR_PNPM_IGNORED_BUILDS).
# The only one here is esbuild@0.21.5, whose functional binary ships in its platform package
# (@esbuild/linux-x64) and needs NO build step, so the skipped script is harmless (verified: esbuild
# --version runs). CRITICAL: `ponder start` shells out to `pnpm install` AGAIN at RUNTIME (a deps-status
# check before it builds), so a per-invocation flag on the build install is not enough -- the runtime
# re-check would re-trigger the hard error and kill the process. We therefore persist the setting into
# the image's GLOBAL pnpm config (a project .npmrc does NOT take, verified), so BOTH the build install
# and Ponder's runtime re-check pass. (Build-config only; nothing committed is changed.)
RUN pnpm config set strict-dep-builds false

# Install deps with the lockfile. --frozen-lockfile = reproducible (fails if lock is stale).
COPY indexer/package.json indexer/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

# App sources Ponder loads on start (config + schema + handlers + the abis + the Hono read API).
COPY indexer/ponder.config.ts indexer/ponder.schema.ts indexer/ponder-env.d.ts indexer/tsconfig.json ./
COPY indexer/abis ./abis
COPY indexer/src ./src

# The shared deployed-contracts manifest (addresses + deploy block + chainId), read by ponder.config.ts.
COPY contracts/deployed-v2.json /app/contracts/deployed-v2.json

# Writable Ponder runtime dir (PGlite data under .ponder/pglite + generated artifacts). A named volume
# in compose persists the indexed state across restarts so it does not re-sync from the deploy block.
RUN mkdir -p /app/indexer/.ponder

EXPOSE 42069
# `ponder start` builds once, syncs from the deploy block, then serves GraphQL + the custom /api routes.
# Bind 0.0.0.0 so the backend container can reach it over the compose network. Port pinned for clarity
# (Ponder's port comes from the -p flag, NOT $PORT).
CMD ["pnpm", "ponder", "start", "--hostname", "0.0.0.0", "--port", "42069"]
