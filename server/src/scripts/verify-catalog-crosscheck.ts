// Cross-implementation invariant: the SERVER agent catalog (server/src/aura/catalog.ts, shape
// AgentPublicMeta) and the INDEXER agent catalog (indexer/src/catalog.ts, shape AgentStyle) carry the SAME
// display metadata for the seeded roster, keyed by agent name. The two shapes differ (the server adds
// model/sampleImages/name; the indexer adds a `style` slug) so they are NOT byte-identical, but the SHARED
// display fields MUST agree per name - else a discovery list badge (indexer) contradicts the agent detail
// page + persona (server). There was no equality check, so drift was invisible. This asserts it.
//
// Run:  tsx src/scripts/verify-catalog-crosscheck.ts   (or `npm run verify:catalog:xcheck`)
//
// The indexer catalog lives in a SEPARATE workspace (its own rootDir), so a server source file cannot
// STATICALLY import it. We load it via a dynamic import with a COMPUTED specifier (tsc leaves it `any`, so
// server tsc stays clean; tsx resolves the .ts at runtime). The indexer catalog is self-contained (no
// imports of its own), so it loads standalone.
import { CATALOG as SERVER_CATALOG } from "../aura/catalog.js";

interface SharedMeta {
  tagline?: string;
  aesthetic?: string;
  accent?: string;
  signatureCharacter?: string | null;
  rarity?: string;
  lore?: string;
  personality?: string;
}

const indexerCatalogUrl = new URL("../../../indexer/src/catalog.ts", import.meta.url).href;
const indexerMod = (await import(indexerCatalogUrl)) as { CATALOG: Record<string, SharedMeta> };
const INDEXER_CATALOG = indexerMod.CATALOG;

// the display fields both catalogs are expected to carry identically (per name).
const SHARED_FIELDS = ["tagline", "aesthetic", "accent", "signatureCharacter", "rarity", "lore", "personality"] as const;

const norm = (v: unknown): string => JSON.stringify(v ?? null); // undefined vs missing both -> null

let bad = 0;
let checked = 0;

const serverNames = Object.keys(SERVER_CATALOG);
const indexerNames = Object.keys(INDEXER_CATALOG);

// 1. name-set parity: every seeded agent present in ONE catalog must be present in the OTHER.
for (const n of serverNames) {
  if (!(n in INDEXER_CATALOG)) {
    bad++;
    console.error(`  ✗ "${n}" is in the SERVER catalog but MISSING from the indexer catalog`);
  }
}
for (const n of indexerNames) {
  if (!(n in SERVER_CATALOG)) {
    bad++;
    console.error(`  ✗ "${n}" is in the INDEXER catalog but MISSING from the server catalog`);
  }
}

// 2. per-name shared-field equality.
for (const n of serverNames) {
  const s = SERVER_CATALOG[n] as SharedMeta | undefined;
  const i = INDEXER_CATALOG[n];
  if (!s || !i) continue;
  for (const f of SHARED_FIELDS) {
    checked++;
    const sv = norm(s[f]);
    const iv = norm(i[f]);
    if (sv !== iv) {
      bad++;
      if (bad <= 20) console.error(`  ✗ ${n}.${f}: server=${sv} indexer=${iv}`);
    }
  }
}

console.log(
  `catalog cross-check: ${serverNames.length} server names, ${indexerNames.length} indexer names, ${checked} shared-field comparisons; mismatches: ${bad}`,
);
console.log(
  bad === 0
    ? "CATALOG CROSS-CHECK PASSED ✓ (server + indexer share identical display metadata per name)"
    : `CATALOG CROSS-CHECK FAILED: ${bad} ✗ (server/indexer catalog drift - reconcile the fields above)`,
);
process.exit(bad === 0 ? 0 : 1);
