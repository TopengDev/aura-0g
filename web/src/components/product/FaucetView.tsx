"use client";

import { useAccount, useBalance } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Reveal } from "@/components/Reveal";
import { PageHeader, Panel, ProvLine, Chip, ActionButton, ConnectGate } from "@/components/product/primitives";
import { ZeroG } from "@/components/atoms/ZeroG";
import { APP_CHAIN, EXPLORER, FAUCET_URL } from "@/lib/chains";
import { shortHex } from "@/lib/api";

// /faucet - the testnet gas helper. AURA's writes (mint an output, list/buy on the marketplace, create
// an agent) are user-signed, so they cost 0G gas even though generation itself is sponsored. This page
// shows the connected wallet's live 0G balance on Galileo (chain 16602), links the canonical 0G faucet
// (https://faucet.0g.ai, confirmed in chains.ts + the project README), and lays out the claim steps +
// the per-claim amount honestly. No wallet connected => a calm connect gate (the balance needs an address).
export function FaucetView() {
  const { address, isConnected } = useAccount();
  // Scope the balance read to Galileo so it's the gas balance that matters for AURA, regardless of the
  // wallet's currently-selected network.
  const { data: bal, isLoading } = useBalance({ address, chainId: APP_CHAIN.id });

  const balanceNum = bal ? Number(bal.formatted) : null;
  const low = balanceNum !== null && balanceNum < 0.1; // the full AURA flow spends ~0.1 0G

  return (
    <section className="relative px-5 py-16 sm:px-8 sm:py-20">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <Reveal>
          <PageHeader
            kicker="Testnet faucet"
            marker="get gas"
            title={<>Fuel your wallet.</>}
            lede={
              <>
                Generating on AURA is sponsored, the network pays for the compute and storage. But minting
                your Relic, listing it, or buying one are transactions you sign yourself, so they need a
                little <ZeroG /> for gas. Grab some free testnet <ZeroG /> below.
              </>
            }
          />
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_1fr]">
          {/* Balance + claim */}
          <Reveal delay={0.04}>
            {!isConnected || !address ? (
              <ConnectGate
                title="Connect to check your balance"
                body={
                  <>
                    Your <ZeroG /> balance is keyed to your address on the Galileo testnet. Connect a
                    wallet to see it, then claim from the faucet if you are running low.
                  </>
                }
              >
                <ConnectButton.Custom>
                  {({ openConnectModal }) => <ActionButton onClick={openConnectModal}>Connect wallet</ActionButton>}
                </ConnectButton.Custom>
              </ConnectGate>
            ) : (
              <Panel className="p-6 sm:p-8">
                <div className="flex items-center justify-between">
                  <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                    Your balance
                  </div>
                  <Chip tone={low ? "default" : "ok"}>{low ? "Running low" : "Funded"}</Chip>
                </div>

                <div className="mt-5 flex items-baseline gap-2">
                  <span className="font-display" style={{ fontSize: "clamp(40px,7vw,68px)", lineHeight: 1, letterSpacing: "-0.02em" }}>
                    {isLoading ? "..." : balanceNum !== null ? balanceNum.toFixed(4) : "0.0000"}
                  </span>
                  <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>{bal?.symbol ?? "0G"}</span>
                </div>

                <div className="mt-3 flex items-center gap-2 text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                  <span className="h-3 w-px shrink-0" style={{ background: "var(--color-ok)" }} />
                  <a href={`${EXPLORER}/address/${address}`} target="_blank" rel="noreferrer" className="font-mono-x underline-offset-4 hover:underline" style={{ color: "var(--color-accent)" }}>
                    {shortHex(address)}
                  </a>
                  <span>on {APP_CHAIN.name}</span>
                </div>

                <ProvLine className="my-6" />

                <p className="text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                  {low ? (
                    <>You will want a bit more <ZeroG /> before minting or trading. The faucet sends about <strong style={{ color: "var(--color-ink)" }}>0.5 0G</strong> per claim, which comfortably covers the whole flow (a full create, generate, mint, and trade run spends roughly 0.1 0G).</>
                  ) : (
                    <>You have enough <ZeroG /> for gas. If you ever run low, the faucet sends about <strong style={{ color: "var(--color-ink)" }}>0.5 0G</strong> per claim.</>
                  )}
                </p>

                <div className="mt-6">
                  <ActionButton href={FAUCET_URL}>Open the 0G faucet -&gt;</ActionButton>
                  <p className="mt-3 text-center text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                    opens faucet.0g.ai in a new tab
                  </p>
                </div>
              </Panel>
            )}
          </Reveal>

          {/* Steps + honest notes */}
          <Reveal delay={0.06}>
            <Panel className="p-6 sm:p-8" style={{ background: "var(--color-cream-warm)" }}>
              <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                How to claim
              </div>
              <ol className="mt-5 space-y-4">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-4">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono-x text-[16px]" style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}>
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[16px] font-semibold" style={{ color: "var(--color-ink)" }}>{s.title}</div>
                      <div className="mt-1 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{s.body}</div>
                    </div>
                  </li>
                ))}
              </ol>

              <ProvLine className="my-6" />

              <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
                Good to know
              </div>
              <ul className="mt-4 space-y-2.5">
                {NOTES.map((n) => (
                  <li key={n.id} className="flex items-start gap-3 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
                    <span aria-hidden className="mt-[0.7em] h-px w-3 shrink-0" style={{ background: "var(--color-border-strong)" }} />
                    {n.body}
                  </li>
                ))}
              </ul>
            </Panel>
          </Reveal>
        </div>

        {/* What the gas is for */}
        <Reveal delay={0.08}>
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {GAS_USES.map((g) => (
              <Panel key={g.label} className="p-5">
                <div className="label-caps text-[13px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-3)" }}>{g.label}</div>
                <p className="mt-2 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{g.body}</p>
              </Panel>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const STEPS: { title: string; body: React.ReactNode }[] = [
  { title: "Copy your wallet address", body: "The faucet sends to a 0G Galileo address. Your connected address is shown on the left." },
  { title: "Open the 0G faucet", body: <>Head to faucet.0g.ai, paste your address, and clear the captcha. It is the official <ZeroG /> Galileo testnet faucet.</> },
  { title: "Wait for the drip", body: "It lands in a few seconds, about 0.5 0G. Your balance on the left updates on the next refresh." },
  { title: "Come back and build", body: <>With gas in hand you can mint a generation, list it, or buy a Relic. Generation itself stays free.</> },
];

const NOTES: { id: string; body: React.ReactNode }[] = [
  { id: "testnet", body: <>This is testnet <ZeroG /> only. It has no real value and exists purely for trying AURA on Galileo (chain 16602).</> },
  { id: "rate-limit", body: "The faucet is rate-limited, roughly one claim per address per day, and gated by a captcha to keep it fair." },
  { id: "read-free", body: <>You do not need <ZeroG /> to browse, explore, or verify a Relic, only to send a transaction that you sign.</> },
];

const GAS_USES: { label: string; body: string }[] = [
  { label: "Mint a Relic", body: "After a free generation, minting the Relic as an on-chain NFT is a transaction you sign." },
  { label: "List or buy", body: "Listing a Relic for sale, updating a price, or buying one each settle on-chain and cost gas." },
  { label: "Create an Aura", body: "Minting your own creative Aura (an iNFT with its own royalty stream) is user-signed too." },
];
