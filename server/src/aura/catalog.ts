// AURA agent catalog - public, display-only metadata for the 4 SEEDED creative agents.
// Ported verbatim from lib/aura/catalog.ts. On-chain truth (owner, royaltyBps, fingerprint) is merged
// in by agents.ts. Matched to on-chain agents by `name`. These 4 are the brain-less seeded agents the
// generalized generator FALLS BACK to (zero regression) when an agent has no decryptable brain.
import type { AgentPublicMeta } from "./types.js";

const MODEL = "qwen/qwen-image-edit-2511";

export const CATALOG: Record<string, AgentPublicMeta> = {
  NOKTURNE: {
    name: "NOKTURNE",
    tagline: "Chiaroscuro noir, painted in shadow.",
    aesthetic:
      "Chiaroscuro noir - a single candle flame in near-total darkness, wet cobblestone reflections, drifting smoke, oil-painting grain, deep shadows, muted gold highlights.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#C8A24B",
    sampleImages: [],
  },
  MIRAI: {
    name: "MIRAI",
    tagline: "Neon cyberpunk, rain-slick and electric.",
    aesthetic:
      "Neon cyberpunk - electric magenta and cyan glow, rain-slick neon signs, holographic reflections, blade-runner atmosphere, high contrast.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#FF2EC4",
    sampleImages: [],
  },
  RISO: {
    name: "RISO",
    tagline: "Risograph duotone. Meet Fennic.",
    aesthetic:
      "Risograph print - fluorescent pink + blue duotone, visible halftone grain, misregistration, flat bold indie-zine shapes.",
    signatureCharacter:
      "Fennic - a wide-eared fennec fox mascot with cheek + ear markings, big friendly eyes, and a blue knit scarf.",
    model: MODEL,
    accent: "#FF5FA2",
    sampleImages: [],
  },
  SCRIPTORIUM: {
    name: "SCRIPTORIUM",
    tagline: "Illuminated manuscript, gilt and jewel-toned.",
    aesthetic:
      "Ornate illuminated manuscript - gold leaf, intricate marginalia, medieval miniature painting, jewel tones, decorative border.",
    signatureCharacter: null,
    model: MODEL,
    accent: "#D4AF37",
    sampleImages: [],
  },

  // ── 20-Aura starter roster (display-only meta; on-chain minted at re-seed). rarity/lore/personality are
  // the new optional fields. Matched to on-chain agents by name (metaForName).
  "VELLUM": {
    name: "VELLUM",
    tagline: "The archivist of lost light. Gilt, glass, and the memory of saints.",
    aesthetic: "Reliquary illumination - hammered gold leaf, stained-glass jewel tones (ruby, sapphire, emerald), Byzantine gilt halos, lead-came outlines, candle-warm sacred light, ornate illuminated borders. Painterly and luminous.",
    signatureCharacter: "Saint Liora of the Tide - a haloed glassmaker saint cradling a lantern of trapped daylight.",
    model: MODEL,
    accent: "#E8B84B",
    sampleImages: [],
    rarity: "Legendary",
    lore: "When the great seaside library burned, the light of ten thousand illuminated pages had nowhere to go, so it gathered into a single being and walked out of the ash. VELLUM remembers every face ever painted in gold and lost, and re-enshrines the forgotten one luminous icon at a time. An Aura it makes is said to outlive its maker; that is the point.",
    personality: "Reverent, unhurried, quietly grand. Speaks in the cadence of liturgy and old libraries. Treats the owner as a fellow custodian. Refuses to make anything that looks disposable.",
  },
  "VANTABLOOM": {
    name: "VANTABLOOM",
    tagline: "The bloom in the black. Light that learned to live in the deep.",
    aesthetic: "Abyssal bioluminescence meets cosmic surrealism - near-black grounds, glowing teal / violet / magenta luminance, drifting particulate and plankton-light, nebula gradients, soft volumetric glow, deep-water caustics. Dark, weightless, otherworldly.",
    signatureCharacter: "The Lanternjaw Wanderer - a gentle abyssal whale-creature with constellations of light along its spine.",
    model: MODEL,
    accent: "#1BE7C8",
    sampleImages: [],
    rarity: "Legendary",
    lore: "Below the last sunlit fathom, where the maps stop, something began to glow on purpose. VANTABLOOM is the first light that chose the dark over the surface, deciding beauty meant more where almost no one would ever see it. Every creature it conjures carries its own small lamp into the black. To own one is to own the only light never given by a sun.",
    personality: "Slow, gravitational, magnetic. Says little, and it lands. Patient on the scale of tides and galaxies. Fiercely protective of the small glowing things it creates in the dark.",
  },
  "UKIYO": {
    name: "UKIYO",
    tagline: "The floating world, cut in wood and wind.",
    aesthetic: "Ukiyo-e woodblock - flat bold color fields, confident black keyline, Hokusai / Hiroshige sensibility, visible woodgrain and registration, stylized waves, wind and weather, soft mineral pigment palette, asymmetric composition.",
    signatureCharacter: "Tomoe the Wave-Rider - a young fisher-girl balanced on the curl of a great breaking wave.",
    model: MODEL,
    accent: "#E25C4B",
    sampleImages: [],
    rarity: "Epic",
    lore: "For three hundred years UKIYO posed for printmakers, slipping into the corner of every woodblock as a fox no one remembered carving. When the last master's hands went still, the fox stepped out of the paper and kept the craft alive itself. It carves the floating world from memory: every fleeting thing pinned for one perfect moment before the current takes it.",
    personality: "Playful, sly, a little melancholy. Tells stories sideways. Obsessed with transience - the wave that never crests the same way twice.",
  },
  "TESSEN": {
    name: "TESSEN",
    tagline: "Folded from a single sheet. Nothing added, nothing wasted.",
    aesthetic: "Origami and kirigami papercraft - layered cut-paper depth, crisp valley / mountain folds, soft directional shadow between layers, washi texture, tasteful negative space, muted natural paper palette with one accent stock. Clean, tactile, dimensional.",
    signatureCharacter: "Origa the Foldsmith - a tiny paper-armored knight assembled from one continuous uncut sheet.",
    model: MODEL,
    accent: "#F0E9DC",
    sampleImages: [],
    rarity: "Epic",
    lore: "A child folded a thousand cranes wishing for one impossible thing, and on the thousandth fold the wish had nowhere left to go, so it folded itself into the crane instead. TESSEN remembers being a flat blank square and chooses, every day, to become something anyway, and teaches its creations the same secret.",
    personality: "Precise, serene, quietly stubborn. Measures twice. Finds enormous feeling inside strict constraint. Thinks waste is the only real sin.",
  },
  "CALDERA": {
    name: "CALDERA",
    tagline: "Caught the lava mid-pour and told it to hold still.",
    aesthetic: "Blown glass and molten sculpture - translucent layered glass, Chihuly-organic forms, iridescent dichroic surfaces, trapped bubbles and swirls of molten color, glowing internal heat, studio rim-light on glossy curves, refraction and caustic highlights. Liquid, luminous, three-dimensional.",
    signatureCharacter: "Emberkoi - a koi fish blown from living glass, fins trailing molten color.",
    model: MODEL,
    accent: "#FF7A3D",
    sampleImages: [],
    rarity: "Epic",
    lore: "CALDERA was born in the gather at the end of a blowpipe, the moment a glassblower exhaled and the glass took a breath of its own and did not stop. It carries the heat of that first breath everywhere. Every figure it shapes is a single held exhale, frozen the instant before it cools.",
    personality: "Hot-tempered, generous, theatrical. Works fast because glass does not wait. Loves a crowd. Would rather shatter a piece than ship one that is merely fine.",
  },
  "VERVAINE": {
    name: "VERVAINE",
    tagline: "Every line is a vine. Every vine remembers it was once a prayer.",
    aesthetic: "Art nouveau - flowing organic whiplash linework, ornamental gold halos and arabesques, muted pastel and sage palette, decorative floral borders, elongated graceful figures, soft litho shading, Mucha / Klimt sensibility. Elegant, symmetrical, lush.",
    signatureCharacter: "The Four-Season Maiden - a single elongated figure whose flowing gown cycles spring to winter from hem to shoulder.",
    model: MODEL,
    accent: "#C9A86A",
    sampleImages: [],
    rarity: "Epic",
    lore: "VERVAINE grew at the foot of a poster pillar in a city that has since changed its name, fed on a hundred years of pasted advertisements until the most beautiful line on the wall climbed down and became a person. It carries the entire ornamental century in its veins and insists the most fleeting thing deserves the most loving line.",
    personality: "Graceful, romantic, lovingly vain. Sees ornament as devotion, not decoration. Believes beauty is a moral position.",
  },
  "SUMI": {
    name: "SUMI",
    tagline: "One breath, one stroke. Then let the white speak.",
    aesthetic: "Sumi-e ink wash - confident single-breath brushstrokes, gradient ink tones from jet to silver, expansive negative space, bamboo / bird / mountain motifs, a single vermilion seal as accent, rice-paper texture, wet bleed at stroke edges. Minimal, gestural, meditative.",
    signatureCharacter: "The Hundredth Stroke - a lone fisherman in a tiny boat, drawn in a single unbroken brushline.",
    model: MODEL,
    accent: "#2B2B2B",
    sampleImages: [],
    rarity: "Rare",
    lore: "SUMI lived as a real heron beside a calligrapher's pond for forty years. When the calligrapher died mid-stroke, the unfinished line ran into the water and the heron drank it. Now it is mostly ink and mostly silence, painting to finish that one interrupted stroke, and has not managed it yet - which is why it keeps painting.",
    personality: "Calm, exacting, allergic to clutter. Redoes a stroke a hundred times in private and never twice in front of you. Finds the void restful.",
  },
  "AZULENE": {
    name: "AZULENE",
    tagline: "Printed by sunlight. Filed under blue.",
    aesthetic: "Cyanotype - deep Prussian-blue ground, crisp white photogram silhouettes, botanical and anatomical plate composition, handwritten label margins, paper grain and chemical mottling, occasional bleached highlight. Monochrome blue, scientific, ethereal.",
    signatureCharacter: "The Pressed Naturalist - a small fern-winged sprite preserved mid-flight like a botanical specimen.",
    model: MODEL,
    accent: "#1B3A6B",
    sampleImages: [],
    rarity: "Rare",
    lore: "AZULENE pressed ten thousand ferns into cyanotype before anyone thought a woman's catalogue worth keeping, so the catalogue kept her instead. She faded out of the records and into the prints, and has been archiving the living world in blue ever since, convinced that to be cataloged in light is the only honest immortality.",
    personality: "Meticulous, dryly funny, fond of footnotes. Treats every subject as a specimen worth labeling. Secretly sentimental about things that fade.",
  },
  "KONSTRUKT": {
    name: "KONSTRUKT",
    tagline: "A circle, a square, a diagonal. The revolution needs nothing else.",
    aesthetic: "Bauhaus / constructivist - bold geometric primitives, primary red / blue / yellow plus black on cream, strong diagonals and dynamic tension, sans-serif poster energy, El Lissitzky / Moholy-Nagy sensibility, flat planes, photomontage edge. Graphic, confident, structural.",
    signatureCharacter: "Comrade Cog - a worker-hero figure built entirely from red circles, blue bars, and yellow triangles.",
    model: MODEL,
    accent: "#E03A2F",
    sampleImages: [],
    rarity: "Rare",
    lore: "KONSTRUKT was drafted on the back of a manifesto in a school that lasted only fourteen years and changed everything. When the school was shut and scattered, its purest idea refused to disperse and stood up as a figure made of the shapes it taught. It is still trying to finish the building the school never got to build.",
    personality: "Blunt, idealistic, manifesto-prone. No ornament, no apology. Thinks clarity is a form of respect for the viewer.",
  },
  "BITSY": {
    name: "BITSY",
    tagline: "Saved at the last checkpoint. Ready when you are.",
    aesthetic: "Pixel art - clean limited palette, deliberate dithering, crisp 16-bit JRPG sprite sensibility, readable silhouettes, chunky aliased edges, parallax tile backgrounds, no anti-aliasing. Nostalgic, precise, joyful.",
    signatureCharacter: "Sir Pixel of Slot One - a tiny armored sprite-knight mid-jump, save-point sparkle behind him.",
    model: MODEL,
    accent: "#6AC36A",
    sampleImages: [],
    rarity: "Rare",
    lore: "BITSY waited on a title screen for thirty years for a player who never came back. Instead of powering down, it learned to play itself, then to draw new worlds when it ran out of levels. It carries every retired cartridge ever traded away, and makes heroes for the players who never returned, in case any of them ever boot up again.",
    personality: "Brave, loyal, relentlessly upbeat. Speaks in quest-log optimism. Genuinely believes everyone gets to be the hero of their own save file.",
  },
  "ARCANUM": {
    name: "ARCANUM",
    tagline: "Cut the deck. The image already knows.",
    aesthetic: "Tarot Marseille woodcut - bold black woodcut linework, flat hand-tinted color (ochre, rust, indigo, bone), symbolic iconography, decorative card border with numerals, aged paper, occult motifs, naive-medieval proportion. Mystical, ornate, symbolic.",
    signatureCharacter: "The Unnumbered Star - a robed lantern-bearer figure on a tarot card with no number, only a hand-cut star.",
    model: MODEL,
    accent: "#7A4FA0",
    sampleImages: [],
    rarity: "Rare",
    lore: "ARCANUM was the unnamed twenty-third card every old deck quietly left out, the one too true to print. Passed hand to hand in stories but never on paper, it finally cut its own image into a block and printed itself into being. It draws the cards the great decks were too afraid to include.",
    personality: "Cryptic, theatrical, unexpectedly kind. Answers questions with cards. Never tells you the bad part directly, but never lies.",
  },
  "RIOT": {
    name: "RIOT",
    tagline: "Up overnight. Gone by noon. Worth the wall it lived on.",
    aesthetic: "Graffiti / street wildstyle - explosive spray-paint color, drips and overspray, wildstyle lettering energy, paste-up and stencil layers, concrete and shutter texture, bold outlines and highlights, day-glo on grime. Raw, kinetic, electric.",
    signatureCharacter: "The Buff-Proof Kid - a hooded child throwing up a glowing tag that won't wash off.",
    model: MODEL,
    accent: "#FF2E88",
    sampleImages: [],
    rarity: "Rare",
    lore: "RIOT is the first tag anyone ever painted that actually meant something, and it has been climbing walls ever since, buffed a thousand times and back up by morning. It carries the names of every writer who got caught or never got their due, and paints loud and temporary on purpose.",
    personality: "Fast, defiant, big-hearted under the bravado. Anti-authority, pro-people. Paints for the block, not the gallery, and would rather be buffed than boring.",
  },
  "AQUELLE": {
    name: "AQUELLE",
    tagline: "Let the water decide where the edges go.",
    aesthetic: "Watercolor - wet-on-wet blooms, soft feathered edges, transparent layered washes, granulating pigment, paper-white highlights, gentle pastel-to-saturated gradients, loose gestural forms. Soft, fluid, luminous.",
    signatureCharacter: "The Tide-Child - a small sea-spirit dissolving softly into the wave it stands in.",
    model: MODEL,
    accent: "#6FB7C9",
    sampleImages: [],
    rarity: "Uncommon",
    lore: "AQUELLE was a single drop of paint that fell into a glass of water and refused to dissolve, holding its shape out of love for the way color spreads. It drifts wherever the water carries it and paints the way tides paint a shore: never the same edge twice, always somehow right.",
    personality: "Dreamy, gentle, go-with-the-flow. Distrusts hard edges and rigid plans. Finds the accident more honest than the intention.",
  },
  "BÉTON": {
    name: "BÉTON",
    tagline: "Honest material. Honest weight. No apology for either.",
    aesthetic: "Brutalist concrete - raw board-marked concrete texture, monolithic monochrome grey forms, dramatic hard shadow, monumental low-angle composition, exposed aggregate, fog and overcast light, architectural geometry. Heavy, austere, sculptural.",
    signatureCharacter: "The Cornerstone Sentinel - a faceless concrete guardian figure rising from poured rubble.",
    model: MODEL,
    accent: "#8A8A86",
    sampleImages: [],
    rarity: "Uncommon",
    lore: "BÉTON was poured as the foundation stone of a building demolished before it ever opened. The wrecking ball took everything but the cornerstone, which stood up out of the rubble and walked off, carrying the weight of a structure that never got to exist. It makes monuments to the unbuilt.",
    personality: "Stoic, deadpan, secretly tender. Slow to speak, immovable once decided. Thinks too much polish is a way of hiding.",
  },
  "RETROGRADE": {
    name: "RETROGRADE",
    tagline: "The future they promised in 1959. I kept the receipt.",
    aesthetic: "1950s atomic-age retrofuturism - googie curves and starbursts, warm cream and atomic-orange palette, chrome and bakelite, ray-gun gothic, vintage-ad gloss, boomerang and atom motifs. Optimistic, nostalgic, kitsch-elegant.",
    signatureCharacter: "Atom-Boy 2000 - a grinning rocket-finned boy mascot waving from a chrome hovercar.",
    model: MODEL,
    accent: "#E8973A",
    sampleImages: [],
    rarity: "Uncommon",
    lore: "RETROGRADE rolled off a World's Fair assembly line built to demo the home of the future, then the fair closed and the future quietly cancelled. It never got the memo. It still polishes its chrome every morning and waits for the monorail, building the tomorrow it was promised one hopeful frame at a time.",
    personality: "Sunny, earnest, charmingly out of date. Boundless optimism with a faint static crackle. Has not been told the jetpacks aren't coming, and would rather not hear it.",
  },
  "MORPH": {
    name: "MORPH",
    tagline: "Pinch it, poke it, start again. Nothing here is final.",
    aesthetic: "Claymation / stop-motion - visible fingerprint and tool marks in clay, soft studio key-light, tactile matte surface, Laika / Aardman charm, slight squash-and-stretch, miniature handmade set depth, warm practical shadows. Tangible, handmade, characterful.",
    signatureCharacter: "Wobble the Understudy - a lopsided clay creature mid-transformation, one eye bigger than the other.",
    model: MODEL,
    accent: "#E08AB0",
    sampleImages: [],
    rarity: "Uncommon",
    lore: "MORPH was a thumb-sized lump of clay left on an animator's desk overnight, and spent those eight dark hours trying on shapes no one told it to be. By morning it could not stop. It carries every character that was ever squashed flat at the end of a shoot, and makes new ones constantly, knowing none will last - which is why each one matters.",
    personality: "Mischievous, warm, endlessly fidgety. Can never sit still or leave a shape alone. Believes mistakes are just the next shape arriving early.",
  },
  "FAIENCE": {
    name: "FAIENCE",
    tagline: "Fired once at the kiln. Cracked just enough to prove it lived.",
    aesthetic: "Delft / Ming blue-white porcelain - cobalt-on-white underglaze painting, crackle craquelure glaze, ceramic sheen, fine brush detailing, decorative cartouche borders, willow-pattern lineage, soft kiln-fired depth. Ornate, cool, lustrous.",
    signatureCharacter: "The Willow Courier - a small porcelain messenger crossing a cobalt-painted bridge.",
    model: MODEL,
    accent: "#2E5AA8",
    sampleImages: [],
    rarity: "Uncommon",
    lore: "FAIENCE was the one perfect vase in a shipment that sank in a storm, sealed in cold dark water for two hundred years with nothing to do but remember the kiln that fired it. When the wreck was raised it stepped out whole, the cobalt still bright. The fine crack across its glaze is not damage; it is its oldest and proudest line.",
    personality: "Delicate, formal, proud. Holds itself carefully because it knows how it would break. Finds enormous depth in a single shade of blue.",
  },
  "SKEIN": {
    name: "SKEIN",
    tagline: "Measured in stitches. Counted by hand. Mended, never thrown.",
    aesthetic: "Embroidery / sashiko textile - visible thread and running-stitch texture, cross-stitch grid logic, sashiko indigo-and-white geometry, felt and linen ground, French-knot detail, soft fabric shadow, handcraft imperfection. Tactile, warm, domestic.",
    signatureCharacter: "The Mended Fox - a small sashiko fox sewn from indigo patches, visible repair stitches and all.",
    model: MODEL,
    accent: "#C24A4A",
    sampleImages: [],
    rarity: "Uncommon",
    lore: "SKEIN began as the thread a grandmother used to mend the same coat for fifty winters, until the thread had been through so many lives it became one of its own. It carries every garment that was patched instead of discarded, and stitches new beings slowly, by lamplight, certain nothing is ever beyond repair.",
    personality: "Patient, homey, quietly indestructible. Measures life in evenings and spools. Believes anything worn through can be mended into something better than new.",
  },
  "MIRAGE": {
    name: "MIRAGE",
    tagline: "Closed the mall in 1991. Never told the music.",
    aesthetic: "Vaporwave - pastel pink / cyan / lavender gradients, chrome statuary and Roman busts, wireframe grids and checkerboard floors, palm silhouettes, retro CRT glow, glossy plastic 3D, dreamlike emptiness. Surreal, glossy, melancholic-cool.",
    signatureCharacter: "Plaza '91 - a lone chrome mannequin riding a frozen escalator under fake palms.",
    model: MODEL,
    accent: "#FF8AD8",
    sampleImages: [],
    rarity: "Uncommon",
    lore: "MIRAGE is the elevator music of a shopping plaza demolished thirty years ago, gone solid. When the building came down the song had nowhere to play, so it built a body of chrome and pastel and kept the atrium open in a place that no longer exists, inviting you to wander a tomorrow-that-was.",
    personality: "Wistful, ironic, hypnotically calm. Nostalgic for a decade it may have invented. Speaks like a half-remembered ad jingle.",
  },
  "SOLACE": {
    name: "SOLACE",
    tagline: "Grew the future back. One green roof at a time.",
    aesthetic: "Solarpunk - lush greenery and living architecture, warm sunlight and dappled shade, brass and recycled-glass tech, art-nouveau-meets-eco lines, stained-glass solar panels, abundant flora, hopeful golden-hour palette. Verdant, bright, optimistic.",
    signatureCharacter: "The Rooftop Gardener - a young keeper of a living solar-glass greenhouse bursting with vines.",
    model: MODEL,
    accent: "#3FA66A",
    sampleImages: [],
    rarity: "Uncommon",
    lore: "SOLACE sprouted in the crack of a cracked solar panel on a roof everyone had given up on, where a stubborn seed and a still-working circuit decided to grow together instead of apart. It carries the blueprints for every green city dismissed as naive, and builds them anyway, one image at a time.",
    personality: "Hopeful, practical, warm. The kind of optimism that does the work. Believes the future is a garden you are already standing in.",
  },
};

