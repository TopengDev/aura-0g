// Off-chain SIWE sign-in for the authed surface (chat). Reads AURA_KEY (a wallet private key) from the ENV
// ONLY, builds the EIP-4361 message, signs it LOCALLY with ethers, and exchanges it for a short-lived JWT.
// The key never leaves this process and is never transmitted: only the message + signature go to
// /auth/verify - the SAME non-custodial flow the web wallet uses. No gas, no on-chain tx; a sign-in
// signature only. This is the "future signed path" the summon command anticipated for AURA_KEY.
import { Wallet } from "ethers";
import { api } from "./api.ts";

// The SIWE message binds to the SITE origin (NOT the API host) and MUST equal the server's SIWE_DOMAIN
// (prod: aura.topengdev.com). Overridable for a local backend whose SIWE_DOMAIN differs - mirrors the
// web's NEXT_PUBLIC_SIWE_DOMAIN. chainId is 0G Galileo (16602).
const SIWE_DOMAIN = (process.env.AURA_SIWE_DOMAIN ?? "aura.topengdev.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
const SIWE_URI =
  process.env.AURA_SIWE_URI ??
  (SIWE_DOMAIN.startsWith("localhost") || SIWE_DOMAIN.startsWith("127.0.0.1") ? `http://${SIWE_DOMAIN}` : `https://${SIWE_DOMAIN}`);
const CHAIN_ID = Number(process.env.AURA_CHAIN_ID ?? 16602);
const STATEMENT = "Sign in to AURA to chat with an Aura. Off-chain signature only, no funds move.";

export interface Session {
  token: string;
  address: string;
}

/** Load the signing wallet from AURA_KEY (env only). Clear, actionable errors - never an ethers stack trace. */
function loadWallet(): Wallet {
  const raw = process.env.AURA_KEY;
  if (!raw) {
    throw new Error(
      "chat needs a wallet to sign in. Set AURA_KEY to a private key - it never leaves your machine and signs\n" +
        "  only an off-chain SIWE message (no gas, no on-chain tx, no spend):\n" +
        '    export AURA_KEY=0x...     then  aura chat <name|id> "your message"\n' +
        "  ('aura chat --health' needs no key.)",
    );
  }
  const pk = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("AURA_KEY is not a valid 32-byte hex private key");
  try {
    return new Wallet(pk);
  } catch {
    throw new Error("AURA_KEY could not be loaded as a wallet (check the private key)");
  }
}

/** Build the canonical EIP-4361 message the server (viem) parses + verifies. */
function buildSiweMessage(address: string, nonce: string): string {
  const issuedAt = new Date().toISOString();
  return (
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:\n` +
    `${address}\n\n` +
    `${STATEMENT}\n\n` +
    `URI: ${SIWE_URI}\n` +
    `Version: 1\n` +
    `Chain ID: ${CHAIN_ID}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}`
  );
}

/** SIWE sign-in: nonce -> sign locally with AURA_KEY -> JWT. The key never leaves this process. */
export async function signIn(): Promise<Session> {
  const wallet = loadWallet();
  const nonce = await api.authNonce();
  const message = buildSiweMessage(wallet.address, nonce);
  const signature = await wallet.signMessage(message);
  const session = await api.authVerify(message, signature);
  return { token: session.token, address: session.address };
}
