import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";

// Image-serving route. Resolves an image so the gallery NEVER shows a broken image, in order:
//   1. Baked catalog portrait (slug "showcase-<name>") or a baked showpiece output (ROOT_TO_FILE) ->
//      the PNG shipped inside the web image.
//   2. USER content -> proxy the REAL bytes from the BACKEND:
//        - "agent-<id>"  -> backend GET /agent-portrait/<id>  (a user agent's reference-image portrait)
//        - any other root -> backend GET /image/<root>        (a generated output / reference image)
//      The backend serves these from its durable local content-addressed cache (0G Storage testnet
//      evicts image-sized blobs, so the backend cache -- not 0G -- is the reliable source).
//   3. Anything still unresolved -> a deterministic styled SVG placeholder.
//
// NOTE on the key form: showcase roots are the slash-free slug "showcase-<name>" (the "0g://" scheme is
// stripped at the URL builder in lib/api.ts, because a "%2F" encoded-slash in the path segment 404s
// behind nginx + Next-standalone). Legacy "0g://showcase-<name>" keys are kept as tolerant aliases.

export const dynamic = "force-dynamic";

// In-cluster backend base for SSR-side fetches (NOT the public origin). Mirrors lib/api.ts API_BASE
// resolution: AURA_API_INTERNAL (compose: http://server:8787) > NEXT_PUBLIC_AURA_API > localhost.
function backendBase(): string {
  return (
    process.env.AURA_API_INTERNAL ||
    process.env.NEXT_PUBLIC_AURA_API ||
    "http://localhost:8787"
  ).replace(/\/$/, "");
}

// Fetch real image bytes from the backend (the durable source). Returns the raw bytes + content-type on
// success, null on any miss/error (the caller then renders the placeholder). Bytes (not a Response) so the
// caller can run them through the same optimize step (resize + AVIF/WebP) the baked local files get.
async function fetchBackendImage(pathAndQuery: string): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const res = await fetch(`${backendBase()}${pathAndQuery}`, { cache: "no-store" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/png";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return { bytes: buf, type: ct };
  } catch {
    return null;
  }
}

// ── Image optimization (resize + modern-format transcode) ──────────────────────────────────────────
// Mobile perf: the catalog/output art ships as ~1-2MB full-resolution PNGs (1024x1024) but is displayed
// at 130-370 CSS px, and PNG is the wrong wire format for photographic art. We transcode to AVIF (or
// WebP) via the browser's Accept header and optionally downscale to the requested display width (?w=).
// This is byte+decode optimization ONLY -- the same source pixels, re-encoded near-losslessly and sized
// to what is shown -- so it does not change how anything looks. SVG placeholders are never touched.
//
// Transcoded buffers are cached in TWO layers keyed by (cacheKey, width, format):
//   L1 in-process Map  -- fastest, but capped + wiped on every container restart.
//   L2 on-disk cache   -- survives restarts/redeploys. Because every key is content-addressed (the image
//                         root, a baked-file path, or an agent id whose portrait is stable), a cached
//                         variant is valid effectively forever, so the CPU-heavy AVIF encode becomes a
//                         TRUE one-time cost instead of being repeated on every cold load. This is the
//                         core perf fix: a cold visit (jury first load, or any load after a redeploy) now
//                         reads a ready file in ~tens of ms instead of paying a 3-6s synchronous encode.
// On ANY sharp/disk error we fall back to the original bytes -- an image never breaks.
type Optimized = { body: Uint8Array<ArrayBuffer>; type: string };
const XCODE_CACHE = new Map<string, Optimized>();
const XCODE_MAX = 256;

// L2 disk cache directory. In the container this is a mounted named volume (see deploy compose) so the
// encoded variants persist across `docker compose up --force-recreate`. Defaults to a dir under the app
// working dir for local dev. Best-effort: any failure here silently degrades to encode-on-request.
const DISK_CACHE_DIR =
  process.env.IMAGE_XCODE_CACHE_DIR || path.join(process.cwd(), ".image-cache");
