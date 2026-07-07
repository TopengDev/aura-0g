import { ZeroG } from "@/components/atoms/ZeroG";
import { EXPLORER, FAUCET_URL, CHAIN_ID, CHAIN_SHORT, CHAIN_TIER } from "@/lib/chains";
import { fetchHealth, shortAddr } from "@/lib/api";
import { PROOF_CONTRACTS } from "@/lib/proof-contracts";

// The three headline contracts, sourced from the network-aware baked set (lib/proof-contracts.ts, which
// mirrors contracts/deployed-v2.json 1:1 and follows APP_CHAIN) rather than from /health. On the mainnet
// cutover /health.contracts.agentRegistry is the DEAD 0x0 pre-cutover registry (agents now live on the real
// ERC-7857 AuraINFT), so reading it painted a zero-address "live contract" in the footer. Sourcing from the
// baked set shows the live AuraINFT (matching the /proof panel) and keeps OutputNFT + Marketplace exactly in
// lockstep with the deploy manifest. AuraINFT/OutputNFT/Marketplace exist in BOTH the mainnet + testnet sets,
// so a rollback build (NEXT_PUBLIC_AURA_CHAIN_ID=16602) still resolves the correct testnet addresses.
const FOOTER_CONTRACT_LABELS = ["AuraINFT", "OutputNFT", "Marketplace"] as const;

// Server component. Footer with the AURA wordmark + thesis, three columns, the LIVE chainId +
// contract addresses (mono, linking to chainscan), the app-chain network badge, and a faucet helper.
export async function Footer() {
  const health = await fetchHealth();
  const chainId = health?.chainId ?? CHAIN_ID;

  const contractLinks = FOOTER_CONTRACT_LABELS.map((label) =>
    PROOF_CONTRACTS.find((c) => c.label === label),
  ).filter((c): c is (typeof PROOF_CONTRACTS)[number] => c !== undefined)
    .map((c) => ({ label: c.label, addr: c.addr }));

  return (
    <footer className="relative border-t border-[var(--color-border)]" style={{ background: "color-mix(in oklab, var(--color-cream-deep) 70%, transparent)" }}>
      <div className="mx-auto w-full max-w-[var(--container-wrap)] px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="font-display" style={{ fontSize: 30, letterSpacing: "0.14em" }}>
              AURA
            </div>
            <p className="mt-3 max-w-[34ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              A marketplace for art you can prove. Every Relic is created by an autonomous on-chain Aura,
              attested in a TEE, and stored on <ZeroG />.
            </p>
            <div className="tag mt-5" style={{ border: "1px solid var(--color-border-strong)", background: "var(--color-paper)", color: "var(--color-ink-2)" }}>
              <ZeroG /> {CHAIN_SHORT} {CHAIN_TIER}
            </div>
          </div>

          <FooterCol title="Explore" links={[
            { label: "Auras", href: "/agents" },
            { label: "Gallery", href: "/explore" },
            { label: "Activity", href: "/explore#activity" },
            { label: "Proof", href: "/proof" },
          ]} />
          <FooterCol title="Build" links={[
            { label: "Generate", href: "/generate" },
            { label: "Create an Aura", href: "/create" },
            { label: "CLI", href: "/cli" },
            { label: "Dashboard", href: "/dashboard" },
          ]} />

          <div>
            <h4 className="label-caps text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.13em" }}>
              Network
            </h4>
            <dl className="mt-4 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="label-caps text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.06em" }}>chainId</dt>
                <dd className="font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-ink)" }}>{chainId}</dd>
              </div>
              {contractLinks.map((c) => (
                /* label on its own line, the address below + nowrap, so a long label never forces the
                   0x value to wrap mid-hash in this narrow footer column. */
                <div key={c.label} className="flex flex-col gap-0.5">
                  <dt className="label-caps text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.06em" }}>{c.label}</dt>
                  <dd>
                    <a
                      href={`${EXPLORER}/address/${c.addr}`}
                      target="_blank"
                      rel="noreferrer"
                      className="micro inline-block whitespace-nowrap font-mono-x text-[16px] underline-offset-2 hover:underline"
                      style={{ color: "var(--color-accent)" }}
                    >
                      {shortAddr(c.addr)}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
            <a
              href={FAUCET_URL}
              target="_blank"
              rel="noreferrer"
              className="lnk micro mt-5 inline-flex items-center gap-1.5 text-[16px] font-semibold hover:opacity-70"
              style={{ color: "var(--color-accent)" }}
            >
              Need test <ZeroG />? Faucet <span className="arrow" aria-hidden>-&gt;</span>
            </a>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-[var(--color-border)] pt-6 sm:flex-row sm:items-center">
          <span className="text-[16px] font-medium" style={{ color: "var(--color-ink-3)" }}>
            AURA. Art you can prove, from living Auras on <ZeroG />.
          </span>
          <span className="text-[16px] font-medium" style={{ color: "var(--color-ink-3)" }}>
            Built on <ZeroG /> {CHAIN_SHORT}. {CHAIN_TIER}.
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="label-caps text-[13px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.13em" }}>
        {title}
      </h4>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="text-[16px] font-medium transition-colors hover:text-[var(--color-ink)]" style={{ color: "var(--color-ink-2)" }}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
