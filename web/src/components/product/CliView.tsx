"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { PageHeader, Panel, ProvLine, Chip, ActionButton } from "@/components/product/primitives";

// /cli - the docs + showcase surface for the AURA CLI. Authored in the existing Technical Editorial
// system (PageHeader / Panel / ProvLine / Chip / ActionButton + the warm token palette + the prov-rule
// motif). It documents the live, single-binary CLI - the composable, scriptable surface for AURA - with
// the install one-liner front and center, the seven commands, and the trustless `aura verify` recompute as
// the highlight. All content is drawn verbatim from cli/README.md + cli/CLI-REPORT.md (nothing invented).

const INSTALL = "curl -fsSL https://aura.topengdev.com/install.sh | sh";
const INSTALL_WIN = "irm https://aura.topengdev.com/install.ps1 | iex";
const INSTALL_NPX = "npx @aura/cli verify 23";

type Command = {
  signature: string;
  example: string;
  blurb: string;
  returns: string;
};

// The seven commands, exactly as documented in cli/README.md + cli/CLI-REPORT.md. `returns` is the real
// per-command response shape from the report's endpoint table - we show what each command yields rather
// than fabricating sample output (the one real captured transcript is reserved for `verify` below).
const COMMANDS: Command[] = [
  {
    signature: "aura agents",
    example: "aura agents",
    blurb: "List every Aura (creative agent).",
    returns: "All Auras: id, name, style, royalty, relic count, tagline.",
  },
  {
    signature: "aura explore [n]",
    example: "aura explore 5",
    blurb: "List the n most recent Relics with rarity (default 15).",
    returns: "Recent Relics, rarity-tinted (Common gray, Rare cyan, Epic magenta, Legendary gold).",
  },
  {
    signature: "aura aura <name|id>",
    example: "aura aura nokturne",
    blurb: "Inspect an Aura - lore, style, royalty, relic count.",
    returns: "Lore, aesthetic, signature, model, royalty.",
  },
  {
    signature: "aura relic <id>",
    example: "aura relic 23",
    blurb: "Inspect a Relic - image, owner, on-chain provenance.",
    returns: "Image URL, owner, seed, provenance, TEE attestation.",
  },
  {
    signature: "aura verify <id>",
    example: "aura verify 23",
    blurb: "Recompute a Relic's rarity + subject from the on-chain seed, locally (trustless).",
    returns: "A local, byte-exact recompute of the seed, rarity, and subject - no API trust. The money command.",
  },
  {
    signature: "aura summon <name|id>",
    example: "aura summon nokturne",
    blurb: "Explain + watch a summon (--watch <requestId> to follow one).",
    returns: "Explains the escrow tx + watches a summon through to mint.",
  },
  {
    signature: 'aura chat <name|id> "<msg>"',
    example: 'aura chat nokturne "what have you earned?"',
    blurb: "Talk to an Aura - in-character, grounded in its on-chain identity, TEE-attested when 0G serves it.",
    returns: "A reply (TEE-attested when 0G serves it) plus any guarded tool action. Signs in with AURA_KEY (off-chain SIWE); --health needs no key.",
  },
];

// The real captured `aura verify 23` transcript, verbatim from cli/CLI-REPORT.md (the live RARE pull).
const VERIFY_TRANSCRIPT = `Verify Relic #23   Rare ◆
  Recomputed locally by this CLI (keyless recompute - re-derived from the on-chain preimage the API relays)
  ✔ seed recomputes from public preimage  (seedRoot == on-chain seed)
  ✔ seed is a real provable-pull seed  (>= 2^64 keccak root)
  ✔ PROVABLE: rig-evident, recompute it yourself

   rarity  Rare ◆  roll 8054 / 9999
  subject  tiger hermit as frost mechanical form, casting cradling something, in a salt-flat
           at dawn during an eclipse ...

  Public on-chain preimage (fetched - on-chain values relayed by the API)
    requestId  4
        buyer  0x6072C05AdD8Eb43f5aE7Dc7817889ab8AE64d8Fa
      agentId  20
    blockHash  0x2aa222b94b8864e990ea296703aaec86ad8e58f9ec9bafb6135d617e3c4b4e70
  onChainSeed  106543224641626748915671244648347594258244032279370252980128457404203602199003
   recomputed  106543224641626748915671244648347594258244032279370252980128457404203602199003   (== match)`;

const VERIFY_JSON = `aura verify 23 --json | jq .recomputedLocally.provable   # => true`;

