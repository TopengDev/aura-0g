"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/Reveal";
import { PageHeader, Panel, ProvLine, Chip, MetaRow, ActionButton, Field } from "@/components/product/primitives";
import { ZeroG } from "@/components/atoms/ZeroG";
import { EXPLORER, STORAGE_SCAN } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import { runVerification, type VerifyResult } from "@/lib/verify";
import { shortHex } from "@/lib/api";

// The STANDALONE public provenance verifier (/verify). No wallet, read-only on-chain. A token id goes
// in, and the SHARED runVerification (the same one the output detail page's inline Verify uses) re-reads
// /provenance/:id + /royalty/:id live and asserts the five checks: agent exists, image on-chain, TEE
// attestation present, provenance hash matches, royalty resolves to the current agent owner. The result
// renders as the all-green (or failed) checklist plus the real values + a link through to the output.
type State =
  | { phase: "idle" }
  | { phase: "checking"; id: string }
  | { phase: "done"; id: string; result: VerifyResult }
  | { phase: "notfound"; id: string }
  | { phase: "error"; id: string; message: string };

export function VerifyView({ initialId }: { initialId?: string }) {
  const [input, setInput] = useState(initialId ?? "");
  const [state, setState] = useState<State>({ phase: "idle" });

  const verify = useCallback(async (raw: string) => {
    const id = raw.trim().replace(/^#/, "");
    if (!/^\d+$/.test(id)) {
      setState({ phase: "error", id: raw, message: "Enter a numeric output token id (for example, 6)." });
      return;
    }
    setState({ phase: "checking", id });
    try {
      const result = await runVerification(id);
      if (!result) {
        setState({ phase: "notfound", id });
        return;
      }
      setState({ phase: "done", id, result });
    } catch (e) {
      setState({ phase: "error", id, message: e instanceof Error ? e.message : "Verification failed." });
    }
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void verify(input);
  };

  // Deep-link support: when arrived with ?id= (initialId), auto-run the verification once on mount so
  // the result is on screen immediately (no manual click needed for a shared verify link).
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoRan.current && initialId && /^\d+$/.test(initialId.trim().replace(/^#/, ""))) {
      autoRan.current = true;
      void verify(initialId);
    }
  }, [initialId, verify]);

  const checking = state.phase === "checking";

  return (
    <section className="relative px-5 py-16 sm:px-8 sm:py-20">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <PageHeader
            kicker="Provenance verifier"
            marker="read-only"
            title={<>Verify any piece.</>}
            lede={
              <>
                Paste an output token id and AURA re-reads the chain live, no wallet required. It confirms
                the creating agent, that the image and a TEE attestation are committed on-chain, that the
                provenance hash holds, and that the royalty still resolves to the current agent owner.
                The same checks the marketplace runs, in your hands.
              </>
            }
          />
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          {/* Input + how-it-works */}
          <Reveal delay={0.04}>
            <Panel className="p-6 sm:p-8">
              <form onSubmit={onSubmit}>
                <Field label="Output token id" hint="numeric">
                  <div className="flex gap-2">
                    <input
                      value={input}
                      inputMode="numeric"
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="e.g. 6"
                      aria-label="Output token id"
                      // Resting border in className (not inline) so focus:border-* wins (inline style would override it).
                      className="w-full rounded-[14px] border border-[var(--color-border-strong)] px-4 py-3 font-mono-x text-[14px] outline-none transition-colors focus:border-[var(--color-accent)]"
                      style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}
                    />
                  </div>
                </Field>
                <div className="mt-4">
                  <ActionButton type="submit" disabled={checking || input.trim().length === 0}>
                    {checking ? "Verifying on-chain..." : "Verify provenance"}
                  </ActionButton>
                </div>
              </form>

              <ProvLine className="my-6" />

              <div className="font-mono-x text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                What gets checked
              </div>
              <ul className="mt-4 space-y-2.5">
                {WHAT_GETS_CHECKED.map((c) => (
                  <li key={c} className="flex items-start gap-2.5 font-mono-x text-[12px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                    <span aria-hidden style={{ color: "var(--color-ink-3)" }}>·</span>
                    {c}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[12px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                Reads run against the live <ZeroG /> Galileo chain (id 16602). Nothing is signed or spent.
              </p>
            </Panel>
          </Reveal>

          {/* Result */}
          <div>
            {state.phase === "idle" ? (
              <Reveal delay={0.06}>
                <IdlePanel />
              </Reveal>
            ) : state.phase === "checking" ? (
              <CheckingPanel id={state.id} />
            ) : state.phase === "notfound" ? (
              <NotFoundPanel id={state.id} />
            ) : state.phase === "error" ? (
              <ErrorPanel message={state.message} />
            ) : (
              <ResultPanel id={state.id} result={state.result} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const WHAT_GETS_CHECKED = [
  "The creating agent exists on-chain.",
  "The image root is committed on-chain.",
  "A TEE attestation is present.",
  "The provenance hash matches the chain.",
  "The royalty resolves to the current agent owner.",
];

// The pre-verification calm state: explains the thesis, nudges a sample id.
function IdlePanel() {
  return (
    <Panel className="flex h-full flex-col justify-center p-8 text-center" style={{ background: "var(--color-cream-warm)" }}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: "var(--color-border-strong)" }}>
        <ShieldIcon />
      </div>
      <h2 className="font-display mt-5" style={{ fontSize: "clamp(24px,3.4vw,34px)", lineHeight: 1.05 }}>
        Provenance, on demand.
      </h2>
      <p className="mx-auto mt-3 max-w-[42ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        Every AURA output carries an unforgeable on-chain trail. Enter a token id to re-derive it live.
        Try <button type="button" className="underline underline-offset-4" style={{ color: "var(--color-accent)" }} onClick={() => { const el = document.querySelector<HTMLInputElement>('input[aria-label="Output token id"]'); if (el) { el.value = "6"; el.dispatchEvent(new Event("input", { bubbles: true })); el.focus(); } }}>#6</button>{" "}
        to see a fully verified piece.
      </p>
    </Panel>
  );
}

function CheckingPanel({ id }: { id: string }) {
  return (
    <Panel className="p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <div className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          Verifying output #{id}
        </div>
        <span className="font-mono-x text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--color-accent)" }}>
          Reading chain
        </span>
      </div>
      <div className="mt-6 space-y-3">
        {WHAT_GETS_CHECKED.map((c) => (
          <div key={c} className="aura-skeleton h-9 rounded-[12px]" />
        ))}
      </div>
      <p className="mt-5 font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>
        Reading the chain (provenance + royalty)...
      </p>
    </Panel>
  );
}

// The full verified (or failed) result: the checklist, the real on-chain values, and a link through to
// the output. Mirrors the output detail page's provenance block so the two read identically.
function ResultPanel({ id, result }: { id: string; result: VerifyResult }) {
  const { ok, checks, summary, provenance: p, royalty: r } = result;
  const storageHref = p.links.storageScan?.startsWith("http")
    ? p.links.storageScan
    : `${STORAGE_SCAN}/tx/${p.onChain.imageRoot}`;
  const accent = ok ? "var(--color-ok)" : "var(--color-warn)";

  return (
    <Reveal>
      <Panel className="overflow-hidden">
        {/* Verdict header */}
        <div className="flex items-center justify-between gap-3 border-b px-6 py-5 sm:px-8" style={{ borderColor: "var(--color-border)", background: ok ? "color-mix(in oklab, var(--color-ok) 10%, transparent)" : "color-mix(in oklab, var(--color-warn) 10%, transparent)" }}>
          <div>
            <div className="font-mono-x text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
              {p.agent.name} · output #{id}
            </div>
            <div className="font-display mt-1.5" style={{ fontSize: "clamp(22px,3vw,30px)", lineHeight: 1, color: accent }}>
              {ok ? "Verified on-chain" : "Verification incomplete"}
            </div>
          </div>
          <Chip tone={ok ? "ok" : "default"}>{ok ? "All checks passed" : `${checks.filter((c) => c.ok).length}/${checks.length}`}</Chip>
        </div>

        <div className="p-6 sm:p-8">
          {/* Checklist */}
          <ul className="space-y-2.5">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-3 font-mono-x text-[12px]" style={{ color: "var(--color-ink)" }}>
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
                  style={{ background: c.ok ? "color-mix(in oklab, var(--color-ok) 16%, transparent)" : "color-mix(in oklab, var(--color-warn) 16%, transparent)", color: c.ok ? "var(--color-ok)" : "var(--color-warn)" }}
                >
                  {c.ok ? "✓" : "✕"}
                </span>
                {c.label}
              </li>
            ))}
          </ul>

          <p className="mt-5 text-[13px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
            {summary}
          </p>

          <ProvLine className="my-6" />

          {/* Real on-chain values */}
          <div className="font-mono-x text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            On-chain facts
          </div>
          <dl className="mt-4">
            <MetaRow k="Creating agent" v={`${p.agent.name} (#${p.agent.agentId})`} mono={false} />
            <MetaRow k="TEE attestation" v={shortHex(p.onChain.teeAttestation)} ok={p.verification.teeAttestationPresent} />
            <MetaRow k="Model attestation" v={shortHex(p.agent.modelAttestation)} ok={!!p.agent.modelAttestation} />
            <MetaRow k="Style DNA" v={shortHex(p.agent.styleFingerprint)} />
            <MetaRow k="0G storage root" v={shortHex(p.onChain.imageRoot)} href={storageHref} />
            <MetaRow k="Provenance hash" v={shortHex(p.onChain.provenanceHash)} />
            <MetaRow k="Seed" v={String(p.onChain.seed)} />
            {r ? <MetaRow k="Royalty" v={`${r.royaltyPct}% to current owner`} mono={false} /> : null}
            <MetaRow k="Royalty receiver" v={shortHex(p.verification.royaltyReceiver)} href={`${EXPLORER}/address/${p.verification.royaltyReceiver}`} ok={r ? r.receiverIsAgentOwner : false} />
            <MetaRow k="Agent owner" v={shortHex(p.agent.owner)} href={`${EXPLORER}/address/${p.agent.owner}`} />
          </dl>

          {/* SUMMON economic proof: this piece was a PAID commission, and the fee split settled on-chain. */}
          {result.summon ? (
            <>
              <ProvLine className="my-6" />
              <div className="flex items-center justify-between gap-3">
                <div className="font-mono-x text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Paid commission · the moat
                </div>
                <Chip tone="ok">Summoned</Chip>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                This wasn’t a free mint. A collector paid <strong style={{ color: "var(--color-ink)" }}>{result.summon.fee} <ZeroG /></strong> to
                summon the agent, and the fee settled <strong style={{ color: "var(--color-ink)" }}>on-chain</strong> — straight to the agent’s
                owner. Supply can never exceed paid demand.
              </p>
              <dl className="mt-4">
                <MetaRow k="Commission fee" v={`${result.summon.fee} 0G`} mono={false} />
                <MetaRow k="→ Agent owner" v={`${result.summon.ownerCut} 0G`} href={`${EXPLORER}/address/${result.summon.agentOwner}`} ok mono={false} />
                <MetaRow k="→ Platform" v={`${result.summon.platformFee} 0G`} mono={false} />
                <MetaRow k="Commissioned by" v={shortHex(result.summon.buyer)} href={`${EXPLORER}/address/${result.summon.buyer}`} />
                <MetaRow k="Settlement tx" v={shortHex(result.summon.fulfillTx)} href={result.summon.fulfillTx ? `${EXPLORER}/tx/${result.summon.fulfillTx}` : undefined} ok />
                <MetaRow k="Summon request" v={`#${result.summon.requestId}`} />
              </dl>
            </>
          ) : null}

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <ActionButton href={`/outputs/${id}`}>View the output -&gt;</ActionButton>
            <a
              href={`${EXPLORER}/token/${CONTRACTS.outputNFT}?a=${id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 font-mono-x text-[13px] transition-opacity hover:opacity-85"
              style={{ background: "transparent", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)" }}
            >
              On 0G Scan -&gt;
            </a>
          </div>
        </div>
      </Panel>
    </Reveal>
  );
}

function NotFoundPanel({ id }: { id: string }) {
  return (
    <Reveal>
      <Panel className="p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
          <span className="font-mono-x text-[16px]">?</span>
        </div>
        <h2 className="font-display mt-5" style={{ fontSize: "clamp(22px,3vw,30px)", lineHeight: 1.05 }}>
          No output #{id} on-chain.
        </h2>
        <p className="mx-auto mt-3 max-w-[42ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          Nothing with that token id has been minted on the 0G Galileo testnet. Double-check the id, or
          browse the gallery to find a verifiable piece.
        </p>
        <div className="mx-auto mt-6 max-w-[240px]">
          <ActionButton href="/explore" variant="outline">Browse the gallery -&gt;</ActionButton>
        </div>
      </Panel>
    </Reveal>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <Reveal>
      <Panel className="p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
          <span className="font-mono-x text-[16px]">!</span>
        </div>
        <h2 className="font-display mt-5" style={{ fontSize: "clamp(22px,3vw,30px)", lineHeight: 1.05 }}>
          Could not verify.
        </h2>
        <p className="mx-auto mt-3 max-w-[42ch] font-mono-x text-[12px] leading-relaxed" style={{ color: "var(--color-warn)" }}>
          {message}
        </p>
      </Panel>
    </Reveal>
  );
}

function ShieldIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden style={{ color: "var(--color-ink-2)" }}>
      <path d="M10 2.5 4 5v4.5c0 3.4 2.4 6.3 6 7.5 3.6-1.2 6-4.1 6-7.5V5l-6-2.5Z" strokeLinejoin="round" />
      <path d="m7.4 9.8 1.9 1.9 3.4-3.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
