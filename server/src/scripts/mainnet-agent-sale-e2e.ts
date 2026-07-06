// AURA PAID OPEN-MARKET AGENT SALE (Flow B) - FULL end-to-end verification on 0G Aristotle MAINNET (16661).
//
// Proves the shipped SALE routes + the shared sale-service against the LIVE mainnet AuraINFT with the REAL
// oracle key, WITHOUT touching production state: an ISOLATED temp SQLite DB, a FRESH throwaway agent minted
// for the test, and throwaway buyer wallets funded from the sponsor in-container. NEVER prints a private key.
//
// It exercises the routes through app.inject (the repo's accepted e2e transport, same as e2e-inft-galileo),
// so the sale-service, the oracle proof, the platform-submitted transfer, the ETH split, and the dual-wall
// memory reset all run identically to the HTTP path. Flow:
//   1. mint a fresh agent as a throwaway CREATOR/seller S (real on-chain mint, brain staged like create-agent)
//   2. SALE 1  S -> buyer1     : list -> commit -> pay custodian -> settle (transfer + split), memory wall
//   3. RESALE  buyer1 -> buyer2: a visible CREATOR royalty (creator S != seller buyer1)
//   4. REFUND  buyer2 lists, buyer3 commits + pays, the escrow expires, buyer3 refunds (anti-rug)
//   5. CLEANUP : transfer the throwaway agent back to the platform so nothing is left mis-owned
//
// Run (inside a server container, .env bind-mounted):
//   docker run --rm -v ~/apps/aura/.env:/app/.env:ro <server-image> node dist/scripts/mainnet-agent-sale-e2e.js
import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { ethers } from "ethers";

// ── env FIRST (config freezes CONTRACTS/keys at module load) ──────────────────────────────────────────
const envFile = [process.env.AURA_ENV_FILE, "/app/.env", path.resolve(process.cwd(), ".env")].find(
  (p): p is string => !!p && existsSync(p),
);
if (envFile) dotenvConfig({ path: envFile });
// ISOLATE from the production DB: a fresh temp SQLite for the harness only.
process.env.SQLITE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "aura-sale-e2e-")), "e2e.db");

const PLATFORM = "0x8a3bCd5937C1f5847CAfCb98Cf748C88A9e9Bf3d";
const PRICE1 = ethers.parseEther("0.001");
const PRICE2 = ethers.parseEther("0.001");
const PRICE3 = ethers.parseEther("0.001");
const CREATOR_RESALE_BPS = 1000; // 10% agent-resale creator royalty -> a clearly-observable split leg
const FUND = { S: ethers.parseEther("0.008"), b1: ethers.parseEther("0.012"), b2: ethers.parseEther("0.012"), b3: ethers.parseEther("0.009") };

const out: Record<string, unknown> = { chainId: null, agentId: null, txs: {}, assertions: [], balances: {}, split: {} };
let passed = 0;
const ok = (cond: boolean, msg: string) => {
  (out.assertions as string[]).push(`${cond ? "PASS" : "FAIL"}: ${msg}`);
  if (!cond) {
    console.error("  FAIL:", msg);
    console.log("\n=== E2E SUMMARY (FAILED) ===\n" + JSON.stringify(out, null, 2));
    process.exit(1);
  }
  passed++;
  console.log("  PASS:", msg);
};

