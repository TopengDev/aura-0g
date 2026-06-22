// SERVER-ONLY. JWT auth plumbing for Fastify. The JWT carries { address } (lowercased) and is issued
// by the SIWE verify route. Routes that need auth use the `authenticate` preHandler; the verified
// address is then read off request.user.address (owner-scoping every job/agent action).
import type { FastifyReply, FastifyRequest } from "fastify";
// Load @fastify/jwt's type declarations (adds jwtVerify/jwtSign to Fastify request/instance).
import "@fastify/jwt";

export interface JwtPayload {
  address: string; // lowercased EVM address
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

/** preHandler: verify the Bearer JWT or 401. On success, request.user.address is set. */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    await reply.code(401).send({ error: "unauthorized - present a valid Bearer JWT from /auth/verify" });
  }
}
