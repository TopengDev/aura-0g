// POST /mint-args (authed, owner-scoped) - THE critical integration.
// For a DONE generation job owned by the caller, return everything the user needs to submit mintOutput
// themselves: { to, creatorAgentId, imageRoot, provenanceHash, teeAttestation, seed, nonce,
// attestationSig } + an eip712 block. The attestationSig is the attestor's EIP-712 MintAuth signature
// that the deployed OutputNFT verifies (recovered signer must == attestor, nonce single-use).
//
// `to` defaults to jwt.address but the caller MAY mint to an explicit `to` (the contract accepts any
// recipient; the attestation binds whatever `to` is signed, so a tampered `to` is rejected on-chain).
import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import { getJobForOwner, getMintAttestation, claimMintAttestation } from "../aura/jobs.js";
import { signMintAuth, eip712Block, type MintAuthParams } from "../aura/attestation.js";
import { outputRead } from "../aura/contracts.js";
import { CONTRACTS, GALILEO } from "../aura/config.js";
import type { MintArgsResponse } from "../aura/types.js";

export async function mintArgsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { jobId?: string; to?: string } }>(
    "/mint-args",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const owner = req.user.address;
      const { jobId } = req.body ?? {};
      if (!jobId) return reply.code(400).send({ error: "jobId required" });

      const job = getJobForOwner(jobId, owner);
      if (!job) return reply.code(404).send({ error: "job not found (or not owned by you)" });
      if (job.status !== "done" || !job.result) {
        return reply.code(409).send({ error: `job not mintable (status=${job.status})` });
      }

      // SINGLE-MINT SENTINEL (M2): a done job may back AT MOST ONE OutputNFT. Without this, /mint-args
      // signs a FRESH nonce every call, so one sponsored generation could be re-attested into N Relics to
      // any recipient - breaking 1-generation=1-Relic scarcity. We record the ONE nonce (+ bound recipient)
      // issued per job and never sign a SECOND distinct one:
      //   - already-issued + consumed on-chain -> 409 (the Relic exists).
      //   - already-issued + NOT yet consumed  -> re-serve the SAME nonce/recipient (idempotent retry; a
      //     differing `to` is ignored so a second distinct sig can never be produced).
      //   - never issued -> atomically claim a fresh nonce (the WHERE mint_nonce IS NULL claim also makes
      //     two concurrent first calls converge on ONE nonce). The on-chain usedNonce guard is the ultimate
      //     backstop; this stops a second SIGNATURE from ever existing.
      let to: `0x${string}`;
      let nonce: `0x${string}`;
      const existing = getMintAttestation(jobId);
      if (existing) {
        let consumed = false;
        try {
          consumed = Boolean(await outputRead().usedNonce(existing.nonce));
        } catch {
          consumed = false; // cannot confirm -> re-serve the SAME nonce (on-chain usedNonce still prevents a double mint)
        }
        if (consumed) {
          return reply
            .code(409)
            .send({ error: "already minted: this generation's Relic was already minted (1 generation = 1 Relic)" });
        }
        // outstanding-but-unconsumed: re-serve the SAME attestation (never a new distinct nonce).
        to = ethers.getAddress(existing.to && ethers.isAddress(existing.to) ? existing.to : owner) as `0x${string}`;
        nonce = existing.nonce as `0x${string}`;
      } else {
        // first issuance: recipient defaults to the authed owner; allow an explicit override (validated).
        let toRaw = owner;
        if (req.body?.to) {
          if (!ethers.isAddress(req.body.to)) return reply.code(400).send({ error: "invalid `to` address" });
          toRaw = req.body.to.toLowerCase();
        }
        const fresh = ethers.hexlify(ethers.randomBytes(32));
        const claimed = claimMintAttestation(jobId, fresh, toRaw); // atomic single-writer claim
        if (claimed === fresh) {
          nonce = fresh as `0x${string}`;
          to = ethers.getAddress(toRaw) as `0x${string}`;
        } else {
          // a concurrent first call won the claim -> use ITS attestation (never issue a 2nd distinct nonce).
          const won = getMintAttestation(jobId);
          nonce = (won?.nonce ?? claimed) as `0x${string}`;
          to = ethers.getAddress(won?.to && ethers.isAddress(won.to) ? won.to : toRaw) as `0x${string}`;
        }
      }

      const r = job.result;
      const creatorAgentId = BigInt(job.agentId);
      const seed = BigInt(r.seed);

      const params: MintAuthParams = {
        to,
        creatorAgentId,
        imageRoot: r.imageRoot,
        provenanceHash: r.provenanceHash as `0x${string}`,
        teeAttestation: r.teeAttestation as `0x${string}`,
        seed,
        nonce,
      };

      const attestationSig = await signMintAuth(params);

      const out: MintArgsResponse = {
        contract: CONTRACTS.outputNFT,
        chainId: GALILEO.chainId,
        to: params.to,
        creatorAgentId: job.agentId,
        imageRoot: r.imageRoot,
        provenanceHash: r.provenanceHash,
        teeAttestation: r.teeAttestation,
        seed: seed.toString(),
        nonce,
        attestationSig,
        eip712: eip712Block(params),
      };
      return out;
    },
  );

  // GET /mint-args/nonce-status/:nonce - small helper to let a client check if a nonce was consumed.
  app.get<{ Params: { nonce: string } }>("/mint-args/nonce-status/:nonce", async (req, reply) => {
    const n = req.params.nonce;
    if (!/^0x[0-9a-fA-F]{64}$/.test(n)) return reply.code(400).send({ error: "nonce must be a 0x bytes32" });
    try {
      const used = await outputRead().usedNonce(n);
      return { nonce: n, used: Boolean(used) };
    } catch (e: any) {
      return reply.code(502).send({ error: `chain read failed: ${String(e?.message).slice(0, 100)}` });
    }
  });
}
