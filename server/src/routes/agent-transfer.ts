// POST /agents/:id/transfer/prepare + /confirm (authed) - the ERC-7857 SECURE-TRANSFER flow, wired.
//
// The de-mock's server half, exposed as an app endpoint. Mirrors the create/mint shape: the SERVER (which
// holds the trusted re-encryption oracle key + the brain custody) computes the oracle-signed transfer args;
// the USER submits AuraINFT.transfer() with THEIR OWN wallet (non-custodial). Ownership only ever moves
// through that proof-gated on-chain call (raw ERC721 transfers revert on AuraINFT).
//
//   prepare: owner-only. Re-encrypts the brain to the buyer, seals the fresh key to the buyer's pubkey,
//            uploads the new envelope, signs the EIP-191 transfer proof, returns AuraINFT.transfer() args.
//   confirm: after the user's transfer tx lands, verifies ownerOf == buyer ON-CHAIN, then re-custodies the
//            brain to the buyer AND fires the memory DUAL-WALL reseal (the buyer's relationship starts fresh;
//            the seller's epoch key is dropped) - so the on-chain re-key and the off-chain memory wall move
//            together. NEVER prints or returns a private key.
import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import { CONTRACTS, GALILEO } from "../aura/config.js";
import { auraInftConfigured, auraInftRead } from "../aura/contracts.js";
import { reencryptForTransfer } from "../aura/oracle.js";
import { sealedToHex } from "../aura/sealing.js";
import { pubkeyOf } from "../aura/pubkey.js";
import { brainByAgentId, recustodyBrainForTransfer } from "../aura/store.js";
import { store, download } from "../aura/storage.js";
import { cachedImageByRoot, cacheImageByRoot } from "../aura/image-cache.js";
import { sponsorSigner } from "../aura/wallet.js";
import { resealRelationshipForNewOwner } from "../aura/chat-memory.js";
import { rateLimit } from "../aura/ratelimit.js";

// pending re-key, prepare -> confirm. In-memory (per process): a prepared-but-unsubmitted transfer is cheap
// to re-prepare, so losing it on restart is acceptable for the demo. Production: persist alongside agent_brains.
interface PendingTransfer {
  to: string; // lowercased buyer
  newKeyHex: string; // the fresh AES data-key (server re-custody target)
  newEncBrainRoot: string;
  newDataHash: string;
  sealedKeyHex: string;
  createdAt: number;
}
const pending = new Map<number, PendingTransfer>();

