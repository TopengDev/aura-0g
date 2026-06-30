// Tiny, dependency-free terminal UI: ANSI colors + a clean box table + rarity tinting. Hand-rolled (no
// chalk/cli-table) so the compiled binary stays small and cold-start stays fast. Respects NO_COLOR and a
// non-TTY pipe (so `aura explore | grep` and CI logs are clean), per the de-facto no-color convention.

const COLOR = process.env.NO_COLOR === undefined && (process.stdout.isTTY ?? false) && process.env.TERM !== "dumb";

function sgr(open: number, close: number) {
  return (s: string | number): string => (COLOR ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
}

export const c = {
  bold: sgr(1, 22),
  dim: sgr(2, 22),
  italic: sgr(3, 23),
  underline: sgr(4, 24),
  red: sgr(31, 39),
  green: sgr(32, 39),
  yellow: sgr(33, 39),
  blue: sgr(34, 39),
  magenta: sgr(35, 39),
  cyan: sgr(36, 39),
  gray: sgr(90, 39),
  white: sgr(97, 39),
};

/** 256-color foreground (used for the gold Legendary tier). */
export function fg256(n: number, s: string): string {
  return COLOR ? `\x1b[38;5;${n}m${s}\x1b[39m` : s;
}

// ── rarity tinting ───────────────────────────────────────────────────────────────────────────────────
export type Rarity = "Common" | "Rare" | "Epic" | "Legendary";

const RARITY_GLYPH: Record<Rarity, string> = { Common: "○", Rare: "◆", Epic: "✦", Legendary: "★" };

/** Tint a rarity label by tier: Common gray, Rare cyan, Epic magenta, Legendary gold. */
export function rarityTint(r: string): string {
  switch (r) {
    case "Rare":
      return c.cyan(c.bold("Rare"));
    case "Epic":
      return c.magenta(c.bold("Epic"));
    case "Legendary":
      return fg256(220, "\x1b[1mLegendary\x1b[22m");
    case "Common":
      return c.gray("Common");
    default:
      return c.gray(r);
  }
}

export function rarityBadge(r: string): string {
  const glyph = RARITY_GLYPH[r as Rarity] ?? "○";
  return `${rarityTint(r)} ${glyph}`;
}

// ── width-aware helpers (so colored cells align) ───────────────────────────────────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
function visLen(s: string): number {
  return stripAnsi(s).length;
}
function padEndVis(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - visLen(s)));
}

export function shortHex(h: string | null | undefined, head = 6, tail = 4): string {
  if (!h) return c.gray("-");
  if (h.length <= head + tail + 2) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** A clean Unicode box table. Headers are bolded; rows may contain ANSI (width is measured visibly). */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(visLen(h), ...rows.map((r) => visLen(r[i] ?? ""))));
  const top = "┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
  const sep = "├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
  const bot = "└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";
  const fmt = (cells: string[], bold = false) =>
    "│ " + cells.map((cell, i) => padEndVis(bold ? c.bold(cell) : cell, widths[i]!)).join(" │ ") + " │";
  return [top, fmt(headers, true), sep, ...rows.map((r) => fmt(r)), bot].join("\n");
}

/** A key/value detail block (label dim+right-aligned, value as-is). */
export function kv(pairs: [string, string][], labelWidth?: number): string {
  const w = labelWidth ?? Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `  ${c.gray(k.padStart(w))}  ${v}`).join("\n");
}

export function ok(s: string): string {
  return `${c.green("✔")} ${s}`;
}
export function bad(s: string): string {
  return `${c.red("✘")} ${s}`;
}
export function check(passed: boolean, s: string): string {
  return passed ? ok(s) : bad(s);
}

export function heading(s: string): string {
  return "\n" + c.bold(c.white(s)) + "\n";
}

export function err(msg: string): void {
  process.stderr.write(`${c.red("error")} ${msg}\n`);
}
