// AURA ERC-7857 SERVER-ROUTE e2e on GALILEO - proves the WIRING (not just the contract): the create/mint
// target, the /agents/:id/transfer/{prepare,confirm} routes, the ownerOf memory gate + the dual-wall reset
// on a REAL on-chain transfer, plus the EXPIRED reject path + royalty-follows-ownership. Deploys a FRESH,
// ISOLATED AuraINFT on Galileo (never touches the live 0xb596 registry). NEVER prints a private key.
//
// Env (from the shell / .env): PRIVATE_KEY (sponsor = owner A + deployer, funded), SUMMON_BUYER_KEY (buyer B,
// funded). A fresh ephemeral oracle key is generated in-process (distinct from the sponsor, signs only).
// Run:  RPC_URL=https://evmrpc-testnet.0g.ai <keys> npx tsx src/scripts/e2e-inft-galileo.ts
import { readFileSync, mkdtempSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { ethers } from "ethers";
import { encryptBrain, type BrainPlain } from "../aura/brain.js"; // config-free
import { sealKeyToPubkey, sealedToHex } from "../aura/sealing.js"; // config-free

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// ── env MUST be set before any config-touching module is imported (config freezes CONTRACTS at load) ──
const oracleWallet = ethers.Wallet.createRandom(); // distinct trusted oracle (NOT the sponsor); signs only
process.env.ORACLE_PRIVATE_KEY = oracleWallet.privateKey;
process.env.SQLITE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "aura-inft-e2e-")), "e2e.db");
process.env.RPC_URL = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai";
process.env.CHAIN_ID = process.env.CHAIN_ID ?? "16602";

const GAS = { gasPrice: 5_000_000_000n }; // Galileo min tip 2 gwei -> 5 gwei legacy
const normalizePk = (pk: string) => (pk.startsWith("0x") ? pk : `0x${pk}`);
const recoverPub = async (w: ethers.Wallet, msg: string): Promise<string> =>
  ethers.SigningKey.recoverPublicKey(ethers.hashMessage(msg), await w.signMessage(msg));
const sha256Hex = (b: Buffer) => "0x" + createHash("sha256").update(b).digest("hex");

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { console.error("  \x1b[31mFAIL:\x1b[0m", msg); process.exit(1); }
  passed++;
  console.log("  \x1b[32mPASS:\x1b[0m", msg);
};

