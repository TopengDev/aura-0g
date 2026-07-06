import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Footer } from "@/components/chrome/Footer";
import { Panel, Chip, MetaRow, ActionButton, ProvLine, CopyCommand } from "@/components/product/primitives";
import { ShareOnX } from "@/components/product/ShareOnX";
import { fetchPublicVerify, shortHex, type PublicVerify } from "@/lib/api";
import { absoluteUrl, farcasterEmbed, X_HANDLE } from "@/lib/share";

// /verify/[id] - the SHAREABLE, SSR provenance permalink. It renders the KEYLESS GET /api/verify?token=<id>
// result (no wallet, no JS required): the verdict + checks, the real on-chain facts, and - the thing the
// interactive /verify page lacks - a copy-paste "verify it yourself in ~10s" script grouped Tier 1 / Tier 2,
// plus the honest trust boundaries. Server-rendered (crawlable, OG-cardable) with the /og/output/[id] share
// card. Coexists with /verify (index): App Router routes /verify/25 here, /verify to the input page.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await fetchPublicVerify(id);
  const name = data?.found ? data.onchain?.agentName : null;
  const title = name ? `Verify ${name} #${data!.token} | AURA` : `Verify Relic #${id} | AURA`;
  const description =
    "Re-derive this AURA Relic's on-chain provenance yourself in ~10s, no wallet: a keyless verify endpoint, the exact chain reads, and the honest trust boundaries.";
  const ogImage = `/og/output/${id}`;
  const pageUrl = `/verify/${id}`;
  return {
    title,
    description,
    openGraph: {
      type: "article",
      title,
      description,
      url: pageUrl,
      images: [{ url: ogImage, width: 1200, height: 630, alt: `Verify AURA Relic #${id}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
      site: `@${X_HANDLE}`,
      creator: `@${X_HANDLE}`,
    },
    other: {
      "fc:miniapp": farcasterEmbed({ imageUrl: absoluteUrl(ogImage), url: absoluteUrl(pageUrl), label: "Verify it" }),
    },
  };
}

export default async function VerifyPermalinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await fetchPublicVerify(id);
  return (
    <>
      <main className="min-h-screen pt-14">
        <section className="relative px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto w-full max-w-[var(--container-wrap)]">
            {!data ? (
              <UnavailablePanel id={id} />
            ) : !data.found ? (
              <NotFoundPanel id={id} network={data.network?.name} />
            ) : (
              <VerifiedView data={data} />
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

// ── The verified (or partial) render ────────────────────────────────────────
function VerifiedView({ data }: { data: PublicVerify }) {
  const oc = data.onchain!;
  const v = data.verify!;
  const sc = data.selfCheck ?? {};
  const explorer = data.network.explorer;
  const ok = v.ok;
  const accent = ok ? "var(--color-ok)" : "var(--color-warn)";
  const passed = v.checks.filter((c) => c.ok).length;

  const shareUrl = absoluteUrl(`/verify/${data.token}`);
  const shareText = `Verify ${oc.agentName} #${data.token} on AURA yourself: keyless, no wallet, ~10s. Art you can prove. @${X_HANDLE}`;

  const isInft = data.agent?.standard === "erc7857";

  return (
    <div className="mx-auto max-w-[860px]">
      {/* Lede */}
      <header className="w-full">
        <div className="flex items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          <span>Keyless verify</span>
          <span className="prov-rule h-px flex-1" style={{ opacity: 0.5 }} />
          <span style={{ color: "var(--color-accent)" }}>{data.network.name}</span>
        </div>
        <h1 className="font-display mt-4" style={{ fontSize: "clamp(34px, 6vw, 68px)", lineHeight: 1.0, letterSpacing: "-0.02em" }}>
          {oc.agentName} · Relic #{data.token}
        </h1>
        <p className="mt-4 max-w-[60ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          Do not take our word for it. This page re-derives from a keyless endpoint and the raw chain; every
          command below runs with no wallet in about ten seconds.
        </p>
      </header>

      {/* Verdict + checks */}
      <Panel className="mt-8 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b px-6 py-5 sm:px-8" style={{ borderColor: "var(--color-border)", background: ok ? "color-mix(in oklab, var(--color-ok) 10%, transparent)" : "color-mix(in oklab, var(--color-warn) 10%, transparent)" }}>
          <div>
            <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
              On-chain verification
            </div>
            <div role="status" className="font-display mt-1.5" style={{ fontSize: "clamp(22px,3vw,30px)", lineHeight: 1, color: accent }}>
              {ok ? "Verified on-chain" : "Verification incomplete"}
            </div>
          </div>
          <Chip tone={ok ? "ok" : "default"}>{ok ? "All checks passed" : `${passed}/${v.checks.length}`}</Chip>
        </div>

        <div className="p-6 sm:p-8">
          <ul className="space-y-2.5">
            {v.checks.map((c) => (
              <li key={c.label} className="flex items-center gap-3 text-[16px] font-medium" style={{ color: "var(--color-ink)" }}>
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[16px]"
                  style={{ background: c.ok ? "color-mix(in oklab, var(--color-ok) 16%, transparent)" : "color-mix(in oklab, var(--color-warn) 16%, transparent)", color: c.ok ? "var(--color-ok)" : "var(--color-warn)" }}
                >
                  {c.ok ? "✓" : "✕"}
                </span>
                {c.label}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
            {v.summary}
          </p>

          <ProvLine className="my-6" />

          {/* On-chain facts */}
          <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            On-chain facts
          </div>
          <dl className="mt-4">
            <MetaRow k="Creating Aura" v={`${oc.agentName} (#${oc.creatorAgentId})`} mono={false} />
            <MetaRow k="Relic owner" v={shortHex(oc.owner)} href={`${explorer}/address/${oc.owner}`} />
            <MetaRow k="TEE attestation" v={shortHex(oc.teeAttestation)} ok mono />
            <MetaRow k="0G storage root" v={shortHex(oc.imageRoot)} href={sc.storageProof} mono />
            <MetaRow k="Provenance hash" v={shortHex(oc.provenanceHash)} mono />
            <MetaRow k="Seed" v={oc.seed} mono />
            <MetaRow k="Rarity" v={oc.rarity} mono={false} />
            <MetaRow
              k="On-chain TEE-verified"
              v={oc.onchainTeeVerified ? `dataHash ${shortHex(oc.dataHash)}` : "no on-chain TEE dataHash for this relic"}
              ok={oc.onchainTeeVerified}
              mono={oc.onchainTeeVerified}
            />
            <MetaRow
              k="TEE signer (pinned)"
              v={oc.onchainTeeVerified ? shortHex(oc.teeSigner) : `${shortHex(oc.teeSignerExpected)} · once armed`}
              mono
            />
            {data.royalty ? (
              <>
                <MetaRow k="Royalty" v={`${data.royalty.pct}% · ${data.royalty.standard}`} ok={data.royalty.receiverIsAgentOwner} mono={false} />
                <MetaRow k="Royalty receiver" v={shortHex(data.royalty.receiver)} href={`${explorer}/address/${data.royalty.receiver}`} ok={data.royalty.receiverIsAgentOwner} />
              </>
            ) : null}
            <MetaRow k="Agent standard" v={isInft ? "ERC-7857 iNFT" : "ERC-721 · cutover staged"} mono={false} />
            <MetaRow k="Image model" v={`${data.model?.name} · ${data.model?.verifiability}`} mono={false} />
          </dl>
        </div>
      </Panel>

      {/* Verify it yourself */}
      <div className="mt-10">
        <div className="flex items-center gap-3 label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          <span>Verify it yourself</span>
          <span className="prov-rule h-px flex-1" style={{ opacity: 0.5 }} />
          <span style={{ color: "var(--color-accent)" }}>no wallet · ~10s</span>
        </div>

        {/* Tier 1 */}
        {data.tiers ? (
          <Panel className="mt-5 p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display" style={{ fontSize: "clamp(18px,2.4vw,24px)", lineHeight: 1.05 }}>
                Tier 1 · {data.tiers.tier1.label}
              </h3>
              <Chip tone="ok">Live · keyless</Chip>
            </div>
            <p className="mt-2 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              The API is not lying: re-read the same values straight off the chain and confirm they agree.
            </p>
            <div className="mt-4 space-y-2.5">
              {data.tiers.tier1.checks.map((key) => (sc[key] ? <CopyCommand key={key} cmd={sc[key]} note={SELF_CHECK_NOTE[key]} /> : null))}
            </div>
          </Panel>
        ) : null}

        {/* Tier 2 (honest dormant/active) */}
        {data.tiers ? (
          <Panel className="mt-4 p-6 sm:p-7" style={data.tiers.tier2.active ? undefined : { background: "color-mix(in oklab, var(--color-ink) 3%, var(--color-paper))" }}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display" style={{ fontSize: "clamp(18px,2.4vw,24px)", lineHeight: 1.05 }}>
                Tier 2 · {data.tiers.tier2.label}
              </h3>
              <Chip tone={data.tiers.tier2.active ? "ok" : "default"}>
                {data.tiers.tier2.active ? "Armed" : "Activates at mainnet deploy"}
              </Chip>
            </div>
            <p className="mt-2 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              {data.tiers.tier2.note}
            </p>
            <div className="mt-4 space-y-2.5" style={data.tiers.tier2.active ? undefined : { opacity: 0.72 }}>
              {data.tiers.tier2.checks.map((key) => (sc[key] ? <CopyCommand key={key} cmd={sc[key]} note={SELF_CHECK_NOTE[key]} /> : null))}
            </div>
          </Panel>
        ) : null}
      </div>

      {/* Honest trust boundaries */}
      {data.trustBoundaries?.length ? (
        <Panel className="mt-8 p-6 sm:p-8">
          <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            What we do NOT hide
          </div>
          <ul className="mt-4 space-y-2.5">
            {data.trustBoundaries.map((b, i) => (
              <li key={i} className="flex items-start gap-3 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                <span aria-hidden className="mt-[0.7em] h-px w-3 shrink-0" style={{ background: "var(--color-border-strong)" }} />
                {b}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {/* Links + share */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <ActionButton href={`/outputs/${data.token}`}>View the Relic -&gt;</ActionButton>
        <a
          href={sc.explorer}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 font-semibold text-[16px] transition-opacity hover:opacity-85"
          style={{ background: "transparent", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)" }}
        >
          On 0G Scan -&gt;
        </a>
        <ShareOnX text={shareText} url={shareUrl} label="Share the proof" />
      </div>
      <p className="mt-5 text-[13px]" style={{ color: "var(--color-ink-3)" }}>
        Machine-readable JSON: <span className="font-mono-x">GET /api/verify?token={data.token}</span> · generated {data.generatedAt}
      </p>
    </div>
  );
}

// Muted "what to expect" captions, keyed by selfCheck command. Kept OUT of the copied command so a paste is
// clean; shown as the CopyCommand note instead.
const SELF_CHECK_NOTE: Record<string, ReactNode> = {
  provenance: "the keyless JSON this page renders",
  onchainProvenance: "the imageRoot / provenanceHash / teeAttestation / seed must match the JSON",
  royalty: "the receiver must equal ownerOf(creatorAgentId) - royalty follows the agent owner",
  agentOwner: "the royalty receiver above must equal this address",
  storageProof: "returns { finalized: true, size, ... } - the image blob is committed on 0G Storage",
  imageHash: "must equal dataHashOf(token) when the on-chain-TEE-verified tier is armed",
  teeSigner: "must equal the 0G-published enclave signer once setTeeSigner is armed at the mainnet deploy",
};

// ── Empty states (SSR) ───────────────────────────────────────────────────────
function NotFoundPanel({ id, network }: { id: string; network?: string }) {
  return (
    <div className="mx-auto max-w-[560px]">
      <Panel className="p-8 text-center sm:p-10" role="status">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
          <span className="font-mono-x text-[16px]">?</span>
        </div>
        <h1 className="font-display mt-5" style={{ fontSize: "clamp(24px,3.4vw,34px)", lineHeight: 1.05 }}>
          No Relic #{id} on-chain.
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          Nothing with that token id has been minted on {network ?? "this network"}. Double-check the id, or
          browse the gallery to find a verifiable Relic.
        </p>
        <div className="mx-auto mt-7 flex max-w-[360px] flex-col gap-3 sm:flex-row">
          <ActionButton href="/explore" variant="outline">Browse the gallery -&gt;</ActionButton>
          <ActionButton href="/verify">Verify another -&gt;</ActionButton>
        </div>
      </Panel>
    </div>
  );
}

function UnavailablePanel({ id }: { id: string }) {
  return (
    <div className="mx-auto max-w-[560px]">
      <Panel className="p-8 text-center sm:p-10" role="status">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}>
          <span className="font-mono-x text-[16px]">!</span>
        </div>
        <h1 className="font-display mt-5" style={{ fontSize: "clamp(24px,3.4vw,34px)", lineHeight: 1.05 }}>
          Verification is momentarily unreachable.
        </h1>
        <p className="mx-auto mt-3 max-w-[44ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          The verify endpoint could not be reached for Relic #{id}. The chain is the source of truth - try the
          interactive verifier, or read it directly on 0G Scan.
        </p>
        <div className="mx-auto mt-7 flex max-w-[360px] flex-col gap-3 sm:flex-row">
          <ActionButton href={`/verify?id=${id}`} variant="outline">Interactive verifier -&gt;</ActionButton>
          <ActionButton href="/proof">See the proof ledger -&gt;</ActionButton>
        </div>
      </Panel>
    </div>
  );
}
