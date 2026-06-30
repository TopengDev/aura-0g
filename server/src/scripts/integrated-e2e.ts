// INTEGRATED e2e: prove the integrated Summon shape (the real-marketplace design) on a real local EVM (anvil).
// Complements live-integration-e2e.ts (H-1 + B-1..B-6 on a fresh stack) by proving the TWO things the
// integrated pivot adds:
//
//   INT-1  SEPARATE-LAYER DEPLOY: a PRE-EXISTING AgentRegistry (the live marketplace) + a SEPARATELY-deployed
//          OutputNFT(existingRegistry) + SummonEscrow(existingRegistry, newOutputNFT) -> an agent that already
//          lives in the registry (owned by the deployer) becomes summonable; the watcher fulfills via H-1
//          mintForSettlement -> output to the buyer + the 97.5/2.5 split. (Mirrors DeployIntegrated.s.sol.)
//   INT-2  INCOME-FOLLOWS-THE-AGENT (the moat): transfer the agent to a NEW owner, summon again -> the owner
//          cut now accrues to the NEW owner (registry.ownerOf at settle), while the platform cut is unchanged.
//
// LOCAL ONLY: anvil + deterministic throwaway keys + a deterministic STUB gen (no 0G, no live keys).
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ethers } from "ethers";

const PORT = 8554;
const RPC = `http://127.0.0.1:${PORT}`;
const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const OUT = path.join(REPO, "contracts", "out");