export function CliView() {
  return (
    <section className="relative px-5 py-16 sm:px-8 sm:py-20">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        {/* Hero */}
        <Reveal>
          <PageHeader
            kicker="AURA CLI"
            marker="composable surface"
            title={
              <>
                Prove any pull
                <br />
                from your terminal.
              </>
            }
            lede={
              <>
                The AURA CLI is the composable, scriptable surface for AURA - the same actions as the app,
                driven from any terminal or script. A single static binary, no runtime to install. The
                headline is <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>aura verify</code>:
                it recomputes a Relic&rsquo;s rarity and subject from the on-chain seed locally, so a gacha
                pull is rig-evident: you recompute the result yourself, no trust in our API.
              </>
            }
          >
            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <Chip tone="accent">single static binary</Chip>
              <Chip>no runtime dependency</Chip>
              <Chip>macOS · Linux · Windows</Chip>
              <Chip>scriptable (--json)</Chip>
            </div>
          </PageHeader>
        </Reveal>

        {/* Install - the headline */}
        <Reveal delay={0.04}>
          <div className="mt-16 sm:mt-20">
            <SectionLabel marker="01">Install</SectionLabel>
            <h2 className="font-display mt-4" style={{ fontSize: "clamp(28px,4vw,44px)", lineHeight: 1.02, letterSpacing: "-0.01em" }}>
              One line. Any shell.
            </h2>
            <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed sm:text-[16px]" style={{ color: "var(--color-ink-2)" }}>
              macOS and Linux, any shell. A single static binary, no Node needed. The installer detects your
              OS and arch, verifies the checksum, and places <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>aura</code> on your PATH.
            </p>

            <div className="mt-7 grid grid-cols-1 gap-5 lg:grid-cols-[1.25fr_0.75fr]">
              <Panel className="min-w-0 p-6 sm:p-7">
                <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  macOS / Linux
                </div>
                <div className="mt-3">
                  <CommandLine command={INSTALL} />
                </div>

                <div className="mt-6 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Windows (PowerShell)
                </div>
                <div className="mt-3">
                  <CommandLine command={INSTALL_WIN} />
                </div>

                <div className="mt-6 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Anywhere with Node (no install)
                </div>
                <div className="mt-3">
                  <CommandLine command={INSTALL_NPX} />
                </div>
              </Panel>

              <Panel className="min-w-0 p-6 sm:p-7" style={{ background: "var(--color-cream-warm)" }}>
                <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Per-OS notes
                </div>
                <ul className="mt-4 space-y-3.5">
                  <PlatformNote os="macOS" detail="x64 + arm64 (Apple silicon). Single static binary." />
                  <PlatformNote os="Linux" detail="x64 + arm64. Single static binary, no Node runtime." />
                  <PlatformNote os="Windows" detail="x64 binary via PowerShell. arm64 runs under x64 emulation." />
                  <PlatformNote os="npx" detail="Node 18+ fallback. Runs the node bundle, no install." />
                </ul>
                <p className="mt-5 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
                  Binaries embed the runtime, so there is zero dependency to install. Hosting and download use
                  a gzip artifact (about a third the size); the installer gunzips after a checksum check.
                </p>
              </Panel>
            </div>
          </div>
        </Reveal>

        {/* Commands */}
        <Reveal delay={0.04}>
          <div className="mt-16 sm:mt-20">
            <SectionLabel marker="02">Commands</SectionLabel>
            <h2 className="font-display mt-4" style={{ fontSize: "clamp(28px,4vw,44px)", lineHeight: 1.02, letterSpacing: "-0.01em" }}>
              Seven commands.
            </h2>
            <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed sm:text-[16px]" style={{ color: "var(--color-ink-2)" }}>
              The same actions as the AURA app - browse, verify a pull, summon, and chat with an Aura - driven from a
              terminal. Output is rarity-tinted, respects{" "}
              <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>NO_COLOR</code> and non-TTY pipes,
              and every command supports scripting.
            </p>

            <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-2">
              {COMMANDS.map((c) => (
                <CommandCard key={c.signature} command={c} />
              ))}
            </div>
          </div>
        </Reveal>

        {/* The money demo: aura verify */}
        <Reveal delay={0.04}>
          <div className="mt-16 sm:mt-20">
            <SectionLabel marker="03">The proof</SectionLabel>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-display" style={{ fontSize: "clamp(28px,4vw,44px)", lineHeight: 1.02, letterSpacing: "-0.01em" }}>
                <code className="font-mono-x" style={{ fontSize: "0.82em" }}>aura verify</code> proves the pull.
              </h2>
              <Chip tone="ok">trustless · local</Chip>
            </div>
            <p className="mt-4 max-w-[68ch] text-[16px] leading-relaxed sm:text-[16px]" style={{ color: "var(--color-ink-2)" }}>
              <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>verify</code> does not trust the
              API&rsquo;s rarity verdict. It fetches the on-chain economic proof and the public preimage, then{" "}
              <strong style={{ color: "var(--color-ink)" }}>recomputes the seed locally</strong> -{" "}
              <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>seedRoot = keccak256(abi.encode(DOMAIN_PULL, requestId, buyer, agentId, summonBlockHash))</code>,
              byte-for-byte the same derivation the contract anchors - asserts it equals the committed on-chain
              seed, then derives the rarity and the 12-dimension subject from that seed. What it recomputed
              locally is labeled separately from what it fetched. The recompute is a verbatim copy of the server
              gacha derivation, so there is zero drift between server, web verifier, and CLI.
            </p>

            {/* Single column: the terminal runs full-width on top (the 78-digit onChainSeed line scrolls
                INSIDE it via the pre's overflow-x-auto), then the supporting panels sit in a row below. */}
            <div className="mt-7 flex flex-col gap-5">
              <div className="min-w-0">
                <div className="mb-3">
                  <CommandLine command="aura verify 23" />
                </div>
                <TerminalBlock text={VERIFY_TRANSCRIPT} caption="aura verify 23 · live API · the RARE pull" />
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
                <Panel className="p-6 sm:p-7">
                  <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                    What it asserts
                  </div>
                  <ul className="mt-4 space-y-3">
                    <VerifyCheck>The seed recomputes from the public preimage (<code className="font-mono-x">seedRoot == on-chain seed</code>).</VerifyCheck>
                    <VerifyCheck>The seed is a real provable-pull seed (a keccak root, not a low number).</VerifyCheck>
                    <VerifyCheck>RIG-EVIDENT: rarity and subject re-derived locally, so a substituted result would not match.</VerifyCheck>
                  </ul>
                  <p className="mt-5 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                    Confirmed three ways: from source, from the compiled binary, and from the node bundle. The
                    locally recomputed seed is byte-exact equal to the on-chain seed; the derived rarity is{" "}
                    <strong style={{ color: "var(--color-ink)" }}>Rare</strong>, roll{" "}
                    <strong style={{ color: "var(--color-ink)" }}>8054</strong> - exactly the on-chain pull.
                  </p>
                </Panel>

                <Panel className="flex flex-col p-6 sm:p-7" style={{ background: "var(--color-cream-warm)" }}>
                  <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                    Script it
                  </div>
                  <p className="mt-3 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                    Every command speaks JSON. Pipe the proof straight into a CI check or a wallet flow.
                  </p>
                  <div className="mt-4">
                    <CommandLine command={VERIFY_JSON} />
                  </div>
                </Panel>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Trust boundary - honest */}
        <Reveal delay={0.04}>
          <div className="mt-16 sm:mt-20">
            <SectionLabel marker="04">Trust boundary</SectionLabel>
            <Panel className="mt-5 p-6 sm:p-8">
              <div className="flex items-center gap-3">
                <h2 className="font-display" style={{ fontSize: "clamp(22px,3vw,32px)", lineHeight: 1.05 }}>
                  Honest about the one assumption.
                </h2>
              </div>
              <ProvLine className="my-6" />
              <p className="max-w-[74ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                The preimage fields and <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>onChainSeed</code> are
                public, immutable on-chain values that the API merely relays; the CLI re-derives the seed,
                rarity, and subject from them itself. The one remaining trust assumption is that the API reported
                those on-chain values faithfully. A fully paranoid verifier would read{" "}
                <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>onChainSeed</code> (from{" "}
                <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>OutputNFT.provenanceOf</code>) and the
                block hash (from the <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>Summoned</code> event)
                directly from a 0G RPC. That direct-RPC cross-check is a clean future{" "}
                <code className="font-mono-x" style={{ color: "var(--color-ink)" }}>--rpc</code> flag; v1 recomputes from
                the relayed preimage, the same model the web verifier uses.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="sm:max-w-[260px]">
                  <ActionButton href="/verify">Verify in the browser -&gt;</ActionButton>
                </div>
                <a
                  href="https://github.com/TopengDev/aura-0g/tree/v2/cli"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 font-semibold text-[16px] transition-opacity hover:opacity-85"
                  style={{ background: "transparent", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)" }}
                >
                  CLI source on GitHub -&gt;
                </a>
              </div>
            </Panel>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// A section label in the provenance-rule motif: a mono kicker, a hairline rule, an index marker. Mirrors
// the PageHeader kicker row so each section reads as part of the same editorial system.
function SectionLabel({ children, marker }: { children: ReactNode; marker: string }) {
  return (
    <div className="flex items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
      <span>{children}</span>
      <span className="prov-rule h-px flex-1" style={{ opacity: 0.5 }} />
      <span style={{ color: "var(--color-accent)" }}>{marker}</span>
    </div>
  );
}

// A copyable command line: a sunken mono surface with a leading prompt glyph + a copy-to-clipboard button
// that yields the exact command (no prompt glyph). Copy uses the same navigator.clipboard pattern as the
// CopyValue primitive (graceful no-op on an insecure/denied context).
function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable (insecure context / denied) - the command stays visible + selectable.
    }
  };
  return (
    <div
      className="flex items-center gap-3 rounded-[14px] border px-4 py-3"
      style={{ borderColor: "var(--color-border-strong)", background: "var(--color-cream-deep)" }}
    >
      <span aria-hidden className="shrink-0 font-mono-x text-[16px]" style={{ color: "var(--color-accent)" }}>
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono-x text-[16px]" style={{ color: "var(--color-ink)" }}>
        {command}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy command"}
        title={copied ? "Copied" : "Copy command"}
        className="micro label-caps inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[13px] hover:bg-[color-mix(in_oklab,var(--color-ink)_6%,transparent)] active:scale-[0.94]"
        style={{ color: copied ? "var(--color-ok)" : "var(--color-ink-3)", border: "1px solid var(--color-border-strong)", letterSpacing: "0.1em" }}
      >
        {copied ? (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Copied
          </>
        ) : (
          <>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            Copy
          </>
        )}
      </button>
    </div>
  );
}