function parseAgentId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function agentTransferRoutes(app: FastifyInstance): Promise<void> {
  // POST /agents/:id/transfer/prepare  { to, toPubkey? } -> AuraINFT.transfer() args (owner-only)
  app.post<{ Params: { id: string }; Body: { to?: string; toPubkey?: string } }>(
    "/agents/:id/transfer/prepare",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraInftConfigured()) {
        return reply.code(501).send({ error: "secure transfer not enabled (AuraINFT is not wired on this deployment)" });
      }
      const from = req.user.address;
      const agentId = parseAgentId(req.params.id);
      if (agentId === null) return reply.code(400).send({ error: "bad agentId" });

      // rate limit: prepare runs an oracle re-encryption + a sponsor-paid 0G upload of the new envelope.
      const rl = rateLimit(`transfer:${from}`, 5, 60_000);
      if (!rl.ok) return reply.code(429).send({ error: "rate limited", retryInMs: rl.resetInMs });

      const to = (req.body?.to ?? "").trim();
      if (!ethers.isAddress(to)) return reply.code(400).send({ error: "`to` (recipient address) required" });
      if (to.toLowerCase() === from.toLowerCase()) return reply.code(400).send({ error: "cannot transfer to yourself" });

      const inft = auraInftRead();
      let ownerOnChain: string;
      try {
        ownerOnChain = (await inft.ownerOf(agentId)) as string;
      } catch {
        return reply.code(404).send({ error: `agent #${agentId} not found on AuraINFT` });
      }
      if (ownerOnChain.toLowerCase() !== from.toLowerCase()) {
        return reply.code(403).send({ error: "only the current on-chain owner may initiate a secure transfer" });
      }

      // buyer pubkey: from the body, else recovered from the buyer's SIWE login (wallet_pubkeys). Required to
      // ECIES-seal the re-encrypted key to them (ERC-7857 per-owner sealing).
      let toPubkey = (req.body?.toPubkey ?? "").trim() || null;
      if (toPubkey) {
        try {
          if (ethers.computeAddress(toPubkey).toLowerCase() !== to.toLowerCase()) {
            return reply.code(400).send({ error: "toPubkey does not correspond to `to`" });
          }
        } catch {
          return reply.code(400).send({ error: "invalid toPubkey" });
        }
      } else {
        toPubkey = pubkeyOf(to);
      }
      if (!toPubkey) {
        return reply.code(409).send({ error: "buyer pubkey unknown: the buyer must sign in (SIWE) once, or pass toPubkey" });
      }

      const brain = brainByAgentId(agentId);
      if (!brain) return reply.code(409).send({ error: "no brain custody for this agent on this backend (mint it through this backend to enable secure transfer)" });

      // current encrypted envelope: durable local cache first, then 0G Storage.
      let currentEnvelope: Buffer | null = cachedImageByRoot(brain.encBrainRoot)?.bytes ?? null;
      if (!currentEnvelope) {
        try {
          currentEnvelope = await download(brain.encBrainRoot);
        } catch {
          return reply.code(409).send({ error: "current brain envelope is not retrievable (cache miss + 0G eviction)" });
        }
      }

      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const re = await reencryptForTransfer({
        inft: CONTRACTS.auraINFT,
        chainId: GALILEO.chainId,
        tokenId: BigInt(agentId),
        from,
        to,
        toPubkey,
        currentEnvelope,
        currentKeyHex: brain.brainKeyHex,
        deadlineSec: deadline,
      });

      // upload the re-encrypted envelope -> newEncBrainRoot (the pointer AuraINFT stores) + cache it durably.
      const newStore = await store(sponsorSigner(), re.newEnvelope, `agent-brain-rekey-${agentId}`);
      const newEncBrainRoot = newStore.rootHash;
      cacheImageByRoot(newEncBrainRoot, re.newEnvelope, { contentType: "application/octet-stream", source: "brain" });

      const sealedKeyHex = sealedToHex(re.sealedKey);
      pending.set(agentId, {
        to: to.toLowerCase(),
        newKeyHex: re.newKeyHex,
        newEncBrainRoot,
        newDataHash: re.newDataHash,
        sealedKeyHex,
        createdAt: Date.now(),
      });

      // the args the USER submits to AuraINFT.transfer(...) with their own wallet. NO private key is returned.
      return {
        contract: CONTRACTS.auraINFT,
        chainId: GALILEO.chainId,
        method: "transfer",
        from,
        to,
        tokenId: agentId,
        newSealedKey: sealedKeyHex,
        newEncBrainRoot,
        newDataHash: re.newDataHash,
        deadline,
        proof: re.proof,
      };
    },
  );

  // POST /agents/:id/transfer/confirm - after the user's transfer tx lands: re-custody + memory reseal.
  app.post<{ Params: { id: string } }>(
    "/agents/:id/transfer/confirm",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      if (!auraInftConfigured()) return reply.code(501).send({ error: "secure transfer not enabled" });
      const agentId = parseAgentId(req.params.id);
      if (agentId === null) return reply.code(400).send({ error: "bad agentId" });
      const p = pending.get(agentId);
      if (!p) return reply.code(404).send({ error: "no pending transfer for this agent (prepare first)" });

      // verify the on-chain move actually happened (ownerOf == the prepared buyer) before mutating custody.
      let ownerOnChain: string;
      try {
        ownerOnChain = (await auraInftRead().ownerOf(agentId)) as string;
      } catch {
        return reply.code(502).send({ error: "chain read failed" });
      }
      if (ownerOnChain.toLowerCase() !== p.to) {
        return reply.code(409).send({ error: `transfer not confirmed on-chain (owner is still ${ownerOnChain}); submit AuraINFT.transfer() first` });
      }

      // re-custody the brain to the new owner (the oracle already rotated the key + envelope + seal).
      recustodyBrainForTransfer({
        agentId,
        newOwner: p.to,
        encBrainRoot: p.newEncBrainRoot,
        brainKeyHex: p.newKeyHex,
        sealedKey: p.sealedKeyHex,
        dataHash: p.newDataHash,
      });

      // the memory DUAL-WALL reseal: the buyer's relationship epoch starts fresh; the seller's epoch key is
      // dropped from custody (forward secrecy). The on-chain re-key and the off-chain memory wall move together.
      const { epoch } = resealRelationshipForNewOwner(agentId, p.to);
      pending.delete(agentId);

      return { ok: true, agentId, newOwner: p.to, brainRecustodied: true, memoryReset: true, relationshipEpoch: epoch };
    },
  );
}
