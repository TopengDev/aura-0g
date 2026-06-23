"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { EXPLORER } from "@/lib/chains";
import { useMint } from "@/lib/useMint";
import {
  confirmAgentMint,
  createAgentDraft,
  shortHex,
  type CreateAgentArgs,
} from "@/lib/api";

// The create-agent workflow. Left = the form (reference image + identity + style + royalties); right =
// a sticky flow panel (StepRail + the action). The flow is authed end-to-end (SIWE -> JWT). Phases:
//   compose -> signin -> building (server stores + encrypts + attests) -> ready (mintAgent args) ->
//   minting (wallet) -> confirming (promote brain) -> minted.
type Flow = "compose" | "signin" | "building" | "ready" | "minting" | "confirming" | "minted" | "error";

// Royalty caps mirror the contract requires (royaltyBps <= 2000, creatorResaleBps <= 2000 = 20%).
const MAX_PCT = 20;
// Image bounds mirror the backend validate() (384..3072px each side, PNG/JPEG, <=12MB).
const MIN_PX = 384;
const MAX_PX = 3072;
const MAX_BYTES = 12 * 1024 * 1024;

export function CreateView() {
  const { address, isConnected } = useAccount();
  const { state: mintState, busy: minting, mintAgent, reset: resetMint, auth } = useMint();

  const [name, setName] = useState("");
  const [styleDescriptor, setStyleDescriptor] = useState("");
  const [signatureCharacter, setSignatureCharacter] = useState("");
  const [identityLock, setIdentityLock] = useState("");
  const [negative, setNegative] = useState("");
  const [royaltyPct, setRoyaltyPct] = useState("7");
  const [resalePct, setResalePct] = useState("10");

  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const imageUrlRef = useRef<string | null>(null);

  const [flow, setFlow] = useState<Flow>("compose");
  const [draft, setDraft] = useState<CreateAgentArgs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mintedId, setMintedId] = useState<number | null>(null);

  useEffect(() => {
    imageUrlRef.current = imageUrl;
    return () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    };
  }, [imageUrl]);

  // Validate + accept a reference image (dimensions checked client-side to mirror the backend so the
  // user gets instant feedback instead of a round-trip 400).
  const onPickImage = useCallback(
    (file: File | null) => {
      setImageError(null);
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
        setImageUrl(null);
      }
      setImage(null);
      if (!file) return;
      if (!/image\/(png|jpe?g)/.test(file.type)) {
        setImageError("Use a PNG or JPEG.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setImageError("Image must be 12MB or smaller.");
        return;
      }
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = probe;
        if (w < MIN_PX || h < MIN_PX || w > MAX_PX || h > MAX_PX) {
          setImageError(`Image must be ${MIN_PX} to ${MAX_PX}px on each side (got ${w}x${h}).`);
          URL.revokeObjectURL(url);
          return;
        }
        setImage(file);
        setImageUrl(url);
      };
      probe.onerror = () => {
        setImageError("Could not read that image.");
        URL.revokeObjectURL(url);
      };
      probe.src = url;
    },
    [imageUrl],
  );

  const royaltyBps = Math.round(Number(royaltyPct) * 100);
  const creatorResaleBps = Math.round(Number(resalePct) * 100);

  const validPct = (v: string) => /^\d*\.?\d*$/.test(v) && Number(v) >= 0 && Number(v) <= MAX_PCT;
  const formValid =
    name.trim().length >= 2 &&
    name.trim().length <= 48 &&
    styleDescriptor.trim().length >= 8 &&
    !!image &&
    validPct(royaltyPct) &&
    validPct(resalePct);

  // Build the draft on the server (store + encrypt + attest), getting back the mintAgent args.
  const onBuild = useCallback(async () => {
    if (!formValid || !image) return;
    setError(null);
    setDraft(null);
    try {
      let token = auth.token;
      if (!token) {
        setFlow("signin");
        token = await auth.signIn();
      }
      if (!token) throw new Error("Sign-in did not complete. Try again.");

      setFlow("building");
      const args = await createAgentDraft(token, image, {
        name: name.trim(),
        royaltyBps,
        creatorResaleBps,
        styleDescriptor: styleDescriptor.trim(),
        identityLock: identityLock.trim() || undefined,
        negative: negative.trim() || undefined,
        signatureCharacter: signatureCharacter.trim() || undefined,
      });
      setDraft(args);
      setFlow("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the agent.");
      setFlow("error");
    }
  }, [formValid, image, auth, name, royaltyBps, creatorResaleBps, styleDescriptor, identityLock, negative, signatureCharacter]);

  // Wallet-sign mintAgent, then promote the staged brain key to the new agentId.
  const onMint = useCallback(async () => {
    if (!draft) return;
    setFlow("minting");
    const id = await mintAgent(draft);
    if (id === null) {
      setFlow("ready");
      return;
    }
    setMintedId(id);
    // promote the brain (best-effort: the agent is already minted; a failed promote only means the
    // generalized generator falls back to the catalog brain until retried).
    setFlow("confirming");
    try {
      const token = auth.token;
      if (token) await confirmAgentMint(token, draft.encBrainRoot, id);
    } catch {
      // non-fatal; surface nothing blocking. The agent exists on-chain regardless.
    }
    setFlow("minted");
  }, [draft, mintAgent, auth]);

  const onReset = useCallback(() => {
    resetMint();
    setError(null);
    setDraft(null);
    setMintedId(null);
    setFlow("compose");
  }, [resetMint]);

  const steps = useMemo<{ label: string; status: StepStatus }[]>(() => {
    const building = flow === "building" || flow === "signin";
    const built = flow === "ready" || flow === "minting" || flow === "confirming" || flow === "minted";
    const mintingNow = flow === "minting";
    const confirming = flow === "confirming";
    const done = flow === "minted";
    return [
      {
        label: building ? "Sealing brain + style to 0G" : "Build identity (sponsored)",
        status: building ? "active" : built ? "done" : flow === "error" ? "error" : "pending",
      },
      { label: "Derive style DNA + attestation", status: built ? "done" : "pending" },
      {
        label: mintingNow ? (mintState.step ?? "Registering on-chain") : "Sign mint (your wallet)",
        status: done || confirming ? "done" : mintingNow ? "active" : "pending",
      },
      {
        label: confirming ? "Activating the agent brain" : "Agent live",
        status: done ? "done" : confirming ? "active" : "pending",
      },
    ];
  }, [flow, mintState.step]);

  return (
    <section className="relative px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <PageHeader
            kicker="Create"
            marker="new agent iNFT"
            title={<>Mint a creative agent.</>}
            lede={
              <>
                Give it a reference image and a style, and AURA seals an encrypted brain to <ZeroG />{" "}
                Storage, derives a provable style-DNA fingerprint, and attests the model from a live TEE.
                You sign the mint and own the agent, its style, and every royalty it earns.
              </>
            }
          />
        </Reveal>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[1.35fr_1fr]">
          {/* Left: the form */}
          <div className="space-y-6">
            {/* Reference image */}
            <Reveal>
              <Panel className="p-5">
                <div className="mb-3 font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Reference image
                </div>
                <ImageDrop imageUrl={imageUrl} onPick={onPickImage} disabled={flow === "building" || flow === "minting"} />
                {imageError ? (
                  <p className="mt-2 font-mono-x text-[11px]" style={{ color: "var(--color-warn)" }}>{imageError}</p>
                ) : (
                  <p className="mt-2 font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                    PNG or JPEG, {MIN_PX} to {MAX_PX}px each side. This becomes the agent&apos;s determinism anchor.
                  </p>
                )}
              </Panel>
            </Reveal>

            {/* Identity */}
            <Reveal delay={0.04}>
              <Panel className="p-5 space-y-4">
                <div className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Identity
                </div>
                <Field label="Agent name" hint={`${name.trim().length}/48`}>
                  <TextInput value={name} onChange={setName} maxLength={48} placeholder="e.g. NOCTILUCA" disabled={flow === "building" || flow === "minting"} />
                </Field>
                <Field label="Style descriptor" hint={`${styleDescriptor.trim().length} chars, min 8`}>
                  <TextArea value={styleDescriptor} onChange={setStyleDescriptor} rows={3} maxLength={500} placeholder="Describe the agent's aesthetic: palette, light, texture, mood, subject." disabled={flow === "building" || flow === "minting"} />
                </Field>
                <Field label="Signature character (optional)">
                  <TextInput value={signatureCharacter} onChange={setSignatureCharacter} maxLength={120} placeholder="A recurring subject or motif, if any" disabled={flow === "building" || flow === "minting"} />
                </Field>
              </Panel>
            </Reveal>

            {/* Direction (advanced, optional) */}
            <Reveal delay={0.05}>
              <Panel className="p-5 space-y-4">
                <div className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Direction <span style={{ color: "var(--color-ink-3)", opacity: 0.7 }}>· optional</span>
                </div>
                <Field label="Identity lock">
                  <TextArea value={identityLock} onChange={setIdentityLock} rows={2} maxLength={300} placeholder="What must stay constant across generations (defaults to keeping the reference subject)." disabled={flow === "building" || flow === "minting"} />
                </Field>
                <Field label="Negative prompt">
                  <TextInput value={negative} onChange={setNegative} maxLength={200} placeholder="What to avoid (artifacts, watermarks, ...)" disabled={flow === "building" || flow === "minting"} />
                </Field>
              </Panel>
            </Reveal>

            {/* Royalties */}
            <Reveal delay={0.06}>
              <Panel className="p-5">
                <div className="mb-4 font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Royalties
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Output royalty %" hint="max 20%">
                    <TextInput value={royaltyPct} onChange={setRoyaltyPct} inputMode="decimal" type="text" placeholder="7" disabled={flow === "building" || flow === "minting"} />
                  </Field>
                  <Field label="Agent resale royalty %" hint="max 20%">
                    <TextInput value={resalePct} onChange={setResalePct} inputMode="decimal" type="text" placeholder="10" disabled={flow === "building" || flow === "minting"} />
                  </Field>
                </div>
                <p className="mt-3 font-mono-x text-[11px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                  Output royalty routes to whoever owns this agent on every sale of its work. Agent resale
                  royalty pays you, the original creator, each time the agent itself is resold.
                </p>
                {(!validPct(royaltyPct) || !validPct(resalePct)) ? (
                  <p className="mt-2 font-mono-x text-[11px]" style={{ color: "var(--color-warn)" }}>
                    Each royalty must be between 0 and 20%.
                  </p>
                ) : null}
              </Panel>
            </Reveal>
          </div>

          {/* Right: sticky flow */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <Reveal delay={0.05}>
              <div className="rounded-[22px] border p-6" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-cream-warm)" }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                    Mint flow
                  </span>
                  <Chip tone="accent">permissionless</Chip>
                </div>

                <div className="mt-5">
                  <StepRail steps={steps} />
                </div>

                <ProvLine className="my-5" />

                {!isConnected ? (
                  <div className="space-y-3">
                    <p className="text-[13px]" style={{ color: "var(--color-ink-2)" }}>
                      Connect a wallet on the 0G Galileo testnet. You sign in once (SIWE) to build, and
                      sign again to mint the agent.
                    </p>
                    <ConnectButton.Custom>
                      {({ openConnectModal }) => <ActionButton onClick={openConnectModal}>Connect wallet</ActionButton>}
                    </ConnectButton.Custom>
                  </div>
                ) : flow === "compose" || flow === "signin" || flow === "error" ? (
                  <div className="space-y-3">
                    <ActionButton onClick={onBuild} disabled={!formValid || flow === "signin"}>
                      {flow === "signin" ? "Sign in to AURA..." : "Build the agent"}
                    </ActionButton>
                    {!formValid ? (
                      <p className="font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                        Add a reference image, a name, and a style descriptor to begin.
                      </p>
                    ) : null}
                    {flow === "error" && error ? (
                      <div className="rounded-xl border p-3 font-mono-x text-[12px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
                        {error}
                      </div>
                    ) : null}
                  </div>
                ) : flow === "building" ? (
                  <div className="rounded-xl border p-3 font-mono-x text-[12px]" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}>
                    Storing to 0G, encrypting the brain, deriving the attestation. This takes a few seconds.
                  </div>
                ) : flow === "ready" || flow === "minting" || flow === "confirming" ? (
                  <div className="space-y-3">
                    {draft ? (
                      <dl>
                        <MetaRow k="Style DNA fingerprint" v={shortHex(draft.styleFingerprint)} />
                        <MetaRow k="Model attestation" v={shortHex(draft.modelAttestation)} ok />
                        <MetaRow k="Encrypted brain root" v={shortHex(draft.encBrainRoot)} />
                        <MetaRow k="Output royalty" v={`${(draft.royaltyBps / 100).toFixed(2)}%`} />
                        <MetaRow k="Creator resale" v={`${(draft.creatorResaleBps / 100).toFixed(2)}%`} />
                      </dl>
                    ) : null}
                    {flow === "confirming" ? (
                      <div className="rounded-xl border p-3 font-mono-x text-[12px]" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}>
                        Activating the agent brain
                      </div>
                    ) : (
                      <ActionButton onClick={onMint} disabled={minting || !draft}>
                        {minting ? (mintState.step ?? "Minting...") : "Sign mint in your wallet"}
                      </ActionButton>
                    )}
                    <button type="button" onClick={onReset} className="w-full text-center font-mono-x text-[11px] underline underline-offset-4" style={{ color: "var(--color-ink-3)" }}>
                      Discard and start over
                    </button>
                    {mintState.phase === "error" && mintState.error ? (
                      <div className="rounded-xl border p-3 font-mono-x text-[12px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
                        {mintState.error}
                      </div>
                    ) : null}
                  </div>
                ) : flow === "minted" ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border p-4" style={{ borderColor: "color-mix(in oklab, var(--color-ok) 40%, transparent)" }}>
                      <div className="font-mono-x text-[12px]" style={{ color: "var(--color-ok)" }}>
                        Agent registered on-chain ✓
                      </div>
                      {mintState.txHash ? (
                        <a href={`${EXPLORER}/tx/${mintState.txHash}`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono-x text-[11px] underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
                          {shortHex(mintState.txHash)} on 0G Scan
                        </a>
                      ) : null}
                    </div>
                    {mintedId !== null ? (
                      <>
                        <ActionButton href={`/agents/${mintedId}`}>View agent #{mintedId} -&gt;</ActionButton>
                        <ActionButton href={`/generate?agent=${mintedId}`} variant="outline">Generate with it -&gt;</ActionButton>
                      </>
                    ) : null}
                    <button type="button" onClick={onReset} className="w-full text-center font-mono-x text-[11px] underline underline-offset-4" style={{ color: "var(--color-ink-3)" }}>
                      Create another
                    </button>
                  </div>
                ) : null}

                <p className="mt-5 font-mono-x text-[11px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                  The style fingerprint is a keccak hash of the canonical public style. It is committed
                  on-chain at mint, so the agent&apos;s identity is provable and cannot drift silently.
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

// The reference-image drop/select control. Shows the chosen image, or a calm dashed dropzone.
function ImageDrop({
  imageUrl,
  onPick,
  disabled,
}: {
  imageUrl: string | null;
  onPick: (f: File | null) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        onPick(e.dataTransfer.files?.[0] ?? null);
      }}
      className="relative overflow-hidden rounded-[16px] border-2 border-dashed transition-colors"
      style={{ borderColor: over ? "var(--color-accent)" : "var(--color-border-strong)", background: "var(--color-paper)" }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        disabled={disabled}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {imageUrl ? (
        <div className="relative aspect-[4/3] w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Reference" className="h-full w-full object-cover" />
          {!disabled ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="absolute bottom-3 right-3 rounded-full px-3 py-1.5 font-mono-x text-[11px]"
              style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}
            >
              Replace
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 disabled:cursor-not-allowed"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-ink-3)" }} aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 16l5-5 4 4 3-3 6 6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="8.5" cy="8.5" r="1.5" />
          </svg>
          <span className="font-mono-x text-[12px]" style={{ color: "var(--color-ink-2)" }}>Drop an image or click to choose</span>
        </button>
      )}
    </div>
  );
}
