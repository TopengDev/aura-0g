// SERVER-ONLY. Allowlisted image resolver — maps a stable key to a repo-relative PNG file.
// Used by GET /api/image/[key]. Allowlist => NO path traversal (keys never touch the filesystem
// path directly; only values in IMAGE_FILES are read).
import path from "node:path";

const ROOT = process.cwd();

// Stable key -> repo-relative file. Agent sample keys + per-output keys.
export const IMAGE_FILES: Record<string, string> = {
  // ── agent sample galleries ──
  "nokturne-style": "images/NOKTURNE.png",
  "nokturne-bust": "images/characters/T1/NOKTURNE-bust.png",
  "mirai-style": "images/MIRAI.png",
  "mirai-bust": "images/characters/T1/MIRAI-bust.png",
  "mirai-samurai": "images/characters/T2a/MIRAI-01-samurai.png",
  "mirai-netrunner": "images/characters/T2a/MIRAI-02-netrunner.png",
  "riso-hero": "demo/hero.png",
  "riso-style": "images/RISO.png", // the canonical coffee-window scene in RISO style (parallels nokturne/mirai/scriptorium-style)
  "riso-canonical": "images/characters/T1/RISO-bust.png",
  "riso-pirate": "images/characters/T3/fennic-01-pirate.png",
  "riso-astronaut": "images/characters/T3/fennic-02-astronaut.png",
  "riso-wizard": "images/characters/T3/fennic-03-wizard.png",
  "riso-punk": "images/characters/T3/fennic-04-punk.png",
  "riso-king": "images/characters/T3/fennic-05-king.png",
  "riso-samurai": "images/characters/T3/fennic-06-samurai.png",
  "scriptorium-style": "images/SCRIPTORIUM.png",
  "scriptorium-bust": "images/characters/T1/SCRIPTORIUM-bust.png",
  "collection-montage": "demo/collection-montage.png",

  // ── per-output token images (legacy, pre-existing on-chain outputs #1-#11) ──
  "output-1": "images/NOKTURNE.png",
  "output-2": "images/characters/T1/NOKTURNE-bust.png",
  "output-3": "demo/hero.png",
  "output-4": "demo/hero.png", // market piece reused the hero image
  "output-5": "images/characters/T1/RISO-bust.png",
  "output-6": "images/characters/T3/fennic-01-pirate.png",
  "output-7": "images/characters/T3/fennic-02-astronaut.png",
  "output-8": "images/characters/T3/fennic-03-wizard.png",
  "output-9": "images/characters/T3/fennic-04-punk.png",
  "output-10": "images/characters/T3/fennic-05-king.png",
  "output-11": "images/characters/T3/fennic-06-samurai.png",
};

/** Base image presets that the demo wallet can generate FROM (qwen-image-edit is EDIT-only). */
export const BASE_PRESETS: Record<string, { file: string; label: string; agentName: string }> = {
  "riso-fox": { file: "images/characters/T1/RISO-bust.png", label: "RISO fennec fox (canonical)", agentName: "RISO" },
  "nokturne-scene": { file: "images/_base-scene.png", label: "neutral scene", agentName: "NOKTURNE" },
  "mirai-bust": { file: "images/characters/T1/MIRAI-bust.png", label: "MIRAI bust", agentName: "MIRAI" },
};

/** Resolve an allowlisted key to an absolute file path, or null if not allowlisted. */
export function resolveImageKey(key: string): string | null {
  const rel = IMAGE_FILES[key];
  if (!rel) return null;
  return path.join(ROOT, rel);
}

export function resolveBasePreset(key: string): string | null {
  const preset = BASE_PRESETS[key];
  if (!preset) return null;
  return path.join(ROOT, preset.file);
}
