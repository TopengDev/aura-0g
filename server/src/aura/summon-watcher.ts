// SERVER-ONLY. The Summon fulfillment watcher (the autonomous runner).
//
// Watches the SummonEscrow for `Summoned` events -> runs the REAL TEE generation for the commissioned
// agent (the proven ~42s 0G Compute path) -> signs the attestor MintAuth -> calls fulfill(), which mints
// the output to the BUYER (attestation-gated) and splits the fee to the agent's CURRENT owner + platform.
// The runner self-signs as the SPONSOR (== attestor), so NO user wallet is needed for the agent's action.
//
// IDEMPOTENT + RETRY-SAFE by construction:
//   - the ON-CHAIN `requests(id).settled` flag is the source of truth (checked before every fulfill, and
//     again immediately before the tx send) so a crashed-but-landed fulfill, or a concurrent fulfill, can
//     never double-mint or double-split;
//   - a SQLite journal (summon_requests) tracks off-chain work across restarts; a persisted scan cursor
//     means a restart resumes, never re-scans from 0; an in-process in-flight set prevents re-processing a
//     request already being worked in THIS process (and lets a restart re-pick orphaned in-flight rows).
//
// REFUND-after-deadline is the BUYER's lever (anti-rug), NOT the runner's: the watcher only marks an
// unfulfillable request 'expired' so the UI can surface the refund button; it never moves the buyer's money.
import { ethers } from "ethers";
import { db } from "./db.js";
import { summonRead, summonWrite, readProvider } from "./contracts.js";
import { sponsorSigner } from "./wallet.js";
import { signSettlementMintAuth, type MintAuthParams } from "./attestation.js";
import { generateAndProve, type GenProof } from "./generate.js";
import { pullSeedRoot, mapSubject, ZERO_BYTES32 } from "./gacha.js";
import { rawAgent } from "./agents.js";
import { genGuardAcquire, genGuardRelease } from "./ratelimit.js";
import {
  CONTRACTS,
  GAS,
  GALILEO,
  DEPLOYED,
  SUMMON_POLL_MS,
  SUMMON_START_BLOCK,
  SUMMON_PROMPT,
  MAX_SUMMON_ATTEMPTS,
  SUMMON_RETRY_BACKOFF_MS,
} from "./config.js";

/** The gen function the watcher uses. Injectable so the e2e can swap in a fast deterministic stub.
 *  `pull` carries the deterministic gacha seedRoot + the hash-into-pools subject for THIS summon (the
 *  watcher computes them from the on-chain preimage before calling). */
export type SummonGenFn = (args: {
  agentId: number;
  agentName: string;
  encBrainRoot: string;
  prompt: string;
  pull?: { seedRoot: bigint; subjectProse: string };
}) => Promise<GenProof>;

const defaultGenFn: SummonGenFn = ({ agentId, agentName, encBrainRoot, prompt, pull }) =>
  generateAndProve({ agentId, agentName, encBrainRoot, userPrompt: prompt, label: `summon-${agentId}-${seedLabel()}`, pull });

// time-based label without Date.now() typing fuss; only used as a 0G object name.
function seedLabel(): string {
  return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17);
}

type ProcessResult = "fulfilled" | "failed" | "settled" | "expired" | "deferred" | "abandoned";

interface SummonRow {
  request_id: number;
  agent_id: number;
  agent_name: string | null;
  buyer: string;
  fee: string;
  deadline: number;
  status: string;
  token_id: number | null;
  attempts: number;
  updated_at: string;
  summon_block: number | null; // block the Summoned event landed in (for the deterministic pull seed)
}

export interface PollResult {
  scanned: number; // new Summoned events ingested this cycle
  processed: number; // requests we attempted to act on
  fulfilled: number;
  failed: number;
  skipped: number; // already-settled / expired / deferred / in-flight
}

export interface SummonWatcherOptions {
  genFn?: SummonGenFn;
  pollMs?: number;
  prompt?: string;
  log?: (msg: string) => void;
}

