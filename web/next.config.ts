import type { NextConfig } from "next";

// Rewrites run SERVER-SIDE in the Next process, so they target the IN-CLUSTER backend address (the same
// one SSR uses in lib/api.ts): AURA_API_INTERNAL > NEXT_PUBLIC_AURA_API > localhost. In the containerized
// deploy nginx fronts /health + /api/* and routes them straight to the backend, so these rewrites are a
// fallback; pointing them at the internal address keeps them correct even when NEXT_PUBLIC_AURA_API is
// the public origin (or "" for same-origin). Local dev is unchanged (defaults to localhost:8787).
const API =
  process.env.AURA_API_INTERNAL || process.env.NEXT_PUBLIC_AURA_API || "http://localhost:8787";

// AURA web app. NOT a static export: we use route handlers (image proxy) and a
// rewrite so the in-app RELATIVE fetch('/health') hits the running Fastify server
// on 8787. Everything else in lib/api.ts + siwe.ts fetches the backend via the
// ABSOLUTE NEXT_PUBLIC_AURA_API base, so they need no rewrite.
//
// IMPORTANT (Phase 2a): the Phase-1 config also rewrote /agents, /agents/:path*,
// /outputs, /outputs/:path* to the backend. Those were dead config (nothing fetches
// them relatively) AND they SHADOWED the new App Router product pages (/agents,
// /agents/[id], /outputs/[id]) so the pages rendered raw backend JSON. They are
// removed. /api/:path* is kept (no page collides with it; it is the proxied surface).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  // Standalone output for the Docker image: Next traces the minimal node_modules + emits a self-
  // contained server.js under .next/standalone. The deploy Dockerfile copies standalone + .next/static
  // + public into a lean runner (no full node_modules, no pnpm at runtime). `next dev`/`next start` are
  // unaffected; this only changes what `next build` additionally emits.
  output: "standalone",
  // web/ lives inside the zerog-smoke repo (which has its own root app/ + lockfile). Pin the tracing
  // root to THIS dir so Next does not infer the parent workspace.
  outputFileTracingRoot: import.meta.dirname,
  webpack: (config) => {
    // Optional peers pulled by wagmi/walletconnect that are not used in this browser app. Stubbing
    // them removes the noisy "Module not found" warnings and speeds compile.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "pino-pretty": false,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  async rewrites() {
    // Only RELATIVE in-app fetches need a rewrite. Web3Provider does fetch('/health'); everything
    // else (lib/api.ts, siwe.ts) uses the absolute NEXT_PUBLIC_AURA_API base. The /api/:path* entry
    // is kept as the proxied read surface (no App Router page collides with /api/*).
    // The former /agents, /agents/:path*, /outputs, /outputs/:path* rewrites were removed: they were
    // dead (nothing fetched them relatively) and they shadowed the App Router product pages.
    return [
      { source: "/health", destination: `${API}/health` },
      { source: "/api/:path*", destination: `${API}/api/:path*` },
    ];
  },
};

export default nextConfig;
