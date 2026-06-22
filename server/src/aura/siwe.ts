// SERVER-ONLY. SIWE (Sign-In With Ethereum) -> short-lived JWT. viem's generateSiweNonce +
// verifySiweMessage. The nonce is single-use (stored in SQLite, consumed on verify). The verify
// binds the SIWE domain + chainId 16602 + the issued nonce; on success the route issues a ~1h JWT.
import { generateSiweNonce, verifySiweMessage, parseSiweMessage } from "viem/siwe";
import { createPublicClient, defineChain, http } from "viem";
import { db } from "./db.js";
import { GALILEO, SIWE_DOMAIN } from "./config.js";

const galileo = defineChain({
  id: GALILEO.chainId,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [GALILEO.rpc] } },
});

let _pub: ReturnType<typeof createPublicClient> | null = null;
function publicClient() {
  if (!_pub) _pub = createPublicClient({ chain: galileo, transport: http() });
  return _pub;
}

const NONCE_TTL_MS = 10 * 60 * 1000; // 10 min to complete the SIWE handshake

/** Issue a single-use SIWE nonce, stored for verification. */
export function issueNonce(): string {
  const nonce = generateSiweNonce();
  db().prepare(`INSERT INTO siwe_nonces (nonce,created_at,used) VALUES (?,?,0)`).run(nonce, Date.now());
  return nonce;
}

/** Consume a nonce: valid only if present, unused, and not expired. Marks it used. */
function consumeNonce(nonce: string): boolean {
  const d = db();
  const row = d.prepare(`SELECT created_at, used FROM siwe_nonces WHERE nonce=?`).get(nonce) as
    | { created_at: number; used: number }
    | undefined;
  if (!row) return false;
  if (row.used) return false;
  if (Date.now() - row.created_at > NONCE_TTL_MS) return false;
  d.prepare(`UPDATE siwe_nonces SET used=1 WHERE nonce=?`).run(nonce);
  return true;
}

export interface SiweVerifyResult {
  ok: boolean;
  address?: string;
  error?: string;
}

/**
 * Verify a SIWE message+signature. Binds: our domain, chainId 16602, and a single-use server nonce.
 * Returns the recovered address on success.
 */
export async function verifySiwe(message: string, signature: `0x${string}`): Promise<SiweVerifyResult> {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch (e: any) {
    return { ok: false, error: `unparseable SIWE message: ${String(e?.message).slice(0, 80)}` };
  }
  const nonce = parsed.nonce;
  if (!nonce) return { ok: false, error: "missing nonce" };

  // chainId must be our testnet (defence-in-depth; verifySiweMessage also checks it below).
  if (parsed.chainId !== GALILEO.chainId) return { ok: false, error: `wrong chainId (expected ${GALILEO.chainId})` };

  // single-use nonce check FIRST (cheap, blocks replay before signature crypto).
  if (!consumeNonce(nonce)) return { ok: false, error: "invalid or expired nonce" };

  let valid = false;
  try {
    valid = await publicClient().verifySiweMessage({
      message,
      signature,
      domain: SIWE_DOMAIN,
      nonce,
    });
  } catch (e: any) {
    return { ok: false, error: `verify failed: ${String(e?.message).slice(0, 120)}` };
  }
  if (!valid) return { ok: false, error: "signature/domain/chain/nonce mismatch" };
  return { ok: true, address: parsed.address?.toLowerCase() };
}
