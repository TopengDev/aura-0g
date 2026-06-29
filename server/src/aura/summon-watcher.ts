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
import { signMintAuth, type MintAuthParams } from "./attestation.js";
import { generateAndProve, type GenProof } from "./generate.js";
import { rawAgent } from "./agents.js";
import { genGuardAcquire, genGuardRelease } from "./ratelimit.js";
import { CONTRACTS, GAS, GALILEO, DEPLOYED, SUMMON_POLL_MS, SUMMON_START_BLOCK, SUMMON_PROMPT } from "./config.js";

/** The gen function the watcher uses. Injectable so the e2e can swap in a fast deterministic stub. */
export type SummonGenFn = (args: {
  agentId: number;
  agentName: string;
  encBrainRoot: string;
  prompt: string;
}) => Promise<GenProof>;

const defaultGenFn: SummonGenFn = ({ agentId, agentName, encBrainRoot, prompt }) =>
  generateAndProve({ agentId, agentName, encBrainRoot, userPrompt: prompt, label: `summon-${agentId}-${seedLabel()}` });

// time-based label without Date.now() typing fuss; only used as a 0G object name.
function seedLabel(): string {
  return new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17);
}

type ProcessResult = "fulfilled" | "failed" | "settled" | "expired" | "deferred";

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
      else if (r === "failed") failed++;
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

      // shared cost guard (protects the funded sponsor wallet). If no slot, leave 'pending' + retry later.
      const guard = genGuardAcquire();
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

      this.setStatus(id, "generating", "generating the commissioned output inside the TEE (~42s)");
      this.bumpAttempts(id);
      const proof = await this.genFn({
        agentId: agent.agentId,
        agentName: agent.name,
        encBrainRoot: agent.encBrainRoot,
        prompt: this.prompt,
      });

      // fresh single-use nonce; sign the attestor MintAuth binding the BUYER + agent + the gen proof.
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
      const sig = await signMintAuth(params);
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
      // transient/forged failure: mark 'failed' (retried next poll until the deadline) WITHOUT settling.
      this.fail(id, errMsg(e));
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
  private upsertRequest(r: { requestId: number; agentId: number; buyer: string; fee: string; deadline: number }): void {
    const now = nowIso();
    db()
      .prepare(
        `INSERT INTO summon_requests (request_id, agent_id, buyer, fee, deadline, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(request_id) DO NOTHING`,
      )
      .run(r.requestId, r.agentId, r.buyer.toLowerCase(), r.fee, r.deadline, now, now);
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
}

function nowIso(): string {
  return new Date().toISOString();
}
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

let _singleton: SummonWatcher | null = null;
/** Process-wide watcher used by the real entrypoint (index.ts). */
export function getSummonWatcher(opts?: SummonWatcherOptions): SummonWatcher {
  if (!_singleton) _singleton = new SummonWatcher(opts);
  return _singleton;
}
