// SERVER-ONLY, PURE. The GENOME -> STYLE -> PROMPT mapping: it turns a child's on-chain 8-locus genome into a
// coherent, model-legible STYLE descriptor + render prompt, so the child's portrait VISIBLY blends both
// parents. Because the child genome is Mendelian-inherited locus-by-locus (fuse-genome.ts), each style axis
// (palette / linework / texture / rendering / motif / composition / light / finish) is drawn from ONE parent
// (or a 5% mutation) - so a child of a "risograph pink" parent and a "charcoal chiaroscuro" parent renders as
// a genuine hybrid (e.g. risograph palette + charcoal linework), not mud.
//
// This is the STYLE analog of gacha.ts's 12 SUBJECT pools: gacha varies the SUBJECT (style stays the agent's);
// FUSION varies the heritable STYLE genome. The locus order + pool sizes are byte-locked to FuseGenome.sol's
// poolSizes() [12,8,8,8,10,8,8,6]; the vocab lists below are sized to match (self-checked at module load).
import type { Genome } from "./fuse-genome.js";
import { poolSizes, N_LOCI } from "./fuse-genome.js";
import type { StyleVec } from "../memory/types.js";

// The 8 style loci, in the CANONICAL FuseGenome order. Each list holds exactly poolSizes()[i] entries (the
// allele index selects one). Editing an entry changes what a genome renders as but NOT the genome itself
// (the genome is the on-chain DNA; this is its visible expression) - keep them coherent + non-overlapping.
const PALETTE = [
  "risograph duotone pink-and-blue",
  "muted earth ochre and umber",
  "high-key pastel wash",
  "monochrome ink grayscale",
  "neon cyber magenta-and-cyan",
  "warm sepia and antique gold",
  "cool teal and slate",
  "vivid primary triad",
  "desaturated film-noir tones",
  "iridescent oil-slick spectrum",
  "candlelit amber against shadow",
  "arctic blue-white and silver",
]; // 12

const LINEWORK = [
  "fine confident pen linework",
  "loose gestural charcoal strokes",
  "hard clean vector edges",
  "rough scratchy dry-brush lines",
  "no visible outline, form built from value",
  "bold woodcut contours",
  "delicate hair-thin etched lines",
  "brushy calligraphic sweeps",
]; // 8

const TEXTURE = [
  "halftone dot grain",
  "raw canvas-weave tooth",
  "smooth airbrushed gradients",
  "heavy impasto ridges",
  "paper fiber and deckle edges",
  "grainy film-emulsion speckle",
  "dense cross-hatched shading",
  "polished glass sheen",
]; // 8

const RENDERING = [
  "flat 2D graphic shapes",
  "soft volumetric painterly form",
  "cel-shaded animation look",
  "hyperdetailed illustrative realism",
  "low-poly faceted geometry",
  "watercolor bleed and pooling",
  "sculptural chiaroscuro modeling",
  "collage cut-paper layering",
]; // 8

const MOTIF = [
  "koi, cranes, and rippling water",
  "gears, brass, and clockwork",
  "constellations and orbital rings",
  "botanical vines and blossoms",
  "geometric sacred lattices",
  "urban signage and tangled wires",
  "folk talismans and charms",
  "oceanic waves and shells",
  "mountains, mist, and pine",
  "circuitry and luminous glyphs",
]; // 10

const COMPOSITION = [
  "centered symmetrical icon",
  "dynamic diagonal motion",
  "sparse negative-space framing",
  "dense all-over pattern",
  "low-angle heroic framing",
  "intimate close crop",
  "sweeping wide vista",
  "layered depth with a foreground frame",
]; // 8

const LIGHT = [
  "soft diffuse ambient glow",
  "hard dramatic rim light",
  "warm candlelit flicker",
  "cool moonlit wash",
  "backlit silhouette halo",
  "dappled broken light",
  "bioluminescent inner glow",
  "high-contrast noir shadow",
]; // 8

const FINISH = [
  "matte print finish",
  "glossy lacquer sheen",
  "aged patina and wear",
  "crisp digital clarity",
  "hand-pressed print texture",
  "dreamy soft-focus haze",
]; // 6

interface Locus {
  key: keyof StylePicks;
  pool: string[];
}

