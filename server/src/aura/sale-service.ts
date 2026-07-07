// SERVER-ONLY. The SHARED secure-transfer + sale-settlement core.
//
// This extracts the PROVEN prepare + confirm bodies from routes/agent-transfer.ts so the priced
// open-market SALE-SETTLE path reuses the EXACT same re-encrypt / re-seal / dual-wall-memory logic with
// zero duplication. Two consumers call in:
//   1. routes/agent-transfer.ts   - the directed secure transfer (owner initiates, USER submits transfer).
//   2. routes/agent-sale.ts       - the paid open market: the platform CUSTODIAN submits the transfer and
//                                    splits the escrowed ETH (Flow B, server-custodian, no new on-chain contract).
//
// prepareSecureTransfer  : owner-scoped. Re-encrypts the brain to the buyer, ECIES-seals the fresh key to
//                          the buyer's pubkey, uploads the new envelope, signs the EIP-191 transfer proof,
//                          returns the on-chain transfer() args + the PendingRekey to persist. NEVER a key.
// confirmSecureTransfer  : after the on-chain move lands (ownerOf == buyer), re-custodies the brain to the
//                          buyer AND fires the memory DUAL-WALL reseal (buyer fresh epoch, seller epoch dropped).
// settleAgentSale        : the sale orchestration - prepare -> platform submits transfer -> confirm -> split.
import { ethers } from "ethers";
import { CONTRACTS, GALILEO, GAS, SALE_PLATFORM, SALE_PLATFORM_BPS } from "./config.js";
import { auraInftConfigured, auraInftRead, auraInftWrite, readProvider } from "./contracts.js";
import { reencryptForTransfer } from "./oracle.js";
import { sealedToHex } from "./sealing.js";
import { pubkeyOf } from "./pubkey.js";
import { brainByAgentId, recustodyBrainForTransfer } from "./store.js";
import { store } from "./storage.js";
import { cacheImageByRoot, resolveBytesByRoot } from "./image-cache.js";
import { sponsorSigner } from "./wallet.js";
import { resealRelationshipForNewOwner } from "./chat-memory.js";
import {
  deactivateListing,
  markEscrowSettled,
  setEscrowRekey,
  setEscrowTransferTx,
  resetEscrowToCommitted,
  listSettlingEscrows,
  getPayoutLeg,
  markPayoutLegSending,
  markPayoutLegBroadcast,
  markPayoutLegLanded,
  deletePayoutLeg,
  type SaleEscrow,
} from "./sale-store.js";

/** A typed error carrying the HTTP status a route should map it to. */
export class SaleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "SaleError";
  }
}

/** The persisted re-key state (produced by prepare, consumed by confirm). Money-adjacent -> persisted. */
export interface PendingRekey {
  to: string; // lowercased buyer
  newKeyHex: string; // the fresh AES data-key (server re-custody target)
  newEncBrainRoot: string;
  newDataHash: string;
  sealedKeyHex: string;
}

/** The exact args a caller submits to AuraINFT.transfer() (NO private key ever included). */
export interface TransferArgs {
  contract: string;
  chainId: number;
  method: "transfer";
  from: string;
  to: string;
  tokenId: number;
  newSealedKey: string;
  newEncBrainRoot: string;
  newDataHash: string;
  deadline: number;
  proof: string;
}

/**
 * The PREPARE body (owner-scoped, config-side). Validates ownership, resolves the buyer pubkey, loads the
 * brain custody, re-encrypts to a fresh key sealed to the buyer, uploads + caches the new envelope, and
 * signs the EIP-191 transfer proof. Returns { pending, args }: `pending` is persisted by the caller (the
 * in-memory map for a directed transfer, the escrow row for a sale); `args` is what gets submitted on-chain.
 */
