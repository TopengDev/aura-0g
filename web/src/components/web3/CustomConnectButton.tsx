"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useBalance } from "wagmi";

// AURA-styled connect button (keeps RainbowKit's wallet modal): a pill that matches the site -
// solid ink "Connect wallet" when disconnected, a wallet chip with a live dot + the 0G balance when
// connected, and a clear "wrong network" state. RainbowKit prompts add/switch to Galileo when the
// wallet is elsewhere.
const base = {
  borderRadius: 9999,
  fontFamily: "var(--font-mono)",
  fontWeight: 500,
  cursor: "pointer",
  transition: "opacity .15s ease",
} as const;

export function CustomConnectButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;
        return (
          <div style={{ opacity: mounted ? 1 : 0, pointerEvents: mounted ? "auto" : "none" }}>
            {!connected ? (
              <button
                type="button"
                onClick={openConnectModal}
                style={{ ...base, fontSize: 13.5, padding: "11px 22px", background: "var(--color-ink)", color: "var(--color-cream)", border: "1px solid var(--color-ink)" }}
              >
                Connect wallet
              </button>
            ) : chain.unsupported ? (
              <button
                type="button"
                onClick={openChainModal}
                style={{ ...base, fontSize: 13, padding: "11px 18px", background: "transparent", color: "var(--color-warn)", border: "1px solid var(--color-warn)" }}
              >
                Wrong network. Switch
              </button>
            ) : (
              <ConnectedChip
                address={account.address as `0x${string}`}
                displayName={account.displayName}
                onClick={openAccountModal}
              />
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

function ConnectedChip({
  address,
  displayName,
  onClick,
}: {
  address: `0x${string}`;
  displayName: string;
  onClick: () => void;
}) {
  const { data: bal } = useBalance({ address });
  const amount = bal ? `${Number(bal.formatted).toFixed(3)} ${bal.symbol}` : null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ ...base, display: "inline-flex", alignItems: "center", gap: 9, fontSize: 12.5, padding: "9px 15px", background: "var(--color-paper)", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)" }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 9999, background: "var(--color-ok)", flexShrink: 0 }} />
      <span>{displayName}</span>
      {amount ? (
        <span style={{ fontSize: 11, letterSpacing: "0.04em", color: "var(--color-ink-3)" }}>{amount}</span>
      ) : null}
    </button>
  );
}
