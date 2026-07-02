// pnpm resolution hook for the ROOT project (the 0G smoke-test harness). This repo is intentionally NOT a
// pnpm workspace (server/web/indexer/cli each keep their own independent lockfile), so the override CANNOT
// live in a pnpm-workspace.yaml at the root - that file would make pnpm treat the whole repo as one
// workspace and hoist the sub-projects' deps to a root node_modules (verified: it empties web/node_modules
// and breaks web's typecheck). A project-local .pnpmfile.cjs applies ONLY to the root project's install and
// carries no workspace semantics, so the sub-projects stay isolated.
//
// WHAT IT DOES: force the abandoned axios@0.27.2 that `open-jsonrpc-provider` (the 0G storage SDK's JSON-RPC
// HTTP provider) pins onto the already-in-tree, patched axios 1.18.0 - killing CVE-2025-27152 (SSRF) +
// CVE-2023-45857 and the rest of the axios 0.x advisory swamp (all <=0.31.1). Scoped to that one parent, so
// nothing else in the tree changes. (The server does the same via npm `overrides` in server/package.json.)
function readPackage(pkg) {
  if (pkg.name === "open-jsonrpc-provider" && pkg.dependencies && pkg.dependencies.axios) {
    pkg.dependencies.axios = "1.18.0";
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
