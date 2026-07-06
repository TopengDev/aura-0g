// Server-only dynamic OG/Twitter card renderer (Node runtime; AURA self-hosts as standalone Docker, so
// the Node runtime is mandatory and fully supported). Renders a 1200x630 share card with next/og
// ImageResponse (Satori -> Resvg), post-encodes it to a compact JPEG (X scrapers time out and do not
// retry; a lossless PNG of photographic art is ~1MB, the JPEG is ~130KB), and memoizes per card so a
// warm request never re-renders. Fonts are read at runtime from public/fonts (the same process.cwd()+
// /public pattern the images route uses in the standalone container). Every glyph on the card is covered
// by the two bundled fonts, so Satori never attempts a (failing, egress-blocked) dynamic font download.
//
// HONESTY GATE: the provenance label is network-aware. On testnet (Galileo 16602) it says "TEE-attested
// on 0G"; it only becomes "Verified on 0G mainnet" once the deployment moves to 16661. It never claims
// more than the on-chain state supports.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { APP_CHAIN, zgMainnet } from "@/lib/chains";
import { brandArtDataUri, brandMarkDataUri } from "@/lib/og/art";

const W = 1200;
const H = 630;

// Card canvas palette (a FIXED dark editorial ground, deliberately its own surface, not theme-aware).
const BG = "#0e0d0a";
const CREAM = "#f4ecdd";
const INK = "#efece3";
const MUTED = "#9a958a";
const MUTED2 = "#726d63";
const BORDER = "rgba(239,236,227,0.14)";
const OK_FG = "#7fe0c6";
const OK_BG = "rgba(93,213,182,0.12)";
const OK_BORDER = "rgba(93,213,182,0.34)";

// Style -> accent tint. Mirrors STYLE_TINT in app/images/[root]/route.ts (noir gold, cyberpunk magenta,
// risograph pink, illuminated gold, custom periwinkle).
const STYLE_TINT: Record<string, string> = {
  noir: "#C8A24B",
  cyberpunk: "#FF2EC4",
  risograph: "#FF5FA2",
  illuminated: "#D4AF37",
  custom: "#8A8AFF",
};
function tintFor(style?: string): string {
  return STYLE_TINT[(style || "custom").toLowerCase()] ?? STYLE_TINT.custom;
}

const PANEL_W = 570;
const PAD = 50;
const INNER = PANEL_W - PAD * 2; // 470

// Fit the display name to the panel width with a length-driven size (Satori has no clamp / auto-fit).
function nameFontSize(name: string): number {
  const n = (name || "").length;
  if (n <= 6) return 82;
  if (n <= 8) return 72;
  if (n <= 10) return 60;
  if (n <= 13) return 50;
  if (n <= 17) return 41;
  return 34;
}

const isMainnet = APP_CHAIN.id === zgMainnet.id;
function relicNetworkLabel(): string {
  return isMainnet ? "Verified on 0G mainnet" : "TEE-attested on 0G";
}
function auraNetworkLabel(): string {
  return isMainnet ? "Verified on 0G mainnet" : "On-chain Aura on 0G";
}

// Load + cache the two Satori-usable fonts once (ttf; the site's Switzer/Geist are woff2, unusable here).
let fontsPromise: Promise<{ name: string; data: Buffer; weight: 400 | 500; style: "normal" }[]> | null = null;
function loadFonts() {
  if (!fontsPromise) {
    const dir = path.join(process.cwd(), "public", "fonts");
    fontsPromise = Promise.all([
      readFile(path.join(dir, "EtherealGlamour-Regular.ttf")),
      readFile(path.join(dir, "JetBrainsMonoNL-Medium.ttf")),
    ]).then(([ethereal, mono]) => [
      { name: "Ethereal", data: ethereal, weight: 400 as const, style: "normal" as const },
      { name: "Mono", data: mono, weight: 500 as const, style: "normal" as const },
    ]);
  }
  return fontsPromise;
}

// ── card pieces ───────────────────────────────────────────────────────────
function Pill({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "7px 15px", borderRadius: 999, background: OK_BG, border: `1px solid ${OK_BORDER}`, color: OK_FG, fontFamily: "Mono", fontSize: 16, letterSpacing: 0.2, whiteSpace: "nowrap" }}>
      {text}
    </div>
  );
}

function Tag({ text, accent }: { text: string; accent: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", borderRadius: 7, background: `${accent}1f`, border: `1px solid ${accent}54`, color: accent, fontFamily: "Mono", fontSize: 15, letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap" }}>
      {text}
    </div>
  );
}

