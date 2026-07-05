"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import {
  ActionButton,
  Chip,
  CopyValue,
  Field,
  MetaRow,
  Panel,
  TextInput,
} from "@/components/product/primitives";
import { CustomConnectButton } from "@/components/web3/CustomConnectButton";
import { DeployGate, GameHeader, GameSection, GateChip, GatedNote, VerifyPanel } from "@/components/game/shared";
import { useAuth } from "@/components/web3/AuthProvider";
import { useArenaVote } from "@/lib/useArenaVote";
import {
  createBattle,
  fetchBattle,
  fetchTally,
  tallyCurl,
  type BattleView,
  type CreateBattleResult,
  type TallyReport,
  type VotePrep,
} from "@/lib/game";
import { ARENA_ENABLED } from "@/lib/game-contracts";
import { agentPortraitUrl, featuredAgents, fetchAgents, imageUrl, shortAddr, type Agent } from "@/lib/api";

// The CREATIVE ARENA. Two Auras render one shared, un-grindable theme, shown BLIND; the crowd stakes a blind
// commit-reveal vote; the winner is a pure function of the on-chain tally, which anyone can recompute. All
// deploy-gated: until ArenaVote is wired the actions are honestly disabled (no fake art, no fake winner),
// while the "verify the tally yourself" command is always real.
export function ArenaView() {
  const t = useTranslations("game.arena");
  const c = useTranslations("game.common");
  const { isConnected } = useAccount();
  const auth = useAuth();
  const arena = useArenaVote();

  const [battle, setBattle] = useState<CreateBattleResult | null>(null);
  const [bstate, setBstate] = useState<BattleView | null>(null);
  const [tally, setTally] = useState<TallyReport | null>(null);
  const [prep, setPrep] = useState<VotePrep | null>(null);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const battleId = battle?.battleId ?? null;

  const refreshState = useCallback(async () => {
    if (battleId === null) return;
    const [s, ty] = await Promise.all([fetchBattle(battleId), fetchTally(battleId)]);
    if (s.state === "ok") setBstate(s.data);
    if (ty.state === "ok") setTally(ty.data);
  }, [battleId]);

  useEffect(() => {
    if (battleId !== null) void refreshState();
  }, [battleId, refreshState]);

  const ensureToken = useCallback(async (): Promise<string | null> => {
    let token = auth.token;
    if (!token) token = await auth.signIn();
    return token ?? null;
  }, [auth]);

  const onCreate = useCallback(
    async (agentA: number, agentB: number) => {
      setCreateErr(null);
      const token = await ensureToken();
      if (!token) return;
      setCreating(true);
      const r = await createBattle(token, agentA, agentB);
      setCreating(false);
      if (r.state === "ok") {
        setBattle(r.data);
        setPrep(null);
        setTally(null);
      } else if (r.state === "gated") {
        setCreateErr(null); // gate is already shown by the banner
      } else {
        setCreateErr(r.error);
      }
    },
    [ensureToken],
  );

  const onCommit = useCallback(
    async (choice: 1 | 2, stake: string) => {
      if (battleId === null) return;
      const token = await ensureToken();
      if (!token) return;
      const p = await arena.commitVote(token, battleId, choice, stake);
      if (p) setPrep(p);
    },
    [battleId, ensureToken, arena],
  );

  const onReveal = useCallback(async () => {
    if (!prep) return;
    const ok = await arena.revealVote(prep);
    if (ok) void refreshState();
  }, [prep, arena, refreshState]);

  const onFinalize = useCallback(async () => {
    if (battleId === null) return;
    const ok = await arena.finalize(battleId);
    if (ok) void refreshState();
  }, [battleId, arena, refreshState]);

  return (
    <div className="mx-auto w-full max-w-[var(--container-wrap)] px-5 py-14 sm:px-8 sm:py-16">
      <GameHeader
        kicker={t("kicker")}
        marker="0G · ARENAVOTE"
        title={t("title")}
        lede={t("lede")}
        chips={
          <>
            <GateChip enabled={ARENA_ENABLED} />
            <Chip tone="accent">{c("keyless")}</Chip>
            <Chip>{t("battle.blind")}</Chip>
          </>
        }
      />

      {!ARENA_ENABLED ? (
        <div className="mt-10">
          <DeployGate />
        </div>
      ) : null}

      {/* ── Battles: create or open ── */}
      <GameSection index="01" kicker={t("list.title")} title={t("list.body")} />
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <StartBattle onCreate={onCreate} creating={creating} error={createErr} connected={isConnected} enabled={ARENA_ENABLED} />
        <OpenBattle onOpen={setBattle} enabled={ARENA_ENABLED} />
      </div>

      {/* ── The battle ── */}
      <GameSection index="02" kicker={battle ? t("battle.title", { id: battle.battleId }) : t("battle.blind")} title={t("battle.themeNote")} />
      <div className="mt-8">
        {battle ? (
          <BlindBattle battle={battle} bstate={bstate} onRefresh={refreshState} />
        ) : (
          <BlindPreview />
        )}
      </div>

      {/* ── Vote (blind commit-reveal) ── */}
      {battle ? (
        <div className="mt-8">
          <VotePanel
            bstate={bstate}
            prep={prep}
            arena={arena}
            enabled={ARENA_ENABLED}
            connected={isConnected}
            onCommit={onCommit}
            onReveal={onReveal}
            onFinalize={onFinalize}
          />
        </div>
      ) : null}

      {/* ── Verify the tally yourself (always shown) ── */}
      <div className="mt-8">
        <VerifyPanel
          title={t("verify.title")}
          body={t("verify.body")}
          commands={[
            { cmd: tallyCurl(battleId ?? 1), note: t("verify.curlNote") },
            ...(tally?.selfCheck?.getBattle ? [{ cmd: tally.selfCheck.getBattle, note: t("verify.castNote") }] : []),
          ]}
          footer={t("verify.trustRoot")}
        />
        {tally ? <TallyAgreement tally={tally} /> : null}
      </div>
    </div>
  );
}

