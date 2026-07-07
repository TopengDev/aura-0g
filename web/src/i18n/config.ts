// Client-safe i18n constants (NO next/headers import, so a Client Component may import it). The game
// layer ships bilingual en + id. `en` (English) is the DEFAULT so the game surfaces (/arena, /fuse,
// /ladder) match the rest of the app, which is English throughout: AURA is an international hackathon
// entry judged by an international jury, so a game surface must not land a judge in Bahasa Indonesia.
// `id` stays a first-class second locale, reachable via the ID|EN toggle. Locale is carried in a cookie
// (no [locale] URL routing, so the rest of the app's routes are untouched), read server-side in the
// (game) layout so the first paint is already in the right language (no FOUC).
export type Locale = "id" | "en";

export const LOCALES: readonly Locale[] = ["id", "en"] as const;
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "AURA_LOCALE";

/** Coerce an arbitrary cookie value to a valid Locale (absent/invalid => the `en` default; `id` only when
 *  the cookie explicitly asks for it, so the ID|EN toggle still works). */
export function normalizeLocale(v: string | undefined | null): Locale {
  return v === "id" ? "id" : "en";
}
