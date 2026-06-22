// SIWE auth -> short-lived JWT.
//   GET  /auth/nonce            -> { nonce }  (single-use, stored)
//   POST /auth/verify {message,signature} -> { token, address }  (~1h JWT carrying { address })
import type { FastifyInstance } from "fastify";
import { issueNonce, verifySiwe } from "../aura/siwe.js";
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
    const token = await reply.jwtSign({ address: res.address }, { expiresIn: JWT_TTL });
    return { token, address: res.address, expiresIn: JWT_TTL };
  });
}
