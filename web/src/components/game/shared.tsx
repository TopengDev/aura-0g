"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Panel, Chip, CopyCommand } from "@/components/product/primitives";

// Shared GAME-LAYER presentation primitives. They reuse the app's Technical-Editorial system (tokens +
// primitives) so the game routes match the rest of AURA in BOTH themes with zero bespoke color. Every
// string is passed in already-translated (from the view's useTranslations) or resolved here from the
// game.* namespace, so nothing is hardcoded English.

// The page header: mono kicker + a drawn provenance rule + accent marker, an architectural display title,
// then a lede and optional chips. Mirrors primitives/PageHeader + the /proof header.
export function GameHeader({
  kicker,
  marker,
  title,
  lede,
  chips,
}: {
  kicker: string;
  marker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  chips?: ReactNode;
}) {
  return (
    <header className="w-full">
      <div className="flex items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
        <span>{kicker}</span>
        <span className="prov-rule h-px flex-1" style={{ opacity: 0.5 }} />
        {marker ? <span style={{ color: "var(--color-accent)" }}>{marker}</span> : null}
      </div>
      <h1 className="font-display mt-4" style={{ fontSize: "clamp(40px, 7vw, 88px)", lineHeight: 0.98, letterSpacing: "-0.02em" }}>
        {title}
      </h1>
      {lede ? (
        <p className="mt-5 max-w-[64ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          {lede}
        </p>
      ) : null}
      {chips ? <div className="mt-6 flex flex-wrap items-center gap-2.5">{chips}</div> : null}
    </header>
  );
}

// A live/gated status chip. `enabled` reflects whether the contract is wired on this deploy.
export function GateChip({ enabled }: { enabled: boolean }) {
  const t = useTranslations("game");
  return enabled ? <Chip tone="ok">{t("common.onChain")}</Chip> : <Chip>{t("gate.chip")}</Chip>;
}

// The HONEST deploy-gated banner (the "activates at the mainnet deploy" state). Rendered whenever a game
// feature's contract is not wired. It never shows fake data: it explains the 501 gate, states what a
// visitor CAN do right now, and cites that this state is read from the live backend (a 501 = empty address).
export function DeployGate() {
  const t = useTranslations("game.gate");
  return (
    <Panel
      className="overflow-hidden p-7 sm:p-9"
      role="status"
      style={{
        background: "color-mix(in oklab, var(--color-accent) 5%, var(--color-paper))",
        borderColor: "color-mix(in oklab, var(--color-accent) 24%, var(--color-border))",
      }}
    >
      <div className="flex flex-wrap items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-accent)" }}>
        <Chip tone="accent">{t("chip")}</Chip>
        <span className="prov-rule h-px flex-1" style={{ opacity: 0.4 }} />
        <span className="font-mono-x text-[13px]" style={{ color: "var(--color-ink-3)" }}>501</span>
      </div>
      <h2 className="font-display mt-4" style={{ fontSize: "clamp(24px, 3.6vw, 40px)", lineHeight: 1.04, letterSpacing: "-0.015em" }}>
        {t("title")}
      </h2>
      <p className="mt-4 max-w-[72ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {t("body")}
      </p>
      <div className="mt-6 rounded-[16px] border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}>
        <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
          {t("whatWorksNow")}
        </div>
        <p className="mt-2 max-w-[70ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          {t("whatWorksNowBody")}
        </p>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
        {t("sourceOfTruth")}
      </p>
    </Panel>
  );
}

// A section head (kicker index + title) matching /proof's SectionHead.
export function GameSection({ index, kicker, title }: { index: string; kicker: string; title: string }) {
  return (
    <div className="mt-16 sm:mt-20">
      <div className="flex items-center gap-3 label-caps text-[13px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
        <span className="font-mono-x tabular-nums" style={{ color: "var(--color-accent)" }}>{index}</span>
        <span>{kicker}</span>
        <span className="prov-rule h-px flex-1" style={{ opacity: 0.4 }} />
      </div>
      <h2 className="font-display mt-3" style={{ fontSize: "clamp(26px, 4vw, 46px)", lineHeight: 1.02, letterSpacing: "-0.015em" }}>
        {title}
      </h2>
    </div>
  );
}

// The "VERIFY IT YOURSELF" affordance: an accent-tinted panel with a title, a body, one or more copy-paste
// commands, and a keyless note. This is the jury-facing anti-SQLite-theater surface (the arena tally + the
// ladder recompute + the fuse child-genome recompute all render through it).
export function VerifyPanel({
  title,
  body,
  commands,
  footer,
}: {
  title: string;
  body: ReactNode;
  commands: { cmd: string; note?: ReactNode }[];
  footer?: ReactNode;
}) {
  const t = useTranslations("game.common");
  return (
    <Panel
      className="overflow-hidden p-6 sm:p-8"
      style={{
        background: "color-mix(in oklab, var(--color-accent) 5%, var(--color-paper))",
        borderColor: "color-mix(in oklab, var(--color-accent) 24%, var(--color-border))",
      }}
    >
      <div className="flex flex-wrap items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-accent)" }}>
        <span>{title}</span>
        <span className="prov-rule h-px flex-1" style={{ opacity: 0.4 }} />
        <Chip tone="accent">{t("keyless")}</Chip>
      </div>
      <p className="mt-4 max-w-[72ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {body}
      </p>
      <div className="mt-5 space-y-3">
        {commands.map((c, i) => (
          <CopyCommand key={i} cmd={c.cmd} note={c.note} />
        ))}
      </div>
      {footer ? <div className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{footer}</div> : null}
    </Panel>
  );
}

// A calm inline notice used where an action is unavailable because the feature is deploy-gated (keeps the
// action visible but honestly disabled, rather than hiding it or faking a result).
export function GatedNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-[14px] border px-4 py-3 text-[15px] leading-relaxed"
      style={{ borderColor: "color-mix(in oklab, var(--color-accent) 26%, var(--color-border))", background: "color-mix(in oklab, var(--color-accent) 5%, var(--color-paper))", color: "var(--color-ink-2)" }}
    >
      {children}
    </div>
  );
}
