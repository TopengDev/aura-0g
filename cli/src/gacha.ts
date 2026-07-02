// SERVER-ONLY, but PURE + dependency-light (only ethers for keccak/abi). The gacha-depth core: one
// deterministic on-chain-anchored seed roots BOTH a unique per-pull SUBJECT and a provable RARITY, so a
// juror can recompute either from public on-chain data, so the pull is rig-evident (recompute it yourself).
//
// THE UNIFYING SEED (zero contract change - it drops into the existing uint256 Provenance.seed slot):
//
//   seedRoot = keccak256( abi.encode( DOMAIN, requestId, buyer, agentId, summonBlockHash ) )
//
//   - requestId      strictly monotonic + UNIQUE per summon (SummonEscrow nextRequestId++). This is what
//                    STRUCTURALLY guarantees a distinct seed per pull (the literal-enforcement of req 2).
//   - buyer, agentId on-chain in the Summoned event.
//   - summonBlockHash the hash of the block the summon landed in - the operator AND the buyer both learn
//                    it only AFTER the summon is committed, so neither can grind toward a rarity. All four
//                    preimage fields are fixed BEFORE generation and are public, so the seed is both
//                    operator-un-grindable AND independently recomputable.
//
// PROVABILITY: a verifier reads the Relic's on-chain Provenance.seed, reads the matching Summoned event
// (requestId, buyer, agentId) + its block hash, recomputes seedRoot, and asserts seedRoot == seed. Then
// mapSubject(seedRoot) recomputes the subject (committed truthfully in the provenance record's prompt) and
// deriveRarity(seed) recomputes the tier. No trust in us. See BUILD-REPORT.md "Provability recompute".
//
// BACKWARD-COMPAT (req 1, NO migration): the legacy decorative seed was Math.floor(Math.random()*1e9) < 2^30.
// A real pull seedRoot is a full keccak256 (~uniform in 2^256). deriveRarity() therefore treats any seed
// below 2^64 as a legacy/non-pull seed and returns "Common" - so the 20 seeded Relics + every pre-cutover
// output + every sponsor-paid /generate output read as Common with no data change. P(a real keccak seedRoot
// lands < 2^64) = 2^-192, i.e. never.
import { ethers } from "ethers";

const abi = ethers.AbiCoder.defaultAbiCoder();

// Domain tags as bytes32 (keccak of a label) so every abi.encode below is STATIC-typed and therefore
// unambiguous to re-encode in any language (ethers here, viem in the web verifier, or a Solidity verifier).
const DOMAIN_PULL = ethers.keccak256(ethers.toUtf8Bytes("AURA-PULL-v1"));
const TAG_SUBJECT = ethers.keccak256(ethers.toUtf8Bytes("AURA-PULL-subject-v1"));
const TAG_RARITY = ethers.keccak256(ethers.toUtf8Bytes("AURA-PULL-rarity-v1"));

/** Below this, a seed is a legacy/non-pull decorative seed (Math.random*1e9 < 2^30) -> Common. A real
 *  pull seedRoot (full keccak) is astronomically always above it. 2^64 is a wide, unmistakable boundary. */
export const PULL_SEED_FLOOR = 1n << 64n;

export const ZERO_BYTES32 = "0x" + "00".repeat(32);

export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

/** A seed produced by our deterministic pull derivation (vs a legacy decorative seed). The provability
 *  gate that defines "absent rarity = Common" without any stored flag or migration. */
export function isProvablePullSeed(seed: bigint): boolean {
  return seed >= PULL_SEED_FLOOR;
}

/** uint256 seed -> bytes32 hex (left-padded), the form the sub-derivations hash over. */
function seedToBytes32(seed: bigint): string {
  return ethers.zeroPadValue(ethers.toBeHex(seed), 32);
}

/**
 * The unifying seed. requestId/agentId are uint256, buyer is an address, summonBlockHash is bytes32.
 * Returns the seedRoot as a uint256 bigint (what gets committed in Provenance.seed). Pure + recomputable.
 */
