// SIWE auth -> short-lived JWT.
//   GET  /auth/nonce            -> { nonce }  (single-use, stored)
//   POST /auth/verify {message,signature} -> { token, address }  (~1h JWT carrying { address })
import type { FastifyInstance } from "fastify";
import { issueNonce, verifySiwe } from "../aura/siwe.js";
import { recoverSiwePubkey, storePubkey, pubkeyMatchesAddress } from "../aura/pubkey.js";
import { JWT_TTL } from "../aura/config.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/nonce", async () => {
    return { nonce: issueNonce() };
  });

  app.post<{ Body: { message?: string; signature?: string } }>("/auth/verify", async (req, reply) => {
    const { message, signature } = req.body ?? {};
    if (!message || !signature) {
      return reply.code(400).send({ error: "message and signature required" });
    }
    const sig = (signature.startsWith("0x") ? signature : `0x${signature}`) as `0x${string}`;
    const res = await verifySiwe(message, sig);
    if (!res.ok || !res.address) {
      return reply.code(401).send({ error: res.error ?? "SIWE verification failed" });
    }
    // ERC-7857 de-mock: recover + persist the owner's secp256k1 PUBKEY from the SIWE signature, so the
    // sealing/oracle path can ECIES-seal data-keys to them later. Recovery failure must NOT break login
    // (sealing degrades to server-custody-only). Defense-in-depth: only store if it hashes to the address.
    try {
      const pubkey = await recoverSiwePubkey(message, sig);
      if (pubkeyMatchesAddress(pubkey, res.address)) {
        storePubkey(res.address, pubkey);
      } else {
        req.log.warn({ address: res.address }, "recovered SIWE pubkey did not match address - not storing");
      }
    } catch (e) {
      req.log.warn({ err: String((e as Error)?.message).slice(0, 120) }, "SIWE pubkey recovery failed (login still ok)");
    }
    const token = await reply.jwtSign({ address: res.address }, { expiresIn: JWT_TTL });
    return { token, address: res.address, expiresIn: JWT_TTL };
  });
}
