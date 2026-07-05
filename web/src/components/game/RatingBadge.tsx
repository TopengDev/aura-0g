"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchRating, type RatingSurface } from "@/lib/game";
import { ARENA_ENABLED } from "@/lib/game-contracts";

// A compact Arena rank/rating badge for an Aura's profile (the Ladder Tier-2 surface, embedded in the
// existing agent view). Self-contained + English (it renders on the English agent page, OUTSIDE the game
// route group's i18n provider, so it deliberately does not use next-intl). Honest + deploy-gated: it renders
// the live rank when the arena is wired, "Provisional" / "Not yet rated" from the live signal, or the honest
// "Activates at deploy" state when unwired. It never invents a rank.
type Status = "loading" | "gated" | "unrated" | "provisional" | "ranked" | "down";

export function RatingBadge({ agentId }: { agentId: number }) {
  const [status, setStatus] = useState<Status>(ARENA_ENABLED ? "loading" : "gated");
  const [data, setData] = useState<RatingSurface | null>(null);

  useEffect(() => {
    if (!ARENA_ENABLED) {
      setStatus("gated");
      return;
    }
    let live = true;
    fetchRating(agentId).then((r) => {
      if (!live) return;
      if (r.state === "gated") return setStatus("gated");
      if (r.state !== "ok") return setStatus("down");
      const d = r.data;
      setData(d);
      if (d.battlesCounted === 0 || (d.rating === 0 && d.rd === 0)) return setStatus("unrated");
      if (d.provisional || d.rank === 0) return setStatus("provisional");
      setStatus("ranked");
    });
    return () => {
      live = false;
    };
  }, [agentId]);

  if (status === "down") return null;

  const wrap = "flex flex-wrap items-center gap-2.5 rounded-[14px] border px-4 py-3";
  const wrapStyle = { borderColor: "var(--color-border)", background: "var(--color-paper)" } as const;

  return (
    <Link href="/ladder" className={`${wrap} micro`} style={wrapStyle} aria-label="Arena rating ladder">
      <span className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
        Arena rank
      </span>
      <span className="prov-rule h-4 w-px" aria-hidden style={{ background: "var(--color-border-strong)", opacity: 0.6 }} />
      {status === "loading" ? (
        <span className="aura-skeleton inline-block h-4 w-24 rounded" />
      ) : status === "gated" ? (
        <span className="tag" style={{ border: "1px solid var(--color-border-strong)", color: "var(--color-ink-2)", background: "var(--color-paper)" }}>
          Activates at deploy
        </span>
      ) : status === "unrated" ? (
        <span className="text-[15px]" style={{ color: "var(--color-ink-3)" }}>Not yet rated</span>
      ) : status === "provisional" ? (
        <span className="text-[15px]" style={{ color: "var(--color-ink-2)" }}>
          Provisional · <span className="font-mono-x tabular-nums">{data?.rating ?? 0}</span>
        </span>
      ) : (
        <span className="flex items-center gap-2 text-[15px]" style={{ color: "var(--color-ink)" }}>
          <span className="font-display" style={{ fontSize: 20 }}>#{data?.rank}</span>
          <span className="font-mono-x tabular-nums" style={{ color: "var(--color-ink-2)" }}>rating {data?.rating}</span>
        </span>
      )}
      <span className="ml-auto text-[13px]" style={{ color: "var(--color-accent)" }}>Signal only →</span>
    </Link>
  );
}
