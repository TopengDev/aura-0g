"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { buildSiweMessage, fetchNonce, verifySiwe } from "@/lib/siwe";

// SIWE auth context. GATES BOTH GENERATE AND MINT. Generation is sponsored (the server pays for 0G
// compute + gas, so the user does not pay) but the generate backend is owner-scoped, so a SIWE sign-in
// is still required to generate; a second wallet signature settles the on-chain mint. Connect != SIWE:
// a user can connect a wallet for browsing/balance and only signs in (SIWE) when they generate or mint.
// Home does not block on this; it is the scaffolding the generate + mint flows consume.
type AuthState = {
  token: string | null;
  address: `0x${string}` | null;
  status: "idle" | "signing" | "authenticated" | "error";
  error: string | null;
  /** Sign in via SIWE. Returns the fresh JWT so a caller can use it immediately (React state updates
   *  async, so re-reading `token` right after awaiting signIn would miss it). */
  signIn: () => Promise<string>;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async (): Promise<string> => {
    if (!address) {
      setError("connect a wallet first");
      setStatus("error");
      throw new Error("connect a wallet first");
    }
    try {
      setStatus("signing");
      setError(null);
      const nonce = await fetchNonce();
      const message = buildSiweMessage(address, nonce);
      const signature = await signMessageAsync({ message });
      const session = await verifySiwe(message, signature);
      setToken(session.token);
      setStatus("authenticated");
      return session.token;
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign-in failed");
      setStatus("error");
      throw e;
    }
  }, [address, signMessageAsync]);

  const signOut = useCallback(() => {
    setToken(null);
    setStatus("idle");
    setError(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ token, address: address ?? null, status, error, signIn, signOut }),
    [token, address, status, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
