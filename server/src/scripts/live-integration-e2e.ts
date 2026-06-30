// LIVE INTEGRATION e2e: prove H-1 + the B-1..B-6 hardenings hold TOGETHER on a real local EVM (anvil), end
// to end, with the keys SPLIT (B-6). Complements summon-watcher-e2e.ts (happy-path/idempotence) and
// poc-hardening.ts (offline B-1..B-6 logic) by exercising the INTEGRATED LIVE flow the isolated tests miss:
//
//   PART A  happy path, SPLIT keys: buyer summons -> the REAL watcher fulfills (SPONSOR sends the tx/gas,
//           the ATTESTOR only signs) -> mintForSettlement -> output to the buyer + 0.00975/0.00025 split.
//           B-6 LIVE: the attestor key sends ZERO txs (off the gas path); the sponsor key sends the fulfill.
//   PART B  H-1: an attacker's DIRECT mintForSettlement with the attestor's (settler=escrow) sig REVERTS
//           "bad attestation"; that same sig CANNOT route through the permissionless mintOutput; the legit
//           escrow.fulfill SETTLES (mint to buyer + split); a post-settle replay reverts "nonce used".
//   PART C  B-5: a generation whose TEE attestation did NOT verify (verified="n/a") is REFUSED via the
//           EXACT generateAndProve guard -> NO mint, escrow intact. B-4: it is retried at most
//           MAX_SUMMON_ATTEMPTS then ABANDONED (no infinite sponsor-paid regen); the buyer can still REFUND.
//
// LOCAL ONLY: anvil + deterministic throwaway keys + a deterministic STUB gen (no 0G, no live keys). The
// real ~42s 0G Compute gen is gate-validated separately; this proves the on-chain + watcher WIRING.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ethers } from "ethers";
import type { MintAuthParams } from "../aura/attestation.js";

const PORT = 8553;
const RPC = `http://127.0.0.1:${PORT}`;
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const OUT = path.join(REPO, "contracts", "out");

// anvil deterministic accounts (PUBLIC throwaway, local only). B-6: 3 DISTINCT roles for the split.
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // acct0 = platform / deployer
  sponsor: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // acct1 = sponsor/runner (GAS path)
  attestor: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // acct2 = attestor (SIGN-ONLY)
  owner: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // acct3 = agent owner
  buyer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // acct4 = buyer / summoner
  attacker: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // acct5 = front-runner
};

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}`);
  }
}

function artifact(name: string): { abi: ethers.InterfaceAbi; bytecode: string } {
  const j = JSON.parse(readFileSync(path.join(OUT, `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}
async function deploy(wallet: ethers.Wallet, name: string, args: unknown[]): Promise<ethers.Contract> {
  const a = artifact(name);
  const f = new ethers.ContractFactory(a.abi, a.bytecode, wallet);
  const c = await f.deploy(...args);
  await c.waitForDeployment();
  return c as unknown as ethers.Contract;
}
async function waitForAnvil(tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      const j = (await res.json()) as { result?: string };
      if (j.result) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("anvil RPC did not come up");
}
function revertOf(e: unknown): string {
  const x = e as { shortMessage?: string; reason?: string; message?: string };
  return (x?.shortMessage || x?.reason || x?.message || String(e)).slice(0, 100);
}
// a deterministic GenProof (shape only; the real 0G gen is validated separately).
function makeProof(tag: string, verified: boolean | string) {
  return {
    imageRoot: `0g://stub-${tag}`,
    provenanceHash: ethers.id(`prov-${tag}`),
    teeAttestation: ethers.id(`tee-${tag}`),
    seed: 4242,
    model: "stub",
    teeSigner: ethers.ZeroAddress,
    verified,
    verifiability: "TEE",
    chatId: "stub",
    latencyMs: 1,
    bytes: Buffer.alloc(0),
    prompt: "stub",
    usedBrain: false,
    provenanceRecord: {},
  };
}