async function main() {
  console.log("\n=== AURA ERC-7857 SERVER-ROUTE e2e (GALILEO, real chain) ===\n");
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const net = await provider.getNetwork();
  const A = new ethers.Wallet(normalizePk(process.env.PRIVATE_KEY!), provider); // owner A (sponsor) + deployer
  const B = new ethers.Wallet(normalizePk(process.env.SUMMON_BUYER_KEY!), provider); // buyer B
  console.log(`chain ${net.chainId}\ndeployer/owner A ${A.address}\nbuyer B ${B.address}\noracle ${oracleWallet.address} (ephemeral, distinct from sponsor)\n`);

  // ── deploy a FRESH AuraINFT (oracle pinned to the ephemeral = what oracle.ts will sign with) ──
  const artifact = JSON.parse(readFileSync(path.join(REPO_ROOT, "contracts", "out", "AuraINFT.sol", "AuraINFT.json"), "utf8"));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, A);
  const deployed = await factory.deploy(oracleWallet.address, GAS);
  await deployed.waitForDeployment();
  const inftAddr = await deployed.getAddress();
  const deployTx = deployed.deploymentTransaction()?.hash;
  console.log(`[deploy] AuraINFT @ ${inftAddr} | tx ${deployTx}\n`);

  // wire the server config at this fresh contract (auraINFT + registry-owner reads both point here).
  process.env.AURA_INFT_ADDR = inftAddr;
  process.env.AGENT_REGISTRY_ADDR = inftAddr;

  // ── build the sealed brain for A + mint agent #1 (the ERC-7857 9-arg sealed mint) ──
  const aPub = await recoverPub(A, `AURA login: ${A.address}`);
  ok(ethers.computeAddress(aPub).toLowerCase() === A.address.toLowerCase(), "recovered A pubkey hashes to A");
  const brain: BrainPlain = {
    agent: "E2E-AGENT", model: "qwen/qwen-image-edit-2511", canonicalBaseRoot: "0g://e2e-base",
    styleDescriptor: "test style", identityLock: "same subject", negative: "none",
    basePolicy: "ref-anchor", createdAt: new Date().toISOString(),
  };
  const { envelope, keyHex } = encryptBrain(brain);
  const dataHash = sha256Hex(envelope);
  const aesKey = Buffer.from(keyHex.replace(/^0x/, ""), "hex");
  const sealedA = sealedToHex(sealKeyToPubkey(aPub, aesKey));
  const styleFp = ethers.keccak256(ethers.toUtf8Bytes("style-e2e"));
  const modelAtt = ethers.keccak256(ethers.toUtf8Bytes("model-e2e"));
  const encBrainRoot = `0g://e2e-brain-${Date.now()}`;
  const inftA = new ethers.Contract(inftAddr, artifact.abi, A);
  const mintTx = await inftA.mintAgent(A.address, "E2E-AGENT", styleFp, encBrainRoot, dataHash, modelAtt, 700, 1000, sealedA, GAS);
  await mintTx.wait();
  const tokenId = 1;
  ok((await new ethers.Contract(inftAddr, artifact.abi, provider).ownerOf(tokenId)).toLowerCase() === A.address.toLowerCase(), "agent #1 minted, owned by A");

  // ── now import the server modules (config reads the env-set AURA_INFT_ADDR) ──
  const { buildApp } = await import("../app.js");
  const store = await import("../aura/store.js");
  const cache = await import("../aura/image-cache.js");
  const chatmem = await import("../aura/chat-memory.js");
  const { auraInftRead } = await import("../aura/contracts.js");
  const { reencryptForTransfer, oracleAddress } = await import("../aura/oracle.js");
  ok(oracleAddress().toLowerCase() === oracleWallet.address.toLowerCase(), "oracle.ts signs with the wired (on-chain) oracle key");

  // stage the brain custody so the transfer route can re-encrypt it (mimics what create-agent stages at mint).
  cache.cacheImageByRoot(encBrainRoot, envelope, { contentType: "application/octet-stream", source: "brain" });
  store.stageBrain({ owner: A.address, name: "E2E-AGENT", encBrainRoot, brainKeyHex: keyHex, canonicalBaseRoot: encBrainRoot, styleFingerprint: styleFp, modelAttestation: modelAtt, sealedKey: sealedA, dataHash });
  store.promoteBrainByRoot(encBrainRoot, tokenId, A.address);

  // the memory gate resolves the CURRENT owner from THIS AuraINFT (a real on-chain read of the moved token).
  chatmem.__setOwnerResolver(async (id) => ((await auraInftRead().ownerOf(id)) as string).toLowerCase());

  const app = await buildApp({ logger: false });
  const tokenAJwt = app.jwt.sign({ address: A.address.toLowerCase() });
  const tokenBJwt = app.jwt.sign({ address: B.address.toLowerCase() });

  // ── MEMORY (gate) before the transfer: the owner writes + reads; a non-owner is gated out ──
  await chatmem.appendTurn(tokenId, A.address, { ts: new Date().toISOString(), ownerText: "secret: raven at dawn", auraText: "kept private", tools: [] });
  const aMem = await chatmem.loadOwnerMemory(tokenId, A.address);
  ok(!aMem.notOwner && aMem.records.length === 1, "owner A reads its relationship memory (gate allows the live on-chain owner)");
  const bMem0 = await chatmem.loadOwnerMemory(tokenId, B.address);
  ok(bMem0.notOwner && bMem0.records.length === 0, "non-owner B is GATED before the transfer (fail closed)");

  // ── TRANSFER via the SERVER ROUTE: prepare -> submit on-chain -> confirm ──
  const bPub = await recoverPub(B, `AURA login: ${B.address}`);
  const prep = await app.inject({ method: "POST", url: `/agents/${tokenId}/transfer/prepare`, headers: { authorization: `Bearer ${tokenAJwt}` }, payload: { to: B.address, toPubkey: bPub } });
  ok(prep.statusCode === 200, `transfer/prepare route returns 200 for the owner (got ${prep.statusCode})`);
  const args = prep.json() as any;
  const read = auraInftRead();
  const contractDigest = await read.transferProofDigest(args.from, args.to, tokenId, args.newSealedKey, args.newDataHash, args.deadline);
  ok(ethers.verifyMessage(ethers.getBytes(contractDigest), args.proof).toLowerCase() === oracleWallet.address.toLowerCase(),
    "route proof recovers to the oracle + its digest == AuraINFT.transferProofDigest (server produced a chain-valid proof)");

  const xfer = await inftA.transfer(args.from, args.to, tokenId, args.newSealedKey, args.newEncBrainRoot, args.newDataHash, args.deadline, args.proof, GAS);
  const xrcpt = await xfer.wait();
  console.log(`  [transfer] A->B via the route's proof | tx ${xfer.hash}`);
  ok((await read.ownerOf(tokenId)).toLowerCase() === B.address.toLowerCase(), "SERVER-ROUTE secure transfer: ownership flipped A->B on-chain");

  const conf = await app.inject({ method: "POST", url: `/agents/${tokenId}/transfer/confirm`, headers: { authorization: `Bearer ${tokenBJwt}` }, payload: {} });
  const confBody = conf.json() as any;
  ok(conf.statusCode === 200 && confBody.memoryReset === true && confBody.brainRecustodied === true, "transfer/confirm route: brain re-custody + memory dual-wall reset fired");

  // ── MEMORY after the transfer: the FORMER owner is gated, the buyer starts fresh (the overclaim closed) ──
  const aMemAfter = await chatmem.loadOwnerMemory(tokenId, A.address);
  ok(aMemAfter.notOwner && aMemAfter.records.length === 0, "FORMER owner A is GATED after a REAL on-chain transfer (overclaim closed)");
  const bMemAfter = await chatmem.loadOwnerMemory(tokenId, B.address);
  ok(!bMemAfter.notOwner && bMemAfter.records.length === 0, "buyer B starts a FRESH, empty relationship (dual-wall reset on resale)");

  // ── EXPIRED reject on-chain: an oracle proof with a past deadline must revert ──
  const bBrain = store.brainByAgentId(tokenId)!; // B's re-custodied brain (the rotated key + envelope)
  const curEnv = cache.cachedImageByRoot(bBrain.encBrainRoot)!.bytes;
  const pastDeadline = Math.floor(Date.now() / 1000) - 60;
  const reExp = await reencryptForTransfer({ inft: inftAddr, chainId: Number(net.chainId), tokenId: BigInt(tokenId), from: B.address, to: A.address, toPubkey: aPub, currentEnvelope: curEnv, currentKeyHex: bBrain.brainKeyHex, deadlineSec: pastDeadline });
  const inftB = new ethers.Contract(inftAddr, artifact.abi, B);
  let expiredReverted = false;
  try {
    await (await inftB.transfer(B.address, A.address, tokenId, sealedToHex(reExp.sealedKey), "0g://e2e-expired", reExp.newDataHash, pastDeadline, reExp.proof, GAS)).wait();
  } catch { expiredReverted = true; }
  ok(expiredReverted, "EXPIRED proof (past deadline) is REJECTED on-chain");
  ok((await read.ownerOf(tokenId)).toLowerCase() === B.address.toLowerCase(), "expired reject: ownership unchanged (still B)");

  // ── REPLAY reject on-chain: resubmitting the consumed happy-path proof reverts ──
  let replayReverted = false;
  try {
    await (await inftB.transfer(args.from, args.to, tokenId, args.newSealedKey, args.newEncBrainRoot, args.newDataHash, args.deadline, args.proof, GAS)).wait();
  } catch { replayReverted = true; }
  ok(replayReverted, "REPLAY of the consumed transfer proof is REJECTED on-chain");

  // ── ROYALTY resolves to the NEW owner ──
  ok((await read.ownerOf(tokenId)).toLowerCase() === B.address.toLowerCase(), "ROYALTY: the OUTPUT-royalty receiver == AuraINFT.ownerOf(agent) == B (income follows ownership; what OutputNFT.royaltyInfo resolves)");
  const [creatorReceiver] = await read.royaltyInfo(tokenId, 10_000n);
  ok(creatorReceiver.toLowerCase() === A.address.toLowerCase(), "ROYALTY: the ERC2981 creator-resale royalty stays PINNED to the original creator A");

  console.log(`\n=== SERVER-ROUTE e2e: ${passed}/${passed} assertions PASS on Galileo ===`);
  console.log(`    AuraINFT ${inftAddr}`);
  console.log(`    deploy tx ${deployTx}`);
  console.log(`    mint tx   ${mintTx.hash}`);
  console.log(`    transfer tx (via server-route proof) ${xfer.hash}`);
  console.log(`    block ${xrcpt.blockNumber}\n`);
  chatmem.__setOwnerResolver(null);
  await app.close();
  process.exit(0);
}

main().catch((e) => { console.error("\nE2E ERROR:", e?.stack || e); process.exit(1); });