// anvil deterministic accounts (PUBLIC throwaway, local only).
const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // acct0 = deployer == platform == initial agent owner (mirrors live 0x2537)
  sponsor: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // acct1 = sponsor/runner (GAS path)
  attestor: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // acct2 = attestor (SIGN-ONLY)
  owner2: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // acct3 = the NEW owner after transfer (income-follows target)
  buyer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // acct4 = buyer / summoner
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
function makeProof(tag: string) {
  return {
    imageRoot: `0g://stub-${tag}`,
    provenanceHash: ethers.id(`prov-${tag}`),
    teeAttestation: ethers.id(`tee-${tag}`),
    seed: 4242,
    model: "stub",
    teeSigner: ethers.ZeroAddress,
    verified: true,
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

    // ════════════════ SETUP: a PRE-EXISTING registry (the live marketplace), then the SEPARATE integrated layer ════════════════
    // STEP 1: the registry already exists with an agent the DEPLOYER owns (mirrors live: 0x2537 owns agents 1..4).
    const reg = await deploy(w("deployer"), "AgentRegistry", []);
    const regAddr = await reg.getAddress();
    await (await as(reg, "deployer").mintAgent(addr("deployer"), "NOKTURNE", ethers.id("style"), "0g://brain", ethers.id("model"), 700, 1000)).wait();
    ok((await reg.ownerOf(1)).toLowerCase() === addr("deployer").toLowerCase(), "pre-existing registry: agent #1 owned by the deployer (like the live marketplace)");

    // STEP 2: the INTEGRATED deploy - OutputNFT + SummonEscrow bound to the EXISTING registry (no fresh registry).
    const out = await deploy(w("deployer"), "OutputNFT", [regAddr, addr("attestor")]);
    const esc = await deploy(w("deployer"), "SummonEscrow", [regAddr, await out.getAddress(), addr("deployer"), 250]);
    const outAddr = await out.getAddress();
    const escAddr = await esc.getAddress();
    console.log("\n[setup] integrated layer deployed against the EXISTING registry");
    ok((await esc.registry()).toLowerCase() === regAddr.toLowerCase(), "SummonEscrow.registry == the EXISTING registry (not a fresh one)");
    ok((await out.registry()).toLowerCase() === regAddr.toLowerCase(), "new OutputNFT.registry == the EXISTING registry (agents are valid mint targets)");

    // STEP 3: the deployer (current owner) prices its existing agent -> summonable. (DeployIntegrated does this.)
    await (await as(esc, "deployer").setSummonPrice(1, ethers.parseEther("0.01"))).wait();
    ok((await esc.summonPrice(1)) === ethers.parseEther("0.01"), "existing agent #1 is now summonable at 0.01 (priced by its owner)");

    // point the server config at anvil + this stack BEFORE importing config-bound modules.
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "integrated-")), "test.db");
    process.env.CHAIN_ID = "31337";
    process.env.RPC_URL = RPC;
    process.env.AGENT_REGISTRY_ADDR = regAddr;
    process.env.OUTPUT_NFT_ADDR = outAddr;
    process.env.SUMMON_ESCROW_ADDR = escAddr;
    process.env.SPONSOR_PRIVATE_KEY = KEYS.sponsor;
    process.env.ATTESTOR_PRIVATE_KEY = KEYS.attestor;
    process.env.SQLITE_PATH = dbPath;
    process.env.SUMMON_START_BLOCK = "0";
    process.env.AURA_MAX_GENERATIONS = "100";
    process.env.AURA_PER_ADDRESS_GEN_QUOTA = "100";

    const { SummonWatcher } = await import("../aura/summon-watcher.js");
    let gen = 0;
    const verifiedGen = async () => {
      gen++;
      return makeProof(`INT-${gen}`);
    };
    const watcher = new SummonWatcher({ genFn: verifiedGen as never, log: (m) => console.log(`    [watcher] ${m}`) });

    // ════════════════ INT-1 — the existing agent is summonable on the integrated stack ════════════════
    console.log("\n[INT-1] existing-registry agent summonable -> watcher fulfills via H-1 -> split to the CURRENT owner");
    await (await as(esc, "buyer").summon(1, ethers.parseEther("0.01"), { value: ethers.parseEther("0.01") })).wait();
    const r1 = await watcher.pollOnce();
    ok(r1.fulfilled === 1, `watcher fulfilled the summon (fulfilled=${r1.fulfilled})`);
    ok((await out.ownerOf(1)).toLowerCase() === addr("buyer").toLowerCase(), "output #1 minted to the BUYER (H-1 mintForSettlement via the escrow)");
    ok((await esc.requests(1)).settled === true, "request #1 settled on-chain");
    const ownerCut1 = (await esc.pendingWithdrawals(addr("deployer"))) as bigint;
    ok(ownerCut1 === ethers.parseEther("0.01"), `current owner (deployer, also platform) earned the full 0.01 (owner 0.00975 + platform 0.00025)`);

    // ════════════════ INT-2 — INCOME-FOLLOWS-THE-AGENT (the moat) ════════════════
    console.log("\n[INT-2] transfer the agent to a NEW owner -> the next summon's owner-cut follows to the NEW owner");
    // transfer agent #1 from the deployer to owner2 (acct3). The summonPrice persists (escrow mapping, not cleared by transfer).
    await (await as(reg, "deployer").transferFrom(addr("deployer"), addr("owner2"), 1)).wait();
    ok((await reg.ownerOf(1)).toLowerCase() === addr("owner2").toLowerCase(), "agent #1 transferred to the NEW owner (owner2)");
    ok((await esc.summonPrice(1)) === ethers.parseEther("0.01"), "agent #1 stays summonable after transfer (price persists across ownership change)");

    const owner2Before = (await esc.pendingWithdrawals(addr("owner2"))) as bigint;
    const platformBefore = (await esc.pendingWithdrawals(addr("deployer"))) as bigint;
    await (await as(esc, "buyer").summon(1, ethers.parseEther("0.01"), { value: ethers.parseEther("0.01") })).wait();
    const r2 = await watcher.pollOnce();
    ok(r2.fulfilled === 1, `watcher fulfilled the 2nd summon (fulfilled=${r2.fulfilled})`);
    const owner2Delta = ((await esc.pendingWithdrawals(addr("owner2"))) as bigint) - owner2Before;
    const platformDelta = ((await esc.pendingWithdrawals(addr("deployer"))) as bigint) - platformBefore;
    ok(owner2Delta === ethers.parseEther("0.00975"), `INCOME-FOLLOWS: the NEW owner (owner2) earned the 0.00975 owner cut (delta=${ethers.formatEther(owner2Delta)})`);
    ok(platformDelta === ethers.parseEther("0.00025"), `platform still earns only its 0.00025 cut (delta=${ethers.formatEther(platformDelta)}), NOT the owner cut`);
    ok((await out.ownerOf(2)).toLowerCase() === addr("buyer").toLowerCase(), "2nd output minted to the buyer");

    console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} - ${pass} passed, ${fail} failed`);
  } finally {
    anvil.kill("SIGKILL");
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("integrated-e2e crashed:", e);
  process.exit(1);
});