export class SummonWatcher {
  private genFn: SummonGenFn;
  private pollMs: number;
  private prompt: string;
  private log: (msg: string) => void;
  private inFlight = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(opts: SummonWatcherOptions = {}) {
    this.genFn = opts.genFn ?? defaultGenFn;
    this.pollMs = opts.pollMs ?? SUMMON_POLL_MS;
    this.prompt = opts.prompt ?? SUMMON_PROMPT;
    this.log = opts.log ?? (() => {});
  }

  // ── cursor persistence ──
  private getCursor(): number {
    const row = db().prepare(`SELECT cursor_block FROM summon_watcher_state WHERE id = 1`).get() as
      | { cursor_block: number }
      | undefined;
    return row?.cursor_block ?? -1;
  }
  private setCursor(block: number): void {
    db()
      .prepare(
        `INSERT INTO summon_watcher_state (id, cursor_block) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET cursor_block = excluded.cursor_block`,
      )
      .run(block);
  }

  // ── one scan + process cycle (the unit the e2e drives directly) ──
  async pollOnce(): Promise<PollResult> {
    const provider = readProvider();
    const esc = summonRead();
    const latest = await provider.getBlockNumber();

    let cursor = this.getCursor();
    if (cursor < 0) {
      // no persisted cursor: start where told, else just before the deploy block (Galileo), else genesis.
      cursor = (SUMMON_START_BLOCK ?? Math.max(0, (DEPLOYED.deployBlock ?? 1) - 1)) - 1;
    }

    let scanned = 0;
    const fromBlock = cursor + 1;
    if (fromBlock <= latest) {
      const CHUNK = 2000; // bounded ranges keep us under RPC getLogs limits
      for (let start = fromBlock; start <= latest; start += CHUNK) {
        const end = Math.min(start + CHUNK - 1, latest);
        const evs = await esc.queryFilter(esc.filters.Summoned(), start, end);
        for (const ev of evs) {
          const a = (ev as ethers.EventLog).args;
          this.upsertRequest({
            requestId: Number(a.requestId),
            agentId: Number(a.agentId),
            buyer: String(a.buyer),
            fee: a.fee.toString(),
            deadline: Number(a.deadline),
            summonBlock: (ev as ethers.EventLog).blockNumber, // root of the deterministic pull seed
          });
          scanned++;
        }
      }
      this.setCursor(latest);
    }

    // process every non-terminal request not already being worked in THIS process.
    const rows = db()
      .prepare(
        `SELECT * FROM summon_requests WHERE status IN ('pending','generating','fulfilling','failed')
         ORDER BY request_id ASC`,
      )
      .all() as SummonRow[];

    let processed = 0;
    let fulfilled = 0;
    let failed = 0;
    let skipped = 0;
    for (const row of rows) {
      if (this.inFlight.has(row.request_id)) {
        skipped++;
        continue;
      }
      processed++;
      const r = await this.processRequest(row);
      if (r === "fulfilled") fulfilled++;
      else if (r === "failed" || r === "abandoned") failed++;
      else skipped++;
    }
    return { scanned, processed, fulfilled, failed, skipped };
  }