// Order is canonical + load-bearing: it must match FuseGenome.poolSizes() index-for-index.
const LOCI: Locus[] = [
  { key: "palette", pool: PALETTE },
  { key: "linework", pool: LINEWORK },
  { key: "texture", pool: TEXTURE },
  { key: "rendering", pool: RENDERING },
  { key: "motif", pool: MOTIF },
  { key: "composition", pool: COMPOSITION },
  { key: "light", pool: LIGHT },
  { key: "finish", pool: FINISH },
];

// Self-check: every locus vocab must be exactly its FuseGenome pool size. Fail fast at module load so a
// mis-sized list can never silently shrink the expressible style space (mirrors gacha.ts's pool self-check).
{
  const sizes = poolSizes();
  if (LOCI.length !== N_LOCI) throw new Error(`genome-style: expected ${N_LOCI} loci, got ${LOCI.length}`);
  for (let i = 0; i < LOCI.length; i++) {
    if (LOCI[i]!.pool.length !== sizes[i]) {
      throw new Error(`genome-style: locus "${LOCI[i]!.key}" size ${LOCI[i]!.pool.length} != pool ${sizes[i]}`);
    }
    if (new Set(LOCI[i]!.pool).size !== LOCI[i]!.pool.length) {
      throw new Error(`genome-style: locus "${LOCI[i]!.key}" has duplicate entries`);
    }
  }
}

export interface StylePicks {
  palette: string;
  linework: string;
  texture: string;
  rendering: string;
  motif: string;
  composition: string;
  light: string;
  finish: string;
}

/** The style vocab pools by locus key (exposed for verifiers/tests: pool[allele] is the rendered trait word). */
export const STYLE_POOLS: Record<keyof StylePicks, string[]> = {
  palette: PALETTE,
  linework: LINEWORK,
  texture: TEXTURE,
  rendering: RENDERING,
  motif: MOTIF,
  composition: COMPOSITION,
  light: LIGHT,
  finish: FINISH,
};

/** Map a genome (allele index per locus) to its picked style words. Pure + deterministic. */
export function genomeToStyle(genome: Genome): StylePicks {
  if (genome.length !== N_LOCI) throw new Error(`genomeToStyle: genome must be length ${N_LOCI}`);
  const sizes = poolSizes();
  const picks = {} as StylePicks;
  for (let i = 0; i < LOCI.length; i++) {
    const idx = ((genome[i]! % sizes[i]!) + sizes[i]!) % sizes[i]!; // defensive modulo (contract guarantees in-range)
    picks[LOCI[i]!.key] = LOCI[i]!.pool[idx]!;
  }
  return picks;
}

/** A single coherent, model-legible STYLE sentence composed from the genome's picks (the visible blend). */
export function blendedStyleDescriptor(genome: Genome): string {
  const p = genomeToStyle(genome);
  return (
    `${p.palette} palette; ${p.linework}; ${p.texture}; rendered as ${p.rendering}; ` +
    `recurring motifs of ${p.motif}; ${p.composition}; ${p.light}; ${p.finish}`
  );
}

const DEFAULT_NEGATIVE = "no photorealism if stylized, no unwanted artifacts, no watermark, no text";

/**
 * A StyleVec (the memory/brain style record shape) derived from the genome. identityLock is generic (a fused
 * child has no single reference subject to lock); the descriptor IS the blended style; negative is defaulted.
 */
export function genomeToStyleVec(genome: Genome): StyleVec {
  return {
    descriptor: blendedStyleDescriptor(genome),
    identityLock: "Keep a single clear focal subject; render it fully in the fused signature style.",
    negative: DEFAULT_NEGATIVE,
    basePolicy: "feed a parent reference as the edit base; the genome-derived style is the determinism anchor",
  };
}

/**
 * The render prompt for the child's portrait. Style-lock-only (like the summon pull template): it locks the
 * BLENDED style and asks for a brand-new signature emblem, so the child looks like a genuine hybrid of both
 * parents rather than a copy of either reference.
 */
export function genomeToPrompt(childName: string, genome: Genome, negative = DEFAULT_NEGATIVE): string {
  const style = blendedStyleDescriptor(genome);
  return (
    `In the fused signature style of ${childName}: ${style}. ` +
    `Create a brand-new original portrait emblem that embodies this exact hybrid style - do NOT reproduce the ` +
    `reference image's subject or composition, invent a fresh iconic subject rendered in this style. Avoid: ${negative}.`
  );
}