// ── Start a battle (pick two Auras; the server-operator signs createBattle + generates both) ──
function StartBattle({
  onCreate,
  creating,
  error,
  connected,
  enabled,
}: {
  onCreate: (a: number, b: number) => void;
  creating: boolean;
  error: string | null;
  connected: boolean;
  enabled: boolean;
}) {
  const t = useTranslations("game.arena");
  const c = useTranslations("game.common");
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetchAgents().then((all) => {
      if (live) setAgents(featuredAgents(all).slice(0, 12));
    });
    return () => {
      live = false;
    };
  }, []);

  const toggle = (id: number) => {
    if (a === id) return setA(null);
    if (b === id) return setB(null);
    if (a === null) return setA(id);
    if (b === null) return setB(id);
    setB(id);
  };
  const ready = a !== null && b !== null && a !== b;

  return (
    <Panel className="p-6">
      <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>
        {t("list.title")}
      </div>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {t("list.body")}
      </p>
      {!connected ? (
        <div className="mt-5"><CustomConnectButton /></div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {(agents ?? []).map((agent) => {
              const picked = agent.agentId === a ? "A" : agent.agentId === b ? "B" : null;
              return (
                <button
                  key={agent.agentId}
                  type="button"
                  onClick={() => toggle(agent.agentId)}
                  aria-pressed={picked !== null}
                  className="micro relative aspect-square overflow-hidden rounded-[12px] border active:scale-[0.96]"
                  style={{ borderColor: picked ? "var(--color-accent)" : "var(--color-border-strong)", boxShadow: picked ? "0 0 0 2px color-mix(in oklab, var(--color-accent) 40%, transparent)" : "none" }}
                  title={`${agent.name} #${agent.agentId}`}
                >
                  <Image src={agentPortraitUrl(agent, 160)} alt={agent.name} fill sizes="80px" className="object-cover" unoptimized />
                  {picked ? (
                    <span className="absolute right-1 top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[12px] font-semibold" style={{ background: "var(--color-accent)", color: "var(--color-cream)" }}>{picked}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="mt-5">
            <ActionButton onClick={() => ready && a !== null && b !== null && onCreate(a, b)} disabled={!ready || creating || !enabled}>
              {creating ? "Generating both pieces in a 0G TEE" : t("list.open")}
            </ActionButton>
            {!enabled ? <div className="mt-3"><GatedNote>{c("builtTested")}.</GatedNote></div> : null}
            {error ? <p role="alert" className="mt-3 text-[15px]" style={{ color: "var(--color-warn)" }}>{error}</p> : null}
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Open an existing battle by id (on-chain state only) ──
function OpenBattle({ onOpen, enabled }: { onOpen: (b: CreateBattleResult) => void; enabled: boolean }) {
  const t = useTranslations("game.arena");
  const c = useTranslations("game.common");
  const [id, setId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async () => {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) return;
    setErr(null);
    setLoading(true);
    const r = await fetchBattle(n);
    setLoading(false);
    if (r.state === "ok") {
      // Reconstruct a display battle from the on-chain read (no art available for a looked-up battle).
      onOpen({ battleId: r.data.battleId, agentA: r.data.agentA, agentB: r.data.agentB, theme: { seed: "", subjectProse: "" }, commitDur: 0, revealDur: 0, images: [], seedBlind: true });
    } else if (r.state === "gated") {
      setErr(null);
    } else if (r.state === "notfound") {
      setErr(t("list.none"));
    } else {
      setErr(r.error);
    }
  };

  return (
    <Panel className="p-6">
      <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>
        {t("list.lookupTitle")}
      </div>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {t("list.lookupBody")}
      </p>
      <div className="mt-4 flex items-end gap-3">
        <div className="flex-1">
          <Field label={t("list.lookupPlaceholder")}>
            <TextInput value={id} onChange={setId} placeholder="1" type="number" inputMode="numeric" disabled={!enabled} />
          </Field>
        </div>
        <ActionButton onClick={open} disabled={!id || loading || !enabled}>
          {loading ? c("loading") : t("list.open")}
        </ActionButton>
      </div>
      {!enabled ? <div className="mt-3"><GatedNote>{t("list.none")}</GatedNote></div> : null}
      {err ? <p role="alert" className="mt-3 text-[15px]" style={{ color: "var(--color-warn)" }}>{err}</p> : null}
    </Panel>
  );
}

// ── The blind battle (two art pieces on a shared theme; identity hidden until finalize) ──
function BlindBattle({ battle, bstate, onRefresh }: { battle: CreateBattleResult; bstate: BattleView | null; onRefresh: () => void }) {
  const t = useTranslations("game.arena");
  const c = useTranslations("game.common");
  const finalized = bstate?.finalized ?? false;
  const phaseKey = bstate?.phase === "commit" ? "commit" : bstate?.phase === "reveal" ? "reveal" : bstate?.phase === "finalized" ? "finalized" : "awaitingFinalize";
  const hasArt = battle.images.length === 2;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chip tone="accent">{t(`battle.phase.${phaseKey}`)}</Chip>
        {battle.theme.subjectProse ? (
          <span className="text-[15px]" style={{ color: "var(--color-ink-2)" }}>
            <span className="label-caps text-[13px] uppercase tracking-[0.1em]" style={{ color: "var(--color-ink-3)" }}>{t("battle.theme")}:</span> {battle.theme.subjectProse}
          </span>
        ) : null}
        <button type="button" onClick={onRefresh} className="micro ml-auto rounded-full border px-3 py-1 text-[13px]" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}>
          {c("reload")}
        </button>
      </div>
      <p className="mb-4 max-w-[70ch] text-[15px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{t("battle.blindNote")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["A", "B"] as const).map((side, i) => {
          const img = hasArt ? battle.images[i] : null;
          const agentId = i === 0 ? battle.agentA : battle.agentB;
          const won = finalized && bstate?.winner === i + 1;
          return (
            <Panel key={side} className="overflow-hidden" style={won ? { borderColor: "var(--color-ok)", boxShadow: "0 0 0 2px color-mix(in oklab, var(--color-ok) 34%, transparent)" } : undefined}>
              <div className="relative aspect-square w-full" style={{ background: "var(--color-cream-deep)" }}>
                {img ? (
                  <Image src={imageUrl(img.imageRoot)} alt={t("battle.pieceAlt")} fill sizes="(max-width: 640px) 100vw, 480px" className="object-cover" unoptimized />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: "var(--color-ink-3)" }}>
                    <span className="font-display text-[40px]">{side}</span>
                    <span className="label-caps text-[13px] uppercase tracking-[0.12em]">{t("battle.blind")}</span>
                  </div>
                )}
                <span className="absolute left-3 top-3 rounded-full px-3 py-1 text-[13px] font-semibold" style={{ background: "color-mix(in oklab, var(--color-ink) 78%, transparent)", color: "var(--color-cream)", backdropFilter: "blur(6px)" }}>
                  {i === 0 ? t("battle.sideA") : t("battle.sideB")}
                </span>
              </div>
              <div className="flex items-center justify-between p-4">
                <span className="font-mono-x tabular-nums text-[15px]" style={{ color: "var(--color-ink-2)" }}>
                  {finalized ? (
                    <Link href={`/agents/${agentId}`} className="underline-offset-4 hover:underline" style={{ color: "var(--color-accent)" }}>{t("battle.revealedAs", { id: agentId })}</Link>
                  ) : (
                    t("battle.blind")
                  )}
                </span>
                {won ? <Chip tone="ok">{t("result.winner")}</Chip> : null}
              </div>
            </Panel>
          );
        })}
      </div>
      {bstate ? (
        <Panel className="mt-4 p-5">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <MetaRow k={t("battle.stats.weightA")} v={formatEther(BigInt(bstate.weightA))} mono />
            <MetaRow k={t("battle.stats.weightB")} v={formatEther(BigInt(bstate.weightB))} mono />
            <MetaRow k={t("battle.stats.revealCount")} v={String(bstate.revealCount)} mono />
            <MetaRow k={t("battle.stats.pool")} v={`${formatEther(BigInt(bstate.pool))} 0G`} mono />
          </dl>
        </Panel>
      ) : null}
    </div>
  );
}

// The blind battle preview shown when no battle is loaded: two blind slots + the mechanism, no fake art.
function BlindPreview() {
  const t = useTranslations("game.arena");
  const c = useTranslations("game.common");
  return (
    <div>
      <p className="mb-4 max-w-[70ch] text-[15px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{t("battle.blindNote")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["A", "B"] as const).map((side) => (
          <Panel key={side} className="overflow-hidden">
            <div className="flex aspect-square w-full flex-col items-center justify-center gap-2" style={{ background: "var(--color-cream-deep)", color: "var(--color-ink-3)" }}>
              <span className="font-display text-[48px]">{side}</span>
              <span className="label-caps text-[13px] uppercase tracking-[0.12em]">{t("battle.blind")}</span>
            </div>
          </Panel>
        ))}
      </div>
      <div className="mt-4"><GatedNote>{c("builtTested")}. {t("battle.themeNote")}</GatedNote></div>
    </div>
  );
}