  // ── process a single request (idempotent end-to-end) ──
  private async processRequest(row: SummonRow): Promise<ProcessResult> {
    const id = row.request_id;
    this.inFlight.add(id);
    let acquired = false;
    try {
      const esc = summonRead();
      const onChain = await esc.requests(id);

      // already terminal on-chain (fulfilled or refunded by anyone) -> reconcile + stop. Never re-fulfill.
      if (onChain.settled) {
        this.markSettled(id);
        return "settled";
      }

      const now = Math.floor(Date.now() / 1000);
      if (now > Number(onChain.deadline)) {
        this.setStatus(id, "expired", "deadline passed before fulfillment; buyer may refund");
        return "expired";
      }

      // B-4 (regen amplifier): decide whether to regenerate, back off, or give up. ABANDON once attempts
      // hit the ceiling (each prior generation bumped `attempts`) -> mark TERMINAL ('abandoned', not in the
      // reprocess set) instead of regenerating on every poll. BACKOFF a recently-'failed' request so it is
      // not re-generated (sponsor-paid) on a tight loop. The buyer's refund lever is unaffected either way.
      const decision = summonRetryDecision({
        attempts: row.attempts,
        status: row.status,
        updatedAtMs: Date.parse(row.updated_at),
        nowMs: Date.now(),
      });
      if (decision === "abandon") {
        this.abandon(id, `max fulfill attempts (${MAX_SUMMON_ATTEMPTS}) reached; not regenerating (buyer may refund)`);
        return "abandoned";
      }
      if (decision === "backoff") return "deferred";

      // shared cost guard (protects the funded sponsor wallet). If no slot, leave 'pending' + retry later.
      // Attribute the per-address quota to the buyer (B-2); summons are paid on-chain so this is extra
      // defense-in-depth on top of the global cap.
      const guard = genGuardAcquire(row.buyer);
      if (!guard.ok) {
        this.setStatus(id, "pending", `awaiting a gen slot: ${guard.reason ?? "busy"}`);
        return "deferred";
      }
      acquired = true;

      const agent = await rawAgent(row.agent_id);
      if (!agent) {
        this.fail(id, `agent #${row.agent_id} not found on-chain`);
        return "failed";
      }

      // gacha-depth: root the deterministic, operator-un-grindable PULL seed in the on-chain preimage.
      // requestId is UNIQUE per summon (nextRequestId++) -> a distinct seed per pull (literal enforcement);
      // summonBlockHash (the hash of the block the summon landed in) is unknown to BOTH parties until after
      // commitment, closing buyer-side grinding. The same seed roots both the subject + the rarity. A
      // getBlock failure throws -> the request is retried (NOT fulfilled with a non-gacha relic).
      let summonBlockHash = ZERO_BYTES32;
      if (row.summon_block != null) {
        const blk = await readProvider().getBlock(row.summon_block);
        if (!blk?.hash) throw new Error(`summon block ${row.summon_block} hash unavailable (transient) - will retry`);
        summonBlockHash = blk.hash;
      }
      const seedRoot = pullSeedRoot({
        requestId: row.request_id,
        buyer: row.buyer,
        agentId: row.agent_id,
        summonBlockHash,
      });
      const pull = { seedRoot, subjectProse: mapSubject(seedRoot).prose };

      this.setStatus(id, "generating", "generating the commissioned output inside the TEE (~42s)");
      this.bumpAttempts(id);
      const proof = await this.genFn({
        agentId: agent.agentId,
        agentName: agent.name,
        encBrainRoot: agent.encBrainRoot,
        prompt: this.prompt,
        pull,
      });

      // fresh single-use nonce; sign the attestor SettlementMintAuth binding the BUYER + agent + the gen
      // proof + the SETTLER (this escrow). Binding the settler is the H-1 fix: the sig only validates when
      // the escrow itself calls mintForSettlement, so a leaked sig can't be front-run via a direct call.
      const nonce = ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;
      const params: MintAuthParams = {
        to: ethers.getAddress(row.buyer) as `0x${string}`,
        creatorAgentId: BigInt(row.agent_id),
        imageRoot: proof.imageRoot,
        provenanceHash: proof.provenanceHash as `0x${string}`,
        teeAttestation: proof.teeAttestation as `0x${string}`,
        seed: BigInt(proof.seed),
        nonce,
      };
      const sig = await signSettlementMintAuth(params, ethers.getAddress(CONTRACTS.summonEscrow) as `0x${string}`);
      this.recordProof(id, proof, nonce, agent.name);

      // re-check settled RIGHT before sending (covers a concurrent fulfill or a prior crashed-but-landed tx).
      const recheck = await esc.requests(id);
      if (recheck.settled) {
        this.markSettled(id);
        return "settled";
      }

      this.setStatus(id, "fulfilling", "submitting fulfill() -> mint to buyer + split the fee");
      const tx = await summonWrite(sponsorSigner()).fulfill(
        id,
        proof.imageRoot,
        proof.provenanceHash,
        proof.teeAttestation,
        BigInt(proof.seed),
        nonce,
        sig,
        { gasPrice: GAS.gasPrice },
      );
      const rcpt = await tx.wait();
      if (!rcpt) throw new Error("fulfill tx returned no receipt");

      const tokenId = this.tokenIdFromReceipt(rcpt);
      this.markFulfilled(id, tokenId, rcpt.hash);
      this.log(`summon #${id} fulfilled -> output #${tokenId ?? "?"} tx ${rcpt.hash}`);
      return "fulfilled";
    } catch (e: unknown) {
      const msg = errMsg(e);
      // B-4: a settled-elsewhere / nonce-already-used revert is NOT transient - regenerating can never
      // succeed (the request is or will be settled), so mark it TERMINAL instead of looping. The H-1 fix
      // already prevents an attacker from pre-consuming the SETTLEMENT nonce, so this mainly catches a
      // genuine concurrent/own settle; either way, stop burning the sponsor.
      if (isTerminalRevert(msg)) {
        this.abandon(id, `terminal revert, not regenerating: ${msg}`);
        return "abandoned";
      }
      // otherwise transient: mark 'failed'. It is retried (after backoff, up to MAX_SUMMON_ATTEMPTS) WITHOUT
      // settling. If this attempt already pushed attempts to the ceiling, mark terminal now so we don't make
      // one more pointless generation next poll.
      this.fail(id, msg);
      if (this.attemptsOf(id) >= MAX_SUMMON_ATTEMPTS) {
        this.abandon(id, `max fulfill attempts (${MAX_SUMMON_ATTEMPTS}) reached after error: ${msg}`);
        return "abandoned";
      }
      return "failed";
    } finally {
      if (acquired) genGuardRelease();
      this.inFlight.delete(id);
    }
  }

