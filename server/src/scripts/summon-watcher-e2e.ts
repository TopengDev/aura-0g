// CP2 e2e: drive the REAL SummonWatcher against a REAL EVM (local anvil), end to end.
//   deploy stack -> mint agent -> price -> BUYER summons (fee escrowed) -> watcher.pollOnce() runs the
//   (stubbed, fast) gen + signs the attestor MintAuth + calls fulfill() -> assert the output minted to the
//   BUYER + the fee split to owner/platform + the journal row 'fulfilled'. Then pollOnce() AGAIN to assert
//   IDEMPOTENCE (settled on-chain -> no double-fulfill, no second mint, balances unchanged).
//
// The gen is dependency-injected with a deterministic STUB (the real ~42s 0G Compute path is separately
// gate-validated 3/3); this test proves the WATCHER WIRING (event -> sign -> fulfill -> mint+split) + the
// idempotency, fast + free + offline. anvil's well-known test keys (throwaway) drive the wallets.
//
// IMPORTANT: env is set BEFORE any dynamic import of our config-bound modules, because config.ts reads
// process.env at module-load time (chainId / addresses / sqlite path / start block).
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ethers } from "ethers";

const PORT = 8551;
const RPC = `http://127.0.0.1:${PORT}`;
const REPO = path.resolve(import.meta.dirname, "..", "..", ".."); // server/src/scripts -> repo
const OUT = path.join(REPO, "contracts", "out");

// anvil deterministic keys (PUBLIC throwaway - local only)
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // platform
  runner: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // attestor + sponsor + runner
  owner: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // agent owner
  buyer: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // summoner
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

// readiness probe via RAW fetch (NOT the ethers provider, whose network auto-detection flaps - and can
// rebroadcast a tx - if it is first used before anvil is actually listening).
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