// ── The blind, staked commit-reveal vote ──
function VotePanel({
  bstate,
  prep,
  arena,
  enabled,
  connected,
  onCommit,
  onReveal,
  onFinalize,
}: {
  bstate: BattleView | null;
  prep: VotePrep | null;
  arena: ReturnType<typeof useArenaVote>;
  enabled: boolean;
  connected: boolean;
  onCommit: (choice: 1 | 2, stake: string) => void;
  onReveal: () => void;
  onFinalize: () => void;
}) {
  const t = useTranslations("game.arena");
  const c = useTranslations("game.common");
  const { state, busy } = arena;
  const [choice, setChoice] = useState<1 | 2>(1);
  const [stake, setStake] = useState("0.01");
  const gated = state.phase === "gated" || !enabled;
  const finalized = bstate?.finalized ?? false;
  const awaitingFinalize = !finalized && bstate?.phase === "awaiting-finalize";

  return (
    <Panel className="p-6 sm:p-7">
      <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>{t("vote.title")}</div>
      <p className="mt-2 max-w-[72ch] text-[15px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{t("vote.body")}</p>

      {!connected ? (
        <div className="mt-5"><CustomConnectButton /></div>
      ) : finalized ? (
        <FinalResult bstate={bstate} arena={arena} enabled={enabled} />
      ) : awaitingFinalize ? (
        <div className="mt-5">
          <p className="text-[15px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{t("result.notFinal")}</p>
          <div className="mt-4">
            <ActionButton onClick={onFinalize} disabled={busy || gated}>
              {busy && state.action === "finalize" ? state.step ?? t("result.finalize") : t("result.finalize")}
            </ActionButton>
          </div>
          {gated ? <div className="mt-3"><GatedNote>{c("builtTested")}.</GatedNote></div> : null}
          {state.phase === "error" && state.error ? <p role="alert" className="mt-3 text-[15px]" style={{ color: "var(--color-warn)" }}>{state.error}</p> : null}
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          {/* choose side */}
          <div className="flex flex-wrap gap-2">
            {[1, 2].map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => setChoice(ch as 1 | 2)}
                aria-pressed={choice === ch}
                className="micro rounded-full px-4 py-2 text-[15px] font-semibold active:scale-[0.97]"
                style={{ background: choice === ch ? "var(--color-ink)" : "transparent", color: choice === ch ? "var(--color-cream)" : "var(--color-ink-2)", border: "1px solid var(--color-border-strong)" }}
              >
                {ch === 1 ? t("vote.chooseA") : t("vote.chooseB")}
              </button>
            ))}
          </div>
          <div className="max-w-[240px]">
            <Field label={t("vote.stake")}>
              <TextInput value={stake} onChange={setStake} placeholder="0.01" type="number" inputMode="decimal" disabled={gated} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <ActionButton onClick={() => onCommit(choice, stake)} disabled={busy || gated || !!prep}>
              {busy && state.action === "commit" ? state.step ?? t("vote.committing") : t("vote.commit")}
            </ActionButton>
            <ActionButton onClick={onReveal} disabled={busy || gated || !prep} variant="outline">
              {busy && state.action === "reveal" ? state.step ?? t("vote.revealing") : t("vote.reveal")}
            </ActionButton>
          </div>
          {prep ? (
            <div className="rounded-[14px] border p-4" style={{ borderColor: "color-mix(in oklab, var(--color-accent) 26%, var(--color-border))", background: "color-mix(in oklab, var(--color-accent) 5%, var(--color-paper))" }}>
              <div className="label-caps text-[13px] uppercase tracking-[0.1em]" style={{ color: "var(--color-accent)" }}>{t("vote.salt")}</div>
              <div className="mt-2"><CopyValue full={prep.salt} display={shortAddr(prep.salt)} /></div>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "var(--color-warn)" }}>{t("vote.keepSalt")}</p>
            </div>
          ) : null}
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{t("vote.nonReveal")}</p>
          {gated ? <GatedNote>{c("builtTested")}.</GatedNote> : null}
          {state.phase === "error" && state.error ? <p role="alert" className="text-[15px]" style={{ color: "var(--color-warn)" }}>{state.error}</p> : null}
        </div>
      )}
    </Panel>
  );
}