export async function prepareSecureTransfer(
  agentId: number,
  from: string,
  to: string,
  toPubkey?: string | null,
): Promise<{ pending: PendingRekey; args: TransferArgs }> {
  if (!auraInftConfigured()) {
    throw new SaleError(501, "secure transfer not enabled (AuraINFT is not wired on this deployment)");
  }
  if (!ethers.isAddress(to)) throw new SaleError(400, "`to` (recipient address) required");
  if (to.toLowerCase() === from.toLowerCase()) throw new SaleError(400, "cannot transfer to yourself");

  const inft = auraInftRead();
  let ownerOnChain: string;
  try {
    ownerOnChain = (await inft.ownerOf(agentId)) as string;
  } catch {
    throw new SaleError(404, `agent #${agentId} not found on AuraINFT`);
  }
  if (ownerOnChain.toLowerCase() !== from.toLowerCase()) {
    throw new SaleError(403, "only the current on-chain owner may initiate a secure transfer");
  }

  // buyer pubkey: explicit (validated to hash to `to`), else recovered from the buyer's SIWE login.
  let resolvedPubkey = (toPubkey ?? "").trim() || null;
  if (resolvedPubkey) {
    let derived: string;
    try {
      derived = ethers.computeAddress(resolvedPubkey);
    } catch {
      throw new SaleError(400, "invalid toPubkey");
    }
    if (derived.toLowerCase() !== to.toLowerCase()) {
      throw new SaleError(400, "toPubkey does not correspond to `to`");
    }
  } else {
    resolvedPubkey = pubkeyOf(to);
  }
  if (!resolvedPubkey) {
    throw new SaleError(409, "buyer pubkey unknown: the buyer must sign in (SIWE) once, or pass toPubkey");
  }

  const brain = brainByAgentId(agentId);
  if (!brain) {
    throw new SaleError(409, "no brain custody for this agent on this backend (mint it through this backend to enable secure transfer)");
  }

  const currentEnvelope: Buffer | null =
    (await resolveBytesByRoot(brain.encBrainRoot, { source: "brain", contentType: "application/octet-stream" }))?.bytes ?? null;
  if (!currentEnvelope) {
    throw new SaleError(409, "current brain envelope is not retrievable (cache miss + 0G eviction)");
  }

  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const re = await reencryptForTransfer({
    inft: CONTRACTS.auraINFT,
    chainId: GALILEO.chainId,
    tokenId: BigInt(agentId),
    from,
    to,
    toPubkey: resolvedPubkey,
    currentEnvelope,
    currentKeyHex: brain.brainKeyHex,
    deadlineSec: deadline,
  });

  // upload the re-encrypted envelope -> newEncBrainRoot (the pointer AuraINFT stores) + cache it durably.
  const newStore = await store(sponsorSigner(), re.newEnvelope, `agent-brain-rekey-${agentId}`);
  const newEncBrainRoot = newStore.rootHash;
  cacheImageByRoot(newEncBrainRoot, re.newEnvelope, { contentType: "application/octet-stream", source: "brain" });

  const sealedKeyHex = sealedToHex(re.sealedKey);
  const pending: PendingRekey = {
    to: to.toLowerCase(),
    newKeyHex: re.newKeyHex,
    newEncBrainRoot,
    newDataHash: re.newDataHash,
    sealedKeyHex,
  };
  const args: TransferArgs = {
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
  return { pending, args };
}

/**
 * The CONFIRM body. Verifies the on-chain move actually happened (ownerOf == the prepared buyer) BEFORE
 * mutating custody, then re-custodies the brain to the new owner and fires the memory dual-wall reseal
 * (buyer's relationship epoch starts fresh; seller's epoch key is dropped). Returns the buyer's new epoch.
 */
export async function confirmSecureTransfer(agentId: number, pending: PendingRekey): Promise<{ epoch: number }> {
  let ownerOnChain: string;
  try {
    ownerOnChain = (await auraInftRead().ownerOf(agentId)) as string;
  } catch {
    throw new SaleError(502, "chain read failed");
  }
  if (ownerOnChain.toLowerCase() !== pending.to.toLowerCase()) {
    throw new SaleError(409, `transfer not confirmed on-chain (owner is still ${ownerOnChain}); submit AuraINFT.transfer() first`);
  }
  recustodyBrainForTransfer({
    agentId,
    newOwner: pending.to,
    encBrainRoot: pending.newEncBrainRoot,
    brainKeyHex: pending.newKeyHex,
    sealedKey: pending.sealedKeyHex,
    dataHash: pending.newDataHash,
  });
  const { epoch } = resealRelationshipForNewOwner(agentId, pending.to);
  return { epoch };
}

// ── the escrowed-ETH split (mirrors AuraMarketplace._settleSale: EIP-2981 royalty + platform fee + remainder) ──

export interface SplitLeg {
  role: "royalty" | "platformFee" | "seller";
  receiver: string;
  wei: string; // decimal wei
  tx: string | null; // payout tx hash, or null when RETAINED by the custodian (receiver == custodian)
}

export interface ComputedSplit {
  priceWei: bigint;
  royaltyReceiver: string;
  royaltyWei: bigint;
  platformReceiver: string;
  platformWei: bigint;
  seller: string;
  sellerWei: bigint;
}

/**
 * Compute the split for a sale of `agentId` at `priceWei` to the given `seller`. EIP-2981 royaltyInfo is the
 * AGENT-RESALE creator royalty (pinned to the original creator at mint); the platform fee is priceWei *
 * platformBps / 10000; the seller gets the remainder. Mirrors AuraMarketplace._settleSale, including the
 * "no valid royalty receiver -> fold into the seller" and the royalty+fee <= price conservation.
 */
export async function computeSplit(agentId: number, priceWei: bigint, seller: string): Promise<ComputedSplit> {
  let royaltyReceiver = ethers.ZeroAddress;
  let royaltyWei = 0n;
  try {
    const [r, a] = (await auraInftRead().royaltyInfo(agentId, priceWei)) as [string, bigint];
    royaltyReceiver = r;
    royaltyWei = BigInt(a);
  } catch {
    royaltyReceiver = ethers.ZeroAddress;
    royaltyWei = 0n;
  }
  const platformWei = (priceWei * BigInt(SALE_PLATFORM_BPS)) / 10_000n;
  // conservation: royalty + platform must never exceed the price (fold royalty back to the seller if so).
  if (royaltyWei + platformWei > priceWei) {
    royaltyWei = 0n;
    royaltyReceiver = ethers.ZeroAddress;
  }
  // no valid royalty receiver -> fold that share into the seller proceeds (price stays conserved).
  if (royaltyWei > 0n && royaltyReceiver !== ethers.ZeroAddress) {
    // keep as-is
  } else {
    royaltyWei = 0n;
    royaltyReceiver = ethers.ZeroAddress;
  }
  const sellerWei = priceWei - royaltyWei - platformWei;
  return {
    priceWei,
    royaltyReceiver,
    royaltyWei,
    platformReceiver: SALE_PLATFORM,
    platformWei,
    seller,
    sellerWei,
  };
}

/** ethers v6 tx send with a small nonce-collision retry (the sponsor wallet is shared with the live server). */
async function sendWithNonceRetry<T extends { hash: string; wait: () => Promise<any> }>(
  send: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await send();
    } catch (e: any) {
      const m = String(e?.message ?? e).toLowerCase();
      const retriable = /nonce|replacement transaction underpriced|already known|txpool/.test(m);
      lastErr = e;
      if (!retriable || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * H2 (money-idempotency): send `wei` to `to` for a specific escrow `leg` EXACTLY ONCE across any number of
 * retries / crashes. The mechanism:
 *   - persist a per-leg SENTINEL BEFORE broadcasting (state 'sending'), then record the tx hash + pinned nonce
 *     the instant sendTransaction resolves (state 'broadcast'), BEFORE awaiting tx.wait().
 *   - on a re-run, RECONCILE BY CHAIN READ first: if the recorded tx already landed (receipt.status==1) NEVER
 *     re-send - return the same hash. If it is not yet mined, re-broadcast with the SAME pinned nonce so at
 *     most one tx per nonce can ever confirm (dedupe, never double-spend).
 *   - a normal send-throw (never broadcast) clears the sentinel so a retry is clean; only a true crash between
 *     the 'sending' mark and the broadcast leaves an ambiguous 'sending' row -> fail CLOSED (never re-send a
 *     possibly-already-sent payout blind; a human reconciles from the pinned nonce).
 * This is what makes the documented "tx mines, then tx.wait() rejects on an 0G RPC flake, route resets to
 * retryable, retry re-sends" flow NON-double-paying.
 */
// Minimal structural seams so the exactly-once path is unit-traceable (a mock signer/provider can simulate a
// post-mine tx.wait() rejection). The real sponsorSigner()/readProvider() satisfy these structurally.
type IdempotentSendSigner = {
  sendTransaction(tx: any): Promise<{ hash: string; nonce: number; wait(): Promise<{ status: number | null } | null> }>;
};
type IdempotentReadProvider = { getTransactionReceipt(hash: string): Promise<{ status: number | null } | null> };

export async function idempotentEthSend(
  escrowId: number,
  leg: string,
  to: string,
  weiStr: string,
  injected?: { signer?: IdempotentSendSigner; provider?: IdempotentReadProvider },
): Promise<string> {
  const wei = BigInt(weiStr);
  const signer: IdempotentSendSigner = injected?.signer ?? (sponsorSigner() as unknown as IdempotentSendSigner);
  const provider: IdempotentReadProvider = injected?.provider ?? (readProvider() as unknown as IdempotentReadProvider);
  const recipient = ethers.getAddress(to);
  const existing = getPayoutLeg(escrowId, leg);

  // already known to have landed on a prior run -> return it, no send.
  if (existing?.state === "landed" && existing.txHash) return existing.txHash;

  // a prior run broadcast this leg: reconcile by chain read BEFORE any re-send.
  if (existing?.state === "broadcast" && existing.txHash) {
    try {
      const rcpt = await provider.getTransactionReceipt(existing.txHash);
      if (rcpt) {
        if (rcpt.status === 1) {
          markPayoutLegLanded(escrowId, leg, existing.txHash);
          return existing.txHash; // ALREADY PAID - never re-send
        }
        // a plain ETH send that reverted on-chain is anomalous; refuse to blindly re-send.
        throw new SaleError(502, `${leg}: prior payout tx ${existing.txHash} reverted on-chain - manual reconcile required for escrow #${escrowId}`);
      }
      // receipt not found: the original may be pending or dropped. Re-broadcast with the SAME pinned nonce
      // (below) so it can only replace/dedupe the original, never create a second paying tx.
    } catch (e) {
      if (e instanceof SaleError) throw e;
      /* transient read failure -> fall through to a pinned-nonce re-broadcast (still dedupe-safe) */
    }
    const pinnedNonce = existing.nonce ?? undefined;
    const tx = await sendWithNonceRetry(() =>
      signer.sendTransaction({ to: recipient, value: wei, gasPrice: GAS.gasPrice, ...(pinnedNonce != null ? { nonce: pinnedNonce } : {}) }),
    );
    markPayoutLegBroadcast(escrowId, leg, { receiver: recipient, wei: weiStr, nonce: tx.nonce, txHash: tx.hash });
    const rcpt = await tx.wait();
    if (!rcpt || rcpt.status !== 1) throw new SaleError(502, `${leg} payout to ${recipient} reverted (tx ${tx.hash})`);
    markPayoutLegLanded(escrowId, leg, tx.hash);
    return tx.hash;
  }

  // an orphan 'sending' row (crashed mid-broadcast, no tx hash) is AMBIGUOUS: ETH may or may not have left the
  // wallet. Fail CLOSED - never re-send a maybe-already-sent payout.
  if (existing?.state === "sending" && !existing.txHash) {
    throw new SaleError(409, `${leg}: ambiguous in-flight payout for escrow #${escrowId} (no recorded tx hash) - refusing to re-send to avoid a double-pay. Reconcile manually.`);
  }

  // FRESH send: mark intent BEFORE broadcasting, then broadcast (auto nonce). A send that THROWS never left the
  // wallet -> clear the sentinel so a retry is clean. A send that RESOLVES records its hash + nonce at once.
  markPayoutLegSending(escrowId, leg, { receiver: recipient, wei: weiStr });
  let tx: Awaited<ReturnType<typeof signer.sendTransaction>>;
  try {
    tx = await sendWithNonceRetry(() => signer.sendTransaction({ to: recipient, value: wei, gasPrice: GAS.gasPrice }));
  } catch (e) {
    deletePayoutLeg(escrowId, leg); // never broadcast -> safe to retry from scratch
    throw e;
  }
  markPayoutLegBroadcast(escrowId, leg, { receiver: recipient, wei: weiStr, nonce: tx.nonce, txHash: tx.hash });
  const rcpt = await tx.wait();
  if (!rcpt || rcpt.status !== 1) throw new SaleError(502, `${leg} payout to ${recipient} reverted (tx ${tx.hash})`);
  markPayoutLegLanded(escrowId, leg, tx.hash);
  return tx.hash;
}

/**
 * Pay out the escrowed ETH split from the CUSTODIAN wallet (== the platform / sponsor). The buyer has paid
 * `price` to the custodian; here we disburse royalty -> creator and remainder -> seller, and RETAIN the
 * platform fee (receiver == custodian, no self-transfer). Payouts are AGGREGATED per distinct receiver
 * (one tx per address) and sent serially with a nonce-retry. Returns the per-role legs with their tx hashes.
 */
export async function payoutSplit(escrowId: number, split: ComputedSplit): Promise<SplitLeg[]> {
  const custodian = SALE_PLATFORM.toLowerCase();

  const legs: SplitLeg[] = [
    { role: "royalty", receiver: split.royaltyReceiver, wei: split.royaltyWei.toString(), tx: null },
    { role: "platformFee", receiver: split.platformReceiver, wei: split.platformWei.toString(), tx: null },
    { role: "seller", receiver: split.seller, wei: split.sellerWei.toString(), tx: null },
  ];

  // aggregate the amount owed to each DISTINCT receiver that is NOT the custodian (the custodian retains its own).
  const owed = new Map<string, bigint>();
  for (const leg of legs) {
    const wei = BigInt(leg.wei);
    if (wei <= 0n) continue;
    const to = leg.receiver.toLowerCase();
    if (to === custodian || to === ethers.ZeroAddress.toLowerCase()) continue;
    owed.set(to, (owed.get(to) ?? 0n) + wei);
  }

  // one tx per receiver, serially, EXACTLY-ONCE per leg via the idempotent sender: it reconciles a prior
  // broadcast by chain read on any retry, so a post-mine tx.wait() rejection can NEVER double-pay a receiver.
  const txByReceiver = new Map<string, string>();
  for (const [to, wei] of owed) {
    const hash = await idempotentEthSend(escrowId, `split:${to}`, to, wei.toString());
    txByReceiver.set(to, hash);
  }

  // annotate each leg: the payout tx, or null when retained by the custodian.
  for (const leg of legs) {
    const to = leg.receiver.toLowerCase();
    if (BigInt(leg.wei) <= 0n) {
      leg.tx = null;
    } else if (to === custodian) {
      leg.tx = null; // retained by the platform custodian (no self-transfer)
    } else {
      leg.tx = txByReceiver.get(to) ?? null;
    }
  }
  return legs;
}

export interface SettleResult {
  transferTx: string;
  relationshipEpoch: number;
  ownerNow: string;
  styleVersion: number;
  split: SplitLeg[];
}

/**
 * SETTLE the sale (the orchestration): prepare the re-encryption for the committed buyer, persist it, have
 * the platform CUSTODIAN submit the proof-gated AuraINFT.transfer with its OWN wallet, confirm ownerOf ==
 * buyer (-> re-custody brain + memory dual-wall reseal), then split the escrowed ETH. The escrow row must
 * already be committed with a VERIFIED buyer->custodian payment (the route verifies + claims it first). The
 * IRREVERSIBLE on-chain move is gated FIRST; only after it confirms does the custodian disburse funds.
 */
export async function settleAgentSale(escrow: SaleEscrow): Promise<SettleResult> {
  const read = auraInftRead();

  // RESUME-SAFE: if a prior settle attempt already moved ownership to the buyer (crash/retry after the
  // irreversible on-chain leg), skip re-prepare/transfer and continue from the persisted re-key. Otherwise
  // run the full prepare -> transfer. This keeps the one irreversible action (the transfer) exactly-once.
  let curOwner = "";
  try {
    curOwner = ((await read.ownerOf(escrow.agentId)) as string).toLowerCase();
  } catch {
    /* fall through to the fresh path (prepare re-checks ownerOf and throws a typed error) */
  }

  let pending: PendingRekey;
  let transferTx: string;
  if (curOwner === escrow.buyer.toLowerCase() && escrow.rekeyJson) {
    // the transfer already landed on a prior attempt -> resume from the persisted re-key.
    pending = JSON.parse(escrow.rekeyJson) as PendingRekey;
    transferTx = escrow.transferTx ?? "(landed on a prior attempt)";
  } else {
    const buyerPubkey = pubkeyOf(escrow.buyer);

    // 1. prepare (re-encrypt to the buyer, seal, upload the new envelope, sign the proof) + persist it.
    const prep = await prepareSecureTransfer(escrow.agentId, escrow.seller, escrow.buyer, buyerPubkey);
    pending = prep.pending;
    setEscrowRekey(escrow.id, JSON.stringify(pending));

    // 2. the platform CUSTODIAN submits the transfer with its OWN wallet (msg.sender == platform; the seller
    //    approved the platform as operator at list time, or the platform is itself the seller).
    const inft = auraInftWrite(sponsorSigner());
    const tx = await sendWithNonceRetry(() =>
      inft.transfer(
        prep.args.from,
        prep.args.to,
        prep.args.tokenId,
        prep.args.newSealedKey,
        prep.args.newEncBrainRoot,
        prep.args.newDataHash,
        prep.args.deadline,
        prep.args.proof,
        GAS,
      ),
    );
    const rcpt = await tx.wait();
    if (!rcpt || rcpt.status !== 1) throw new SaleError(502, `AuraINFT.transfer reverted (tx ${tx.hash})`);
    transferTx = tx.hash;
    setEscrowTransferTx(escrow.id, transferTx); // persist BEFORE the split so a crash here is resumable
  }

  // 3. confirm ownerOf == buyer -> re-custody brain + memory dual-wall reseal (buyer fresh, seller dropped).
  const { epoch } = await confirmSecureTransfer(escrow.agentId, pending);

  // 4. split the escrowed price: royalty -> creator, platform fee retained, remainder -> seller. Each leg is
  //    sent EXACTLY-ONCE (chain-reconciled sentinels), so a resume/retry after a mined-but-flaky payout is safe.
  const split = await computeSplit(escrow.agentId, BigInt(escrow.priceWei), escrow.seller);
  const legs = await payoutSplit(escrow.id, split);

  // 5. read the post-transfer identity (styleVersion bumps on every re-key) + persist + close the listing.
  let ownerNow = escrow.buyer.toLowerCase();
  let styleVersion = 0;
  try {
    ownerNow = ((await read.ownerOf(escrow.agentId)) as string).toLowerCase();
    const a = (await read.getAgent(escrow.agentId)) as { styleVersion: bigint | number };
    styleVersion = Number(a.styleVersion);
  } catch {
    /* best-effort read for the response; the settle already succeeded */
  }

  markEscrowSettled(escrow.id, { transferTx, splitsJson: JSON.stringify(legs), relationshipEpoch: epoch });
  deactivateListing(escrow.agentId);

  return { transferTx, relationshipEpoch: epoch, ownerNow, styleVersion, split: legs };
}

/**
 * REFUND the buyer's escrowed payment from the custodian (the anti-rug path). Sends `price` back to the
 * buyer. The route enforces the guards (past deadline, not settled, payment verified). Returns the refund tx.
 */
export async function refundAgentSale(escrow: SaleEscrow): Promise<{ refundTx: string }> {
  // EXACTLY-ONCE refund: the same chain-reconciled sentinel used for the split, so a mined-but-flaky refund
  // that gets retried never sends a SECOND refund tx to the buyer.
  const refundTx = await idempotentEthSend(escrow.id, "refund", escrow.buyer, escrow.priceWei);
  return { refundTx };
}

/**
 * M5 (stuck-settling boot reaper): a hard crash AFTER beginSettle (status -> 'settling') but before the settle
 * completes leaves the escrow 'settling' forever (reapOrphanJobs only touches the jobs table). On boot, reconcile
 * every stuck 'settling' escrow against chain:
 *   - ownerOf(agent) == buyer  -> the irreversible transfer already LANDED; COMPLETE the settle idempotently
 *                                 (settleAgentSale resumes from the persisted re-key: NO re-transfer, the split
 *                                 legs are chain-reconciled so already-paid legs are skipped, then mark settled).
 *   - otherwise                -> the transfer never landed; reset to 'committed' so it is retryable/refundable.
 * Fail-CLOSED on an unreadable chain (leave it 'settling' for the next boot rather than guess). Serial (shared
 * sponsor nonce). Returns the count reconciled. Best-effort per escrow: one failure never aborts the sweep.
 */
export async function reapStuckSettlingEscrows(): Promise<number> {
  if (!auraInftConfigured()) return 0;
  const stuck = listSettlingEscrows();
  let reconciled = 0;
  for (const escrow of stuck) {
    try {
      let ownerNow: string;
      try {
        ownerNow = ((await auraInftRead().ownerOf(escrow.agentId)) as string).toLowerCase();
      } catch {
        continue; // unreadable chain -> leave it settling, retry on the next boot (never guess)
      }
      if (ownerNow === escrow.buyer.toLowerCase()) {
        await settleAgentSale(escrow); // resume branch: no re-transfer, idempotent split, marks settled
        reconciled++;
      } else {
        resetEscrowToCommitted(escrow.id, "boot-reconcile: transfer did not land - reset to committed (retryable)");
        reconciled++;
      }
    } catch {
      /* leave this escrow settling; the next boot retries. Never let one bad escrow abort the sweep. */
    }
  }
  return reconciled;
}
