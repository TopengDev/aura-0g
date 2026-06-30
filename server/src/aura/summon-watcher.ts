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

      // B-4 (regen amplifier): cap how many full sponsor-paid TEE generations one request can trigger.
      // Each prior generation bumped `attempts` (line below), so once we've hit the ceiling, mark the
      // request TERMINAL ('abandoned', not in the reprocess set) instead of regenerating again. The buyer
      // can still refund after the deadline (their lever); we just stop burning the sponsor on a loop.
      if (row.attempts >= MAX_SUMMON_ATTEMPTS) {
        this.abandon(id, `max fulfill attempts (${MAX_SUMMON_ATTEMPTS}) reached; not regenerating (buyer may refund)`);
        return "abandoned";
      }

      // B-4 backoff: a 'failed' request is not retried every single poll - wait out the backoff window so a
      // persistently-reverting request does not re-generate (sponsor-paid) on a tight loop.
      if (row.status === "failed") {
        const lastMs = Date.parse(row.updated_at);
        if (Number.isFinite(lastMs) && Date.now() - lastMs < SUMMON_RETRY_BACKOFF_MS) {
          return "deferred";
        }
      }

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

      this.setStatus(id, "generating", "generating the commissioned output inside the TEE (~42s)");
      this.bumpAttempts(id);
      const proof = await this.genFn({
        agentId: agent.agentId,
        agentName: agent.name,
        encBrainRoot: agent.encBrainRoot,
        prompt: this.prompt,
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
function isTerminalRevert(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("nonce used") || m.includes("already settled");
}

let _singleton: SummonWatcher | null = null;
/** Process-wide watcher used by the real entrypoint (index.ts). */
export function getSummonWatcher(opts?: SummonWatcherOptions): SummonWatcher {
  if (!_singleton) _singleton = new SummonWatcher(opts);
  return _singleton;
}
