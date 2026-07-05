import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { Footer } from "@/components/chrome/Footer";
import { GameTabs } from "@/components/game/GameTabs";
import { LocaleToggle } from "@/components/game/LocaleToggle";
import { getGameLocale, messagesFor } from "@/i18n/locale";

// The GAME-LAYER route group (/fuse, /arena, /ladder). It is bilingual (id + en) and scoped: the locale is
// read from the AURA_LOCALE cookie during SSR and handed to NextIntlClientProvider as an explicit
// { locale, messages }, so useTranslations works in the client game views WITHOUT a next-intl plugin,
// getRequestConfig, or a [locale] URL segment. That keeps every OTHER route in the app (home, agents,
// proof, verify) exactly as it was: only this subtree opts into i18n + per-request rendering. First paint
// is already in the right language (the cookie is read server-side), so there is no locale FOUC. Both
// themes come for free from the app's token system + ThemeProvider in the root layout.
//
// The two `next-intl` warnings this setup could emit (no timeZone, no now) are silenced by passing static
// values; the game views never format dates/relative-times through next-intl, so the values are inert.
export default async function GameLayout({ children }: { children: ReactNode }) {
  const locale = await getGameLocale();
  const messages = messagesFor(locale);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Jakarta" now={new Date()}>
      <main className="min-h-screen pt-14">
        {/* Game-layer toolbar: sits just under the fixed global nav. Left = layer label + sub-tabs; right
            = the id/en toggle (the theme toggle lives in the global nav). */}
        <div
          className="sticky top-14 z-30 border-b backdrop-blur-md"
          style={{ borderColor: "var(--color-border)", background: "rgb(var(--rgb-cream) / 0.82)" }}
        >
          <div className="mx-auto flex w-full max-w-[var(--container-wrap)] items-center justify-between gap-3 px-5 py-2.5 sm:px-8">
            <div className="flex min-w-0 items-center gap-3 overflow-x-auto">
              <span className="label-caps hidden shrink-0 text-[13px] uppercase tracking-[0.14em] sm:inline" style={{ color: "var(--color-ink-3)" }}>
                {messages.game.nav.layer}
              </span>
              <span className="prov-rule hidden h-4 w-px shrink-0 sm:inline" aria-hidden style={{ background: "var(--color-border-strong)", opacity: 0.6 }} />
              <GameTabs />
            </div>
            <LocaleToggle />
          </div>
        </div>

        {children}
        <Footer />
      </main>
    </NextIntlClientProvider>
  );
}