async function main(): Promise<void> {
  // ── spin up an isolated anvil ──
  const anvil: ChildProcess = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  try {
    await waitForAnvil();
    // static network (anvil is up + chainId is known) => no auto-detect flap, no spurious rebroadcast.
    const provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true });
    const w = (k: keyof typeof KEYS) => new ethers.Wallet(KEYS[k], provider);

    // ── deploy AgentRegistry + OutputNFT(attestor = runner) + SummonEscrow(platform, 250) ──
    const reg = await deploy(w("deployer"), "AgentRegistry", []);
    const out = await deploy(w("deployer"), "OutputNFT", [await reg.getAddress(), w("runner").address]);
    const esc = await deploy(w("deployer"), "SummonEscrow", [
      await reg.getAddress(),
      await out.getAddress(),
      w("deployer").address, // platform
      250,
    ]);
    const regAddr = await reg.getAddress();
    const outAddr = await out.getAddress();
    const escAddr = await esc.getAddress();
    ok(true, `deployed: registry ${regAddr.slice(0, 10)}.. output ${outAddr.slice(0, 10)}.. escrow ${escAddr.slice(0, 10)}..`);

    // ── mint agent #1 (NOKTURNE, 7% royalty) to OWNER; OWNER prices it; BUYER summons ──
    const regAs = (k: keyof typeof KEYS) => reg.connect(w(k)) as ethers.Contract;
    const escAs = (k: keyof typeof KEYS) => esc.connect(w(k)) as ethers.Contract;
    await (await regAs("deployer").mintAgent(
      w("owner").address, "NOKTURNE", ethers.id("style"), "0g://brain", ethers.id("model"), 700, 1000,
    )).wait();
    await (await escAs("owner").setSummonPrice(1, ethers.parseEther("0.1"))).wait();
    await (await escAs("buyer").summon(1, ethers.parseEther("0.1"), { value: ethers.parseEther("0.1") })).wait();
    ok((await esc.requests(1)).buyer.toLowerCase() === w("buyer").address.toLowerCase(), "BUYER summoned agent #1 (0.1 ETH escrowed)");
    ok((await provider.getBalance(escAddr)) === ethers.parseEther("0.1"), "escrow HOLDS the fee");

    // ── point the server config at anvil + this stack BEFORE importing config-bound modules ──
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "summon-e2e-")), "test.db");
    process.env.CHAIN_ID = "31337";
    process.env.RPC_URL = RPC;
    process.env.AGENT_REGISTRY_ADDR = regAddr;
    process.env.OUTPUT_NFT_ADDR = outAddr;
    process.env.SUMMON_ESCROW_ADDR = escAddr;
    process.env.SPONSOR_PRIVATE_KEY = KEYS.runner; // sponsor == attestor == runner
    process.env.SQLITE_PATH = dbPath;
    process.env.SUMMON_START_BLOCK = "0";

    const { SummonWatcher } = await import("../aura/summon-watcher.js");

    // deterministic stub gen (the real ~42s 0G path is gate-validated separately; this proves wiring).
    let genCalls = 0;
    const stubGen = async (a: { agentId: number }) => {
      genCalls++;
      return {
        imageRoot: `0g://stub-${a.agentId}-${genCalls}`,
        provenanceHash: ethers.id(`prov-${a.agentId}-${genCalls}`),
        teeAttestation: ethers.id(`tee-${a.agentId}-${genCalls}`),
        seed: 1234 + genCalls,
        model: "stub", teeSigner: ethers.ZeroAddress, verified: true, verifiability: "TEE",
        chatId: "stub", latencyMs: 1, bytes: Buffer.alloc(0), prompt: "stub", usedBrain: false, provenanceRecord: {},
      };
    };

    const watcher = new SummonWatcher({ genFn: stubGen as never, log: (m) => console.log(`    [watcher] ${m}`) });

    // ── pollOnce: detect Summoned -> stub gen -> sign -> fulfill -> mint + split ──
    const r1 = await watcher.pollOnce();
    ok(r1.scanned === 1, `pollOnce scanned the 1 Summoned event (scanned=${r1.scanned})`);
    ok(r1.fulfilled === 1, `pollOnce FULFILLED the summon (fulfilled=${r1.fulfilled})`);
    ok(genCalls === 1, "the gen ran exactly once");

    ok((await out.ownerOf(1)).toLowerCase() === w("buyer").address.toLowerCase(), "output #1 minted to the BUYER (attestation-gated, real EVM)");
    const ownerCut = await esc.pendingWithdrawals(w("owner").address);
    const platCut = await esc.pendingWithdrawals(w("deployer").address);
    ok(ownerCut === ethers.parseEther("0.0975"), `fee SPLIT: owner ${ethers.formatEther(ownerCut)} ETH (97.5%)`);
    ok(platCut === ethers.parseEther("0.0025"), `fee SPLIT: platform ${ethers.formatEther(platCut)} ETH (2.5%)`);
    ok((await esc.requests(1)).settled === true, "request #1 settled on-chain");

    // ── IDEMPOTENCE: a second poll must NOT re-fulfill (settled) - no second mint, balances unchanged ──
    const r2 = await watcher.pollOnce();
    ok(r2.fulfilled === 0, `second pollOnce did NOT re-fulfill (fulfilled=${r2.fulfilled})`);
    ok(genCalls === 1, "the gen did NOT run a second time (idempotent)");
    ok((await out.nextTokenId()) === 2n, "no second output minted (nextTokenId still 2)");
    ok((await esc.pendingWithdrawals(w("owner").address)) === ownerCut, "owner balance unchanged (no double-split)");

    // ── CRASH-RECOVERY idempotence (the double-mint guard): a stale NON-terminal journal row for a request
    //    that is ALREADY settled on-chain must reconcile (NOT re-fulfill). Simulate a process that crashed
    //    after the fulfill tx landed but before the status write -> the on-chain settled re-check saves us. ──
    const { db } = await import("../aura/db.js");
    await (await escAs("buyer").summon(1, ethers.parseEther("0.1"), { value: ethers.parseEther("0.1") })).wait(); // request #2
    await watcher.pollOnce(); // watcher fulfills #2 -> output #2
    ok((await esc.requests(2)).settled === true, "request #2 fulfilled by the watcher (output #2)");
    const genAfter2 = genCalls;
    // forcibly reset #2's journal row to a stale non-terminal status (the orphaned-after-crash case)
    db().prepare("UPDATE summon_requests SET status='failed' WHERE request_id=2").run();
    const r3 = await watcher.pollOnce();
    ok(r3.fulfilled === 0, "stale 'failed' row for an ALREADY-settled request did NOT re-fulfill");
    ok(genCalls === genAfter2, "no extra gen on the stale row (on-chain settled reconciled)");
    ok((await out.nextTokenId()) === 3n, "exactly 2 outputs total - NO phantom third mint (double-mint guard holds)");
    const row2 = db().prepare("SELECT status FROM summon_requests WHERE request_id=2").get() as { status: string };
    ok(row2.status === "settled", "stale row reconciled to 'settled'");

    console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} - ${pass} passed, ${fail} failed`);
  } finally {
    anvil.kill("SIGKILL");
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("e2e crashed:", e);
  process.exit(1);
});
