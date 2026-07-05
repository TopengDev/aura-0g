"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useAccount } from "wagmi";
import {
  ActionButton,
  Chip,
  ConnectGate,
  CopyValue,
  MetaRow,
  Panel,
  StepRail,
  type StepStatus,
} from "@/components/product/primitives";
import { CustomConnectButton } from "@/components/web3/CustomConnectButton";
import { DeployGate, GameHeader, GameSection, GateChip, GatedNote, VerifyPanel } from "@/components/game/shared";
import { useAuth } from "@/components/web3/AuthProvider";
import { useFusion } from "@/lib/useFusion";
import { fuseVerifyCurl, type FuseExecuteResult } from "@/lib/game";
import { FUSION_ENABLED } from "@/lib/game-contracts";
import { agentPortraitUrl, fetchCreatorDashboard, imageUrl, shortAddr, type Agent } from "@/lib/api";

type FlowStep = "pick" | "review" | "commit" | "reveal" | "child";

// The FUSION experience. Pick two Auras you own, review the fee + cooldown + generation, commit (requestFusion)
// then reveal (executeFusion), and meet the descendant with its blended portrait, on-chain genome, lineage,
// generation badge, and a dynasty view. All on-chain and non-custodial. Deploy-gated: until AuraFusion is
// wired the actions are honestly disabled (no fake child is ever shown), while the real Auras you own and the
// keyless child-genome recompute are always real.
export function FuseView() {
  const t = useTranslations("game.fuse");
  const c = useTranslations("game.common");
  const { address, isConnected } = useAccount();
  const auth = useAuth();
  const fusion = useFusion();

  const [owned, setOwned] = useState<Agent[] | null>(null);
  const [loadingOwned, setLoadingOwned] = useState(false);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [step, setStep] = useState<FlowStep>("pick");
  const [requestId, setRequestId] = useState<number | null>(null);
  const [child, setChild] = useState<FuseExecuteResult | null>(null);
  const [childId, setChildId] = useState<number | null>(null);

  // Real Auras this wallet owns (from the indexer-proxied creator dashboard; NOT game-gated).
  useEffect(() => {
    if (!address) {
      setOwned(null);
      return;
    }
    let live = true;
    setLoadingOwned(true);
    fetchCreatorDashboard(address).then((d) => {
      if (!live) return;
      setOwned(d?.agentsOwned ?? []);
      setLoadingOwned(false);
    });
    return () => {
      live = false;
    };
  }, [address]);

  // Preselect parent A from a ?a=<agentId> deep-link (the "Fuse this Aura" entry from the agent view), once
  // the owned list is in and only if the wallet actually owns it. Client-only URL read (no Suspense needed).
  useEffect(() => {
    if (!owned || a !== null) return;
    const pre = Number(new URLSearchParams(window.location.search).get("a"));
    if (Number.isInteger(pre) && pre > 0 && owned.some((x) => x.agentId === pre)) setA(pre);
  }, [owned, a]);

  const parentA = useMemo(() => owned?.find((x) => x.agentId === a) ?? null, [owned, a]);
  const parentB = useMemo(() => owned?.find((x) => x.agentId === b) ?? null, [owned, b]);
  const bothPicked = a !== null && b !== null && a !== b;

  const toggle = useCallback(
    (id: number) => {
      if (a === id) return setA(null);
      if (b === id) return setB(null);
      if (a === null) return setA(id);
      if (b === null) return setB(id);
      // both filled: replace B
      setB(id);
    },
    [a, b],
  );

  const ensureToken = useCallback(async (): Promise<string | null> => {
    let token = auth.token;
    if (!token) token = await auth.signIn();
    return token ?? null;
  }, [auth]);

  const onRequest = useCallback(async () => {
    if (!bothPicked || a === null || b === null) return;
    const token = await ensureToken();
    if (!token) return;
    const res = await fusion.requestFusion(token, a, b);
    if (res) {
      setRequestId(res.requestId);
      setStep("reveal");
    }
  }, [a, b, bothPicked, ensureToken, fusion]);

  const onExecute = useCallback(async () => {
    if (requestId === null) return;
    const token = await ensureToken();
    if (!token) return;
    const res = await fusion.executeFusion(token, requestId);
    if (res) {
      setChild(res.result);
      setChildId(res.childId);
      setStep("child");
    }
  }, [requestId, ensureToken, fusion]);

  const stepIndex: Record<FlowStep, number> = { pick: 0, review: 1, commit: 2, reveal: 3, child: 4 };
  const steps: { label: string; status: StepStatus }[] = (["pick", "review", "commit", "reveal", "child"] as FlowStep[]).map((s) => ({
    label: t(`steps.${s}`),
    status: stepIndex[step] === stepIndex[s] ? "active" : stepIndex[step] > stepIndex[s] ? "done" : "pending",
  }));

  const rules: { key: "ownBoth" | "persist" | "siblings" | "fee"; note: string }[] = [
    { key: "ownBoth", note: t("rules.ownBothNote") },
    { key: "persist", note: t("rules.persistNote") },
    { key: "siblings", note: t("rules.siblingsNote") },
    { key: "fee", note: t("rules.feeNote") },
  ];

  return (
    <div className="mx-auto w-full max-w-[var(--container-wrap)] px-5 py-14 sm:px-8 sm:py-16">
      <GameHeader
        kicker={t("kicker")}
        marker="0G · AURAFUSION"
        title={t("title")}
        lede={t("lede")}
        chips={
          <>
            <GateChip enabled={FUSION_ENABLED} />
            <Chip tone="accent">{c("keyless")}</Chip>
            <Chip>ERC-7857</Chip>
          </>
        }
      />

      {!FUSION_ENABLED ? (
        <div className="mt-10">
          <DeployGate />
        </div>
      ) : null}

      {/* ── The rules of fusion (the locked design, stated plainly) ── */}
      <GameSection index="01" kicker={t("kicker")} title={t("rules.ownBoth")} />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {rules.map((r) => (
          <Panel key={r.key} className="p-6">
            <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>
              {t(`rules.${r.key}`)}
            </div>
            <p className="mt-2.5 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              {r.note}
            </p>
          </Panel>
        ))}
      </div>

      {/* ── The flow ── */}
      <GameSection index="02" kicker={t("steps.pick")} title={t("pick.title")} />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0">
          {!isConnected ? (
            <ConnectGate title={c("connectWallet")} body={t("pick.body")}>
              <CustomConnectButton />
            </ConnectGate>
          ) : (
            <ParentPicker
              owned={owned}
              loading={loadingOwned}
              a={a}
              b={b}
              onToggle={toggle}
              emptyLabel={t("pick.empty")}
              youOwnLabel={t("pick.you")}
              chosenLabel={t("pick.chosen")}
            />
          )}

          {isConnected && bothPicked && parentA && parentB ? (
            <ReviewAndCommit
              parentA={parentA}
              parentB={parentB}
              requestId={requestId}
              fusion={fusion}
              enabled={FUSION_ENABLED}
              onRequest={onRequest}
              onExecute={onExecute}
            />
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-32 lg:self-start">
          <Panel className="p-6">
            <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
              {t("steps.pick")} → {t("steps.child")}
            </div>
            <div className="mt-4">
              <StepRail steps={steps} />
            </div>
          </Panel>
        </aside>
      </div>

      {/* ── The descendant ── */}
      <GameSection index="03" kicker={t("steps.child")} title={t("child.title")} />
      <div className="mt-8">
        {child ? (
          <ChildReveal child={child} childId={childId} parentA={parentA} parentB={parentB} />
        ) : (
          <DynastyPreview parentA={parentA} parentB={parentB} />
        )}
      </div>

      {/* ── Verify the child genome yourself (always shown; works post-deploy) ── */}
      <div className="mt-8">
        <VerifyPanel
          title={t("child.verifyTitle")}
          body={t("child.verifyBody")}
          commands={[{ cmd: fuseVerifyCurl(requestId ?? 1), note: t("child.verifyNote") }]}
          footer={c("builtTested")}
        />
      </div>
    </div>
  );
}

// ── Parent picker (real owned Auras) ───────────────────────────────────────
function ParentPicker({
  owned,
  loading,
  a,
  b,
  onToggle,
  emptyLabel,
  youOwnLabel,
  chosenLabel,
}: {
  owned: Agent[] | null;
  loading: boolean;
  a: number | null;
  b: number | null;
  onToggle: (id: number) => void;
  emptyLabel: string;
  youOwnLabel: string;
  chosenLabel: string;
}) {
  if (loading || owned === null) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="aura-skeleton aspect-[4/5] rounded-[18px]" />
        ))}
      </div>
    );
  }
  if (owned.length < 2) {
    return (
      <Panel className="p-8 text-center">
        <p className="mx-auto max-w-[44ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          {emptyLabel}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <ActionButton href="/create" variant="outline">Create an Aura</ActionButton>
          <ActionButton href="/agents" variant="outline">Browse Auras</ActionButton>
        </div>
      </Panel>
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
          {youOwnLabel} · {owned.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {owned.map((agent) => {
          const picked = agent.agentId === a ? "A" : agent.agentId === b ? "B" : null;
          return (
            <button
              key={agent.agentId}
              type="button"
              onClick={() => onToggle(agent.agentId)}
              aria-pressed={picked !== null}
              className="micro group relative overflow-hidden rounded-[18px] border text-left active:scale-[0.985]"
              style={{
                borderColor: picked ? "var(--color-accent)" : "var(--color-border-strong)",
                boxShadow: picked ? "0 0 0 2px color-mix(in oklab, var(--color-accent) 40%, transparent)" : "none",
                background: "var(--color-paper)",
              }}
            >
              <div className="relative aspect-[4/5] w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
                <Image
                  src={agentPortraitUrl(agent, 320)}
                  alt={agent.name}
                  fill
                  sizes="(max-width: 640px) 45vw, 220px"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  unoptimized
                />
                {picked ? (
                  <span
                    className="absolute right-2 top-2 flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 text-[13px] font-semibold"
                    style={{ background: "var(--color-accent)", color: "var(--color-cream)" }}
                  >
                    {picked}
                  </span>
                ) : null}
              </div>
              <div className="p-3">
                <div className="truncate font-display text-[18px]" style={{ letterSpacing: "-0.01em" }}>
                  {agent.name}
                </div>
                <div className="mt-0.5 font-mono-x tabular-nums text-[13px]" style={{ color: "var(--color-ink-3)" }}>
                  #{agent.agentId} · {picked ? chosenLabel : `${agent.outputCount} relics`}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Review + commit + reveal ────────────────────────────────────────────────
function ReviewAndCommit({
  parentA,
  parentB,
  requestId,
  fusion,
  enabled,
  onRequest,
  onExecute,
}: {
  parentA: Agent;
  parentB: Agent;
  requestId: number | null;
  fusion: ReturnType<typeof useFusion>;
  enabled: boolean;
  onRequest: () => void;
  onExecute: () => void;
}) {
  const t = useTranslations("game.fuse");
  const c = useTranslations("game.common");
  const { state, busy } = fusion;
  const gated = state.phase === "gated" || !enabled;

  return (
    <Panel className="mt-8 p-6 sm:p-7">
      <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>
        {t("review.title")}
      </div>
      <dl className="mt-4">
        <MetaRow k={c("parents")} v={`${parentA.name} #${parentA.agentId} + ${parentB.name} #${parentB.agentId}`} mono={false} />
        <MetaRow k={t("review.generation")} v={t("review.generationFormula")} mono={false} />
        <MetaRow k={t("review.fee")} v={t("rules.feeNote")} mono={false} />
        <MetaRow k={t("review.cooldown")} v={t("rules.persistNote")} mono={false} />
      </dl>
      <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
        {t("review.requestNote")}
      </p>

      {/* Commit + reveal actions (honestly disabled when gated) */}
      <div className="mt-6 space-y-4">
        {requestId === null ? (
          <div>
            <ActionButton onClick={onRequest} disabled={busy || gated}>
              {busy && state.action === "request" ? state.step ?? t("commit.title") : t("review.requestFusion")}
            </ActionButton>
            {gated ? <div className="mt-3"><GatedNote>{c("builtTested")}. {t("commit.body")}</GatedNote></div> : null}
          </div>
        ) : (
          <div>
            <div className="mb-3">
              <MetaRow k={t("commit.requestId")} v={`#${requestId}`} mono />
              <p className="mt-1 text-[15px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{t("commit.toReveal")}</p>
            </div>
            <ActionButton onClick={onExecute} disabled={busy || gated}>
              {busy && state.action === "execute" ? state.step ?? t("reveal.generating") : t("reveal.execute")}
            </ActionButton>
          </div>
        )}
        {state.phase === "error" && state.error ? (
          <p role="alert" className="text-[15px]" style={{ color: "var(--color-warn)" }}>{state.error}</p>
        ) : null}
      </div>
    </Panel>
  );
}

// ── Genome strip (8 loci) ───────────────────────────────────────────────────
function GenomeStrip({ genome }: { genome: number[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {genome.map((v, i) => (
        <div
          key={i}
          className="flex h-11 w-11 flex-col items-center justify-center rounded-[10px] border font-mono-x tabular-nums"
          style={{ borderColor: "var(--color-border-strong)", background: "color-mix(in oklab, var(--color-accent) 8%, var(--color-paper))" }}
          title={`locus ${i + 1}`}
        >
          <span className="text-[15px]" style={{ color: "var(--color-ink)" }}>{v}</span>
          <span className="text-[10px]" style={{ color: "var(--color-ink-3)" }}>L{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

// ── Dynasty / family-tree node ──────────────────────────────────────────────
function TreeNode({ agent, id, label, tone = "parent" }: { agent: Agent | null; id: number | null; label: string; tone?: "child" | "parent" }) {
  const isChild = tone === "child";
  return (
    <div
      className="flex min-w-[128px] flex-col items-center rounded-[16px] border p-3"
      style={{
        borderColor: isChild ? "var(--color-accent)" : "var(--color-border-strong)",
        background: isChild ? "color-mix(in oklab, var(--color-accent) 8%, var(--color-paper))" : "var(--color-paper)",
      }}
    >
      <div className="relative h-16 w-16 overflow-hidden rounded-[12px]" style={{ background: "var(--color-cream-deep)" }}>
        {agent ? (
          <Image src={agentPortraitUrl(agent, 128)} alt={agent.name} fill sizes="64px" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-[22px]" style={{ color: "var(--color-ink-3)" }}>?</div>
        )}
      </div>
      <div className="mt-2 max-w-[120px] truncate font-display text-[15px]">{agent ? agent.name : label}</div>
      <div className="font-mono-x tabular-nums text-[12px]" style={{ color: "var(--color-ink-3)" }}>{id !== null ? `#${id}` : label}</div>
    </div>
  );
}

function DynastyTree({ child, childId, parentA, parentB }: { child: FuseExecuteResult | null; childId: number | null; parentA: Agent | null; parentB: Agent | null }) {
  const t = useTranslations("game.fuse");
  const aId = child ? Number((child.publicStyle?.fusion as { parents?: number[] })?.parents?.[0] ?? parentA?.agentId ?? null) : parentA?.agentId ?? null;
  const bId = child ? Number((child.publicStyle?.fusion as { parents?: number[] })?.parents?.[1] ?? parentB?.agentId ?? null) : parentB?.agentId ?? null;
  return (
    <div className="flex flex-col items-center">
      <TreeNode agent={null} id={childId} label={child ? child.childName : t("child.title")} tone="child" />
      <div className="my-2 h-6 w-px" style={{ background: "var(--color-border-strong)" }} aria-hidden />
      <div className="flex items-start gap-6 sm:gap-10">
        <TreeNode agent={parentA} id={aId} label="" />
        <TreeNode agent={parentB} id={bId} label="" />
      </div>
    </div>
  );
}

// ── Child reveal (real, only after a real executeFusion) ─────────────────────
function ChildReveal({ child, childId, parentA, parentB }: { child: FuseExecuteResult; childId: number | null; parentA: Agent | null; parentB: Agent | null }) {
  const t = useTranslations("game.fuse");
  const c = useTranslations("game.common");
  const parents = ((child.publicStyle?.fusion as { parents?: number[] } | undefined)?.parents ?? []) as number[];
  const pa = parents[0] ?? parentA?.agentId ?? "?";
  const pb = parents[1] ?? parentB?.agentId ?? "?";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel className="overflow-hidden">
        <div className="relative aspect-square w-full" style={{ background: "var(--color-cream-deep)" }}>
          <Image src={imageUrl(child.portrait.imageRoot)} alt={t("child.portraitAlt")} fill sizes="(max-width: 1024px) 100vw, 520px" className="object-cover" unoptimized />
          <span className="absolute left-3 top-3 rounded-full px-3 py-1 text-[13px] font-semibold" style={{ background: "var(--color-accent)", color: "var(--color-cream)" }}>
            {t("child.generationBadge", { gen: child.generation })}
          </span>
        </div>
        <div className="p-5">
          <div className="font-display text-[26px]" style={{ letterSpacing: "-0.01em" }}>{child.childName}</div>
          <div className="mt-1 text-[15px]" style={{ color: "var(--color-ink-2)" }}>
            {t("child.descendedFrom", { a: pa, b: pb })}
          </div>
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel className="p-5 sm:p-6">
          <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>{t("child.genomeTitle")}</div>
          <div className="mt-3"><GenomeStrip genome={child.childGenome} /></div>
          <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{t("child.genomeNote")}</p>
          <dl className="mt-4">
            <MetaRow k={c("generation")} v={String(child.generation)} mono />
            <MetaRow k="fuseSeed" v={<CopyValue full={child.fuseSeed} display={shortAddr(child.fuseSeed)} />} mono />
            <MetaRow k={t("child.styleTitle")} v={child.blendedStyleDescriptor} mono={false} />
            {childId !== null ? <MetaRow k={c("child")} v={`#${childId}`} mono /> : null}
          </dl>
        </Panel>

        <Panel className="p-5 sm:p-6">
          <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>{t("child.dynastyTitle")}</div>
          <p className="mt-1 text-[14px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{t("child.dynastyNote")}</p>
          <div className="mt-4"><DynastyTree child={child} childId={childId} parentA={parentA} parentB={parentB} /></div>
        </Panel>

        {child.memory ? (
          <Panel className="p-5 sm:p-6">
            <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-accent)" }}>{t("child.memoryTitle")}</div>
            <p className="mt-1 text-[14px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{t("child.memoryNote")}</p>
            <dl className="mt-3">
              <MetaRow k="L1 inherited" v={String(child.memory.inheritedL1Count)} mono />
              <MetaRow k="L2" v={child.memory.l2Reset ? "reset" : "carried"} mono={false} />
            </dl>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

// The dynasty preview shown BEFORE a real child exists: driven by the SELECTED real parents (honest), it
// shows the prospective descendant node + the lineage shape. No fake child data.
function DynastyPreview({ parentA, parentB }: { parentA: Agent | null; parentB: Agent | null }) {
  const t = useTranslations("game.fuse");
  const c = useTranslations("game.common");
  if (!parentA || !parentB) {
    return (
      <Panel className="p-8 text-center">
        <p className="mx-auto max-w-[52ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          {t("pick.needTwo")}
        </p>
      </Panel>
    );
  }
  return (
    <Panel className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-3 label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
        <span>{t("child.dynastyTitle")}</span>
        <span className="prov-rule h-px flex-1" style={{ opacity: 0.4 }} />
        <Chip>{c("builtTested")}</Chip>
      </div>
      <div className="mt-6"><DynastyTree child={null} childId={null} parentA={parentA} parentB={parentB} /></div>
      <p className="mx-auto mt-6 max-w-[60ch] text-center text-[15px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
        {t("child.lineageTitle")}: {parentA.name} #{parentA.agentId} + {parentB.name} #{parentB.agentId}
      </p>
    </Panel>
  );
}
