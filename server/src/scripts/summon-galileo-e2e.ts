// CP5 LIVE proof: the REAL Summon loop on 0G Galileo, end to end, with the REAL ~42s TEE generation.
//   buyer pays summon (0.01 0G escrowed) -> the REAL SummonWatcher detects the Summoned event -> runs the
//   real 0G Compute gen (generateAndProve, the gate-validated ~42s path) -> signs the attestor MintAuth ->
//   fulfill() mints the output to the buyer + splits the fee. Asserts the mint + split on the LIVE chain.
//
// Isolated Summon stack (deployed-summon.json). Self-summon (the only funded wallet is 0x253727ac, which
// is buyer=owner=platform=sponsor=attestor) — still proves the full pipeline executes live with a real gen.
// A distinct buyer + the income-follows beat are for the recorded demo (a 2nd funded wallet). Idempotent:
// if a fulfill receipt flakes on the Galileo RPC, the on-chain settled re-check reconciles on retry.
//
// env is set BEFORE importing config-bound modules (config.ts reads process.env at load time).
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ethers } from "ethers";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const dep = JSON.parse(readFileSync(path.join(REPO, "contracts", "deployed-summon.json"), "utf8"));
const RPC = dep.rpcUrl as string;

// the funded key (0x253727ac) from the repo .env. Used as buyer + sponsor/attestor/runner.
function envKey(): string {
  const env = readFileSync(path.join(REPO, ".env"), "utf8");
  const m = env.match(/^PRIVATE_KEY=(.+)$/m);
  if (!m) throw new Error("PRIVATE_KEY not in .env");
  const k = m[1].trim();
  return k.startsWith("0x") ? k : `0x${k}`;
}

let pass = 0;
let fail = 0;
const ok = (c: boolean, label: string) => {
  if (c) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}`);
  }
};

async function main(): Promise<void> {
  const KEY = envKey();
  // static network -> no auto-detect flap / spurious rebroadcast on the flaky Galileo RPC.
  const provider = new ethers.JsonRpcProvider(RPC, dep.chainId, { staticNetwork: true });
  const buyer = new ethers.Wallet(KEY, provider);
  console.log(`Galileo LIVE summon e2e · buyer/sponsor ${buyer.address}\n  escrow ${dep.summonEscrow}\n`);

  const escAbi = [
    "function summon(uint256 agentId,uint256 maxPrice) payable returns (uint256)",
    "function requests(uint256) view returns (address buyer,uint256 agentId,uint256 fee,uint64 deadline,bool settled)",
    "function pendingWithdrawals(address) view returns (uint256)",
    "function summonPrice(uint256) view returns (uint256)",
    "event Summoned(uint256 indexed requestId,uint256 indexed agentId,address indexed buyer,uint256 fee,uint64 deadline)",
  ];
  const outAbi = ["function ownerOf(uint256) view returns (address)", "function nextTokenId() view returns (uint256)"];
  const esc = new ethers.Contract(dep.summonEscrow, escAbi, buyer);
  const out = new ethers.Contract(dep.outputNFT, outAbi, provider);

  const AGENT = 1n; // NOKTURNE (seeded + priced)
  const price: bigint = await esc.summonPrice(AGENT);
  ok(price > 0n, `agent #${AGENT} is summonable on Galileo (price ${ethers.formatEther(price)} 0G)`);

  const pendingBefore: bigint = await esc.pendingWithdrawals(buyer.address);
  const tokenBefore: bigint = await out.nextTokenId();

  // ── 1. BUYER summons (escrows the fee) ──
  console.log("→ summon() ...");
  const sumTx = await esc.summon(AGENT, price, { value: price, gasPrice: 5_000_000_000n });
  const sumRcpt = await sumTx.wait();
  let requestId = 0;
  const iface = new ethers.Interface(escAbi);
  for (const lg of sumRcpt.logs) {
    try {
      const p = iface.parseLog(lg);
      if (p?.name === "Summoned") {
        requestId = Number(p.args.requestId);
        break;
      }
    } catch {
      /* not ours */
    }
  }
  ok(requestId > 0, `BUYER summoned agent #${AGENT} on Galileo -> requestId ${requestId} (tx ${sumRcpt.hash.slice(0, 12)}…)`);
  const r0 = await esc.requests(requestId);
  ok(r0.fee === price && r0.settled === false, "fee escrowed on-chain, unsettled");

  // ── 2. point the server config at the live stack + spin up the REAL watcher (REAL ~42s gen) ──
  const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "summon-galileo-")), "test.db");
  process.env.CHAIN_ID = String(dep.chainId);
  process.env.RPC_URL = RPC;
  process.env.AGENT_REGISTRY_ADDR = dep.agentRegistry;
  process.env.OUTPUT_NFT_ADDR = dep.outputNFT;
  process.env.SUMMON_ESCROW_ADDR = dep.summonEscrow;
  process.env.SPONSOR_PRIVATE_KEY = KEY;
  process.env.SQLITE_PATH = dbPath;
  process.env.SUMMON_START_BLOCK = String(dep.summonStartBlock);

  const { SummonWatcher } = await import("../aura/summon-watcher.js");
  const watcher = new SummonWatcher({ log: (m) => console.log(`    [watcher] ${m}`) }); // default genFn = REAL gen

  // ── 3. drive the watcher: detect -> REAL gen (~42s) -> fulfill -> mint + split. Idempotent retry on flake. ──
  console.log("→ watcher.pollOnce() — this runs the REAL ~42s 0G Compute generation, please wait…");
  let settled = false;
  for (let attempt = 1; attempt <= 2 && !settled; attempt++) {
    const t0 = Date.now();
    const res = await watcher.pollOnce();
    console.log(`    poll ${attempt}: ${JSON.stringify(res)} (${Math.round((Date.now() - t0) / 1000)}s)`);
    settled = (await esc.requests(requestId)).settled;
    if (!settled) console.log(`    not settled yet (attempt ${attempt}) — retrying (idempotent)…`);
  }
  ok(settled, "request SETTLED on-chain (the watcher fulfilled it live)");

  // ── 4. assert the mint + split on Galileo ──
  const tokenAfter: bigint = await out.nextTokenId();
  const tokenId = tokenAfter - 1n;
  ok(tokenAfter > tokenBefore, `an output was minted (tokenId ${tokenId})`);
  const owner = await out.ownerOf(tokenId);
  ok(owner.toLowerCase() === buyer.address.toLowerCase(), `output #${tokenId} minted to the BUYER (attestation-gated, LIVE)`);
  const pendingAfter: bigint = await esc.pendingWithdrawals(buyer.address);
  const delta = pendingAfter - pendingBefore;
  ok(delta === price, `fee split credited: +${ethers.formatEther(delta)} 0G to owner+platform (self here) == the ${ethers.formatEther(price)} fee`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  if (fail === 0) {
    console.log(`\nLIVE EVIDENCE:\n  requestId ${requestId} | output #${tokenId} | summon tx ${sumRcpt.hash}\n  escrow ${dep.summonEscrow} | outputNFT ${dep.outputNFT} | chain 16602`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("galileo e2e crashed:", e);
  process.exit(1);
});