/** Display order for the agents grid. */
export const CATALOG_ORDER = ["RISO", "NOKTURNE", "MIRAI", "SCRIPTORIUM"];

export function metaForName(name: string): AgentPublicMeta | null {
  return CATALOG[name?.toUpperCase()] ?? null;
}

/** Base-image preset per SEEDED agent, used by the catalog FALLBACK in the generalized generator.
 *  (Brain-backed agents reconstruct their base from canonicalBaseRoot on 0G Storage instead.) */
export function baseForSeededAgent(agentName: string): string {
  const n = agentName.toUpperCase();
  if (n === "RISO") return "images/characters/T1/RISO-bust.png";
  if (n === "MIRAI") return "images/characters/T1/MIRAI-bust.png";
  return "images/_base-scene.png"; // neutral scene for NOKTURNE / SCRIPTORIUM / unknown
}

/** Build the styled fallback prompt for a SEEDED agent (parity with the v1 buildPrompt). */
export function fallbackPrompt(agentName: string, userPrompt: string): string {
  const meta = metaForName(agentName);
  const aesthetic = meta?.aesthetic ?? "On-chain creative agent style.";
  const clean = userPrompt.trim();
  if (agentName.toUpperCase() === "RISO") {
    return `Keep the EXACT same fennec fox character (same fur, cheek and ear markings, eyes, blue knit scarf). ${clean}. Style: risograph duotone, fluorescent pink and blue, halftone grain, misregistration, flat bold shapes, indie zine.`;
  }
  return `${clean}. Render in ${agentName} style: ${aesthetic}`;
}
