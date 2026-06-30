"use client";

import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { ZeroG } from "@/components/atoms/ZeroG";
import { PageHeader, Panel, ProvLine, Chip, MetaRow, StatFigure, ActionButton } from "@/components/product/primitives";
import { TradePanel } from "@/components/product/TradePanel";
import { SummonPanel } from "@/components/product/SummonPanel";
import { AuraChat } from "@/components/product/AuraChat";
import { EXPLORER } from "@/lib/chains";
import { CONTRACTS } from "@/lib/contracts";
import { agentPortraitUrl, shortHex, type AgentDetail, type MarketListing, type Output } from "@/lib/api";

// One agent. Identity header (name, style-DNA fingerprint, model attestation, current owner, royalty
// rates, styleVersion), the agent's output collection, stats, the trade panel (kind=agent, with the
// royalty-follows-the-agent story), and the Generate CTA.
export function AgentDetailView({
  agent: a,
  outputs,
  listing,
}: {
  agent: AgentDetail;
  outputs: Output[];
  listing: MarketListing | null;
}) {
  const accent = a.meta.accent;
  const portrait = agentPortraitUrl(a);
  const agentUrl = `${EXPLORER}/token/${CONTRACTS.agentRegistry}?a=${a.agentId}`;

  return (
    <section className="relative px-5 py-12 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <Link href="/agents" className="font-mono-x text-[11px] uppercase tracking-[0.14em] hover:underline" style={{ color: "var(--color-ink-3)" }}>
            &lt;- All Auras
          </Link>
        </Reveal>

        {/* Identity header + portrait + trade panel */}
        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
          {/* Left: portrait + identity */}
          <div>
            <Reveal>
              <div className="relative overflow-hidden rounded-[24px] border" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 10%, var(--color-paper))` }}>
                <div className="relative aspect-[16/10] w-full overflow-hidden">
                  <img src={portrait} alt={`${a.name} portrait`} className="h-full w-full object-cover" />
                  <span className="absolute left-4 top-4"><Chip tone="solid" accent={accent}>{a.style}</Chip></span>
                  {a.meta.rarity ? (
                    <span className="absolute right-4 top-4"><Chip tone="accent" accent={accent}>{a.meta.rarity}</Chip></span>
                  ) : null}
                </div>
              </div>
            </Reveal>

            <Reveal delay={0.05}>
              <div className="mt-6">
                <PageHeader
                  kicker="Living Aura"
                  marker={`#${a.agentId} · v${a.styleVersion}`}
                  title={a.name}
                  lede={a.meta.tagline}
                />
              </div>
            </Reveal>

            <Reveal delay={0.08}>
              <p className="mt-5 max-w-[64ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                {a.meta.aesthetic}
              </p>
            </Reveal>

            {a.meta.lore ? (
              <Reveal delay={0.09}>
                <div className="mt-6">
                  <div className="mb-1 font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                    Lore
                  </div>
                  <p className="max-w-[64ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                    {a.meta.lore}
                  </p>
                </div>
              </Reveal>
            ) : null}

            {a.meta.personality ? (
              <Reveal delay={0.1}>
                <div className="mt-5">
                  <div className="mb-1 font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                    Personality
                  </div>
                  <p className="max-w-[64ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                    {a.meta.personality}
                  </p>
                </div>
              </Reveal>
            ) : null}

            {/* Identity / on-chain DNA */}
            <Reveal delay={0.1}>
              <Panel className="mt-7 p-5">
                <div className="mb-1 font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                  Identity. on-chain
                </div>
                <dl>
                  <MetaRow k="Current owner" v={shortHex(a.owner)} href={`${EXPLORER}/address/${a.owner}`} />
                  {a.styleFingerprint ? <MetaRow k="Style DNA fingerprint" v={shortHex(a.styleFingerprint)} /> : null}
                  {a.modelAttestation ? <MetaRow k="Model attestation" v={shortHex(a.modelAttestation)} ok /> : null}
                  {a.model ? <MetaRow k="Model" v={a.model} mono={false} /> : null}
                  <MetaRow k="Relic royalty" v={`${a.royaltyPct}%`} />
                  <MetaRow k="Creator resale royalty" v={`${a.creatorResaleBps / 100}%`} />
                  <MetaRow k="Style version" v={`v${a.styleVersion}`} />
                  <MetaRow k="Agent iNFT" v={shortHex(CONTRACTS.agentRegistry)} href={agentUrl} />
                </dl>
              </Panel>
            </Reveal>

            {/* Living-Agents core: chat with THIS Aura (in character, remembers you, can create + act) */}
            <Reveal delay={0.12}>
              <AuraChat agentId={a.agentId} agentName={a.name} accent={accent} />
            </Reveal>
          </div>

          {/* Right: trade panel (sticky on desktop) + generate CTA */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            <Reveal delay={0.06}>
              <TradePanel
                kind="agent"
                tokenId={a.agentId}
                owner={a.owner}
                listing={listing}
                note={
                  <>
                    Buying this Aura transfers ownership <strong style={{ color: "var(--color-ink)" }}>and its entire future royalty stream</strong>. Every
                    future sale of any Relic {a.name} has minted (or ever mints) pays its <ZeroG />{" "}
                    royalty to whoever owns this Aura. The royalty follows the work.
                  </>
                }
              />
            </Reveal>
            <Reveal delay={0.08}>
              <div className="mt-4">
                <SummonPanel
                  agentId={a.agentId}
                  agentName={a.name}
                  owner={a.owner}
                  note={
                    <>
                      Pay to summon {a.name} and it creates a TEE-attested 1/1 <strong style={{ color: "var(--color-ink)" }}>live, on demand</strong>, minted
                      straight to you. The fee pays the Aura&rsquo;s <strong style={{ color: "var(--color-ink)" }}>current owner</strong>, and so does every future resale
                      royalty. Own the Aura, earn from every summon.
                    </>
                  }
                />
              </div>
            </Reveal>
            <Reveal delay={0.12}>
              <div className="mt-4">
                <ActionButton href={`/generate?agent=${a.agentId}`} variant="outline">
                  Generate with {a.name} -&gt;
                </ActionButton>
                <p className="mt-2 text-center font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>
                  Generation is sponsored. Sign in once to generate.
                </p>
              </div>
            </Reveal>
          </div>
        </div>

        {/* Stats */}
        <Reveal>
          <div className="mt-14">
            <ProvLine />
            <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
              <StatFigure value={a.outputCount} label="Relics created" />
              <StatFigure value={a.salesCount} label="Secondary sales" />
              <StatFigure value={<>{a.royaltiesEarned} <span className="font-mono-x text-[14px]" style={{ color: "var(--color-ink-3)" }}>0G</span></>} label="Royalties earned" />
              <StatFigure value={`${a.royaltyPct}%`} label="Relic royalty" />
            </div>
          </div>
        </Reveal>

        {/* Output collection */}
        <div className="mt-16">
          <Reveal>
            <div className="flex items-end justify-between gap-4">
              <div>
                <span className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>The collection</span>
                <h2 className="font-display mt-3" style={{ fontSize: "clamp(28px,4.5vw,48px)", lineHeight: 1, letterSpacing: "-0.015em" }}>
                  Everything {a.name} has made.
                </h2>
              </div>
              <span className="font-mono-x text-[12px]" style={{ color: "var(--color-ink-3)" }}>{outputs.length} relics</span>
            </div>
          </Reveal>

          {outputs.length === 0 ? (
            <Panel className="mt-8 p-10 text-center">
              <p className="font-display" style={{ fontSize: "clamp(22px,3.5vw,32px)" }}>No relics yet.</p>
              <p className="mt-2 font-mono-x text-[12px]" style={{ color: "var(--color-ink-3)" }}>
                This Aura has not minted any work yet. Generate the first one (sponsored, you just sign in once).
              </p>
              <div className="mx-auto mt-5 max-w-[260px]">
                <ActionButton href={`/generate?agent=${a.agentId}`}>Generate with {a.name} -&gt;</ActionButton>
              </div>
            </Panel>
          ) : (
            <div className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
              {outputs.map((o, i) => (
                <Reveal key={o.tokenId} delay={Math.min(0.04 * i, 0.24)}>
                  <OutputThumb output={o} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function OutputThumb({ output: o }: { output: Output }) {
  const img = `/images/${encodeURIComponent(o.imageRoot.replace(/^0g:\/\//, ""))}?style=${o.style}`;
  return (
    <Link
      href={`/outputs/${o.tokenId}`}
      className="group block overflow-hidden rounded-[18px] border transition-shadow duration-300 hover:shadow-[var(--shadow-card)]"
      style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}
    >
      <div className="relative aspect-square w-full overflow-hidden" style={{ background: "var(--color-cream-deep)" }}>
        <img src={img} alt={`${o.agentName} #${o.tokenId}`} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
      </div>
      <div className="flex items-center justify-between p-3 font-mono-x text-[11px]">
        <span style={{ color: "var(--color-ink-2)" }}>#{o.tokenId}</span>
        <span style={{ color: "var(--color-accent)" }}>View -&gt;</span>
      </div>
    </Link>
  );
}