async function main(): Promise<void> {
  const anvil: ChildProcess = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  try {
    await waitForAnvil();
    const provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true });
    const w = (k: keyof typeof KEYS) => new ethers.Wallet(KEYS[k], provider);
    const addr = (k: keyof typeof KEYS) => w(k).address;
    const as = (c: ethers.Contract, k: keyof typeof KEYS) => c.connect(w(k)) as ethers.Contract;

    // ── deploy: OutputNFT attestor = the SPLIT attestor key (acct2); escrow platform = deployer (acct0), 250 bps ──
    const reg = await deploy(w("deployer"), "AgentRegistry", []);
    const out = await deploy(w("deployer"), "OutputNFT", [await reg.getAddress(), addr("attestor")]);
    const esc = await deploy(w("deployer"), "SummonEscrow", [await reg.getAddress(), await out.getAddress(), addr("deployer"), 250]);
    const regAddr = await reg.getAddress();
    const outAddr = await out.getAddress();
    const escAddr = await esc.getAddress();
    console.log("\n[setup] deployed stack on anvil with SPLIT keys");
    ok(true, `registry ${regAddr.slice(0, 10)} / output ${outAddr.slice(0, 10)} / escrow ${escAddr.slice(0, 10)}`);
    ok((await out.attestor()).toLowerCase() === addr("attestor").toLowerCase(), `OutputNFT.attestor == split attestor key acct2 (${addr("attestor").slice(0, 10)})`);

    // mint agent #1 to owner; owner prices it 0.01 ETH.
    await (await as(reg, "deployer").mintAgent(addr("owner"), "NOKTURNE", ethers.id("style"), "0g://brain", ethers.id("model"), 700, 1000)).wait();
    await (await as(esc, "owner").setSummonPrice(1, ethers.parseEther("0.01"))).wait();

    // ── point the server config at anvil + this stack BEFORE importing config-bound modules ──
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "live-integ-")), "test.db");
    process.env.CHAIN_ID = "31337";
    process.env.RPC_URL = RPC;
    process.env.AGENT_REGISTRY_ADDR = regAddr;
    process.env.OUTPUT_NFT_ADDR = outAddr;
    process.env.SUMMON_ESCROW_ADDR = escAddr;
    process.env.SPONSOR_PRIVATE_KEY = KEYS.sponsor; // GAS path (sends fulfill)
    process.env.ATTESTOR_PRIVATE_KEY = KEYS.attestor; // B-6 split: distinct SIGN-ONLY key
    process.env.SQLITE_PATH = dbPath;
    process.env.SUMMON_START_BLOCK = "0";
    process.env.AURA_MAX_SUMMON_ATTEMPTS = "2"; // small so the B-4 cap is fast/legible
    process.env.AURA_SUMMON_RETRY_BACKOFF_MS = "0"; // no wait between retries in the test
    process.env.AURA_MAX_GENERATIONS = "100"; // don't let the gen cap gate the watcher tests
    process.env.AURA_PER_ADDRESS_GEN_QUOTA = "100";

    const { SummonWatcher } = await import("../aura/summon-watcher.js");
    const { signSettlementMintAuth, attestorAddress } = await import("../aura/attestation.js");
    const { ENFORCE_TEE_VERIFICATION, attestorIsSplitFromSponsor } = await import("../aura/config.js");
    const { teeVerifyPassed, TeeVerificationError } = await import("../aura/generate.js");

    // ── B-6 key split is live on this stack ──
    console.log("\n[B-6] key split live (attestor off the gas wallet)");
    ok(attestorAddress().toLowerCase() === addr("attestor").toLowerCase(), "config attestorAddress() == acct2 (the on-chain OutputNFT.attestor)");
    ok(attestorAddress().toLowerCase() !== addr("sponsor").toLowerCase(), "attestor (acct2) != sponsor/gas key (acct1)");
    ok(attestorIsSplitFromSponsor() === true, "attestorIsSplitFromSponsor() == true");

    // ════════════════ PART A — happy path with SPLIT keys (real watcher) ════════════════
    console.log("\n[PART A] happy path: buyer summons -> real watcher fulfills (sponsor gas, attestor signs)");
    await (await as(esc, "buyer").summon(1, ethers.parseEther("0.01"), { value: ethers.parseEther("0.01") })).wait();
    ok((await esc.requests(1)).buyer.toLowerCase() === addr("buyer").toLowerCase(), "buyer summoned agent #1 (request #1, 0.01 ETH escrowed)");

    let genCallsA = 0;
    const verifiedGen = async () => {
      genCallsA++;
      return makeProof(`A-${genCallsA}`, true);
    };
    const watcherA = new SummonWatcher({ genFn: verifiedGen as never, log: (m) => console.log(`    [watcherA] ${m}`) });
    const rA = await watcherA.pollOnce();
    ok(rA.fulfilled === 1, `watcher fulfilled request #1 (fulfilled=${rA.fulfilled})`);
    ok((await out.ownerOf(1)).toLowerCase() === addr("buyer").toLowerCase(), "output #1 minted to the BUYER");
    const ownerCutA = await esc.pendingWithdrawals(addr("owner"));
    const platCutA = await esc.pendingWithdrawals(addr("deployer"));
    ok(ownerCutA === ethers.parseEther("0.00975"), `fee split: owner ${ethers.formatEther(ownerCutA)} ETH (97.5%)`);
    ok(platCutA === ethers.parseEther("0.00025"), `fee split: platform ${ethers.formatEther(platCutA)} ETH (2.5%)`);
    ok((await esc.requests(1)).settled === true, "request #1 settled on-chain");
    // B-6 live proof: the attestor key NEVER sent a tx (sign-only); the sponsor key sent the fulfill.
    ok(Number(await provider.getTransactionCount(addr("attestor"))) === 0, "B-6: attestor key sent ZERO txs (sign-only, OFF the gas path)");
    ok(Number(await provider.getTransactionCount(addr("sponsor"))) > 0, "B-6: sponsor key sent the fulfill tx (the gas path)");

    // ════════════════ PART B — H-1 live front-run ════════════════
    console.log("\n[PART B] H-1: front-run the settlement mint -> must REVERT; legit fulfill still settles");
    await (await as(esc, "buyer").summon(1, ethers.parseEther("0.01"), { value: ethers.parseEther("0.01") })).wait();
    ok((await esc.requests(2)).buyer.toLowerCase() === addr("buyer").toLowerCase(), "buyer summoned agent #1 again (request #2)");

    // backend builds the attestor SettlementMintAuth sig (settler = the escrow) for request #2's gen.
    const proofB = makeProof("B", true);
    const nonceB = ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;
    const paramsB: MintAuthParams = {
      to: ethers.getAddress(addr("buyer")) as `0x${string}`,
      creatorAgentId: 1n,
      imageRoot: proofB.imageRoot,
      provenanceHash: proofB.provenanceHash as `0x${string}`,
      teeAttestation: proofB.teeAttestation as `0x${string}`,
      seed: BigInt(proofB.seed),
      nonce: nonceB,
    };
    const settlementSig = await signSettlementMintAuth(paramsB, ethers.getAddress(escAddr) as `0x${string}`);

    // ATTACK 1: attacker calls OutputNFT.mintForSettlement DIRECTLY (msg.sender = attacker != signed settler=escrow).
    let revD = "";
    let threwD = false;
    try {
      await (await as(out, "attacker").mintForSettlement(addr("buyer"), 1, proofB.imageRoot, proofB.provenanceHash, proofB.teeAttestation, BigInt(proofB.seed), nonceB, settlementSig)).wait();
    } catch (e) {
      threwD = true;
      revD = revertOf(e);
    }
    ok(threwD && /bad attestation/i.test(revD), `H-1: attacker DIRECT mintForSettlement REVERTS ("${revD}")`);
    ok((await out.usedSettlementNonce(nonceB)) === false, "H-1: the settlement nonce was NOT consumed by the failed front-run");

    // ATTACK 2: the SAME sig cannot route through the permissionless mintOutput (different EIP-712 type/digest).
    let revM = "";
    let threwM = false;
    try {
      await (await as(out, "attacker").mintOutput(addr("buyer"), 1, proofB.imageRoot, proofB.provenanceHash, proofB.teeAttestation, BigInt(proofB.seed), nonceB, settlementSig)).wait();
    } catch (e) {
      threwM = true;
      revM = revertOf(e);
    }
    ok(threwM && /bad attestation/i.test(revM), `H-1: settlement sig CANNOT route through mintOutput ("${revM}")`);

    // LEGIT: escrow.fulfill (sponsor sends) -> escrow calls mintForSettlement (msg.sender == escrow == signed settler) -> mints.
    const nextBefore = await out.nextTokenId();
    const ownerBefore = (await esc.pendingWithdrawals(addr("owner"))) as bigint;
    await (await as(esc, "sponsor").fulfill(2, proofB.imageRoot, proofB.provenanceHash, proofB.teeAttestation, BigInt(proofB.seed), nonceB, settlementSig)).wait();
    ok((await esc.requests(2)).settled === true, "H-1: legit escrow.fulfill SETTLES request #2");
    ok((await out.nextTokenId()) === nextBefore + 1n, "H-1: exactly ONE new output minted by the legit settle");
    ok((await out.ownerOf(nextBefore)).toLowerCase() === addr("buyer").toLowerCase(), `H-1: output #${nextBefore} minted to the BUYER (not the attacker)`);
    ok((await out.usedSettlementNonce(nonceB)) === true, "H-1: the settlement nonce is now consumed");
    ok(((await esc.pendingWithdrawals(addr("owner"))) as bigint) - ownerBefore === ethers.parseEther("0.00975"), "H-1: owner cut +0.00975 ETH on the legit settle");

    // ATTACK 3 (post-settle replay): attacker re-uses the now-consumed nonce -> "nonce used".
    let revR = "";
    let threwR = false;
    try {
      await (await as(out, "attacker").mintForSettlement(addr("buyer"), 1, proofB.imageRoot, proofB.provenanceHash, proofB.teeAttestation, BigInt(proofB.seed), nonceB, settlementSig)).wait();
    } catch (e) {
      threwR = true;
      revR = revertOf(e);
    }
    ok(threwR && /nonce used/i.test(revR), `H-1: post-settle replay of the nonce REVERTS ("${revR}")`);

    // ════════════════ PART C — B-5 (TEE-enforced) + B-4 (retry cap) live ════════════════
    console.log("\n[PART C] B-5: unverified TEE attestation -> NO mint; B-4: retries capped -> abandoned");
    await (await as(esc, "buyer").summon(1, ethers.parseEther("0.01"), { value: ethers.parseEther("0.01") })).wait();
    const reqC = 3;
    ok((await esc.requests(reqC)).buyer.toLowerCase() === addr("buyer").toLowerCase(), `buyer summoned agent #1 (request #${reqC})`);

    // a gen that mirrors generateAndProve's EXACT B-5 guard: verified="n/a" -> throw TeeVerificationError.
    let genCallsC = 0;
    const unverifiedGen = async () => {
      genCallsC++;
      const verified = "n/a";
      if (ENFORCE_TEE_VERIFICATION && !teeVerifyPassed(verified)) {
        throw new TeeVerificationError(`TEE verification did not pass (verified=${JSON.stringify(verified)}) - refusing to attest/mint`);
      }
      return makeProof(`C-${genCallsC}`, verified);
    };
    const watcherC = new SummonWatcher({ genFn: unverifiedGen as never, log: (m) => console.log(`    [watcherC] ${m}`) });
    const nextC = await out.nextTokenId();

    await watcherC.pollOnce(); // attempt 1 -> gen refuses -> 'failed'
    await watcherC.pollOnce(); // attempt 2 -> at MAX -> 'abandoned'
    await watcherC.pollOnce(); // 'abandoned' is terminal -> NOT reprocessed (no more gen)

    ok((await esc.requests(reqC)).settled === false, "B-5: request #3 is NOT settled (unverified gen never minted)");
    ok((await out.nextTokenId()) === nextC, "B-5: NO new output minted for the unverified gen");
    ok(genCallsC === 2, `B-4: gen ran at most MAX_SUMMON_ATTEMPTS (2) times then stopped (genCalls=${genCallsC}, no infinite regen)`);
    const { db } = await import("../aura/db.js");
    const rowC = db().prepare("SELECT status FROM summon_requests WHERE request_id = ?").get(reqC) as { status: string } | undefined;
    ok(rowC?.status === "abandoned", `B-4: request #3 marked terminal 'abandoned' (status=${rowC?.status})`);

    // anti-rug: the buyer can still REFUND the abandoned request after the deadline (no funds stuck).
    await provider.send("evm_increaseTime", [3601]); // past FULFILL_WINDOW (1h)
    await provider.send("evm_mine", []);
    const buyerBefore = (await esc.pendingWithdrawals(addr("buyer"))) as bigint;
    await (await as(esc, "buyer").refund(reqC)).wait();
    ok(((await esc.pendingWithdrawals(addr("buyer"))) as bigint) - buyerBefore === ethers.parseEther("0.01"), "B-4/anti-rug: buyer REFUNDED the abandoned summon (0.01 ETH, no funds stuck)");
    ok((await esc.requests(reqC)).settled === true, "request #3 now terminal via refund");

    console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} - ${pass} passed, ${fail} failed`);
  } finally {
    anvil.kill("SIGKILL");
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("live-integration crashed:", e);
  process.exit(1);
});