export function pullSeedRoot(args: {
  requestId: bigint | number;
  buyer: string;
  agentId: bigint | number;
  summonBlockHash: string;
}): bigint {
  const encoded = abi.encode(
    ["bytes32", "uint256", "address", "uint256", "bytes32"],
    [
      DOMAIN_PULL,
      BigInt(args.requestId),
      ethers.getAddress(args.buyer),
      BigInt(args.agentId),
      args.summonBlockHash,
    ],
  );
  return BigInt(ethers.keccak256(encoded));
}

// ─────────────────────────────── the 12 subject pools ───────────────────────────────
// Each pool is composed as the cross-product of two compact curated lists, so the file stays readable
// while every pool genuinely holds SIZE distinct strings (asserted at module load below). The hash picks
// one index per dimension; the 12 picks compose one brand-new scene description. STYLE is never chosen
// here - it stays locked to the agent (provenance). Only the SUBJECT varies.
function cross(a: readonly string[], b: readonly string[], join = " "): string[] {
  const out: string[] = [];
  for (const x of a) for (const y of b) out.push(`${x}${join}${y}`);
  return out;
}

// 1. Protagonist 32 x 8 = 256
const BEINGS = [
  "fox", "raven", "koi", "wolf", "owl", "stag", "serpent", "crane",
  "tiger", "whale", "moth", "lynx", "heron", "boar", "falcon", "otter",
  "dragon", "phoenix", "golem", "sprite", "djinn", "kitsune", "wisp", "automaton",
  "monk", "wanderer", "alchemist", "cartographer", "diver", "lamplighter", "clockmaker", "beekeeper",
] as const;
const ARCHETYPES = ["spirit", "guardian", "trickster", "elder", "scout", "oracle", "hermit", "herald"] as const;
const POOL_PROTAGONIST = cross(BEINGS, ARCHETYPES);

// 2. Species / form variant 8 x 8 = 64
const MATERIALS = ["porcelain", "obsidian", "brass", "jade", "paper", "amber", "frost", "ember"] as const;
const FORMS = ["mechanical", "celestial", "feral", "translucent", "armored", "overgrown", "spectral", "origami"] as const;
const POOL_FORM = cross(MATERIALS, FORMS);

// 3. Action / pose 8 x 8 = 64
const VERBS = ["leaping", "kneeling", "soaring", "drifting", "guarding", "unfurling", "listening", "casting"] as const;
const POSES = ["mid-stride", "in repose", "coiled to spring", "reaching upward", "turned to look back", "balanced on one foot", "cradling something", "stepping through a doorway"] as const;
const POOL_ACTION = cross(VERBS, POSES);

// 4. Setting / environment 16 x 8 = 128
const PLACES = [
  "a tidal cove", "a paper-lantern alley", "a glass greenhouse", "a desert observatory",
  "a flooded cathedral", "a bamboo grove", "a clockwork harbor", "a salt-flat at dawn",
  "a terraced rice valley", "a derelict orbital ring", "a moss-choked library", "a neon night market",
  "a frozen lighthouse", "a canyon of standing stones", "a floating archipelago", "a subway turned garden",
] as const;
const PLACE_MOD = ["after the rain", "under aurora", "at low tide", "wreathed in fog", "lit by fireflies", "dusted with snow", "at the blue hour", "during an eclipse"] as const;
const POOL_SETTING = cross(PLACES, PLACE_MOD);

// 5. Time-of-day / weather 8 x 6 = 48
const TIMES = ["dawn", "high noon", "golden hour", "dusk", "midnight", "the gray pre-storm light", "a moonless night", "first light after snow"] as const;
const WEATHER = ["clear and still", "with drifting rain", "in rolling mist", "under a thunderhead", "with falling petals", "in soft snowfall"] as const;
const POOL_TIMEWEATHER = cross(TIMES, WEATHER, ", ");

// 6. Lighting style 32
const POOL_LIGHTING = cross(
  ["rim-lit", "backlit", "candlelit", "neon-washed", "dappled", "volumetric", "bioluminescent", "lantern-lit"] as const,
  ["warm", "cold", "high-contrast", "diffuse"] as const,
);

// 7. Mood / emotion 8 x 6 = 48
const POOL_MOOD = cross(
  ["serene", "wistful", "triumphant", "uneasy", "playful", "reverent", "lonely", "defiant"] as const,
  ["and quiet", "and electric", "and tender", "and vast", "and intimate", "and bittersweet"] as const,
);