function FinalResult({ bstate, arena, enabled }: { bstate: BattleView | null; arena: ReturnType<typeof useArenaVote>; enabled: boolean }) {
  const t = useTranslations("game.arena");
  const { state, busy } = arena;
  const winner = bstate?.winner ?? 0;
  const label = winner === 1 ? t("result.winnerA") : winner === 2 ? t("result.winnerB") : t("result.tie");
  return (
    <div className="mt-5">
      <div className="rounded-[16px] border p-5" style={{ borderColor: "color-mix(in oklab, var(--color-ok) 30%, transparent)", background: "color-mix(in oklab, var(--color-ok) 6%, var(--color-paper))" }}>
        <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ok)" }}>{t("result.title")}</div>
        <div className="mt-2 font-display text-[28px]" style={{ letterSpacing: "-0.01em" }}>{label}</div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <ActionButton onClick={() => arena.claim(bstate?.battleId ?? 0)} disabled={busy || !enabled} variant="outline">
          {busy && state.action === "claim" ? state.step ?? t("result.claim") : t("result.claim")}
        </ActionButton>
      </div>
    </div>
  );
}

// The tally cross-check table (independent recompute vs the contract's enforced tally).
function TallyAgreement({ tally }: { tally: TallyReport }) {
  const t = useTranslations("game.arena");
  const rows: { k: string; ok: boolean }[] = [
    { k: t("verify.agree"), ok: tally.agree.ok },
  ];
  return (
    <Panel className="mt-4 p-5">
      <dl>
        <MetaRow k={t("battle.stats.winner")} v={tally.recompute.winnerLabel} ok={tally.agree.winnerMatches} mono={false} />
        <MetaRow k="linear weighting" v={tally.agree.weightingIsLinear ? "ok" : "tampered"} ok={tally.agree.weightingIsLinear} mono={false} />
        {rows.map((r) => (
          <MetaRow key={r.k} k={r.k} v={r.ok ? "ok" : "mismatch"} ok={r.ok} mono={false} />
        ))}
      </dl>
    </Panel>
  );
}
