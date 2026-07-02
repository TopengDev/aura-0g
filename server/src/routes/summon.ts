// Public Summon reads for the webapp. No auth: a summon is self-funded by the BUYER (unlike /generate,
// which is sponsor-paid + owner-scoped), and a request's status is public.
//   GET /summon/agent/:agentId       -> is this agent summonable + the on-chain commission price
//   GET /summon/:requestId/status     -> the watcher's staged journal merged with the on-chain settled
//                                        state (what the ~42s progress UX polls)
import type { FastifyInstance } from "fastify";
import { ethers } from "ethers";
import { db } from "../aura/db.js";
import { summonRead, readProvider, outputRead } from "../aura/contracts.js";
import { CONTRACTS, SUMMON_START_BLOCK, DEPLOYED } from "../aura/config.js";
import { pullSeedRoot, mapSubject, deriveRarity, rarityRoll, isProvablePullSeed, ZERO_BYTES32 } from "../aura/gacha.js";

interface SummonRow {
  request_id: number;
  agent_id: number;
  agent_name: string | null;
  buyer: string;
  fee: string;
  deadline: number;
  status: string;
  progress: string | null;
  image_root: string | null;
  token_id: number | null;
  fulfill_tx: string | null;
  error: string | null;
}

// ── summon-proof (perf) ──────────────────────────────────────────────────────────────────────────────
// The proof for an output token is IMMUTABLE once its Fulfilled tx is mined, so cache it in-process. The
// old path scanned the whole Fulfilled event range (deploy-block -> head) on every Verify click, which
// was uncached and would silently exceed RPC 10k-range caps as the chain grows. The fast path now locates
// the fulfill tx via the watcher's SQLite journal (summon_requests: token_id -> request_id, fulfill_tx,
// summon_block) and verifies against chain with a couple of BOUNDED calls (getTransactionReceipt + parse
// the Fulfilled log, getBlock for the pull-seed hash). The unbounded scan survives only as a fallback for
// a token not in this journal, and it is chunked.
const proofCache = new Map<number, unknown>();

interface SummonProofRow {
  request_id: number;
  agent_id: number;
  buyer: string;
  token_id: number | null;
  fulfill_tx: string | null;
  summon_block: number | null;
}

/** Recompute the provable-pull roll (gacha-depth) from PUBLIC on-chain preimage. Best-effort: any failure
 *  returns null and the economic proof still stands on its own. Uses summon_block (bounded getBlock) when
 *  known; otherwise, if given a scan range, the indexed Summoned(requestId) query. */
async function computeRoll(
  esc: ethers.Contract,
  requestId: number,
  buyer: string,
  agentId: number,
  tokenId: number,
  summonBlock: number | null,
  scan: { start: number; latest: number } | null,
): Promise<unknown> {
  try {
    let summonBlockHash: string = ZERO_BYTES32;
    if (summonBlock != null) {
      const blk = await readProvider().getBlock(summonBlock);
      if (blk?.hash) summonBlockHash = blk.hash;
    } else if (scan) {
      const sevs = (await esc.queryFilter(esc.filters.Summoned(requestId), scan.start, scan.latest)) as ethers.EventLog[];
      if (sevs[0]?.blockHash) summonBlockHash = sevs[0].blockHash;
    }
    const seedRoot = pullSeedRoot({ requestId, buyer, agentId, summonBlockHash });
    const onChainSeed: bigint = (await outputRead().provenanceOf(tokenId)).seed;
    const seedMatches = seedRoot === onChainSeed;
    const provable = seedMatches && isProvablePullSeed(onChainSeed);
    const subject = mapSubject(onChainSeed);
    const rarity = deriveRarity(onChainSeed);
    return {
      provable, // true => the seed recomputes from public preimage AND is a real pull seed
      seedMatches, // seedRoot (recomputed) == on-chain Provenance.seed
      rarity, // Common | Rare | Epic | Legendary (Common when not a provable pull)
      rarityRoll: isProvablePullSeed(onChainSeed) ? rarityRoll(onChainSeed) : null, // 0..9999
      subject: subject.tuple, // the 12-dimension subject the model rendered
      subjectProse: subject.prose,
      onChainSeed: onChainSeed.toString(),
      recomputedSeedRoot: seedRoot.toString(),
      // the EXACT public preimage a juror re-hashes (keccak256(abi.encode(DOMAIN, ...))). See verify.ts.
      seedPreimage: { domain: "AURA-PULL-v1", requestId, buyer, agentId, summonBlockHash },
    };
  } catch {
    return null; // recompute is best-effort; the economic proof above still stands on its own.
  }
}

