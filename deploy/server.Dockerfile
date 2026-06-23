# syntax=docker/dockerfile:1
# AURA backend (Fastify, Node 22, UNBUNDLED). Build context = REPO ROOT (the server reads
# ../contracts/deployed-v2.json and ../images/* relative to REPO_ROOT, so those dirs must be in the
# image). Native dep `better-sqlite3` compiles via node-gyp (python3+make+g++ in the build stage);
# the other native addons (utf-8-validate, bufferutil, blake-hash) ship linux-x64 prebuilds.
#
# The funded keys .env is NEVER copied here. It is bind-mounted at runtime by docker-compose and read
# by src/index.ts via dotenv from REPO_ROOT/.env. No key ever lands in a layer.

# ---- build stage: toolchain + full deps + tsc ----
FROM node:22-bookworm-slim AS build
WORKDIR /app/server

# node-gyp toolchain for better-sqlite3 (the only module that compiles from source).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install with the lockfile (reproducible). package-lock.json => npm ci.
COPY server/package.json server/package-lock.json ./
RUN npm ci

# Compile TS -> dist/.
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# Prune dev deps in place so we ship only production node_modules (keeps the compiled .node addons).
RUN npm prune --omit=dev

# ---- runtime stage: lean, no toolchain ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/server

# Non-root runtime user (the base image ships `node`). Data dir is created + chowned for the volume.
# REPO_ROOT in the container is /app (server/src/aura/config.ts: server/../../.. ). The server reads
# /app/contracts/deployed-v2.json and /app/images/* , and writes /app/server/data/* (a named volume).

# production node_modules (incl. the compiled better-sqlite3 .node) + compiled app.
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./package.json

# Repo-root assets the server reads at runtime (one source of truth for addresses + the catalog base
# images for the seeded-agent generate fallback). Copied to /app/contracts and /app/images.
COPY contracts/deployed-v2.json /app/contracts/deployed-v2.json
COPY images /app/images

# Writable runtime data dir (SQLite WAL + generated PNG cache). Mounted as a named volume in compose.
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node

EXPOSE 8787
# index.ts loads /app/.env (bind-mounted) then listens on HOST:PORT (0.0.0.0:8787 by default).
CMD ["node", "dist/index.js"]
