// Provable-pull RARITY derivation for the indexer read model. This MUST stay byte-identical to the
// server's server/src/aura/gacha.ts deriveRarity() (the server uses ethers; here we use viem) - the same
// seed must yield the same tier on both sides, else a list badge would disagree with the verify panel.
// Cross-checked in server/src/scripts/verify-gacha-crosscheck.ts.
//
// The indexer only needs RARITY (lists/grids). The full subject mapper lives server-side + in the web
// verifier. Rarity is a pure function of the on-chain seed: legacy/non-pull seeds (< 2^64, the old
// Math.random*1e9 decorative seeds) read as "Common" with NO migration; a real pull seedRoot (full
// keccak) gets its bucketed roll.
import { keccak256, encodeAbiParameters, stringToHex, toHex, padHex } from "viem";

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

const TAG_RARITY = keccak256(stringToHex("AURA-PULL-rarity-v1"));
const PULL_SEED_FLOOR = 1n << 64n;

function seedToBytes32(seed: bigint): `0x${string}` {
  return padHex(toHex(seed), { size: 32 });
}

export function isProvablePullSeed(seed: bigint): boolean {
  return seed >= PULL_SEED_FLOOR;
}

export function rarityRoll(seed: bigint): number {
  const s32 = seedToBytes32(seed);
  const h = keccak256(
    encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [s32, TAG_RARITY]),
  );
  return Number(BigInt(h) % 10000n);
}

// Christopher's distribution: Common 80% / Rare 15% / Epic 4% / Legendary 1%.
function bucket(roll: number): Rarity {
  if (roll < 8000) return "Common";
  if (roll < 9500) return "Rare";
  if (roll < 9900) return "Epic";
  return "Legendary";
}

export function deriveRarity(seed: bigint): Rarity {
  if (!isProvablePullSeed(seed)) return "Common";
  return bucket(rarityRoll(seed));
}
