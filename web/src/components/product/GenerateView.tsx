"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Reveal } from "@/components/Reveal";
import { ZeroG } from "@/components/atoms/ZeroG";
import {
  PageHeader,
  Panel,
  ProvLine,
  Chip,
  MetaRow,
  ActionButton,
  Field,
  TextArea,
  TextInput,
  StepRail,
  type StepStatus,
} from "@/components/product/primitives";
import { EXPLORER, CHAIN_FULL } from "@/lib/chains";
import { useMint } from "@/lib/useMint";
import {
  agentPortraitUrl,
  fetchJob,
  fetchJobImageObjectUrl,
  fetchMintArgs,
  shortHex,
  startGeneration,
  type Agent,
  type GenerateJob,
  type GenerateMode,
  type MintArgs,
} from "@/lib/api";

// The generate workflow. A two-column composition consistent with the detail pages: left = the agent +
// the params form + the live preview; right = a sticky flow panel (the StepRail + the current action).
// The flow is authed end-to-end (SIWE -> JWT). Phases:
//   pick/compose -> signin -> generating (poll) -> ready (preview) -> minting (wallet) -> minted.
type Flow =
  | "compose"
  | "signin"
  | "generating"
  | "ready"
  | "minting"
  | "minted"
  | "error";

const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 180_000;

// Map a backend JobStatus to a human progress line for the rail.
function jobLabel(status: GenerateJob["status"]): string {
  switch (status) {
    case "pending":
      return "Queued on the sponsor";
    case "generating":
      return "Painting on 0G Compute";
    case "verifying":
      return "Verifying the TEE attestation";
    case "storing":
      return "Sealing to 0G Storage";
    case "done":
      return "Generation complete";
    case "error":
      return "Generation failed";
    default:
      return status;
  }
}

