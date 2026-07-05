"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

// The game-layer sub-navigation (Fusion / Arena / Ladder), shown in the (game) toolbar under the global
// nav. Active-aware via usePathname. Labels come from the game.nav namespace so they are bilingual.
const TABS = [
  { href: "/fuse", key: "fusion" as const },
  { href: "/arena", key: "arena" as const },
  { href: "/ladder", key: "ladder" as const },
];

export function GameTabs() {
  const pathname = usePathname();
  const t = useTranslations("game.nav");
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav aria-label={t("layer")} className="flex items-center gap-1.5">
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className="micro rounded-full px-3 py-1.5 text-[13px] font-semibold tracking-[0.02em] active:scale-[0.97]"
            style={{
              color: active ? "var(--color-cream)" : "var(--color-ink-2)",
              background: active ? "var(--color-ink)" : "transparent",
              border: active ? "1px solid var(--color-ink)" : "1px solid var(--color-border)",
            }}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