// 8. Composition / framing 32
const POOL_COMPOSITION = cross(
  ["wide establishing shot", "tight portrait", "low-angle hero framing", "overhead flat-lay",
   "over-the-shoulder", "symmetrical centered", "off-center rule-of-thirds", "deep-focus diorama"] as const,
  ["full-bleed", "with negative space", "framed by foreground", "in a vignette"] as const,
  ", ",
);

// 9. Secondary motif / prop 12 x 8 = 96
const MOTIFS = [
  "a paper boat", "a brass key", "a flock of cranes", "a single lantern", "a coiled rope",
  "spilled ink", "a cracked mirror", "a string of bells", "a sprig of plum blossom",
  "a worn map", "a glowing seed", "a broken compass",
] as const;
const MOTIF_QUAL = ["nearby", "drifting past", "held close", "left behind", "half-buried", "catching the light", "in the foreground", "barely visible"] as const;
const POOL_MOTIF = cross(MOTIFS, MOTIF_QUAL);

// 10. Color-accent shift 32
const POOL_ACCENT = cross(
  ["a vermilion", "a teal", "an ochre", "a violet", "a chartreuse", "an indigo", "a coral", "a viridian"] as const,
  ["accent", "wash", "highlight", "undertone"] as const,
);

// 11. Camera / scale 4 x 6 = 24
const POOL_CAMERA = cross(
  ["macro", "intimate", "sweeping", "miniature-diorama"] as const,
  ["scale", "perspective", "depth", "framing", "lens feel", "sense of distance"] as const,
);

// 12. Narrative twist / detail 8 x 8 = 64
const POOL_TWIST = cross(
  ["a second smaller figure watches", "the shadow tells a different story", "one element is impossibly out of season",
   "a thread of gold ties the scene together", "something has just left the frame", "the reflection shows elsewhere",
   "a small light refuses to go out", "the weather disagrees with the mood"] as const,
  ["as a quiet focal detail", "woven subtly into the background", "as the emotional anchor", "barely noticeable at first",
   "echoed in the composition", "carried by the lighting", "hinted in the color", "left for the viewer to find"] as const,
  ", ",
);

interface Dimension {
  key: string;
  pool: string[];
  size: number; // expected size (self-checked at load)
}

// Order is canonical + load-bearing: the verifier indexes the SAME 12 pools in THIS order. Never reorder
// or edit an existing pool's contents without versioning the domain tag (it would change every recompute).
export const DIMENSIONS: Dimension[] = [
  { key: "protagonist", pool: POOL_PROTAGONIST, size: 256 },
  { key: "form", pool: POOL_FORM, size: 64 },
  { key: "action", pool: POOL_ACTION, size: 64 },
  { key: "setting", pool: POOL_SETTING, size: 128 },
  { key: "timeWeather", pool: POOL_TIMEWEATHER, size: 48 },
  { key: "lighting", pool: POOL_LIGHTING, size: 32 },
  { key: "mood", pool: POOL_MOOD, size: 48 },
  { key: "composition", pool: POOL_COMPOSITION, size: 32 },
  { key: "motif", pool: POOL_MOTIF, size: 96 },
  { key: "accent", pool: POOL_ACCENT, size: 32 },
  { key: "camera", pool: POOL_CAMERA, size: 24 },
  { key: "twist", pool: POOL_TWIST, size: 64 },
];

// Self-check: every pool must hold exactly `size` DISTINCT entries (the entropy/collision math depends on
// it). Throws at module load if a curated list was mis-sized or has a duplicate - fail fast, never ship a
// silently-smaller space.
for (const d of DIMENSIONS) {
  if (d.pool.length !== d.size) {
    throw new Error(`gacha pool "${d.key}" size mismatch: expected ${d.size}, got ${d.pool.length}`);
  }
  if (new Set(d.pool).size !== d.pool.length) {
    throw new Error(`gacha pool "${d.key}" contains duplicate entries`);
  }
}

/** The exact combinatorial subject space S = product of pool sizes. Reported in BUILD-REPORT for the
 *  collision math. Computed from the live pools so the number can never drift from the code. */
export const SUBJECT_SPACE: bigint = DIMENSIONS.reduce((acc, d) => acc * BigInt(d.size), 1n);

