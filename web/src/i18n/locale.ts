// SERVER-ONLY locale resolution for the (game) route group. Reads the AURA_LOCALE cookie during SSR and
// returns the matching message bundle, which the (game)/layout hands to NextIntlClientProvider. Both
// bundles are statically imported (small JSON) so there is no async message loading and no plugin/config
// wiring: the client provider gets an explicit { locale, messages }, which is all useTranslations needs.
import { cookies } from "next/headers";
import en from "@/messages/en.json";
import id from "@/messages/id.json";
import { LOCALE_COOKIE, normalizeLocale, type Locale } from "./config";

// Both bundles share the exact same key shape (en.json is the source of truth; id.json mirrors it).
type Messages = typeof en;
const BUNDLES: Record<Locale, Messages> = { en, id };

/** The active locale for this request (from the AURA_LOCALE cookie; defaults to `id`). */
export async function getGameLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}

/** The message bundle for a locale. */
export function messagesFor(locale: Locale): Messages {
  return BUNDLES[locale];
}
