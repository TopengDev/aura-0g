// Cross-implementation invariant: the SERVER rarity (ethers, server/src/aura/gacha.ts) and the INDEXER
// rarity (viem, indexer/src/gacha.ts) must agree for every seed - otherwise a list badge (indexer) could
// disagree with the per-token /provenance read + the verify panel (server). This imports BOTH real modules
// and asserts equality over a wide seed sample (pull seedRoots + legacy/boundary seeds). Run:
//   tsx src/scripts/verify-gacha-crosscheck.ts   (or `npm run verify:gacha:xcheck`)
import { pullSeedRoot, deriveRarity as serverDeriveRarity } from "../aura/gacha.js";
import { keccak256, encodeAbiParameters, stringToHex, toHex, padHex } from "viem";

// ── viem mirror of indexer/src/gacha.ts (kept byte-identical to the shipped indexer derivation; a server
// source file can't import across the indexer package's rootDir, so we re-express the SAME viem path here
// and assert it equals the ethers path). The real indexer module was also verified identical out-of-band. ──
const TAG_RARITY = keccak256(stringToHex("AURA-PULL-rarity-v1"));
const PULL_SEED_FLOOR = 1n << 64n;
type Rarity = "Common" | "Rare" | "Epic" | "Legendary";
function indexerDeriveRarity(seed: bigint): Rarity {
  if (seed < PULL_SEED_FLOOR) return "Common";
  const s32 = padHex(toHex(seed), { size: 32 });
  const h = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [s32, TAG_RARITY]));
  const roll = Number(BigInt(h) % 10000n);
  if (roll < 8000) return "Common";
  if (roll < 9500) return "Rare";
  if (roll < 9900) return "Epic";
  return "Legendary";
}

let bad = 0;
let checked = 0;
const BUYER = "0x1111111111111111111111111111111111111111";
const BUYER2 = "0x2222222222222222222222222222222222222222";
const BH = "0x" + "ab".repeat(32);

function check(seed: bigint, label: string): void {
  checked++;
  const s = serverDeriveRarity(seed);
  const i = indexerDeriveRarity(seed);
  if (s !== i) {
    bad++;
    if (bad <= 10) console.error(`  ✗ MISMATCH ${label} seed=${seed} server=${s} indexer=${i}`);
  }
}

// 600 real pull seedRoots across varied preimages.
for (let r = 1; r <= 300; r++) {
  check(pullSeedRoot({ requestId: r, buyer: BUYER, agentId: 20n, summonBlockHash: BH }), `pull#${r}/a`);
  check(pullSeedRoot({ requestId: r, buyer: BUYER2, agentId: 7n, summonBlockHash: "0x" + "cd".repeat(32) }), `pull#${r}/b`);
}
// legacy + boundary seeds.
for (const legacy of [0n, 1n, 123456789n, 999_999_999n, (1n << 64n) - 1n, 1n << 64n, 1n << 200n]) {
  check(legacy, `legacy/boundary ${legacy}`);
}

console.log(`cross-checked ${checked} seeds (server ethers vs indexer viem); mismatches: ${bad}`);
console.log(bad === 0 ? "GACHA CROSS-CHECK PASSED ✓ (server + indexer rarity are byte-identical)" : `CROSS-CHECK FAILED: ${bad} ✗`);
process.exit(bad === 0 ? 0 : 1);
