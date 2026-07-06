// SIWE client helper. GATES GENERATE + MINT + CREATE. Generation is sponsored (the server pays the 0G
// compute + gas) but the backend is owner-scoped, so a SIWE sign-in is still required to generate; the
// same sign-in authorizes minting and creating an agent. Home does not exercise this. Connect != SIWE.
//
// Server contract (read from server/src/routes/auth.ts + server/src/aura/siwe.ts):
//   GET  /auth/nonce            -> { nonce }                 single-use, 10-min TTL, stored
//   POST /auth/verify {message,signature} -> { token, address, expiresIn }   ~1h JWT { address }
// The SIWE message must bind: domain + uri (the origin the user signs from), chainId 16602, and the
// issued nonce. viem's createSiweMessage builds the EIP-4361 string the server parses + verifies.
//
// DEPLOY-AWARE domain/uri (must AGREE with the server). The server's verifySiweMessage checks the
// `domain` ONLY, against its SIWE_DOMAIN env (server/src/aura/config.ts, default "localhost:3000").
// So both sides MUST resolve to the same host. Resolution order here:
//   1. NEXT_PUBLIC_SIWE_DOMAIN  (build-time pin, e.g. "aura.topengdev.com") -> set server SIWE_DOMAIN to match
//   2. window.location.host     (runtime, in the browser; the origin the user actually signs from)
//   3. "localhost:3000"         (dev fallback; keeps the existing local flow unchanged)
// The uri is derived from the domain (https in prod, http for localhost). The server does not check the
// uri, but EIP-4361 requires it to be present + consistent.

import { createSiweMessage } from "viem/siwe";
import { API_BASE } from "./api";
import { APP_CHAIN } from "./chains";

// The chainId bound into the SIWE message follows the app chain (mainnet 16661 post-cutover). The server
// verifies only the domain (not chainId), but binding the real chain keeps the signed message consistent
// with the wallet's connected network instead of the stale hardcoded testnet id.
const CHAIN_ID = APP_CHAIN.id;

/** The host the SIWE message binds to. Build-time env pin > runtime browser host > localhost dev. */
function siweDomain(): string {
  const pinned = process.env.NEXT_PUBLIC_SIWE_DOMAIN;
  if (pinned && pinned.length > 0) return pinned;
  if (typeof window !== "undefined" && window.location?.host) return window.location.host;
  return "localhost:3000";
}

/** The full origin URI for the SIWE message. https for a real host, http for localhost dev. */
function siweUri(): string {
  // Prefer the actual browser origin when available (carries the correct scheme + port).
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  const domain = siweDomain();
  const scheme = domain.startsWith("localhost") || domain.startsWith("127.0.0.1") ? "http" : "https";
  return `${scheme}://${domain}`;
}

export interface SiweSession {
  token: string;
  address: string;
  expiresIn: number;
}

/** Step 1: fetch a single-use nonce from the server. */
export async function fetchNonce(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/nonce`, { cache: "no-store" });
  if (!res.ok) throw new Error("failed to fetch SIWE nonce");
  const data = (await res.json()) as { nonce: string };
  return data.nonce;
}

/** Step 2: build the EIP-4361 message bound to our (deploy-aware) domain/uri/chain/nonce. */
export function buildSiweMessage(address: `0x${string}`, nonce: string): string {
  return createSiweMessage({
    address,
    chainId: CHAIN_ID,
    domain: siweDomain(),
    nonce,
    uri: siweUri(),
    version: "1",
    statement: "Sign in to AURA to generate, mint, and create. Generation stays sponsored and free.",
  });
}

/** Step 3: verify the signed message and receive a short-lived JWT. */
export async function verifySiwe(message: string, signature: `0x${string}`): Promise<SiweSession> {
  const res = await fetch(`${API_BASE}/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "SIWE verification failed");
  }
  return (await res.json()) as SiweSession;
}
