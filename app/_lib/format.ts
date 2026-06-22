// Small client-side formatting helpers for the AURA UI.

export function shortHash(h: string | null | undefined, lead = 6, tail = 4): string {
  if (!h) return "0x0";
  if (h.length <= lead + tail + 2) return h;
  return `${h.slice(0, lead)}…${h.slice(-tail)}`;
}

export function shortAddr(a: string | null | undefined): string {
  return shortHash(a, 6, 4);
}

// hex -> rgba string, for tinting per-agent accents
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function pct(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}