function ArtPanel({ artUri, accent, label }: { artUri: string | null; accent: string; label: string }) {
  return (
    <div style={{ display: "flex", width: 630, height: H, position: "relative" }}>
      {artUri ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artUri} width={630} height={630} style={{ objectFit: "cover" }} alt="" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 630, height: H, backgroundImage: `radial-gradient(80% 70% at 50% 40%, ${accent}30 0%, ${BG} 70%)` }}>
          <div style={{ display: "flex", fontFamily: "Ethereal", fontSize: 64, letterSpacing: 4, color: CREAM }}>AURA</div>
          <div style={{ display: "flex", marginTop: 14, fontFamily: "Mono", fontSize: 16, letterSpacing: 3, color: accent, textTransform: "uppercase" }}>{label}</div>
        </div>
      )}
      <div style={{ position: "absolute", top: 0, right: 0, width: 1, height: H, background: `${accent}66` }} />
    </div>
  );
}

function Shell({
  accent,
  kicker,
  marker,
  name,
  tags,
  descriptor,
  pillText,
  pillSide,
  metaLeft,
}: {
  accent: string;
  kicker: string;
  marker?: string;
  name: string;
  tags: ReactElement[];
  descriptor?: string;
  pillText: string;
  pillSide?: string;
  metaLeft: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: PANEL_W, height: H, padding: `46px ${PAD}px`, justifyContent: "space-between", backgroundImage: `radial-gradient(120% 90% at 100% 0%, ${accent}1f 0%, ${BG} 62%)` }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontFamily: "Ethereal", fontSize: 30, letterSpacing: 3, color: CREAM }}>AURA</div>
        <div style={{ display: "flex", fontFamily: "Mono", fontSize: 13, letterSpacing: 2, color: MUTED, textTransform: "uppercase" }}>Art you can prove</div>
      </div>
      {/* identity */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 15, letterSpacing: 3, color: MUTED, textTransform: "uppercase", whiteSpace: "nowrap" }}>{kicker}</div>
          <div style={{ display: "flex", flex: 1, height: 1, background: BORDER }} />
          {marker ? <div style={{ display: "flex", fontFamily: "Mono", fontSize: 15, letterSpacing: 1, color: accent, whiteSpace: "nowrap" }}>{marker}</div> : null}
        </div>
        <div style={{ display: "flex", width: INNER, overflow: "hidden", fontFamily: "Ethereal", fontSize: nameFontSize(name), lineHeight: 1, color: CREAM, letterSpacing: -1, whiteSpace: "nowrap" }}>{name}</div>
        {tags.length ? <div style={{ display: "flex", gap: 10, marginTop: 18 }}>{tags}</div> : null}
        {descriptor ? <div style={{ display: "flex", width: INNER, marginTop: 20, fontFamily: "Mono", fontSize: 17, lineHeight: 1.4, color: MUTED }}>{descriptor}</div> : null}
      </div>
      {/* provenance / moat */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Pill text={pillText} />
          {pillSide ? <div style={{ display: "flex", fontFamily: "Mono", fontSize: 14, color: MUTED2, whiteSpace: "nowrap" }}>{pillSide}</div> : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: MUTED2, fontFamily: "Mono", fontSize: 14, whiteSpace: "nowrap" }}>
          <div style={{ display: "flex" }}>{metaLeft}</div>
          <div style={{ display: "flex" }}>·</div>
          <div style={{ display: "flex", color: MUTED }}>aura.topengdev.com</div>
        </div>
      </div>
    </div>
  );
}

export function RelicCard({
  artUri,
  agentName,
  tokenId,
  rarity,
  style,
  provPrefix,
}: {
  artUri: string | null;
  agentName: string;
  tokenId: number;
  rarity?: string;
  style: string;
  provPrefix: string;
}): ReactElement {
  const accent = tintFor(style);
  const rare = rarity && rarity.toLowerCase() !== "common";
  const tags: ReactElement[] = [];
  if (rare) tags.push(<Tag key="r" text={`◆ ${rarity}`} accent={accent} />);
  tags.push(<Tag key="s" text={style} accent={accent} />);
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: BG, color: INK, fontFamily: "Mono" }}>
      <ArtPanel artUri={artUri} accent={accent} label={style} />
      <Shell
        accent={accent}
        kicker="Verifiable Relic"
        marker={`#${tokenId}`}
        name={agentName}
        tags={tags}
        descriptor="Provable 1/1 art, TEE-attested on 0G and minted with royalties that follow the work."
        pillText={`✓ ${relicNetworkLabel()}`}
        metaLeft={`prov ${provPrefix}`}
      />
    </div>
  );
}

