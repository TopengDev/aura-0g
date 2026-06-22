// GET /health - liveness + key wiring facts (no secrets). Confirms the attestor address matches the
// deployed contract's attestor, and reports the sponsor balance + storage reachability + gen stats.
import type { FastifyInstance } from "fastify";
import { DEPLOYED, GALILEO } from "../aura/config.js";
import { attestorAddress } from "../aura/attestation.js";
import { sponsorAddress, sponsorBalance } from "../aura/wallet.js";
import { outputRead } from "../aura/contracts.js";
import { genStats } from "../aura/ratelimit.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    let onChainAttestor: string | null = null;
    let balance: string | null = null;
    try {
      onChainAttestor = await outputRead().attestor();
    } catch {
      /* RPC hiccup - report null */
    }
    try {
      balance = await sponsorBalance();
    } catch {
      /* ignore */
    }
    const attestor = attestorAddress();
    return {
      ok: true,
      chainId: GALILEO.chainId,
      contracts: {
        agentRegistry: DEPLOYED.agentRegistry,
        outputNFT: DEPLOYED.outputNFT,
        marketplace: DEPLOYED.marketplace,
      },
      sponsor: sponsorAddress(),
      attestor,
      attestorMatchesContract: onChainAttestor ? onChainAttestor.toLowerCase() === attestor.toLowerCase() : null,
      onChainAttestor,
      sponsorBalance: balance,
      gen: genStats(),
      time: new Date().toISOString(),
    };
  });
}