/** Shape the JURY-VERIFIABLE economic proof from an on-chain Fulfilled event's args (parsed from the log,
 *  not our DB, so a juror trusts the chain). */
function shapeProof(tokenId: number, args: ethers.Result, fulfillTx: string, roll: unknown): Record<string, unknown> {
  const ownerCut = args.ownerCut as bigint;
  const platformFee = args.platformFee as bigint;
  const fee = ownerCut + platformFee;
  return {
    tokenId,
    isSummon: true,
    enabled: true,
    requestId: Number(args.requestId),
    agentId: Number(args.agentId),
    buyer: args.buyer as string,
    agentOwner: args.agentOwner as string,
    ownerCutWei: ownerCut.toString(),
    ownerCut: ethers.formatEther(ownerCut),
    platformFeeWei: platformFee.toString(),
    platformFee: ethers.formatEther(platformFee),
    feeWei: fee.toString(),
    fee: ethers.formatEther(fee),
    fulfillTx,
    escrow: CONTRACTS.summonEscrow,
    roll,
  };
}

export async function summonRoutes(app: FastifyInstance): Promise<void> {
  // GET /summon/agent/:agentId -> { agentId, enabled, summonable, priceWei, price }
  app.get<{ Params: { agentId: string } }>("/summon/agent/:agentId", async (req, reply) => {
    const agentId = Number(req.params.agentId);
    if (!Number.isInteger(agentId) || agentId < 1) return reply.code(400).send({ error: "bad agentId" });
    if (!CONTRACTS.summonEscrow) {
      return { agentId, enabled: false, summonable: false, priceWei: "0", price: "0", escrow: null };
    }
    try {
      const price: bigint = await summonRead().summonPrice(agentId);
      return {
        agentId,
        enabled: true,
        summonable: price > 0n,
        priceWei: price.toString(),
        price: ethers.formatEther(price),
        escrow: CONTRACTS.summonEscrow,
      };
    } catch (e: unknown) {
      return reply.code(502).send({ error: `chain read failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}` });
    }
  });

  // GET /summon/:requestId/status -> the off-chain journal (watcher stages) merged with on-chain truth.
  app.get<{ Params: { requestId: string } }>("/summon/:requestId/status", async (req, reply) => {
    const id = Number(req.params.requestId);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "bad requestId" });

    const row = db().prepare(`SELECT * FROM summon_requests WHERE request_id = ?`).get(id) as SummonRow | undefined;

    let onChain: { buyer: string; agentId: number; fee: string; deadline: number; settled: boolean } | null = null;
    if (CONTRACTS.summonEscrow) {
      try {
        const r = await summonRead().requests(id);
        if (r.buyer && r.buyer !== ethers.ZeroAddress) {
          onChain = { buyer: r.buyer, agentId: Number(r.agentId), fee: r.fee.toString(), deadline: Number(r.deadline), settled: r.settled };
        }
      } catch {
        /* chain read best-effort */
      }
    }

    if (!row && !onChain) return reply.code(404).send({ error: "no such summon request" });

    const feeWei = row?.fee ?? onChain?.fee ?? null;
    const settled = onChain?.settled ?? (row?.status === "fulfilled" || row?.status === "settled");
    const deadline = row?.deadline ?? onChain?.deadline ?? 0;
    const expired = !settled && deadline > 0 && Math.floor(Date.now() / 1000) > deadline;

    return {
      requestId: id,
      // the journal status is richer (generating/fulfilling); fall back to on-chain when the watcher is off.
      status: row?.status ?? (settled ? "settled" : "pending"),
      progress: row?.progress ?? null, // human-readable stage line (persisted by the watcher's setStatus)
      agentId: row?.agent_id ?? onChain?.agentId ?? null,
      agentName: row?.agent_name ?? null,
      buyer: row?.buyer ?? onChain?.buyer ?? null,
      feeWei,
      fee: feeWei ? ethers.formatEther(BigInt(feeWei)) : null,
      deadline,
      imageRoot: row?.image_root ?? null,
      tokenId: row?.token_id ?? null,
      fulfillTx: row?.fulfill_tx ?? null,
      settled,
      expired,
      error: row?.error ?? null,
    };
  });

  // GET /summon/output/:tokenId/proof -> the JURY-VERIFIABLE economic proof: was this output minted by a
  // paid summon, and how did the fee split? The economic numbers are always read from the ON-CHAIN Fulfilled
  // event (parsed from the tx log), so a juror trusts the chain, not us. tokenId is a DATA field on Fulfilled
  // (not indexed), so the FAST PATH uses the watcher's journal only as a POINTER (token_id -> fulfill_tx) and
  // verifies with a bounded getTransactionReceipt; the chunked event scan survives as the fallback for a
  // token not in this journal. { isSummon:false } when no summon minted this token. Immutable once settled,
  // so cached in-process.
  app.get<{ Params: { tokenId: string } }>("/summon/output/:tokenId/proof", async (req, reply) => {
    const tokenId = Number(req.params.tokenId);
    if (!Number.isInteger(tokenId) || tokenId < 1) return reply.code(400).send({ error: "bad tokenId" });
    if (!CONTRACTS.summonEscrow) return { tokenId, isSummon: false, enabled: false };

    // immutable once settled -> serve a cached proof without any chain read.
    const cached = proofCache.get(tokenId);
    if (cached !== undefined) return cached;

    try {
      const esc = summonRead();

      // ── FAST PATH: locate the fulfill tx via the watcher's journal, verify with bounded calls ──
      let row: SummonProofRow | undefined;
      try {
        row = db()
          .prepare(`SELECT request_id, agent_id, buyer, token_id, fulfill_tx, summon_block FROM summon_requests WHERE token_id = ?`)
          .get(tokenId) as SummonProofRow | undefined;
      } catch {
        row = undefined; // schema/DB hiccup -> fall through to the scan
      }
      if (row?.fulfill_tx) {
        const receipt = await readProvider().getTransactionReceipt(row.fulfill_tx);
        if (receipt) {
          const escAddr = (CONTRACTS.summonEscrow ?? "").toLowerCase();
          for (const lg of receipt.logs) {
            if (lg.address.toLowerCase() !== escAddr) continue;
            let parsed: ethers.LogDescription | null = null;
            try {
              parsed = esc.interface.parseLog({ topics: [...lg.topics], data: lg.data });
            } catch {
              continue; // not one of the escrow's events
            }
            if (parsed && parsed.name === "Fulfilled" && Number(parsed.args.tokenId) === tokenId) {
              const roll = await computeRoll(esc, Number(parsed.args.requestId), parsed.args.buyer as string, Number(parsed.args.agentId), tokenId, row.summon_block, null);
              const result = shapeProof(tokenId, parsed.args, row.fulfill_tx, roll);
              proofCache.set(tokenId, result);
              return result;
            }
          }
        }
        // journal pointed at a tx we could not verify -> fall through to the authoritative scan below.
      }

      // ── FALLBACK: chunked on-chain Fulfilled scan (token not in this journal, or unverifiable tx) ──
      const latest = await readProvider().getBlockNumber();
      // lower bound: the escrow's deploy block (set SUMMON_START_BLOCK at deploy). Falls back to the v2
      // deploy block, then a bounded recent window, so a juror's read stays cheap.
      const start = SUMMON_START_BLOCK ?? DEPLOYED.deployBlock ?? Math.max(0, latest - 200_000);
      const CHUNK = 5000;
      let match: ethers.EventLog | null = null;
      for (let from = start; from <= latest && !match; from += CHUNK) {
        const to = Math.min(from + CHUNK - 1, latest);
        const evs = await esc.queryFilter(esc.filters.Fulfilled(), from, to);
        match = (evs as ethers.EventLog[]).find((e) => Number(e.args.tokenId) === tokenId) ?? null;
      }
      if (!match) {
        const miss = { tokenId, isSummon: false, enabled: true };
        proofCache.set(tokenId, miss); // a token minted outside a summon can never later become a summon
        return miss;
      }

      const a = match.args;
      const roll = await computeRoll(esc, Number(a.requestId), a.buyer as string, Number(a.agentId), tokenId, row?.summon_block ?? null, { start, latest });
      const result = shapeProof(tokenId, a, match.transactionHash, roll);
      proofCache.set(tokenId, result);
      return result;
    } catch (e: unknown) {
      return reply.code(502).send({ error: `chain read failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}` });
    }
  });
}