async function main() {
  const { GALILEO, GAS, sponsorPrivateKey } = await import("../aura/config.js");
  const provider = new ethers.JsonRpcProvider(GALILEO.rpc, GALILEO.chainId, { staticNetwork: true });
  out.chainId = GALILEO.chainId;
  ok(GALILEO.chainId === 16661, `harness targets 0G mainnet 16661 (got ${GALILEO.chainId})`);

  const sponsor = new ethers.Wallet(sponsorPrivateKey(), provider);
  ok(sponsor.address.toLowerCase() === PLATFORM.toLowerCase(), `sponsor == platform ${PLATFORM}`);

  const bal0 = await provider.getBalance(sponsor.address);
  (out.balances as any).sponsorStart = ethers.formatEther(bal0);
  ok(bal0 > ethers.parseEther("0.1"), `sponsor funded (${ethers.formatEther(bal0)} 0G > 0.1)`);

  // ── server modules (config already froze onto mainnet + the temp DB) ──
  const { oracleAddress, dataHashOf } = await import("../aura/oracle.js");
  const { auraInftRead, auraInftWrite } = await import("../aura/contracts.js");
  const { encryptBrain } = await import("../aura/brain.js");
  const { sealKeyToPubkey, sealedToHex } = await import("../aura/sealing.js");
  const cache = await import("../aura/image-cache.js");
  const storeMod = await import("../aura/store.js");
  const chatmem = await import("../aura/chat-memory.js");
  const { storePubkey } = await import("../aura/pubkey.js");
  const { buildApp } = await import("../app.js");

  ok(oracleAddress().toLowerCase() === PLATFORM.toLowerCase(), "PRE-FLIGHT: server oracle key derives to 0x8a3b (proofs will verify)");
  const readInft = auraInftRead();
  const onChainOracle = (await readInft.oracle()) as string;
  ok(onChainOracle.toLowerCase() === PLATFORM.toLowerCase(), `PRE-FLIGHT: on-chain AuraINFT.oracle() == 0x8a3b (got ${onChainOracle})`);

  // ── throwaway wallets (keys NEVER printed) ──
  const S = ethers.Wallet.createRandom(provider); // creator + first seller
  const buyer1 = ethers.Wallet.createRandom(provider);
  const buyer2 = ethers.Wallet.createRandom(provider);
  const buyer3 = ethers.Wallet.createRandom(provider);
  (out as any).wallets = { S: S.address, buyer1: buyer1.address, buyer2: buyer2.address, buyer3: buyer3.address, platform: PLATFORM };
  console.log(`  wallets: S=${S.address} b1=${buyer1.address} b2=${buyer2.address} b3=${buyer3.address}`);

  // recover + persist each throwaway's pubkey (what SIWE login does) so prepare can ECIES-seal to them.
  for (const w of [S, buyer1, buyer2, buyer3, sponsor]) {
    const msg = `AURA login: ${w.address}`;
    const pub = ethers.SigningKey.recoverPublicKey(ethers.hashMessage(msg), await w.signMessage(msg));
    ok(ethers.computeAddress(pub).toLowerCase() === w.address.toLowerCase(), `recovered pubkey hashes to ${w.address.slice(0, 10)}`);
    storePubkey(w.address, pub);
  }

  // ── serial sponsor sender with nonce-collision retry (the live server shares this wallet) ──
  let sponsorNonce = await provider.getTransactionCount(sponsor.address, "pending");
  async function sponsorSend(to: string, value: bigint): Promise<string> {
    for (let i = 0; i < 4; i++) {
      try {
        const tx = await sponsor.sendTransaction({ to, value, gasPrice: GAS.gasPrice, nonce: sponsorNonce });
        sponsorNonce++;
        const r = await tx.wait();
        if (!r || r.status !== 1) throw new Error(`funding tx ${tx.hash} reverted`);
        return tx.hash;
      } catch (e: any) {
        const m = String(e?.message ?? e).toLowerCase();
        if (/nonce|already known|replacement/.test(m)) {
          sponsorNonce = await provider.getTransactionCount(sponsor.address, "pending");
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        throw e;
      }
    }
    throw new Error("sponsor funding exhausted retries");
  }

  console.log("  funding throwaway wallets from the sponsor...");
  await sponsorSend(S.address, FUND.S);
  await sponsorSend(buyer1.address, FUND.b1);
  await sponsorSend(buyer2.address, FUND.b2);
  await sponsorSend(buyer3.address, FUND.b3);
  ok((await provider.getBalance(buyer1.address)) >= FUND.b1 - ethers.parseEther("0.0001"), "buyer1 funded");

  // ── mint a FRESH throwaway agent as S (real on-chain mint on the mainnet AuraINFT) ──
  const brain = {
    agent: "SALE-E2E-THROWAWAY", model: "qwen/qwen-image-edit-2511", canonicalBaseRoot: "0g://sale-e2e-base",
    styleDescriptor: "flow-b sale e2e throwaway", identityLock: "same subject", negative: "none",
    basePolicy: "ref-anchor", createdAt: new Date().toISOString(),
  };
  const { envelope, keyHex } = encryptBrain(brain);
  const dataHash = dataHashOf(envelope);
  const aesKey = Buffer.from(keyHex.replace(/^0x/, ""), "hex");
  const sPub = ethers.SigningKey.recoverPublicKey(ethers.hashMessage(`AURA login: ${S.address}`), await S.signMessage(`AURA login: ${S.address}`));
  const sealedS = sealedToHex(sealKeyToPubkey(sPub, aesKey));
  const styleFp = ethers.keccak256(ethers.toUtf8Bytes(`style-sale-e2e-${Date.now()}`));
  const modelAtt = ethers.keccak256(ethers.toUtf8Bytes("model-sale-e2e"));
  const encBrainRoot = `0g://sale-e2e-brain-${Date.now()}`;

  const inftS = auraInftWrite(S);
  const mintTx = await inftS.mintAgent(S.address, "SALE-E2E-THROWAWAY", styleFp, encBrainRoot, dataHash, modelAtt, 700, CREATOR_RESALE_BPS, sealedS, GAS);
  const mintRcpt = await mintTx.wait();
  (out.txs as any).mint = mintTx.hash;
  // parse the minted agentId from the AgentMinted event.
  let agentId = 0;
  for (const log of mintRcpt!.logs) {
    try {
      const p = readInft.interface.parseLog(log);
      if (p?.name === "AgentMinted") { agentId = Number(p.args.agentId); break; }
    } catch { /* not ours */ }
  }
  ok(agentId >= 1, `fresh agent minted (agentId #${agentId}), tx ${mintTx.hash}`);
  out.agentId = agentId;
  ok(((await readInft.ownerOf(agentId)) as string).toLowerCase() === S.address.toLowerCase(), "fresh agent owned by creator S");

  // stage the brain custody in the temp DB (mirrors what create-agent stages at mint) so the sale can re-encrypt it.
  cache.cacheImageByRoot(encBrainRoot, envelope, { contentType: "application/octet-stream", source: "brain" });
  storeMod.stageBrain({ owner: S.address, name: "SALE-E2E-THROWAWAY", encBrainRoot, brainKeyHex: keyHex, canonicalBaseRoot: encBrainRoot, styleFingerprint: styleFp, modelAttestation: modelAtt, sealedKey: sealedS, dataHash });
  storeMod.promoteBrainByRoot(encBrainRoot, agentId, S.address);
  ok(!!storeMod.brainByAgentId(agentId), "brain custody staged for the fresh agent");

  const app = await buildApp({ logger: false });
  const jwt = (addr: string) => app.jwt.sign({ address: addr.toLowerCase() });
  const inject = async (method: "POST" | "GET", url: string, addr: string | null, payload?: unknown) =>
    app.inject({ method, url, headers: addr ? { authorization: `Bearer ${jwt(addr)}` } : {}, payload: payload as any });

  // seller S writes a memory turn as the CURRENT owner (to prove the seller is walled off after the sale).
  await chatmem.appendTurn(agentId, S.address, { ts: new Date().toISOString(), ownerText: "S secret: the raven flies at dawn", auraText: "kept private for S", tools: [] });
  const sMemBefore = await chatmem.loadOwnerMemory(agentId, S.address);
  ok(!sMemBefore.notOwner && sMemBefore.records.length === 1, "seller S can read its relationship memory BEFORE the sale (it is the owner)");

  // helper: pay the custodian from a buyer wallet and return the funding tx hash.
  async function payCustodian(buyer: ethers.HDNodeWallet, custodian: string, amountWei: bigint): Promise<string> {
    const tx = await buyer.sendTransaction({ to: ethers.getAddress(custodian), value: amountWei, gasPrice: GAS.gasPrice });
    const r = await tx.wait();
    if (!r || r.status !== 1) throw new Error(`custodian payment ${tx.hash} reverted`);
    return tx.hash;
  }

  // ── SALE 1: S -> buyer1 ────────────────────────────────────────────────────────────────────────────
  console.log("\n  === SALE 1: S -> buyer1 ===");
  await (await inftS.setApprovalForAll(PLATFORM, true, GAS)).wait(); // seller approves the custodian to move the token
  const list1 = await inject("POST", `/agents/${agentId}/sale/list`, S.address, { priceWei: PRICE1.toString() });
  ok(list1.statusCode === 200, `sale/list 200 as owner S (got ${list1.statusCode}: ${list1.body.slice(0, 160)})`);
  (out.txs as any).list1 = "recorded (off-chain listing)";

  const market1 = await inject("GET", "/market/agents", null);
  const mj1 = market1.json() as any;
  ok(market1.statusCode === 200 && mj1.activeSales.some((s: any) => s.agentId === agentId), "GET /market/agents shows the listing (custodial=true)");
  ok(mj1.custodial === true && mj1.custodian.toLowerCase() === PLATFORM.toLowerCase(), "market discloses the custodian + custodial-MVP flag");

  const commit1 = await inject("POST", `/agents/${agentId}/sale/commit`, buyer1.address, {});
  const cj1 = commit1.json() as any;
  ok(commit1.statusCode === 200 && cj1.custodian.toLowerCase() === PLATFORM.toLowerCase() && cj1.amountWei === PRICE1.toString(), `commit 200 -> pay ${cj1.amountEther} to custodian`);

  const pay1 = await payCustodian(buyer1, cj1.custodian, BigInt(cj1.amountWei));
  (out.txs as any).pay1 = pay1;

  const sBal0 = await provider.getBalance(S.address);
  const settle1 = await inject("POST", `/agents/${agentId}/sale/settle`, buyer1.address, { escrowId: cj1.escrowId, paymentTx: pay1 });
  const sj1 = settle1.json() as any;
  ok(settle1.statusCode === 200, `settle 200 (got ${settle1.statusCode}: ${settle1.body.slice(0, 200)})`);
  (out.txs as any).transfer1 = sj1.transferTx;
  (out.split as any).sale1 = sj1.split;
  ok(((await readInft.ownerOf(agentId)) as string).toLowerCase() === buyer1.address.toLowerCase(), "SALE 1: ownerOf flipped S -> buyer1 on-chain");
  const agentAfter1 = await readInft.getAgent(agentId);
  ok(Number(agentAfter1.styleVersion) === 2, `SALE 1: styleVersion bumped 1 -> ${Number(agentAfter1.styleVersion)} (brain re-keyed)`);
  // split legs: creator==seller==S for the first sale, so royalty + proceeds both accrue to S; platform keeps the fee.
  const royalty1 = (sj1.split as any[]).find((l) => l.role === "royalty");
  const seller1 = (sj1.split as any[]).find((l) => l.role === "seller");
  const fee1 = (sj1.split as any[]).find((l) => l.role === "platformFee");
  ok(royalty1.receiver.toLowerCase() === S.address.toLowerCase(), "SALE 1 split: royalty receiver == creator S");
  ok(seller1.receiver.toLowerCase() === S.address.toLowerCase(), "SALE 1 split: seller proceeds -> S");
  ok(fee1.receiver.toLowerCase() === PLATFORM.toLowerCase() && fee1.tx === null, "SALE 1 split: platform fee retained by custodian (no self-transfer)");
  const sBal1 = await provider.getBalance(S.address);
  ok(sBal1 > sBal0, `SALE 1: seller/creator S balance increased by proceeds+royalty (${ethers.formatEther(sBal1 - sBal0)} 0G)`);

  // memory dual-wall: buyer1 (new owner) starts fresh + can write; seller S is now walled off.
  const b1Mem = await chatmem.loadOwnerMemory(agentId, buyer1.address);
  ok(!b1Mem.notOwner && b1Mem.records.length === 0, "SALE 1: buyer1 starts a FRESH, empty relationship epoch (can chat)");
  await chatmem.appendTurn(agentId, buyer1.address, { ts: new Date().toISOString(), ownerText: "buyer1 hello, new bond", auraText: "hi buyer1", tools: [] });
  const b1Mem2 = await chatmem.loadOwnerMemory(agentId, buyer1.address);
  ok(!b1Mem2.notOwner && b1Mem2.records.length === 1, "SALE 1: buyer1 can WRITE + read its own relationship memory (new epoch)");
  const sMemAfter = await chatmem.loadOwnerMemory(agentId, S.address);
  ok(sMemAfter.notOwner && sMemAfter.records.length === 0, "SALE 1: seller S is WALLED OFF after the sale (former owner cannot read; epoch dropped)");

  // ── RESALE HOP: buyer1 -> buyer2 (VISIBLE creator royalty: creator S != seller buyer1) ───────────────
  console.log("\n  === RESALE: buyer1 -> buyer2 (visible creator royalty) ===");
  const inftB1 = auraInftWrite(buyer1);
  await (await inftB1.setApprovalForAll(PLATFORM, true, GAS)).wait();
  const list2 = await inject("POST", `/agents/${agentId}/sale/list`, buyer1.address, { priceWei: PRICE2.toString() });
  ok(list2.statusCode === 200, `RESALE list 200 as buyer1 (got ${list2.statusCode})`);
  const commit2 = await inject("POST", `/agents/${agentId}/sale/commit`, buyer2.address, {});
  const cj2 = commit2.json() as any;
  ok(commit2.statusCode === 200, `RESALE commit 200 (got ${commit2.statusCode})`);
  const pay2 = await payCustodian(buyer2, cj2.custodian, BigInt(cj2.amountWei));
  (out.txs as any).pay2 = pay2;

  const sBalR0 = await provider.getBalance(S.address);
  const b1BalR0 = await provider.getBalance(buyer1.address);
  const settle2 = await inject("POST", `/agents/${agentId}/sale/settle`, buyer2.address, { escrowId: cj2.escrowId, paymentTx: pay2 });
  const sj2 = settle2.json() as any;
  ok(settle2.statusCode === 200, `RESALE settle 200 (got ${settle2.statusCode}: ${settle2.body.slice(0, 200)})`);
  (out.txs as any).transfer2 = sj2.transferTx;
  (out.split as any).resale = sj2.split;
  ok(((await readInft.ownerOf(agentId)) as string).toLowerCase() === buyer2.address.toLowerCase(), "RESALE: ownerOf flipped buyer1 -> buyer2");
  const agentAfter2 = await readInft.getAgent(agentId);
  ok(Number(agentAfter2.styleVersion) === 3, `RESALE: styleVersion bumped 2 -> ${Number(agentAfter2.styleVersion)}`);
  const royalty2 = (sj2.split as any[]).find((l) => l.role === "royalty");
  const seller2 = (sj2.split as any[]).find((l) => l.role === "seller");
  ok(royalty2.receiver.toLowerCase() === S.address.toLowerCase() && royalty2.tx, "RESALE split: creator royalty -> S with a REAL payout tx (creator != seller)");
  ok(seller2.receiver.toLowerCase() === buyer1.address.toLowerCase() && seller2.tx, "RESALE split: seller proceeds -> buyer1 with a payout tx");
  ok(BigInt(royalty2.wei) > 0n, `RESALE split: royalty wei = ${royalty2.wei} (${ethers.formatEther(royalty2.wei)} 0G, 10% creator resale)`);
  const sBalR1 = await provider.getBalance(S.address);
  const b1BalR1 = await provider.getBalance(buyer1.address);
  ok(sBalR1 - sBalR0 === BigInt(royalty2.wei), `RESALE: creator S received EXACTLY the royalty on-chain (+${ethers.formatEther(sBalR1 - sBalR0)} 0G)`);
  ok(b1BalR1 - b1BalR0 === BigInt(seller2.wei), `RESALE: seller buyer1 received EXACTLY the proceeds (+${ethers.formatEther(b1BalR1 - b1BalR0)} 0G)`);
  (out.split as any).resaleCheck = { royaltyToCreatorS: royalty2.wei, proceedsToSellerBuyer1: seller2.wei };

  // ── REFUND PATH: buyer2 lists, buyer3 commits + pays, the escrow EXPIRES, buyer3 refunds ─────────────
  console.log("\n  === REFUND: buyer3 commits + pays, escrow expires, refunds ===");
  const inftB2 = auraInftWrite(buyer2);
  await (await inftB2.setApprovalForAll(PLATFORM, true, GAS)).wait();
  const list3 = await inject("POST", `/agents/${agentId}/sale/list`, buyer2.address, { priceWei: PRICE3.toString() });
  ok(list3.statusCode === 200, `REFUND setup list 200 as buyer2 (got ${list3.statusCode})`);
  process.env.AGENT_SALE_WINDOW_SEC = "3"; // short window so the escrow expires quickly (read live at commit)
  const commit3 = await inject("POST", `/agents/${agentId}/sale/commit`, buyer3.address, {});
  const cj3 = commit3.json() as any;
  ok(commit3.statusCode === 200, `REFUND commit 200 (deadline ~now+3s)`);
  const pay3 = await payCustodian(buyer3, cj3.custodian, BigInt(cj3.amountWei));
  (out.txs as any).pay3 = pay3;
  const b3Bal0 = await provider.getBalance(buyer3.address);
  // settle BEFORE expiry must be refused ONLY after expiry; here we deliberately wait out the deadline.
  console.log("  waiting for the escrow deadline to pass...");
  await new Promise((r) => setTimeout(r, 6000));
  const earlyRefundOwner = (await readInft.ownerOf(agentId)) as string;
  const refund3 = await inject("POST", `/agents/${agentId}/sale/refund`, buyer3.address, { escrowId: cj3.escrowId, paymentTx: pay3 });
  const rj3 = refund3.json() as any;
  ok(refund3.statusCode === 200 && rj3.refunded === true && !!rj3.refundTx, `REFUND 200, refunded=${rj3.refunded}, refundTx=${rj3.refundTx}`);
  (out.txs as any).refund3 = rj3.refundTx;
  const b3Bal1 = await provider.getBalance(buyer3.address);
  ok(b3Bal1 > b3Bal0, `REFUND: buyer3 got the escrowed price back (+${ethers.formatEther(b3Bal1 - b3Bal0)} 0G)`);
  ok(((await readInft.ownerOf(agentId)) as string).toLowerCase() === buyer2.address.toLowerCase(), "REFUND: ownership unchanged (agent still owned by buyer2, no transfer)");
  process.env.AGENT_SALE_WINDOW_SEC = "3600";

  // ── CLEANUP: transfer the throwaway agent back to the platform so nothing is left mis-owned ──────────
  console.log("\n  === CLEANUP: return the throwaway agent to the platform ===");
  await (await inftB2.setApprovalForAll(PLATFORM, true, GAS)).wait();
  const { prepareSecureTransfer, confirmSecureTransfer } = await import("../aura/sale-service.js");
  const prepClean = await prepareSecureTransfer(agentId, buyer2.address, PLATFORM);
  const inftClean = auraInftWrite(sponsor);
  const cleanTx = await inftClean.transfer(prepClean.args.from, prepClean.args.to, prepClean.args.tokenId, prepClean.args.newSealedKey, prepClean.args.newEncBrainRoot, prepClean.args.newDataHash, prepClean.args.deadline, prepClean.args.proof, GAS);
  await cleanTx.wait();
  await confirmSecureTransfer(agentId, prepClean.pending);
  (out.txs as any).cleanupTransfer = cleanTx.hash;
  ok(((await readInft.ownerOf(agentId)) as string).toLowerCase() === PLATFORM.toLowerCase(), "CLEANUP: throwaway agent returned to the platform (no throwaway-owned agent left)");

  (out.balances as any).sponsorEnd = ethers.formatEther(await provider.getBalance(sponsor.address));
  out.passed = passed;
  console.log(`\n=== AGENT-SALE E2E: ${passed}/${passed} assertions PASS on 0G mainnet 16661 ===`);
  console.log(JSON.stringify(out, null, 2));
  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("\nE2E ERROR:", e?.stack || e);
  console.log("\n=== E2E SUMMARY (ERROR) ===\n" + JSON.stringify(out, null, 2));
  process.exit(1);
});
