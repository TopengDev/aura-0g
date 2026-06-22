// SERVER-ONLY. Process-global singletons. Next.js bundles each route handler SEPARATELY, so a
// module-level `const x = new Map()` is instantiated PER ROUTE — state is NOT shared across routes.
// globalThis is one object per Node process, shared across every route bundle. This is the standard
// Next.js pattern for cross-route in-memory state (cf. the Prisma/Socket.io singleton pattern).
const g = globalThis as unknown as {
  __AURA_JOBS?: Map<string, unknown>;
  __AURA_GEN?: { total: number; inFlight: number };
};

export function jobsStore(): Map<string, any> {
  return (g.__AURA_JOBS ??= new Map()) as Map<string, any>;
}

export function genCounters(): { total: number; inFlight: number } {
  return (g.__AURA_GEN ??= { total: 0, inFlight: 0 });
}
