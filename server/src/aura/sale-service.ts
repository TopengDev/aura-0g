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
import { auraInftConfigured, auraInftRead, auraInftWrite } from "./contracts.js";
import { reencryptForTransfer } from "./oracle.js";
import { sealedToHex } from "./sealing.js";
import { pubkeyOf } from "./pubkey.js";
import { brainByAgentId, recustodyBrainForTransfer } from "./store.js";
import { store } from "./storage.js";
import { cacheImageByRoot, resolveBytesByRoot } from "./image-cache.js";
import { sponsorSigner } from "./wallet.js";
import { resealRelationshipForNewOwner } from "./chat-memory.js";
import { deactivateListing, markEscrowSettled, setEscrowRekey, setEscrowTransferTx, type SaleEscrow } from "./sale-store.js";

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
 * Pay out the escrowed ETH split from the CUSTODIAN wallet (== the platform / sponsor). The buyer has paid
 * `price` to the custodian; here we disburse royalty -> creator and remainder -> seller, and RETAIN the
 * platform fee (receiver == custodian, no self-transfer). Payouts are AGGREGATED per distinct receiver
 * (one tx per address) and sent serially with a nonce-retry. Returns the per-role legs with their tx hashes.
 */
export async function payoutSplit(split: ComputedSplit): Promise<SplitLeg[]> {
  const custodian = SALE_PLATFORM.toLowerCase();
  const signer = sponsorSigner();

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

  // one tx per receiver, serially (shared sponsor nonce), with a nonce-collision retry.
  const txByReceiver = new Map<string, string>();
  for (const [to, wei] of owed) {
    const tx = await sendWithNonceRetry(() =>
      signer.sendTransaction({ to: ethers.getAddress(to), value: wei, gasPrice: GAS.gasPrice }),
    );
    const rcpt = await tx.wait();
    if (!rcpt || rcpt.status !== 1) throw new SaleError(502, `split payout to ${to} reverted (tx ${tx.hash})`);
    txByReceiver.set(to, tx.hash);
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

  // 4. split the escrowed price: royalty -> creator, platform fee retained, remainder -> seller.
  const split = await computeSplit(escrow.agentId, BigInt(escrow.priceWei), escrow.seller);
  const legs = await payoutSplit(split);

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
  const signer = sponsorSigner();
  const tx = await sendWithNonceRetry(() =>
    signer.sendTransaction({ to: ethers.getAddress(escrow.buyer), value: BigInt(escrow.priceWei), gasPrice: GAS.gasPrice }),
  );
  const rcpt = await tx.wait();
  if (!rcpt || rcpt.status !== 1) throw new SaleError(502, `refund to ${escrow.buyer} reverted (tx ${tx.hash})`);
  return { refundTx: tx.hash };
}