  private tokenIdFromReceipt(rcpt: ethers.TransactionReceipt): number | null {
    const iface = new ethers.Interface([
      "event Fulfilled(uint256 indexed requestId,uint256 indexed agentId,address indexed buyer,uint256 tokenId,address agentOwner,uint256 ownerCut,uint256 platformFee)",
    ]);
    for (const lg of rcpt.logs) {
      try {
        const p = iface.parseLog(lg);
        if (p?.name === "Fulfilled") return Number(p.args.tokenId);
      } catch {
        /* not our event */
      }
    }
    return null;
  }

  // ── interval poller (prod). Non-overlapping: the next tick is scheduled only after the current finishes. ──
  start(): void {
    if (this.timer) return;
    if (!CONTRACTS.summonEscrow) {
      this.log("SummonWatcher NOT started: CONTRACTS.summonEscrow is empty (set SUMMON_ESCROW_ADDR)");
      return;
    }
    this.running = true;
    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        const r = await this.pollOnce();
        if (r.fulfilled || r.failed || r.scanned) this.log(`poll ${JSON.stringify(r)}`);
      } catch (e: unknown) {
        this.log(`poll error: ${errMsg(e)}`);
      } finally {
        if (this.running) this.timer = setTimeout(() => void tick(), this.pollMs);
      }
    };
    this.timer = setTimeout(() => void tick(), 0);
    this.log(`SummonWatcher started (escrow ${CONTRACTS.summonEscrow}, chain ${GALILEO.chainId}, poll ${this.pollMs}ms)`);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  // ── journal writes ──
  private upsertRequest(r: { requestId: number; agentId: number; buyer: string; fee: string; deadline: number; summonBlock: number }): void {
    const now = nowIso();
    db()
      .prepare(
        `INSERT INTO summon_requests (request_id, agent_id, buyer, fee, deadline, summon_block, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(request_id) DO UPDATE SET summon_block = COALESCE(summon_requests.summon_block, excluded.summon_block)`,
      )
      .run(r.requestId, r.agentId, r.buyer.toLowerCase(), r.fee, r.deadline, r.summonBlock, now, now);
  }

  private setStatus(id: number, status: string, _detail: string): void {
    db()
      .prepare(`UPDATE summon_requests SET status = ?, updated_at = ? WHERE request_id = ?`)
      .run(status, nowIso(), id);
  }

  private bumpAttempts(id: number): void {
    db().prepare(`UPDATE summon_requests SET attempts = attempts + 1, updated_at = ? WHERE request_id = ?`).run(nowIso(), id);
  }

  private recordProof(id: number, proof: GenProof, nonce: string, agentName: string): void {
    db()
      .prepare(
        `UPDATE summon_requests SET agent_name = ?, image_root = ?, provenance_hash = ?, tee_attestation = ?,
           seed = ?, nonce = ?, updated_at = ? WHERE request_id = ?`,
      )
      .run(agentName, proof.imageRoot, proof.provenanceHash, proof.teeAttestation, String(proof.seed), nonce, nowIso(), id);
  }

  private markFulfilled(id: number, tokenId: number | null, tx: string): void {
    db()
      .prepare(
        `UPDATE summon_requests SET status = 'fulfilled', token_id = ?, fulfill_tx = ?, error = NULL, updated_at = ?
         WHERE request_id = ?`,
      )
      .run(tokenId, tx, nowIso(), id);
  }

  private markSettled(id: number): void {
    // settled on-chain but not by our happy-path tx (refunded, or fulfilled elsewhere). Don't clobber a
    // row we already marked 'fulfilled' (has a token_id). Otherwise mark generic terminal 'settled'.
    db()
      .prepare(
        `UPDATE summon_requests SET status = 'settled', updated_at = ?
         WHERE request_id = ? AND status NOT IN ('fulfilled')`,
      )
      .run(nowIso(), id);
  }

  private fail(id: number, error: string): void {
    db()
      .prepare(`UPDATE summon_requests SET status = 'failed', error = ?, updated_at = ? WHERE request_id = ?`)
      .run(error.slice(0, 280), nowIso(), id);
  }

  // B-4: TERMINAL give-up. 'abandoned' is NOT in the reprocess set, so the request is never re-generated.
  // Does not clobber a row already 'fulfilled'. The buyer's refund lever (after the deadline) is unaffected.
  private abandon(id: number, error: string): void {
    db()
      .prepare(
        `UPDATE summon_requests SET status = 'abandoned', error = ?, updated_at = ?
         WHERE request_id = ? AND status NOT IN ('fulfilled')`,
      )
      .run(error.slice(0, 280), nowIso(), id);
  }

  private attemptsOf(id: number): number {
    const row = db().prepare(`SELECT attempts FROM summon_requests WHERE request_id = ?`).get(id) as
      | { attempts: number }
      | undefined;
    return row?.attempts ?? 0;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// B-4: a revert that means "this request is or will be settled, regenerating can never help" -> terminal.
// Matches the real escrow/NFT revert strings (verified): the NFT's consumed settlement nonce
// (OutputNFT.mintForSettlement `require(!usedSettlementNonce[nonce], "nonce used")`) and the escrow's
// already-settled guard (SummonEscrow.fulfill `require(!r.settled, "already settled")`). Substring +
// case-insensitive because ethers wraps it (e.g. "execution reverted: already settled"). A "bad
// attestation" revert is deliberately NOT terminal - a fresh regeneration produces a fresh valid sig.
export function isTerminalRevert(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("nonce used") || m.includes("already settled");
}

export type RetryDecision = "proceed" | "backoff" | "abandon";

// B-4 (pure, unit-testable): given a request's attempt count + status + last-update time, decide whether to
// regenerate now ("proceed"), wait out the backoff window ("backoff"), or give up permanently ("abandon").
// processRequest() calls this BEFORE running the sponsor-paid TEE generation, so it bounds the regen loop.
export function summonRetryDecision(args: {
  attempts: number;
  status: string;
  updatedAtMs: number;
  nowMs: number;
  maxAttempts?: number;
  backoffMs?: number;
}): RetryDecision {
  const maxAttempts = args.maxAttempts ?? MAX_SUMMON_ATTEMPTS;
  const backoffMs = args.backoffMs ?? SUMMON_RETRY_BACKOFF_MS;
  if (args.attempts >= maxAttempts) return "abandon";
  if (args.status === "failed" && Number.isFinite(args.updatedAtMs) && args.nowMs - args.updatedAtMs < backoffMs) {
    return "backoff";
  }
  return "proceed";
}

let _singleton: SummonWatcher | null = null;
/** Process-wide watcher used by the real entrypoint (index.ts). */
export function getSummonWatcher(opts?: SummonWatcherOptions): SummonWatcher {
  if (!_singleton) _singleton = new SummonWatcher(opts);
  return _singleton;
}
