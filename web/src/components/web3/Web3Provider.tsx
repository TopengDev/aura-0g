"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, getDefaultConfig, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { useTheme } from "@/components/theme/ThemeProvider";
import { AuthProvider } from "@/components/web3/AuthProvider";
import { APP_CHAIN, zgMainnet, zgTestnet } from "@/lib/chains";

// WalletConnect Cloud projectId (public, safe to ship). Enables the mobile/WC wallet list.
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID || "8587a9582464416581ee66bc24063ac9";
const queryClient = new QueryClient();

const wallets = [
  { groupName: "Connect a wallet", wallets: [injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet] },
];

const chainFor = (id: number) => (id === zgMainnet.id ? zgMainnet : zgTestnet);

// Connect any wallet (RainbowKit picker) on the network this deployment runs. The chain is
// AUTO-DETECTED from the server's /health (it reports its chainId), so the app follows the server
// with no rebuild and no chain mismatch. Falls back to the build default.
export function Web3Provider({ children }: { children: ReactNode }) {
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/health")
      .then((r) => r.json())
      .then((d: { chainId?: number }) => {
        if (alive) setChainId(Number(d?.chainId) || APP_CHAIN.id);
      })
      .catch(() => {
        if (alive) setChainId(APP_CHAIN.id);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Render children immediately on the resolved-or-default chain. We do NOT gate the whole app on
  // /health (Home must paint instantly); the chain refines in-place once /health returns.
  const resolvedChainId = chainId ?? APP_CHAIN.id;
  return <Web3Ready chainId={resolvedChainId}>{children}</Web3Ready>;
}

function Web3Ready({ chainId, children }: { chainId: number; children: ReactNode }) {
  const { resolved } = useTheme();
  const config = useMemo(
    () => getDefaultConfig({ appName: "AURA", projectId: WC_PROJECT_ID, chains: [chainFor(chainId)], ssr: true, wallets }),
    [chainId],
  );
  const rkTheme = useMemo(() => {
    const base = { accentColor: "#2a3858", accentColorForeground: "#f9f8f6", borderRadius: "large" as const };
    return resolved === "dark"
      ? darkTheme({ ...base, accentColor: "#93a7d6", accentColorForeground: "#0e0d0a" })
      : lightTheme(base);
  }, [resolved]);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={chainFor(chainId)} theme={rkTheme} modalSize="compact">
          <AuthProvider>{children}</AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
