import type { NextConfig } from "next";

// AURA Next.js monolith. All 0G ops are SERVER-SIDE (route handlers, Node runtime).
// serverExternalPackages: leave these native/CJS deps OUT of the webpack bundle so they
// load via runtime `require` (the 0G storage SDK has native/wasm bits, and the compute
// broker is loaded via createRequire because its ESM entry is broken in v0.7.8).
const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@0glabs/0g-serving-broker",
    "@0gfoundation/0g-ts-sdk",
    "@0glabs/0g-ts-sdk",
    "ethers",
    "circomlibjs",
    "crypto-js",
  ],
};

export default nextConfig;
