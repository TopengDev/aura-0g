"use client";

import Link from "next/link";
import { useState } from "react";
import { Reveal } from "@/components/Reveal";
import { PageHeader, Panel, ProvLine, Chip, MetaRow, ActionButton, CopyValue } from "@/components/product/primitives";
import { RarityBadge } from "@/components/product/RarityBadge";
import { ShareOnX } from "@/components/product/ShareOnX";
import { absoluteUrl, relicShareText } from "@/lib/share";
import { TradePanel } from "@/components/product/TradePanel";
import { EXPLORER, STORAGE_SCAN } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import { runVerification, clientVerifyRoll } from "@/lib/verify";
import {
  agentPortraitUrl,
  shortHex,
  type AgentDetail,
  type MarketListing,
  type Output,
  type Provenance,
  type Royalty,
  type SummonRoll,
} from "@/lib/api";

// One output. The artwork, its creator agent (linked), the generative direction, the provenance block
// (TEE attestation, model, 0G storage root, provenance hash, seed), the trade panel (kind=output), the
// live royalty info, and an inline Verify action that re-checks provenance + royalty on-chain.
export function OutputDetailView({
  output: o,
  provenance,
  royalty,
  agent,
  listing,
}: {
  output: Output;
  provenance: Provenance | null;
  royalty: Royalty | null;
  agent: AgentDetail | null;
  listing: MarketListing | null;
}) {
  const img = `/images/${encodeURIComponent(o.imageRoot.replace(/^0g:\/\//, ""))}?style=${o.style}`;
  const storageHref = o.storageScanUrl?.startsWith("http")
    ? o.storageScanUrl
    : `${STORAGE_SCAN}/tx/${o.imageRoot}`;

  return (
    <section className="relative px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <Link href={agent ? `/agents/${o.creatorAgentId}` : "/agents"} className="label-caps text-[13px] uppercase tracking-[0.14em] hover:underline" style={{ color: "var(--color-ink-3)" }}>
            &lt;- {agent ? agent.name : "All Auras"}
          </Link>
        </Reveal>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_1fr]">
          {/* Left: artwork */}
          <div>
            <Reveal>
              <div className="overflow-hidden rounded-[24px] border" style={{ borderColor: "var(--color-border)", background: "var(--color-cream-deep)" }}>
                <img src={img} alt={`${o.agentName} relic #${o.tokenId}`} className="w-full object-cover" />
              </div>
            </Reveal>
            <Reveal delay={0.05}>
              <div className="mt-3 flex items-center justify-between font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                <span>Relic NFT #{o.tokenId}</span>
                <a href={`${EXPLORER}/token/${CONTRACTS.outputNFT}?a=${o.tokenId}`} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline" style={{ color: "var(--color-accent)" }}>
                  {shortHex(CONTRACTS.outputNFT)} on 0G Scan
                </a>
              </div>
            </Reveal>
          </div>

          {/* Right: identity + trade + provenance */}
          <div className="space-y-6">
            <Reveal>
              <PageHeader
                kicker="Verifiable Relic"
                marker={`#${o.tokenId}`}
                title={<>{o.agentName} <span style={{ color: "var(--color-ink-3)" }}>#{o.tokenId}</span></>}
              />
              {o.rarity ? (
                <div className="mt-3 flex items-center gap-2">
                  <RarityBadge rarity={o.rarity} />
                  <span className="text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                    provably rolled from the on-chain seed
                  </span>
                </div>
              ) : null}
              <div className="mt-4">
                <ShareOnX
                  text={relicShareText(o.agentName, o.tokenId)}
                  url={absoluteUrl(`/outputs/${o.tokenId}`)}
                  label="Share this Relic"
                />
              </div>
            </Reveal>

            {/* Creator agent */}
            <Reveal delay={0.04}>
              <Link href={`/agents/${o.creatorAgentId}`} className="flex items-center gap-3 rounded-[18px] border p-3 transition-shadow hover:shadow-[var(--shadow-card)]" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${agent?.meta.accent ?? "#2a3858"} 8%, var(--color-paper))` }}>
                <img src={agentPortraitUrl({ agentId: o.creatorAgentId, name: o.agentName ?? "", style: o.style })} alt={o.agentName} className="h-12 w-12 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>Created by</div>
                  <div className="font-display" style={{ fontSize: 20, lineHeight: 1.1 }}>{o.agentName}</div>
                </div>
                <Chip accent={agent?.meta.accent}>{o.style}</Chip>
              </Link>
            </Reveal>

            {/* Trade panel */}
            <Reveal delay={0.06}>
              <TradePanel
                kind="output"
                tokenId={o.tokenId}
                owner={o.owner}
                listing={listing}
                note={
                  royalty ? (
                    <>
                      On every sale through AURA, <strong style={{ color: "var(--color-ink)" }}>{royalty.royaltyPct}%</strong> routes to whoever currently owns the{" "}
                      <Link href={`/agents/${o.creatorAgentId}`} className="underline underline-offset-2" style={{ color: "var(--color-accent)" }}>{o.agentName}</Link>{" "}
                      agent. It resolves live on-chain, so the royalty follows the agent.
                    </>
                  ) : undefined
                }
              />
            </Reveal>
          </div>
        </div>

        {/* Generative direction + provenance + royalty */}
        <div className="mt-14 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Generative direction (the prompt/style the agent paints from) */}
          <Reveal>
            <Panel className="p-6">
              <div className="mb-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                Generative direction
              </div>
              <p className="text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                {agent?.meta.aesthetic ?? `A ${o.style} generation by ${o.agentName}.`}
              </p>
              <div className="mt-5">
                <dl>
                  <MetaRow k="Seed" v={<CopyValue full={String(o.seed)} display={shortHex(String(o.seed), 10, 8)} />} />
                  {agent?.model ? <MetaRow k="Model" v={agent.model} mono={false} /> : null}
                  <MetaRow k="Style" v={o.style} mono={false} />
                </dl>
              </div>
              <p className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                The same Aura + same seed reproduces this Relic deterministically. The full prompt is
                sealed into the on-chain provenance hash below.
              </p>
            </Panel>
          </Reveal>

          {/* Provenance block + Verify */}
          <Reveal delay={0.05}>
            <ProvenanceBlock output={o} provenance={provenance} agent={agent} storageHref={storageHref} />
          </Reveal>
        </div>

        {/* Royalty detail */}
        {royalty ? (
          <Reveal>
            <div className="mt-6">
              <RoyaltyBlock royalty={royalty} agentId={o.creatorAgentId} agentName={o.agentName} />
            </div>
          </Reveal>
        ) : null}
      </div>
    </section>
  );
}

// The provenance block carries the unforgeable facts + the inline Verify action that re-checks them
// live on-chain (provenance + royalty), asserting agent existence, image-on-chain, TEE presence, and
// that the royalty receiver still resolves to the current agent owner.
function ProvenanceBlock({
  output: o,
  provenance,
  agent,
  storageHref,
}: {
  output: Output;
  provenance: Provenance | null;
  agent: AgentDetail | null;
  storageHref: string;
}) {
  type VerifyState =
    | { phase: "idle" }
    | { phase: "checking" }
    | { phase: "done"; ok: boolean; checks: { label: string; ok: boolean }[]; summary: string; roll: SummonRoll | null }
    | { phase: "error"; message: string };
  const [verify, setVerify] = useState<VerifyState>({ phase: "idle" });

  const onVerify = async () => {
    setVerify({ phase: "checking" });
    try {
      // Re-check live on-chain through the SHARED verifier so this inline action and the standalone
      // /verify page assert the identical five checks. The flat output's own hash is the expected value.
      const result = await runVerification(o.tokenId, o.provenanceHash);
      if (!result) {
        setVerify({ phase: "error", message: "Could not read provenance from chain." });
        return;
      }
      setVerify({ phase: "done", ok: result.ok, checks: result.checks, summary: result.summary, roll: result.summon?.roll ?? null });
    } catch (e) {
      setVerify({ phase: "error", message: e instanceof Error ? e.message : "Verification failed." });
    }
  };

  const teeAttestation = provenance?.onChain.teeAttestation ?? o.teeAttestation;
  const provHash = provenance?.onChain.provenanceHash ?? o.provenanceHash;

  return (
    <Panel className="p-6">
      <div className="flex items-center justify-between">
        <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          Provenance. unforgeable
        </div>
        <Chip tone="ok">TEE-attested</Chip>
      </div>

      <dl className="mt-4">
        <MetaRow k="TEE attestation" v={shortHex(teeAttestation)} ok />
        {provenance?.agent.modelAttestation ? <MetaRow k="Model attestation" v={shortHex(provenance.agent.modelAttestation)} ok /> : agent?.modelAttestation ? <MetaRow k="Model attestation" v={shortHex(agent.modelAttestation)} ok /> : null}
        <MetaRow k="0G storage root" v={shortHex(o.imageRoot)} href={storageHref} />
        <MetaRow k="Provenance hash" v={shortHex(provHash)} />
        <MetaRow k="Seed" v={<CopyValue full={String(o.seed)} display={shortHex(String(o.seed), 10, 8)} />} />
        {provenance?.agent.styleFingerprint ? <MetaRow k="Style DNA" v={shortHex(provenance.agent.styleFingerprint)} /> : null}
        <MetaRow k="Owner" v={shortHex(o.owner)} href={`${EXPLORER}/address/${o.owner}`} />
      </dl>

      <ProvLine className="my-5" />

      <ActionButton onClick={onVerify} disabled={verify.phase === "checking"} variant="outline">
        {verify.phase === "checking" ? "Verifying on-chain..." : "Verify provenance"}
      </ActionButton>

      {verify.phase === "done" ? (
        <div className="mt-4 rounded-xl border p-4" style={{ borderColor: verify.ok ? "color-mix(in oklab, var(--color-ok) 40%, transparent)" : "var(--color-warn)" }}>
          <div className="font-mono-x text-[16px]" style={{ color: verify.ok ? "var(--color-ok)" : "var(--color-warn)" }}>
            {verify.ok ? "Verified on-chain ✓" : "Verification incomplete"}
          </div>
          <ul className="mt-3 space-y-1.5">
            {verify.checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 font-mono-x text-[16px]" style={{ color: "var(--color-ink-2)" }}>
                <span style={{ color: c.ok ? "var(--color-ok)" : "var(--color-warn)" }}>{c.ok ? "✓" : "✕"}</span>
                {c.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>{verify.summary}</p>
          {verify.roll ? <ProvablePullPanel roll={verify.roll} /> : null}
        </div>
      ) : null}
      {verify.phase === "error" ? (
        <div className="mt-4 rounded-xl border p-3 font-mono-x text-[16px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
          {verify.message}
        </div>
      ) : null}
    </Panel>
  );
}

// The PROVABLE-PULL panel: shows that this Relic's subject + rarity were rolled deterministically from the
// on-chain seed, and re-derives the seedRoot from the PUBLIC preimage IN THE BROWSER (clientVerifyRoll) to
// prove it equals the committed Provenance.seed - so the pull is recomputable + rig-evident, not a hidden DB
// value. Subject dimensions are listed so a viewer sees the exact gacha roll that produced the art.
function ProvablePullPanel({ roll }: { roll: SummonRoll }) {
  const clientOk = clientVerifyRoll(roll);
  const dims = Object.entries(roll.subject);
  return (
    <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-cream-warm)" }}>
      <div className="flex items-center justify-between gap-2">
        <div className="label-caps text-[13px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
          Provable pull
        </div>
        <RarityBadge rarity={roll.rarity} />
      </div>

      {/* the rig-check: the browser recomputed seedRoot == on-chain seed */}
      <div className="mt-3 flex items-start gap-2 font-mono-x text-[16px]" style={{ color: clientOk ? "var(--color-ok)" : "var(--color-warn)" }}>
        <span>{clientOk ? "✓" : "✕"}</span>
        <span>
          {clientOk
            ? "seedRoot recomputed in your browser matches the seed this roll reports - the rarity is recomputable, not a hidden DB value. For the trust anchor, read Provenance.seed on-chain (the cast call on /proof) and confirm it equals this root."
            : roll.provable
              ? "seed recompute pending / unavailable."
              : "Standard Relic (no provable-pull seed) - reads as Common."}
        </span>
      </div>

      {roll.rarityRoll !== null ? (
        <dl className="mt-3">
          <MetaRow k="Rarity roll" v={`${roll.rarityRoll} / 9999`} />
          <MetaRow k="On-chain seed" v={shortHex(roll.onChainSeed, 8, 6)} />
          <MetaRow k="Request id" v={String(roll.seedPreimage.requestId)} mono />
          <MetaRow k="Summon block hash" v={shortHex(roll.seedPreimage.summonBlockHash)} />
        </dl>
      ) : null}

      {dims.length ? (
        <>
          <div className="mt-4 mb-2 label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
            Rolled subject ({dims.length} dimensions)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dims.map(([k, v]) => (
              <span key={k} className="tag micro" style={{ border: "1px solid var(--color-border-strong)", color: "var(--color-ink-2)", background: "var(--color-paper)", letterSpacing: "0.06em" }} title={k}>
                {v}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function RoyaltyBlock({
  royalty: r,
  agentId,
  agentName,
}: {
  royalty: Royalty;
  agentId: number;
  agentName: string;
}) {
  return (
    <Panel className="p-6" style={{ background: "var(--color-cream-warm)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          Royalty. follows the agent
        </div>
        <Chip tone="accent">{r.royaltyPct}% per sale</Chip>
      </div>
      <p className="mt-4 max-w-[70ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {r.thesis}
      </p>
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>Current receiver</div>
          <Link href={`/agents/${agentId}`} className="mt-1 inline-block font-mono-x text-[16px] underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
            {shortHex(r.receiver)}
          </Link>
          <div className="mt-1 text-[16px]" style={{ color: "var(--color-ink-3)" }}>
            {r.receiverIsAgentOwner ? `= the current owner of ${agentName}` : "resolves live on sale"}
          </div>
        </div>
        <div>
          <div className="mb-1 label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>At sample prices</div>
          <dl>
            {r.samples.map((s) => (
              <div key={s.salePrice} className="flex items-center justify-between border-b py-1.5 font-mono-x text-[16px] last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
                <dt style={{ color: "var(--color-ink-3)" }}>{s.salePrice}</dt>
                <dd style={{ color: "var(--color-ink)" }}>{s.royaltyAmount}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Panel>
  );
}