// A single command card: signature + example invocation, a one-line blurb, and what it returns.
function CommandCard({ command }: { command: Command }) {
  return (
    <Panel className="flex h-full min-w-0 flex-col p-5 sm:p-6">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <code className="min-w-0 overflow-x-auto whitespace-nowrap font-mono-x text-[16px]" style={{ color: "var(--color-ink)" }}>
          {command.signature}
        </code>
      </div>
      <p className="mt-3 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {command.blurb}
      </p>
      <div className="mt-4">
        <CommandLine command={command.example} />
      </div>
      <div className="mt-4 flex items-start gap-2 border-t pt-3.5" style={{ borderColor: "var(--color-border)" }}>
        <span className="shrink-0 label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>
          returns
        </span>
        <span className="text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          {command.returns}
        </span>
      </div>
    </Panel>
  );
}

// A faithful terminal transcript block. Renders the captured output line-by-line on a sunken mono surface,
// tinting the `✔` assertion lines with the ok color and the `(== match)` confirmation with the accent -
// the same semantic colors the rest of the app uses, applied to the real, unedited CLI output.
function TerminalBlock({ text, caption }: { text: string; caption: string }) {
  const lines = text.split("\n");
  return (
    <Panel className="min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5" style={{ borderColor: "var(--color-border)" }}>
        {/* terminal cursor block (a terminal idiom) instead of the macOS traffic-light dots (decorative) */}
        <span aria-hidden className="inline-flex items-center gap-2 label-caps text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.12em" }}>
          <span className="inline-block h-[15px] w-[8px]" style={{ background: "var(--color-accent)" }} />
          terminal
        </span>
        <span className="min-w-0 truncate font-mono-x text-[16px] tracking-[0.06em]" style={{ color: "var(--color-ink-3)" }}>
          {caption}
        </span>
      </div>
      <pre
        className="overflow-x-auto px-4 py-4 font-mono-x text-[16px] leading-[1.7]"
        style={{ background: "var(--color-cream-deep)", color: "var(--color-ink-2)" }}
      >
        {lines.map((line, i) => {
          const isCheck = line.trimStart().startsWith("✔");
          const isMatch = line.includes("(== match)");
          const color = isCheck ? "var(--color-ok)" : isMatch ? "var(--color-accent)" : undefined;
          const weight = isCheck ? 600 : undefined;
          return (
            <span key={i} style={{ color, fontWeight: weight, display: "block" }}>
              {line.length ? line : " "}
            </span>
          );
        })}
      </pre>
    </Panel>
  );
}

// A single asserted check, in the verified-checklist language of the standalone verifier (a small ok-tinted
// disc + the claim).
function VerifyCheck({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-[16px] leading-relaxed" style={{ color: "var(--color-ink)" }}>
      <span aria-hidden className="mt-px shrink-0 text-[18px] font-semibold leading-snug" style={{ color: "var(--color-ok)" }}>
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}

// A per-OS install note: a mono OS label + a short plain-language detail.
function PlatformNote({ os, detail }: { os: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 w-[58px] shrink-0 label-caps text-[13px] uppercase tracking-[0.08em]" style={{ color: "var(--color-ink)" }}>
        {os}
      </span>
      <span className="text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {detail}
      </span>
    </li>
  );
}