export function AuraCard({
  artUri,
  name,
  agentId,
  rarity,
  style,
  tagline,
  relics,
  royalties,
}: {
  artUri: string | null;
  name: string;
  agentId: number;
  rarity?: string;
  style: string;
  tagline?: string;
  relics: number;
  royalties: string;
}): ReactElement {
  const accent = tintFor(style);
  const rare = rarity && rarity.toLowerCase() !== "common";
  const tags: ReactElement[] = [];
  if (rare) tags.push(<Tag key="r" text={`◆ ${rarity}`} accent={accent} />);
  tags.push(<Tag key="s" text={style} accent={accent} />);
  const stat = `${relics} ${relics === 1 ? "relic" : "relics"} · ${royalties} 0G royalties`;
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: BG, color: INK, fontFamily: "Mono" }}>
      <ArtPanel artUri={artUri} accent={accent} label={style} />
      <Shell
        accent={accent}
        kicker="Creative Aura"
        marker={`#${agentId}`}
        name={name}
        tags={tags}
        descriptor={tagline}
        pillText={`✓ ${auraNetworkLabel()}`}
        pillSide={stat}
        metaLeft="royalty follows the work"
      />
    </div>
  );
}

export function BrandCard({ artUri, markUri }: { artUri: string | null; markUri?: string | null }): ReactElement {
  const accent = STYLE_TINT.illuminated;
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: BG, color: INK, fontFamily: "Mono" }}>
      <ArtPanel artUri={artUri} accent={accent} label="0G" />
      <div style={{ display: "flex", flexDirection: "column", width: PANEL_W, height: H, padding: `50px ${PAD}px`, justifyContent: "space-between", backgroundImage: `radial-gradient(120% 90% at 100% 0%, ${accent}1f 0%, ${BG} 62%)` }}>
        <div style={{ display: "flex", fontFamily: "Mono", fontSize: 13, letterSpacing: 3, color: MUTED, textTransform: "uppercase" }}>The verifiable art marketplace</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* the halo/apex mark locked up with the wordmark */}
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            {markUri ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={markUri} width={90} height={90} alt="" />
            ) : null}
            <div style={{ display: "flex", fontFamily: "Ethereal", fontSize: 108, lineHeight: 0.98, letterSpacing: -1, color: CREAM }}>AURA</div>
          </div>
          <div style={{ display: "flex", width: INNER, marginTop: 20, fontFamily: "Mono", fontSize: 18, lineHeight: 1.45, color: MUTED }}>
            Creative Auras generate provable 1/1 art on 0G, TEE-attested, with royalties that follow the work.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex" }}>
            <Pill text={`✓ ${relicNetworkLabel()}`} />
          </div>
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 14, color: MUTED }}>aura.topengdev.com</div>
        </div>
      </div>
    </div>
  );
}

// ── render + memoize + JPEG post-encode ─────────────────────────────────────
const CARD_CACHE = new Map<string, { body: Uint8Array<ArrayBuffer>; type: string }>();
const CARD_CACHE_CAP = 128;

function respond(entry: { body: Uint8Array<ArrayBuffer>; type: string }, cacheControl: string): Response {
  return new Response(entry.body, { headers: { "content-type": entry.type, "cache-control": cacheControl } });
}

// Render `element` to a card image Response, memoized under `cacheKey`. `makeElement` is a FACTORY so
// the (backend-hitting) art resolution only runs on a cache MISS. A null factory result falls back to the
// brand card, so a crawler always receives a valid image, never a blank/broken one.
export async function renderCard(
  cacheKey: string,
  cacheControl: string,
  makeElement: () => Promise<ReactElement | null> | ReactElement | null,
): Promise<Response> {
  const hit = CARD_CACHE.get(cacheKey);
  if (hit) return respond(hit, cacheControl);

  let element = await makeElement();
  if (!element) element = <BrandCard artUri={await brandArtDataUri()} markUri={await brandMarkDataUri()} />;

  const fonts = await loadFonts();
  const ir = new ImageResponse(element, { width: W, height: H, fonts });
  const png = Buffer.from(await ir.arrayBuffer());

  let body: Uint8Array<ArrayBuffer>;
  let type: string;
  try {
    body = new Uint8Array(await sharp(png).jpeg({ quality: 85, mozjpeg: true }).toBuffer());
    type = "image/jpeg";
  } catch {
    body = new Uint8Array(png); // never fail the card over an encode issue
    type = "image/png";
  }

  if (CARD_CACHE.size >= CARD_CACHE_CAP) {
    const oldest = CARD_CACHE.keys().next().value;
    if (oldest !== undefined) CARD_CACHE.delete(oldest);
  }
  CARD_CACHE.set(cacheKey, { body, type });
  return respond({ body, type }, cacheControl);
}

// Cache-Control policies. A Relic card is content-addressed + immutable; an Aura card carries live-ish
// stats (relics/royalties) so it uses a short TTL + a 10-minute cache-key bucket (set by the route).
export const RELIC_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const AURA_CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=3600";
export const BRAND_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400";

export async function renderBrand(): Promise<Response> {
  return renderCard("brand", BRAND_CACHE_CONTROL, async () => (
    <BrandCard artUri={await brandArtDataUri()} markUri={await brandMarkDataUri()} />
  ));
}