export interface SubjectTuple {
  protagonist: string;
  form: string;
  action: string;
  setting: string;
  timeWeather: string;
  lighting: string;
  mood: string;
  composition: string;
  motif: string;
  accent: string;
  camera: string;
  twist: string;
}

/** Pick one index per dimension via an INDEPENDENT keccak per dimension (domain-separated, no bit-slicing
 *  bugs). Pure: same seedRoot -> same indices forever. */
function subjectIndices(seed: bigint): number[] {
  const s32 = seedToBytes32(seed);
  return DIMENSIONS.map((d, i) => {
    const h = ethers.keccak256(abi.encode(["bytes32", "bytes32", "uint256"], [s32, TAG_SUBJECT, BigInt(i)]));
    return Number(BigInt(h) % BigInt(d.size));
  });
}

/** seedRoot -> the 12-tuple subject + a composed render-prompt subject string. STYLE stays the agent's. */
export function mapSubject(seed: bigint): { tuple: SubjectTuple; prose: string; indices: number[] } {
  const idx = subjectIndices(seed);
  const pick = (i: number) => DIMENSIONS[i]!.pool[idx[i]!]!;
  const tuple: SubjectTuple = {
    protagonist: pick(0),
    form: pick(1),
    action: pick(2),
    setting: pick(3),
    timeWeather: pick(4),
    lighting: pick(5),
    mood: pick(6),
    composition: pick(7),
    motif: pick(8),
    accent: pick(9),
    camera: pick(10),
    twist: pick(11),
  };
  // Compose a single, model-legible scene sentence. SUBJECT only - no style words (style is locked to the
  // agent in the prompt template). Deterministic ordering so the prose is itself recomputable.
  const prose =
    `${tuple.protagonist} as ${tuple.form} form, ${tuple.action}, in ${tuple.setting} at ${tuple.timeWeather}; ` +
    `${tuple.lighting} light, ${tuple.mood} mood; ${tuple.composition}; ${tuple.motif}; ${tuple.accent}; ` +
    `${tuple.camera}; ${tuple.twist}`;
  return { tuple, prose, indices: idx };
}

// ─────────────────────────────── provable rarity ───────────────────────────────
// rarityRoll = uint(keccak256(abi.encode(seedBytes32, TAG_RARITY))) % 10000, bucketed 80/15/4/1.
// Christopher's distribution: Common 80% / Rare 15% / Epic 4% / Legendary 1%.
export const RARITY_TIERS: { tier: Rarity; lo: number; hi: number; pct: number }[] = [
  { tier: "Common", lo: 0, hi: 8000, pct: 80 }, // [0, 8000)
  { tier: "Rare", lo: 8000, hi: 9500, pct: 15 }, // [8000, 9500)
  { tier: "Epic", lo: 9500, hi: 9900, pct: 4 }, // [9500, 9900)
  { tier: "Legendary", lo: 9900, hi: 10000, pct: 1 }, // [9900, 10000)
];

/** The raw 0..9999 roll for a pull seed (only meaningful when isProvablePullSeed(seed)). */
export function rarityRoll(seed: bigint): number {
  const s32 = seedToBytes32(seed);
  const h = ethers.keccak256(abi.encode(["bytes32", "bytes32"], [s32, TAG_RARITY]));
  return Number(BigInt(h) % 10000n);
}

function bucket(roll: number): Rarity {
  for (const t of RARITY_TIERS) if (roll >= t.lo && roll < t.hi) return t.tier;
  return "Common"; // unreachable (tiers cover [0,10000)), defensive
}

/**
 * Provable rarity. Legacy/non-pull seeds (seed < 2^64) -> "Common" (the backward-compat gate, no
 * migration). A real pull seedRoot -> the bucketed roll. Pure + recomputable from the on-chain seed alone.
 */
export function deriveRarity(seed: bigint): Rarity {
  if (!isProvablePullSeed(seed)) return "Common";
  return bucket(rarityRoll(seed));
}

/** Tolerant parse for callers that hold the seed as a decimal/hex string (API/db) before deriving. */
export function deriveRarityFromString(seed: string | number | bigint): Rarity {
  let v: bigint;
  try {
    v = BigInt(seed);
  } catch {
    return "Common";
  }
  return deriveRarity(v);
}
