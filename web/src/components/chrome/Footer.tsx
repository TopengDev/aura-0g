import { ZeroG } from "@/components/atoms/ZeroG";
import { EXPLORER, FAUCET_URL } from "@/lib/chains";
import { fetchHealth, shortAddr } from "@/lib/api";

// Server component. Footer with the AURA wordmark + thesis, three columns, the LIVE chainId +
// contract addresses (mono, linking to chainscan), a 0G Galileo Testnet badge, and a faucet helper.
export async function Footer() {
  const health = await fetchHealth();
  const chainId = health?.chainId ?? 16602;
  const contracts = health?.contracts;

  const contractLinks = contracts
    ? [
        { label: "AgentRegistry", addr: contracts.agentRegistry },
        { label: "OutputNFT", addr: contracts.outputNFT },
        { label: "Marketplace", addr: contracts.marketplace },
      ]
    : [];

  return (
    <footer className="relative border-t border-[var(--color-border)]" style={{ background: "color-mix(in oklab, var(--color-cream-deep) 70%, transparent)" }}>
      <div className="mx-auto w-full max-w-[var(--container-wrap)] px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <div className="font-display" style={{ fontSize: 30, letterSpacing: "0.14em" }}>
              AURA
            </div>
            <p className="mt-3 max-w-[34ch] text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
              A marketplace for art you can prove. Every Relic is created by an autonomous on-chain Aura,
              attested in a TEE, and stored on <ZeroG />.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--color-border-strong)] px-3 py-1.5 font-mono-x text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ink-2)" }}>
              <ZeroG /> Galileo Testnet
            </div>
          </div>

          <FooterCol title="Explore" links={[
            { label: "Auras", href: "/agents" },
            { label: "Gallery", href: "/explore" },
            { label: "Activity", href: "/explore#activity" },
          ]} />
          <FooterCol title="Build" links={[
            { label: "Generate (free)", href: "/generate" },
            { label: "Create an Aura", href: "/create" },
            { label: "CLI", href: "/cli" },
            { label: "Dashboard", href: "/dashboard" },
          ]} />

          <div>
            <h4 className="font-mono-x text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
              Network
            </h4>
            <dl className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <dt className="font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>chainId</dt>
                <dd className="font-mono-x text-[11px]" style={{ color: "var(--color-ink)" }}>{chainId}</dd>
              </div>
              {contractLinks.map((c) => (
                <div key={c.label} className="flex items-center justify-between gap-3">
                  <dt className="font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>{c.label}</dt>
                  <dd>
                    <a
                      href={`${EXPLORER}/address/${c.addr}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono-x text-[11px] underline-offset-2 hover:underline"
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
              className="mt-5 inline-flex items-center gap-1.5 font-mono-x text-[11px] transition-opacity hover:opacity-70"
              style={{ color: "var(--color-accent)" }}
            >
              Need test <ZeroG />? Faucet <span aria-hidden>-&gt;</span>
            </a>
          </div>
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-[var(--color-border)] pt-6 sm:flex-row sm:items-center">
          <span className="font-mono-x text-[10px] tracking-[0.06em]" style={{ color: "var(--color-ink-3)" }}>
            AURA. Art you can prove, from living Auras on <ZeroG />.
          </span>
          <span className="font-mono-x text-[10px] tracking-[0.06em]" style={{ color: "var(--color-ink-3)" }}>
            Built on <ZeroG /> Galileo. Testnet preview.
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="font-mono-x text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
        {title}
      </h4>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="text-[13px] transition-colors hover:text-[var(--color-ink)]" style={{ color: "var(--color-ink-2)" }}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
