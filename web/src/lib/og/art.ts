// Server-only art resolution for the dynamic OG cards. Resolves the REAL artwork bytes for a Relic or an
// Aura and returns them inlined as a base64 data URI, because Satori's remote-image loading fails
// SILENTLY on self-hosted (non-Vercel) Node (smoke-tested: a remote <img src> renders a blank panel,
// while a base64 data URI renders the art). It mirrors the resolution ORDER of app/images/[root]/route.ts
// (baked local file first, then the backend's durable content-addressed cache) so an OG card shows the
// same pixels the gallery does. Bytes are downscaled + re-encoded to a compact JPEG so the card stays
// small (X scrapers time out and do not retry) and Satori decodes it reliably.
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { imageRootSlug, type Agent, type Output } from "@/lib/api";

const PUBLIC = path.join(process.cwd(), "public");

// In-cluster backend base for server-side fetches (NOT the public origin). Mirrors lib/api.ts +
// images/[root]/route.ts: AURA_API_INTERNAL > NEXT_PUBLIC_AURA_API > localhost.
function backendBase(): string {
  return (process.env.AURA_API_INTERNAL || process.env.NEXT_PUBLIC_AURA_API || "http://localhost:8787").replace(/\/$/, "");
}

// Baked catalog portraits + known baked output roots. MIRRORS the two maps in app/images/[root]/route.ts
// (keep in sync; these are the frozen showpiece mappings). The baked PNGs are the reliable source for the
// showpieces because 0G Storage testnet evicts image-sized blobs.
const SHOWCASE_PORTRAIT: Record<string, string> = {
  "showcase-nokturne": "agents/NOKTURNE.png",
  "showcase-mirai": "agents/MIRAI.png",
  "showcase-riso": "agents/RISO.png",
  "showcase-scriptorium": "agents/SCRIPTORIUM.png",
};
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

const CATALOG_NAMES = new Set(["NOKTURNE", "MIRAI", "RISO", "SCRIPTORIUM"]);

async function readPublic(file: string): Promise<Buffer | null> {
  try {
    const buf = await readFile(path.join(PUBLIC, file));
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

async function fetchBackendBytes(pathAndQuery: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${backendBase()}${pathAndQuery}`, { cache: "no-store" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

// Downscale + re-encode to a compact JPEG data URI. Satori decodes JPEG/PNG reliably; JPEG keeps the card
// small (validated ~80KB art payload vs ~1MB PNG). Returns null on any decode failure so the caller falls
// back to a styled placeholder panel (never a broken/blank card).
async function toDataUri(bytes: Buffer | null): Promise<string | null> {
  if (!bytes) return null;
  try {
    const out = await sharp(bytes, { failOn: "none" })
      .resize({ width: 640, height: 640, fit: "cover" })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

// Resolve a Relic's artwork bytes: baked known output root, else baked showcase portrait, else the
// backend's durable /image/<root> original bytes.
async function loadOutputArt(o: Output): Promise<Buffer | null> {
  const slug = imageRootSlug(o.imageRoot);
  const baked = ROOT_TO_FILE[o.imageRoot] || SHOWCASE_PORTRAIT[slug];
  if (baked) {
    const b = await readPublic(baked);
    if (b) return b;
  }
  return fetchBackendBytes(`/image/${encodeURIComponent(slug)}`);
}

// Resolve an Aura's portrait bytes: baked catalog portrait, else the backend's /agent-portrait/<id>.
async function loadAgentArt(a: Pick<Agent, "name" | "agentId">): Promise<Buffer | null> {
  if (CATALOG_NAMES.has(a.name.toUpperCase())) {
    const b = await readPublic(`agents/${a.name.toUpperCase()}.png`);
    if (b) return b;
  }
  if (typeof a.agentId === "number" && a.agentId > 0) {
    return fetchBackendBytes(`/agent-portrait/${a.agentId}`);
  }
  return null;
}

export async function outputArtDataUri(o: Output): Promise<string | null> {
  return toDataUri(await loadOutputArt(o));
}
export async function agentArtDataUri(a: Pick<Agent, "name" | "agentId">): Promise<string | null> {
  return toDataUri(await loadAgentArt(a));
}

// A strong baked showpiece for the default brand card (backend-free, always available).
export async function brandArtDataUri(): Promise<string | null> {
  return toDataUri(await readPublic("outputs/gen_46ea37da.png"));
}
