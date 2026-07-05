// Client-safe i18n constants (NO next/headers import, so a Client Component may import it). The game
// layer ships bilingual id + en. `id` (Bahasa Indonesia) is the DEFAULT per the AURA/Aenoxa website
// defaults; `en` is the secondary. Locale is carried in a cookie (no [locale] URL routing, so the rest
// of the app's routes are untouched), read server-side in the (game) layout so the first paint is already
// in the right language (no FOUC).
export type Locale = "id" | "en";

export const LOCALES: readonly Locale[] = ["id", "en"] as const;
export const DEFAULT_LOCALE: Locale = "id";
export const LOCALE_COOKIE = "AURA_LOCALE";

/** Coerce an arbitrary cookie value to a valid Locale (defaults to `id`). */
export function normalizeLocale(v: string | undefined | null): Locale {
  return v === "en" ? "en" : "id";
}