export function GenerateView({ agents, preselectId }: { agents: Agent[]; preselectId: number | null }) {
  const { address, isConnected } = useAccount();
  const { state: mintState, busy: minting, mintOutput, reset: resetMint, auth } = useMint();

  const initialAgent = useMemo(
    () => agents.find((a) => a.agentId === preselectId) ?? agents[0] ?? null,
    [agents, preselectId],
  );
  const [agentId, setAgentId] = useState<number | null>(initialAgent?.agentId ?? null);
  const agent = useMemo(() => agents.find((a) => a.agentId === agentId) ?? null, [agents, agentId]);

  const [prompt, setPrompt] = useState("");
  // Generation mode (the compose toggle). Default "style" = Fresh subject (style-lock): the prompt becomes a
  // fresh scene rendered in this Aura's signature style. "identity" = Keep character (identity-lock): restyle
  // the Aura's OWN subject with the prompt (the prior behavior). Only this flips the server style/identity path.
  const [mode, setMode] = useState<GenerateMode>("style");
  const [flow, setFlow] = useState<Flow>("compose");

  const TOP_BADGES = 5;
  const [agentSearch, setAgentSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Keyboard cursor into the agent-search listbox (drives aria-activedescendant + Enter-to-pick).
  const [searchActive, setSearchActive] = useState(-1);
  const searchListId = useId();
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<GenerateJob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mintArgs, setMintArgs] = useState<MintArgs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  // revoke any object URL when it changes / on unmount (the preview is a blob URL).
  useEffect(() => {
    previewRef.current = previewUrl;
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, [previewUrl]);

  // Close the agent search dropdown on outside click.
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  const handlePickAgent = useCallback((id: number) => {
    setAgentId(id);
    setAgentSearch("");
    setSearchOpen(false);
    setSearchActive(-1);
  }, []);

  const topBadges = agents.slice(0, TOP_BADGES);
  const filteredForDropdown = agentSearch.trim()
    ? agents.filter((a) => a.name.toLowerCase().includes(agentSearch.toLowerCase().trim()))
    : agents;
  const showDropdown = searchOpen && filteredForDropdown.length > 0;

  // Arrow-key navigation for the search combobox: Down/Up move the cursor over the filtered options,
  // Enter picks the cursored Aura, Escape closes. Makes the listbox keyboard-operable (not mouse-only).
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setSearchOpen(false);
      setSearchActive(-1);
      return;
    }
    if (!showDropdown) {
      if (e.key === "ArrowDown") setSearchOpen(true);
      return;
    }
    const n = filteredForDropdown.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchActive((i) => (i + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchActive((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (searchActive >= 0 && searchActive < n) {
        e.preventDefault();
        handlePickAgent(filteredForDropdown[searchActive].agentId);
      }
    }
  };

  const accent = agent?.meta.accent ?? "#2a3858";
  const portrait = agent ? agentPortraitUrl(agent) : null;

  const validPrompt = prompt.trim().length >= 4;

  // The full generate flow: ensure SIWE -> start the job -> poll to done -> fetch the preview + mint-args.
  const onGenerate = useCallback(async () => {
    if (!agent || !validPrompt) return;
    setError(null);
    setMintArgs(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    try {
      // 1. SIWE (generation is sponsored but the backend is owner-scoped, so a sign-in is required).
      // signIn returns the fresh JWT directly (React state updates async, so re-reading auth.token here
      // would miss it).
      let token = auth.token;
      if (!token) {
        setFlow("signin");
        token = await auth.signIn();
      }
      if (!token) throw new Error("Sign-in did not complete. Try again.");

      // 2. kick off the generation.
      setFlow("generating");
      const { jobId: id } = await startGeneration(token, agent.agentId, prompt.trim(), mode);
      setJobId(id);

      // 3. poll until done|error.
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let finalJob: GenerateJob | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const j = await fetchJob(token, id);
        setJob(j);
        if (j.status === "done" || j.status === "error") {
          finalJob = j;
          break;
        }
      }
      if (!finalJob) throw new Error("Generation timed out. Check back from your dashboard.");
      if (finalJob.status === "error" || !finalJob.result) {
        throw new Error(finalJob.error ?? "Generation failed.");
      }

      // 4. preview (authed blob) + the mint args (attestor signature) in parallel.
      const [url, args] = await Promise.all([
        fetchJobImageObjectUrl(token, id),
        fetchMintArgs(token, id),
      ]);
      setPreviewUrl(url);
      setMintArgs(args);
      setFlow("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
      setFlow("error");
    }
  }, [agent, validPrompt, prompt, mode, auth, previewUrl]);

  // The on-chain mint step (wallet-signed). On success the StepRail shows minted + the link to the output.
  const onMint = useCallback(async () => {
    if (!mintArgs) return;
    setFlow("minting");
    const tokenId = await mintOutput(mintArgs);
    if (tokenId !== null) setFlow("minted");
    else setFlow("ready"); // mintState carries the error; let the user retry
  }, [mintArgs, mintOutput]);

  const onReset = useCallback(() => {
    resetMint();
    setError(null);
    setJob(null);
    setJobId(null);
    setMintArgs(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFlow("compose");
  }, [resetMint, previewUrl]);

  // Build the StepRail model from the current flow + job/mint state.
  const steps = useMemo<{ label: string; status: StepStatus }[]>(() => {
    const genActive = flow === "generating" || flow === "signin";
    const genDone = flow === "ready" || flow === "minting" || flow === "minted";
    const signDone = flow === "minted";
    const mintingNow = flow === "minting";
    return [
      {
        label: flow === "generating" && job ? jobLabel(job.status) : "Generate (sponsored)",
        status: genActive ? "active" : genDone ? "done" : flow === "error" ? "error" : "pending",
      },
      {
        label: "Attest + sign provenance",
        status: genDone ? "done" : "pending",
      },
      {
        label: mintingNow ? (mintState.step ?? "Minting on-chain") : "Sign mint (your wallet)",
        status: signDone ? "done" : mintingNow ? "active" : flow === "ready" ? "pending" : "pending",
      },
      {
        label: "Relic minted",
        status: signDone ? "done" : "pending",
      },
    ];
  }, [flow, job, mintState.step]);

  if (agents.length === 0) {
    return (
      <section className="px-5 py-16 sm:px-8">
        <div className="mx-auto w-full max-w-[var(--container-wrap)]">
          <PageHeader kicker="Generate" title="No Auras available yet." lede="The catalog is empty. Create an Aura first, then generate with it." />
          <div className="mt-8 max-w-[260px]">
            <ActionButton href="/create">Create an Aura -&gt;</ActionButton>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <PageHeader
            kicker="Generate"
            marker={agent ? `with ${agent.name}` : undefined}
            title={<>Make a verifiable Relic.</>}
            lede={
              <>
                Pick an Aura, describe the work, and it paints on <ZeroG /> Compute inside a TEE. The
                result is sealed to <ZeroG /> Storage with a provenance hash and an attestation, then you
                sign the mint. Generation is sponsored. You only pay gas to mint.
              </>
            }
          />
        </Reveal>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[1.35fr_1fr]">
          {/* Left: agent + compose + preview */}
          <div className="space-y-6">
            {/* Agent picker */}
            <Reveal>
              <Panel className="p-5">
                <div className="mb-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  The Aura
                </div>

                {/* Top-5 quick-select badges */}
                <div className="flex flex-wrap gap-2">
                  {topBadges.map((a) => {
                    const active = a.agentId === agentId;
                    return (
                      <button
                        key={a.agentId}
                        type="button"
                        disabled={flow === "generating" || flow === "minting"}
                        onClick={() => handlePickAgent(a.agentId)}
                        className="micro flex items-center gap-2 rounded-[12px] py-1.5 pl-1.5 pr-3.5 hover:-translate-y-px active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                        style={
                          active
                            ? { background: "var(--color-ink)", color: "var(--color-cream)", border: "1px solid var(--color-ink)" }
                            : { border: "1px solid var(--color-border-strong)", color: "var(--color-ink-2)", background: "var(--color-paper)" }
                        }
                      >
                        {/* decorative: the name is the adjacent visible label */}
                        <img src={agentPortraitUrl(a)} alt="" className="h-6 w-6 rounded-[7px] object-cover" />
                        <span className="text-[16px] font-semibold">{a.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Search + dropdown (all agents) */}
                <div ref={searchBoxRef} className="relative mt-3">
                  <div className="relative">
                    <svg
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                      width="13" height="13" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      style={{ color: "var(--color-ink-3)" }} aria-hidden
                    >
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Search all Auras..."
                      value={agentSearch}
                      disabled={flow === "generating" || flow === "minting"}
                      onChange={(e) => { setAgentSearch(e.target.value); setSearchOpen(true); setSearchActive(-1); }}
                      onFocus={() => setSearchOpen(true)}
                      onKeyDown={onSearchKeyDown}
                      className="w-full rounded-[14px] border border-[var(--color-border-strong)] py-2.5 pl-9 pr-4 font-medium text-[16px] outline-none transition-colors focus:border-[var(--color-accent)] disabled:opacity-50"
                      style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}
                      aria-label="Search Auras"
                      role="combobox"
                      aria-controls={showDropdown ? searchListId : undefined}
                      aria-expanded={showDropdown}
                      aria-autocomplete="list"
                      aria-activedescendant={showDropdown && searchActive >= 0 ? `${searchListId}-opt-${searchActive}` : undefined}
                    />
                  </div>
                  {showDropdown && (
                    <div
                      id={searchListId}
                      role="listbox"
                      aria-label="Aura list"
                      className="scroll-affordance absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-52 overflow-y-auto rounded-[16px] border shadow-[var(--shadow-doc)]"
                      style={{ background: "var(--color-paper)", borderColor: "var(--color-border-strong)" }}
                    >
                      {filteredForDropdown.length === 0 ? (
                        <p className="px-4 py-3 text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                          No Auras match
                        </p>
                      ) : (
                        filteredForDropdown.map((a, idx) => {
                          const active = a.agentId === agentId;
                          const cursored = idx === searchActive;
                          return (
                            <button
                              key={a.agentId}
                              id={`${searchListId}-opt-${idx}`}
                              role="option"
                              aria-selected={active}
                              type="button"
                              disabled={flow === "generating" || flow === "minting"}
                              onClick={() => handlePickAgent(a.agentId)}
                              onMouseEnter={() => setSearchActive(idx)}
                              className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors first:rounded-t-[16px] last:rounded-b-[16px] disabled:opacity-50 ${active ? "" : cursored ? "bg-[var(--color-cream-deep)]" : "hover:bg-[var(--color-cream-deep)]"}`}
                              style={active ? { background: "var(--color-cream-warm)" } : {}}
                            >
                              <img src={agentPortraitUrl(a)} alt="" className="h-6 w-6 rounded-full object-cover" />
                              <span className="font-mono-x text-[16px]" style={{ color: active ? "var(--color-accent)" : "var(--color-ink)" }}>
                                {a.name}
                              </span>
                              {active && (
                                <span className="ml-auto label-caps text-[13px] uppercase tracking-[0.08em]" style={{ color: "var(--color-accent)" }}>
                                  selected
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {agent ? (
                  <p className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                    {agent.meta.aesthetic}
                  </p>
                ) : null}
              </Panel>
            </Reveal>

            {/* Compose */}
            <Reveal delay={0.04}>
              <Panel className="p-5">
                <div className="mb-4 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  The prompt
                </div>

                {/* Mode toggle: Fresh subject (style-lock, default) vs Keep character (identity-lock). This is
                    the only client control that flips the server between its style-lock-only pull path (fresh
                    subject in the Aura's style) and its identity-lock path (restyle the Aura's own subject).
                    See startGeneration in lib/api.ts. */}
                <div className="mb-4">
                  <div
                    role="radiogroup"
                    aria-label="Generation mode"
                    className="grid grid-cols-2 gap-1 rounded-[14px] border p-1"
                    style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)" }}
                  >
                    {([
                      { key: "style", label: "Fresh subject" },
                      { key: "identity", label: "Keep character" },
                    ] as const).map((opt) => {
                      const active = mode === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={flow === "generating" || flow === "minting"}
                          onClick={() => setMode(opt.key)}
                          className="micro rounded-[10px] py-2 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                          style={
                            active
                              ? { background: "var(--color-ink)", color: "var(--color-cream)" }
                              : { background: "transparent", color: "var(--color-ink-2)" }
                          }
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2.5 space-y-1 text-[15px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                    <p>
                      <span className="font-semibold" style={{ color: "var(--color-ink-2)" }}>Fresh subject:</span>{" "}
                      your prompt becomes the scene, rendered in this Aura&apos;s style.
                    </p>
                    <p>
                      <span className="font-semibold" style={{ color: "var(--color-ink-2)" }}>Keep character:</span>{" "}
                      restyle this Aura&apos;s own subject with your prompt.
                    </p>
                  </div>
                </div>

                <Field label="Describe the work" hint={`${prompt.trim().length} chars`} required>
                  <TextArea
                    value={prompt}
                    onChange={setPrompt}
                    rows={4}
                    maxLength={600}
                    disabled={flow === "generating" || flow === "minting"}
                    placeholder={
                      agent
                        ? `e.g. a lone figure under a streetlamp in the rain, drifting smoke, in ${agent.name}'s style`
                        : "Describe the Relic you want"
                    }
                  />
                </Field>
                <p className="mt-3 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                  The Aura fuses your prompt with its sealed style DNA. The seed is chosen at generation
                  and committed on-chain, so the exact Relic is reproducible and provable.
                </p>
              </Panel>
            </Reveal>

            {/* Preview */}
            <Reveal delay={0.06}>
              <PreviewSurface
                accent={accent}
                portrait={portrait}
                flow={flow}
                job={job}
                previewUrl={previewUrl}
                agentName={agent?.name ?? ""}
              />
            </Reveal>
          </div>

          {/* Right: sticky flow panel */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <Reveal delay={0.05}>
              <div className="rounded-[22px] border p-6" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-cream-warm)" }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                    The flow
                  </span>
                  <Chip tone="accent">attestation-gated</Chip>
                </div>

                <div className="mt-5">
                  <StepRail steps={steps} />
                </div>

                <ProvLine className="my-5" />

                {/* The action zone changes by phase + connection */}
                {!isConnected ? (
                  <div className="space-y-3">
                    <p className="text-[16px]" style={{ color: "var(--color-ink-2)" }}>
                      Connect a wallet on the {CHAIN_FULL}. You sign in once (SIWE) to generate, and
                      sign again only to mint.
                    </p>
                    <ConnectButton.Custom>
                      {({ openConnectModal }) => <ActionButton onClick={openConnectModal}>Connect wallet</ActionButton>}
                    </ConnectButton.Custom>
                  </div>
                ) : flow === "compose" || flow === "signin" || flow === "error" ? (
                  <div className="space-y-3">
                    <ActionButton onClick={onGenerate} disabled={!agent || !validPrompt || flow === "signin"}>
                      {flow === "signin" ? "Sign in to AURA..." : "Generate"}
                    </ActionButton>
                    {!validPrompt ? (
                      <p className="text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                        Write at least a few words to begin.
                      </p>
                    ) : null}
                    {flow === "error" && error ? (
                      <div role="alert" className="rounded-xl border p-3 font-mono-x text-[16px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
                        {error}
                      </div>
                    ) : null}
                  </div>
                ) : flow === "generating" ? (
                  <div role="status" aria-busy="true" className="rounded-xl border p-3 font-mono-x text-[16px]" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}>
                    {job ? jobLabel(job.status) : "Starting the sponsor job"}
                    {job?.progress ? <span className="ml-1" style={{ color: "var(--color-ink-3)" }}>· {job.progress}</span> : null}
                  </div>
                ) : flow === "ready" || flow === "minting" ? (
                  <div className="space-y-3">
                    {job?.result ? (
                      <dl>
                        <MetaRow k="TEE attestation" v={shortHex(job.result.teeAttestation)} ok />
                        <MetaRow k="Model" v={job.result.model} mono={false} />
                        <MetaRow k="Verifiability" v={job.result.verifiability} mono={false} />
                        <MetaRow k="0G storage root" v={shortHex(job.result.imageRoot)} />
                        <MetaRow k="Seed" v={String(job.result.seed)} />
                      </dl>
                    ) : null}
                    <ActionButton onClick={onMint} disabled={minting || !mintArgs}>
                      {minting ? (mintState.step ?? "Minting...") : "Sign mint in your wallet"}
                    </ActionButton>
                    <p className="text-center text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                      Minting is an on-chain transaction and cannot be undone. It costs a little <ZeroG /> for gas.{" "}
                      <Link href="/faucet" className="underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
                        Need some? Faucet -&gt;
                      </Link>
                    </p>
                    <button type="button" onClick={onReset} className="w-full text-center font-semibold text-[16px] underline underline-offset-4" style={{ color: "var(--color-ink-3)" }}>
                      Discard and start over
                    </button>
                    {mintState.phase === "error" && mintState.error ? (
                      <div role="alert" className="rounded-xl border p-3 font-mono-x text-[16px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
                        {mintState.error}
                      </div>
                    ) : null}
                  </div>
                ) : flow === "minted" ? (
                  <div className="space-y-3">
                    <div role="status" className="rounded-xl border p-4" style={{ borderColor: "color-mix(in oklab, var(--color-ok) 40%, transparent)" }}>
                      <div className="font-mono-x text-[16px]" style={{ color: "var(--color-ok)" }}>
                        Minted on-chain ✓
                      </div>
                      {mintState.txHash ? (
                        <a href={`${EXPLORER}/tx/${mintState.txHash}`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-[16px] underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
                          {shortHex(mintState.txHash)} on 0G Scan
                        </a>
                      ) : null}
                    </div>
                    {mintState.mintedId !== null ? (
                      <ActionButton href={`/outputs/${mintState.mintedId}`}>
                        View relic #{mintState.mintedId} -&gt;
                      </ActionButton>
                    ) : null}
                    <button type="button" onClick={onReset} className="w-full text-center font-semibold text-[16px] underline underline-offset-4" style={{ color: "var(--color-ink-3)" }}>
                      Generate another
                    </button>
                  </div>
                ) : null}

                <p className="mt-5 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                  The attestation is an EIP-712 signature from the TEE attestor. The contract reverts
                  unless it recovers that signer, so a forged or replayed mint is impossible.
                </p>
              </div>
            </Reveal>

            {agent ? (
              <Reveal delay={0.1}>
                <Link href={`/agents/${agent.agentId}`} className="mt-4 flex items-center justify-between rounded-[18px] border p-3 transition-shadow hover:shadow-[var(--shadow-card)]" style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}>
                  <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                    Relic royalty {agent.royaltyPct}% · follows the Aura
                  </span>
                  <span className="font-mono-x text-[16px]" style={{ color: "var(--color-accent)" }}>
                    {agent.name} -&gt;
                  </span>
                </Link>
              </Reveal>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

// The preview surface: the agent portrait as a calm placeholder before/while generating, the real blob
// once ready. A thin status caption keeps the user oriented during the (multi-second) generation.
function PreviewSurface({
  accent,
  portrait,
  flow,
  job,
  previewUrl,
  agentName,
}: {
  accent: string;
  portrait: string | null;
  flow: Flow;
  job: GenerateJob | null;
  previewUrl: string | null;
  agentName: string;
}) {
  const generating = flow === "generating" || flow === "signin";
  return (
    <div className="overflow-hidden rounded-[24px] border" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 8%, var(--color-paper))` }}>
      <div className="relative aspect-[4/3] w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Generated preview" className="h-full w-full object-cover" />
        ) : portrait ? (
          <img src={portrait} alt={`${agentName} reference`} className={`h-full w-full object-cover transition-all duration-700 ${generating ? "scale-[1.03] opacity-40" : "opacity-25"}`} />
        ) : null}

        {/* generating shimmer + caption */}
        {generating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="aura-skeleton h-full w-full" style={{ position: "absolute", inset: 0 }} />
            <div className="relative z-10 flex flex-col items-center gap-2">
              <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-2)" }}>
                {job ? jobLabel(job.status) : "Starting"}
              </span>
            </div>
          </div>
        ) : null}

        {previewUrl ? (
          <span className="absolute left-4 top-4"><Chip tone="ok">TEE-attested</Chip></span>
        ) : null}
      </div>
      <div className="flex items-center justify-between px-4 py-3 font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
        <span>{previewUrl ? "Generated preview" : generating ? "Painting in a trusted enclave" : "Preview appears here"}</span>
        {job?.result?.latencyMs ? <span>{(job.result.latencyMs / 1000).toFixed(1)}s</span> : null}
      </div>
    </div>
  );
}
