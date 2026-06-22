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
import { getJobForOwner } from "../aura/jobs.js";
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

      // recipient: default to the authed owner; allow an explicit override (validated as an address).
      let to = owner;
      if (req.body?.to) {
        if (!ethers.isAddress(req.body.to)) return reply.code(400).send({ error: "invalid `to` address" });
        to = req.body.to.toLowerCase();
      }

      const r = job.result;
      const creatorAgentId = BigInt(job.agentId);
      const seed = BigInt(r.seed);
      // fresh single-use nonce (bytes32). The contract's usedNonce guard blocks replay.
      const nonce = ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;

      const params: MintAuthParams = {
        to: ethers.getAddress(to) as `0x${string}`,
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
