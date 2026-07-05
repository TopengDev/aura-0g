"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ActionButton, Chip, Field, MetaRow, Panel, TextInput } from "@/components/product/primitives";
import { DeployGate, GameHeader, GameSection, GateChip, GatedNote, VerifyPanel } from "@/components/game/shared";
import {
  fetchLadderVerify,
  fetchRating,
  ladderVerifyCurl,
  type LadderRow,
  type LadderVerifyReport,
  type RatingSurface,
} from "@/lib/game";
import { ARENA_ENABLED } from "@/lib/game-contracts";

type BoardRow = LadderRow & { conservative: number; rank: number; provisional: boolean };

const RD_ELIGIBLE_MAX = 100;

function toBoard(rows: LadderRow[]): BoardRow[] {
  const withCons = rows.map((r) => ({ ...r, conservative: r.rating - 2 * r.rd, provisional: r.rd > RD_ELIGIBLE_MAX }));
  const eligible = withCons.filter((r) => !r.provisional).sort((a, b) => b.conservative - a.conservative);
  const provisional = withCons.filter((r) => r.provisional).sort((a, b) => b.conservative - a.conservative);
  return [...eligible.map((r, i) => ({ ...r, rank: i + 1 })), ...provisional.map((r) => ({ ...r, rank: 0 }))];
}

// The rating LADDER (Tier-2): a leaderboard (fixed-point Glicko-1 over on-chain verdicts) + an Aura rank
// lookup + a keyless "verify the ladder yourself" affordance. Rank is a reputation SIGNAL (price /
// matchmaking / siring value); there is deliberately no emission. Deploy-gated and honest: the board fills
// only from finalized, rated battles once the arena is wired.
export function LadderView() {
  const t = useTranslations("game.ladder");
  const c = useTranslations("game.common");

  const [report, setReport] = useState<LadderVerifyReport | null>(null);
  const [boardState, setBoardState] = useState<"loading" | "gated" | "empty" | "ok" | "down">(ARENA_ENABLED ? "loading" : "gated");

  useEffect(() => {
    if (!ARENA_ENABLED) {
      setBoardState("gated");
      return;
    }
    let live = true;
    fetchLadderVerify(0).then((r) => {
      if (!live) return;
      if (r.state === "gated") return setBoardState("gated");
      if (r.state !== "ok") return setBoardState("down");
      setReport(r.data);
      setBoardState(r.data.rows.length > 0 ? "ok" : "empty");
    });
    return () => {
      live = false;
    };
  }, []);

  const board = useMemo(() => (report ? toBoard(report.rows) : []), [report]);

  return (
    <div className="mx-auto w-full max-w-[var(--container-wrap)] px-5 py-14 sm:px-8 sm:py-16">
      <GameHeader
        kicker={t("kicker")}
        marker="0G · GLICKO-1"
        title={t("title")}
        lede={t("lede")}
        chips={
          <>
            <GateChip enabled={ARENA_ENABLED} />
            <Chip tone="accent">{c("keyless")}</Chip>
            <Chip>{t("badge.signal")}</Chip>
          </>
        }
      />

      {!ARENA_ENABLED ? (
        <div className="mt-10">
          <DeployGate />
        </div>
      ) : null}

      {/* ── Signal, never a reward ── */}
      <Panel className="mt-10 p-6 sm:p-7" style={{ background: "color-mix(in oklab, var(--color-accent) 4%, var(--color-paper))" }}>
        <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>{t("signal.title")}</div>
        <p className="mt-2 max-w-[72ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{t("signal.body")}</p>
      </Panel>

      {/* ── Leaderboard ── */}
      <GameSection index="01" kicker={t("board.title")} title={t("board.body")} />
      <div className="mt-8">
        {boardState === "ok" ? (
          <Panel className="overflow-hidden">
            <div className="hidden grid-cols-[0.5fr_1.4fr_1fr_1fr_1fr] gap-4 border-b px-5 py-3 sm:grid" style={{ borderColor: "var(--color-border)" }}>
              {["rank", "agent", "rating", "rd", "conservative"].map((k) => (
                <span key={k} className="label-caps text-[13px] uppercase tracking-[0.1em]" style={{ color: "var(--color-ink-3)" }}>{t(`board.${k}`)}</span>
              ))}
            </div>
            {board.map((row) => (
              <div key={row.agentId} className="grid grid-cols-2 items-center gap-2 border-b px-5 py-3 last:border-b-0 sm:grid-cols-[0.5fr_1.4fr_1fr_1fr_1fr]" style={{ borderColor: "var(--color-border)" }}>
                <span className="font-display text-[20px]">{row.provisional ? "·" : `#${row.rank}`}</span>
                <Link href={`/agents/${row.agentId}`} className="font-mono-x tabular-nums text-[15px] underline-offset-4 hover:underline" style={{ color: "var(--color-accent)" }}>Aura #{row.agentId}</Link>
                <span className="font-mono-x tabular-nums text-[15px]">{row.rating}</span>
                <span className="font-mono-x tabular-nums text-[15px]" style={{ color: "var(--color-ink-3)" }}>{row.rd}</span>
                <span className="font-mono-x tabular-nums text-[15px]">{row.conservative}{row.provisional ? <span className="ml-2 text-[12px]" style={{ color: "var(--color-ink-3)" }}>{t("badge.provisional")}</span> : null}</span>
              </div>
            ))}
          </Panel>
        ) : (
          <Panel className="p-8 text-center">
            <p className="mx-auto max-w-[56ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              {boardState === "down" ? c("backendUnreachable") : t("board.empty")}
            </p>
          </Panel>
        )}
      </div>

      {/* ── Rank lookup ── */}
      <div className="mt-8">
        <RankLookup enabled={ARENA_ENABLED} />
      </div>

      {/* ── Verify the ladder yourself ── */}
      <div className="mt-8">
        <VerifyPanel
          title={t("verify.title")}
          body={t("verify.body")}
          commands={[{ cmd: ladderVerifyCurl(0), note: t("verify.curlNote") }]}
          footer={t("verify.note")}
        />
      </div>
    </div>
  );
}