let diskReady: Promise<boolean> | null = null;
function ensureDiskCache(): Promise<boolean> {
  if (!diskReady) {
    diskReady = mkdir(DISK_CACHE_DIR, { recursive: true })
      .then(() => true)
      .catch(() => false);
  }
  return diskReady;
}
function extFor(fmt: "avif" | "webp" | null): string {
  return fmt === "avif" ? "avif" : fmt === "webp" ? "webp" : "png";
}
function typeFor(fmt: "avif" | "webp" | null): string {
  return fmt === "avif" ? "image/avif" : fmt === "webp" ? "image/webp" : "image/png";
}
// A filesystem-safe, collision-free filename for a transcode key. The key can contain "/", "|", ":" and
// arbitrary root bytes, so hash it; the format is the extension.
function diskPathFor(ck: string, fmt: "avif" | "webp" | null): string {
  const h = createHash("sha1").update(ck).digest("hex");
  return path.join(DISK_CACHE_DIR, `${h}.${extFor(fmt)}`);
}
async function diskGet(ck: string, fmt: "avif" | "webp" | null): Promise<Optimized | null> {
  try {
    const buf = await readFile(diskPathFor(ck, fmt));
    if (buf.length === 0) return null;
    return { body: new Uint8Array(buf), type: typeFor(fmt) };
  } catch {
    return null; // not cached on disk yet (or unreadable) -- caller encodes
  }
}
async function diskPut(ck: string, fmt: "avif" | "webp" | null, out: Buffer): Promise<void> {
  try {
    if (!(await ensureDiskCache())) return;
    const final = diskPathFor(ck, fmt);
    // Atomic publish: write a unique temp file then rename, so a concurrent reader never sees a partial
    // file and two concurrent encoders of the same key don't corrupt each other.
    const tmp = `${final}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, out);
    await rename(tmp, final);
  } catch {
    /* best-effort: a disk-cache write failure must never break image serving */
  }
}
function memPut(ck: string, res: Optimized): void {
  if (XCODE_CACHE.size >= XCODE_MAX) {
    const first = XCODE_CACHE.keys().next().value;
    if (first !== undefined) XCODE_CACHE.delete(first);
  }
  XCODE_CACHE.set(ck, res);
}

// Raster types sharp can decode + we are willing to re-encode. SVG/GIF pass through untouched.
const TRANSCODABLE = /^image\/(png|jpe?g|webp|avif|tiff)$/i;

function pickFormat(accept: string): "avif" | "webp" | null {
  if (/image\/avif/i.test(accept)) return "avif";
  if (/image\/webp/i.test(accept)) return "webp";
  return null;
}

function parseWidth(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Clamp to a sane band: never below 16, never upscale beyond a retina ceiling.
  return Math.max(16, Math.min(2048, n));
}

async function transcode(
  bytes: Buffer,
  fmt: "avif" | "webp" | null,
  width: number | null,
  cacheKey: string,
): Promise<Optimized | null> {
  // Nothing to do: browser wants no modern format AND no resize was requested -> serve original.
  if (!fmt && !width) return null;
  const ck = `${cacheKey}|w=${width ?? 0}|f=${fmt ?? "orig"}`;
  // L1: in-process.
  const hit = XCODE_CACHE.get(ck);
  if (hit) return hit;
  // L2: on-disk (survives restarts) -- a cold process still skips the expensive encode.
  const onDisk = await diskGet(ck, fmt);
  if (onDisk) {
    memPut(ck, onDisk);
    return onDisk;
  }
  try {
    let img = sharp(bytes, { failOn: "none" });
    if (width) img = img.resize({ width, withoutEnlargement: true });
    let out: Buffer;
    let type: string;
    if (fmt === "avif") {
      // q78 is the conservative-parity choice for an ART marketplace: it preserves fine grain (risograph,
      // noir film texture) that q70 can soften, while still being ~75-95% smaller than the source PNG.
      // effort:3 (was 4) markedly speeds the encode -- effort is the encoder's compression SEARCH budget,
      // not a visual-quality knob, so output looks identical, just a few % larger. With the persistent
      // L2 cache the encode is one-time anyway; the lower effort cuts the cold/pre-warm latency.
      out = await img.avif({ quality: 78, effort: 3 }).toBuffer();
      type = "image/avif";
    } else if (fmt === "webp") {
      out = await img.webp({ quality: 85 }).toBuffer();
      type = "image/webp";
    } else {
      // Resize-only (rare: a client that sent neither avif nor webp). Keep PNG, just smaller.
      out = await img.png({ compressionLevel: 9 }).toBuffer();
      type = "image/png";
    }
    const res: Optimized = { body: new Uint8Array(out), type };
    memPut(ck, res);
    // Persist to L2 in the background -- do not block the response on the disk write. The atomic
    // rename makes concurrent encoders of the same key safe.
    void diskPut(ck, fmt, out);
    return res;
  } catch {
    return null; // fall back to original bytes -- never break the image
  }
}

// Cache-Control for a resolved image, keyed off the (internal) cacheKey:
//   - A hex output root ("backend:0x..") is CONTENT-ADDRESSED -- the bytes for that root can never change
//     -- so it is safe to mark immutable for a year. Browsers (and any future CDN) then never re-request
//     it. This is the bulk of the /explore relic gallery.
//   - A baked local file ("local:..") is stable for the lifetime of a deploy; cache a week.
//   - An agent portrait ("agent-<id>") can change if the agent's first output changes; keep the 1-day TTL.
function imageCacheControl(cacheKey: string): string {
  if (/^backend:0x[0-9a-f]{6,}$/i.test(cacheKey)) {
    return "public, max-age=31536000, immutable";
  }
  if (cacheKey.startsWith("local:")) {
    return "public, max-age=604800";
  }
  return "public, max-age=86400";
}

// Build the image response, optimizing raster bytes (resize + modern format) when possible. Falls back
// to the original bytes for non-raster types or on any transcode failure.
async function serveOptimized(
  bytes: Buffer,
  originalType: string,
  request: Request,
  cacheKey: string,
): Promise<Response> {
  if (TRANSCODABLE.test(originalType)) {
    const url = new URL(request.url);
    const width = parseWidth(url.searchParams.get("w"));
    const fmt = pickFormat(request.headers.get("accept") || "");
    const x = await transcode(bytes, fmt, width, cacheKey);
    if (x) {
      return new NextResponse(x.body, {
        headers: {
          "content-type": x.type,
          // Content is addressed by root (+ style + w); the chosen format is keyed off Accept, so Vary.
          "cache-control": imageCacheControl(cacheKey),
          vary: "Accept",
        },
      });
    }
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": originalType,
      "cache-control": imageCacheControl(cacheKey),
      vary: "Accept",
    },
  });
}

const PUBLIC = path.join(process.cwd(), "public");

// Showcase root -> agent portrait file. Keyed on the slash-free slug; the "0g://"-prefixed form is kept
// as a tolerant alias.
const SHOWCASE_PORTRAIT: Record<string, string> = {
  "showcase-nokturne": "agents/NOKTURNE.png",
  "showcase-mirai": "agents/MIRAI.png",
  "showcase-riso": "agents/RISO.png",
  "showcase-scriptorium": "agents/SCRIPTORIUM.png",
  "0g://showcase-nokturne": "agents/NOKTURNE.png",
  "0g://showcase-mirai": "agents/MIRAI.png",
  "0g://showcase-riso": "agents/RISO.png",
  "0g://showcase-scriptorium": "agents/SCRIPTORIUM.png",
};

// Known on-chain output roots we have real local bytes for (real TEE-attested generations).
// The two live NOKTURNE mints (tokenId 5, 6) are noir generations; we serve real noir PNGs we
// copied into public/outputs so the gallery shows genuine art, not a placeholder.
const ROOT_TO_FILE: Record<string, string> = {
  "0xe3cd354dfadbb8104b503f775cc341677f98df953fe327e6fd5ebc104523b6f3": "outputs/gen_46ea37da.png",
  "0x25e1fbc6dc179cc105dfc21def9057c1635fa518868f4554ec7bd7784b3467e5": "outputs/gen_095fbeb4.png",
  "0xb8119f8de39a2f6d5dd9f96a583d5fd58a4c8ae8e0f3042bffd4d052553d48b0": "outputs/gen_9e2484be.png",
  "0x51828efe2b016b359dfb9a2054e70ec7fccff6081e07c5318dba9735103eded6": "outputs/gen_68e39c56.png",
  "0x7d6b1b9d3ee1ac8dafc056b2a7655e4239fbcc1a11f78dfc1e8939536d9bd5bf": "outputs/gen_ca22a48e.png",
  "0x17d2bad0e32d225d51cd6533425d7f126e38ddb0716bf0322b1476422f8dc0e2": "outputs/gen_f378f511.png",
  "0xdbb503615d82133de6153e09c1ef463133b9201fe2225669d1ff60efe2ce97a0": "outputs/gen_f4e9ef43.png",
  "0x552c6809ebd0a2a4137a94cd82b9c699aa9f74071e5dbd0296e6cae0c73afad3": "outputs/gen_87c26aa3.png",
  "0x9c62b9390e9a927042807a800afc295fa70e748008733634cda1e0dc26f6d3c7": "outputs/gen_259f7356.png",
  "0x9f2b8bb3d59a96852125fadfe18bc5b001807c01b59e1d878e6fd1b960b21cc1": "outputs/gen_c128ebf3.png",
  "0x1780aa11f979133c27472ee259995487d5342ce6c0c0b3435ad4e4d0fb874f2a": "outputs/gen_12e82276.png",
};

// Style -> tint pair for the deterministic placeholder (matches the catalog accents).
const STYLE_TINT: Record<string, { a: string; b: string; label: string }> = {
  noir: { a: "#C8A24B", b: "#1a1712", label: "NOIR" },
  cyberpunk: { a: "#FF2EC4", b: "#0d0a16", label: "CYBERPUNK" },
  risograph: { a: "#FF5FA2", b: "#141018", label: "RISOGRAPH" },
  illuminated: { a: "#D4AF37", b: "#15120a", label: "ILLUMINATED" },
  custom: { a: "#8A8AFF", b: "#0e0d14", label: "ON-CHAIN" },
};

// Escape a value for safe interpolation into SVG/XML text. The root (and, defensively, the style label)
// originate from the request URL, so they MUST be escaped before landing in the SVG markup; this route
// serves image/svg+xml, and an SVG document can execute script, so a raw interpolation would be a
// reflected-XSS sink. (Verified 2026-06-23: a slash-free `<image ... onerror=...>` root reflected raw.)
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".jpg") || file.endsWith(".jpeg")) return "image/jpeg";
  if (file.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

// Cheap deterministic hash so a given root always maps to the same placeholder geometry.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function placeholderSvg(root: string, style: string): string {
  const tint = STYLE_TINT[style] ?? STYLE_TINT.custom;
  const h = hashStr(root);
  // A few seeded grid lines + a soft glow, tinted by style. Editorial, not a broken-image box.
  const cx = 120 + (h % 320);
  const cy = 120 + ((h >> 3) % 320);
  const lines = Array.from({ length: 7 }, (_, i) => {
    const y = 80 + i * 70 + ((h >> (i + 1)) % 24);
    return `<line x1="40" y1="${y}" x2="600" y2="${y}" stroke="${tint.a}" stroke-opacity="0.18" stroke-width="1"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
  <defs>
    <radialGradient id="g" cx="${(cx / 640) * 100}%" cy="${(cy / 640) * 100}%" r="70%">
      <stop offset="0%" stop-color="${tint.a}" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="${tint.b}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="640" fill="${tint.b}"/>
  <rect width="640" height="640" fill="url(#g)"/>
  ${lines}
  <circle cx="${cx}" cy="${cy}" r="3" fill="${tint.a}"/>
  <text x="40" y="600" font-family="ui-monospace, monospace" font-size="15" letter-spacing="3" fill="${tint.a}" fill-opacity="0.85">${escapeXml(tint.label)}</text>
  <text x="40" y="44" font-family="ui-monospace, monospace" font-size="12" letter-spacing="2" fill="${tint.a}" fill-opacity="0.55">${escapeXml(root.slice(0, 14))}</text>
</svg>`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ root: string }> },
): Promise<Response> {
  const { root: rawRoot } = await params;
  const root = decodeURIComponent(rawRoot);
  const url = new URL(request.url);
  const style = (url.searchParams.get("style") || "custom").toLowerCase();

  const localFile = SHOWCASE_PORTRAIT[root] || ROOT_TO_FILE[root];
  if (localFile) {
    try {
      const bytes = await readFile(path.join(PUBLIC, localFile));
      // Optimize (resize + AVIF/WebP) the baked art. cacheKey is the file path: immutable, so the
      // transcoded variants are reused for the whole process lifetime.
      return await serveOptimized(bytes, contentTypeFor(localFile), request, `local:${localFile}`);
    } catch {
      // fall through (backend, then placeholder)
    }
  }

  // USER content -> proxy real bytes from the backend (its durable local cache; 0G is unreliable).
  //   "agent-<id>" -> a user agent's portrait;  any other (non-baked) root -> a generated output/ref image.
  const agentMatch = /^agent-(\d+)$/.exec(root);
  const backendPath = agentMatch
    ? `/agent-portrait/${agentMatch[1]}`
    : `/image/${encodeURIComponent(root)}`;
  const proxied = await fetchBackendImage(backendPath);
  // cacheKey is the content-addressed root, so a backend image transcodes once then serves from cache.
  if (proxied) return await serveOptimized(proxied.bytes, proxied.type, request, `backend:${root}`);

  const svg = placeholderSvg(root, style);
  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=3600",
      // Defense in depth: the root is escaped above, but this SVG is built from request input, so also
      // forbid scripts in the SVG sandbox and stop content-type sniffing in case it is ever opened as a
      // top-level document.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