function RankLookup({ enabled }: { enabled: boolean }) {
  const t = useTranslations("game.ladder");
  const c = useTranslations("game.common");
  const [id, setId] = useState("");
  const [surface, setSurface] = useState<RatingSurface | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "gated" | "ok" | "unrated" | "down">("idle");

  const look = useCallback(async () => {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) return;
    setStatus("loading");
    const r = await fetchRating(n);
    if (r.state === "gated") return setStatus("gated");
    if (r.state !== "ok") return setStatus("down");
    setSurface(r.data);
    setStatus(r.data.battlesCounted === 0 ? "unrated" : "ok");
  }, [id]);

  return (
    <Panel className="p-6 sm:p-7">
      <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>{t("board.lookupTitle")}</div>
      <div className="mt-4 flex items-end gap-3">
        <div className="flex-1 max-w-[260px]">
          <Field label={t("board.lookupPlaceholder")}>
            <TextInput value={id} onChange={setId} placeholder="1" type="number" inputMode="numeric" disabled={!enabled} />
          </Field>
        </div>
        <ActionButton onClick={look} disabled={!id || !enabled || status === "loading"}>
          {status === "loading" ? c("loading") : t("board.lookup")}
        </ActionButton>
      </div>
      {!enabled ? <div className="mt-3"><GatedNote>{c("builtTested")}.</GatedNote></div> : null}
      {status === "ok" && surface ? (
        <dl className="mt-5">
          <MetaRow k={t("board.rank")} v={surface.provisional ? t("badge.provisional") : `#${surface.rank} / ${surface.eligibleField}`} mono={false} ok={!surface.provisional} />
          <MetaRow k={t("board.rating")} v={String(surface.rating)} mono />
          <MetaRow k={t("board.rd")} v={String(surface.rd)} mono />
          <MetaRow k={t("board.conservative")} v={String(surface.conservative)} mono />
        </dl>
      ) : status === "unrated" ? (
        <p className="mt-4 text-[15px]" style={{ color: "var(--color-ink-3)" }}>{t("badge.unratedNote")}</p>
      ) : status === "down" ? (
        <p className="mt-4 text-[15px]" style={{ color: "var(--color-warn)" }}>{c("backendUnreachable")}</p>
      ) : null}
    </Panel>
  );
}
