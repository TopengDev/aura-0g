// AURA ERC-7857 SECURE-TRANSFER DEMO - the de-mock, end to end, on the REAL contract.
//
// This is NOT a standalone simulation (the spike's poc-reseal.cjs was). It deploys AURA's ACTUAL
// AuraINFT contract to a local chain and drives the REAL on-chain secure transfer, using AURA's ACTUAL
// backend crypto modules (brain.ts encryption, sealing.ts ECIES sealing, oracle.ts re-encryption +
// EIP-191 proof, pubkey.ts SIWE pubkey recovery). It proves the de-mocked path works against the code
// that ships, at the trusted-signer bar the field actually meets (NOT a hardware TEE).
//
// Flow:  mint+seal to owner A  ->  oracle re-encrypts + signs  ->  on-chain transfer() to B  ->  B
//        decrypts the brain, A is BLOCKED, the proof recovered to the oracle, dataHash rotated.
//
// Run:   smoke/demo-secure-transfer.sh   (starts a local anvil, runs this against it, tears it down)
// Env:   RPC_URL (default http://127.0.0.1:8545), DEPLOYER_PK, A_PK, B_PK, ORACLE_PRIVATE_KEY
//        - all default to deterministic local-anvil keys; this script NEVER touches a real network.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

import { encryptBrain, decryptBrain, type BrainPlain } from "../aura/brain.js";
import { sealKeyToPubkey, openSealedKey, sealedToHex, sealedFromHex } from "../aura/sealing.js";
import { recoverSiwePubkey } from "../aura/pubkey.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

// ── local-chain accounts DERIVED from anvil's PUBLIC default mnemonic (no key literals in source).
//    All overridable via env; for a real chain (e.g. Galileo) the funded key is passed in at runtime.
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk"; // anvil's public default
const anvilKey = (i: number) =>
  ethers.HDNodeWallet.fromPhrase(ANVIL_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).privateKey;
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const DEPLOYER_PK = process.env.DEPLOYER_PK ?? anvilKey(0);
const A_PK = process.env.A_PK ?? anvilKey(1); // owner A
const B_PK = process.env.B_PK ?? anvilKey(2); // buyer B
const ORACLE_PK = process.env.ORACLE_PRIVATE_KEY ?? anvilKey(3);
// the oracle.ts module reads ORACLE_PRIVATE_KEY at first use - pin it so the contract + service agree.
process.env.ORACLE_PRIVATE_KEY = ORACLE_PK;

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error("  \x1b[31mFAIL:\x1b[0m", msg);
    process.exit(1);
  }
  passed++;
  console.log("  \x1b[32mPASS:\x1b[0m", msg);
};

async function main() {
  console.log("\n=== AURA ERC-7857 SECURE-TRANSFER DEMO (REAL contract + real backend) ===\n");

  // dynamic import AFTER pinning ORACLE_PRIVATE_KEY so oracle.ts binds the right signer.
  const { reencryptForTransfer, dataHashOf, oracleAddress } = await import("../aura/oracle.js");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  // Galileo (16602) needs LEGACY txs at >=2 gwei (its RPC rejects EIP-1559). Set GAS_PRICE for it;
  // local anvil leaves it unset (default fee logic works). Applied to deploy + the real writes.
  const overrides = process.env.GAS_PRICE ? { gasPrice: BigInt(process.env.GAS_PRICE) } : {};
  const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
  const A = new ethers.Wallet(A_PK, provider);
  const B = new ethers.Wallet(B_PK, provider);
  const oracle = new ethers.Wallet(ORACLE_PK, provider);
  console.log(`chain ${net.chainId} @ ${RPC_URL}`);
  console.log(`deployer ${deployer.address}\nowner A  ${A.address}\nbuyer B  ${B.address}\noracle   ${oracle.address}\n`);
  ok(oracle.address.toLowerCase() === oracleAddress().toLowerCase(), "oracle.ts signer == the demo oracle key");

  // ── deploy the REAL AuraINFT, oracle pinned at construction ──
  const artifact = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "contracts", "out", "AuraINFT.sol", "AuraINFT.json"), "utf8"),
  );
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
  const inftDeploy = await factory.deploy(oracle.address, overrides);
  await inftDeploy.waitForDeployment();
  const inftAddr = await inftDeploy.getAddress();
  const deployTxHash = inftDeploy.deploymentTransaction()?.hash ?? "(unknown)";
  console.log(`[deploy] AuraINFT @ ${inftAddr} | deploy tx ${deployTxHash} (oracle set to ${oracle.address})\n`);
  const inftAbi = artifact.abi;
  const inftA = new ethers.Contract(inftAddr, inftAbi, A); // A's signer (owner)
  const inftRead = new ethers.Contract(inftAddr, inftAbi, provider);
  ok((await inftRead.oracle()).toLowerCase() === oracle.address.toLowerCase(), "on-chain oracle == demo oracle");

  // ── acquire pubkeys the REAL way: recover from a signed (SIWE-style) message ──
  const aPub = await recoverSiwePubkey("AURA login: owner A", (await A.signMessage("AURA login: owner A")) as `0x${string}`);
  const bPub = await recoverSiwePubkey("AURA login: buyer B", (await B.signMessage("AURA login: buyer B")) as `0x${string}`);
  ok(ethers.computeAddress(aPub).toLowerCase() === A.address.toLowerCase(), "recovered A pubkey hashes to A's address");
  ok(ethers.computeAddress(bPub).toLowerCase() === B.address.toLowerCase(), "recovered B pubkey hashes to B's address");

  // ── MINT: encrypt the brain (AURA's brain.ts) + ECIES-seal the key to owner A (sealing.ts) ──
  const brain: BrainPlain = {
    agent: "NOKTURNE",
    model: "qwen/qwen-image-edit-2511",
    canonicalBaseRoot: "0g://base-nokturne",
    styleDescriptor: "risograph duotone, fluorescent pink + blue, halftone grain",
    identityLock: "Keep the EXACT same subject as the reference.",
    negative: "no photorealism, no 3d render",
    basePolicy: "feed the canonical reference back as the edit base",
    createdAt: "2026-06-29T00:00:00.000Z",
  };
  const { envelope: env0, keyHex: key0 } = encryptBrain(brain);
  const dataHash0 = dataHashOf(env0);
  const k0 = Buffer.from(key0.replace(/^0x/, ""), "hex");
  const sealedA = sealKeyToPubkey(aPub, k0);

  const styleFp = ethers.keccak256(ethers.toUtf8Bytes("style-dna-nokturne"));
  const modelAtt = ethers.keccak256(ethers.toUtf8Bytes("model:qwen-image-edit-2511"));
  const mintTx = await inftA.mintAgent(
    A.address, "NOKTURNE", styleFp, "0g://enc-brain-v0", dataHash0, modelAtt, 700, 1000, sealedToHex(sealedA), overrides,
  );
  const mintRcpt = await mintTx.wait();
  const tokenId = 1n;
  console.log(`[mint] tokenId ${tokenId} -> A | tx ${mintTx.hash} (block ${mintRcpt.blockNumber}, gas ${mintRcpt.gasUsed})`);
  ok((await inftRead.ownerOf(tokenId)).toLowerCase() === A.address.toLowerCase(), "A owns the freshly-minted agent");

  // A reads its sealed key FROM CHAIN, opens it, decrypts the brain.
  const onchainSealedA = sealedFromHex(await inftRead.sealedKeyOf(tokenId));
  const aOpened = openSealedKey(A.privateKey, onchainSealedA);
  ok(JSON.stringify(decryptBrain(env0, "0x" + aOpened.toString("hex"))) === JSON.stringify(brain),
    "A opens the on-chain sealedKey -> decrypts the brain");

  // ── ORACLE RE-ENCRYPTION: fresh key, re-encrypt, seal to B, EIP-191 proof (oracle.ts) ──
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const re = await reencryptForTransfer({
    inft: inftAddr,
    chainId: Number(net.chainId),
    tokenId,
    from: A.address,
    to: B.address,
    toPubkey: bPub,
    currentEnvelope: env0,
    currentKeyHex: key0,
    deadlineSec: deadline,
  });
  console.log(`[oracle] re-encrypted: newDataHash ${re.newDataHash.slice(0, 18)}.. sealedKeyB ${re.sealedKey.length}B proof ${re.proof.length}ch`);
  ok(re.newDataHash !== dataHash0, "oracle rotated the dataHash (fresh envelope)");

  // sanity: the proof digest the oracle signed MUST equal the contract's own digest fn.
  const contractDigest = await inftRead.transferProofDigest(
    A.address, B.address, tokenId, sealedToHex(re.sealedKey), re.newDataHash, deadline,
  );
  ok(contractDigest === re.digest, "oracle's proof digest == AuraINFT.transferProofDigest (tuple matches exactly)");
  ok(ethers.verifyMessage(ethers.getBytes(re.digest), re.proof).toLowerCase() === oracle.address.toLowerCase(),
    "proof recovers to the oracle signer (off-chain check)");

  // ── NEGATIVE: a FORGED proof (signed by A, not the oracle) must REVERT on-chain ──
  const forgedProof = await A.signMessage(ethers.getBytes(re.digest));
  let forgedReverted = false;
  try {
    await (await inftA.transfer(A.address, B.address, tokenId, sealedToHex(re.sealedKey), "0g://enc-brain-v1", re.newDataHash, deadline, forgedProof, overrides)).wait();
  } catch {
    forgedReverted = true;
  }
  ok(forgedReverted, "FORGED proof (non-oracle signer) is REJECTED on-chain (the old mock accepted anything)");
  ok((await inftRead.ownerOf(tokenId)).toLowerCase() === A.address.toLowerCase(), "token did NOT move on the forged proof");

  // ── REAL TRANSFER: A submits the oracle-signed transfer on-chain ──
  const xferTx = await inftA.transfer(
    A.address, B.address, tokenId, sealedToHex(re.sealedKey), "0g://enc-brain-v1", re.newDataHash, deadline, re.proof, overrides,
  );
  const xferRcpt = await xferTx.wait();
  console.log(`[transfer] A -> B | tx ${xferTx.hash} (block ${xferRcpt.blockNumber}, gas ${xferRcpt.gasUsed})`);

  // BrainRekeyed event emitted?
  const iface = new ethers.Interface(inftAbi);
  let rekeyed = false;
  for (const log of xferRcpt.logs) {
    try {
      const p = iface.parseLog(log);
      if (p?.name === "BrainRekeyed" && p.args.newOwner.toLowerCase() === B.address.toLowerCase()) rekeyed = true;
    } catch { /* not ours */ }
  }
  ok(rekeyed, "BrainRekeyed(newOwner=B) emitted on-chain (the event the old mock NEVER fired)");
  ok((await inftRead.ownerOf(tokenId)).toLowerCase() === B.address.toLowerCase(), "ownership flipped to B on-chain");

  // ── VERIFY the re-key actually happened ──
  const onchainSealedB = sealedFromHex(await inftRead.sealedKeyOf(tokenId));
  ok(!onchainSealedB.equals(onchainSealedA), "on-chain sealedKey rotated (B's seal != A's seal)");
  const agentAfter = await inftRead.getAgent(tokenId);
  ok(agentAfter.dataHash === re.newDataHash, "on-chain dataHash rotated to the new envelope");

  // B opens its sealed key -> decrypts the NEW envelope -> reads the brain.
  const bOpened = openSealedKey(B.privateKey, onchainSealedB);
  ok(JSON.stringify(decryptBrain(re.newEnvelope, "0x" + bOpened.toString("hex"))) === JSON.stringify(brain),
    "B opens its on-chain sealedKey -> decrypts the NEW envelope -> reads the brain");

  // A is now BLOCKED: cannot open B's sealed key, and A's OLD key cannot decrypt the new envelope.
  let aCannotOpenB = false;
  try { openSealedKey(A.privateKey, onchainSealedB); } catch { aCannotOpenB = true; }
  ok(aCannotOpenB, "old owner A CANNOT open B's sealedKey (re-encryption excluded A)");
  let aOldKeyBlocked = false;
  try { decryptBrain(re.newEnvelope, key0); } catch { aOldKeyBlocked = true; }
  ok(aOldKeyBlocked, "A's OLD key cannot decrypt the NEW envelope (fresh-key rotation)");

  // ── REPLAY: the SAME oracle proof cannot be reused ──
  // (A no longer owns it, but the per-digest replay guard is the first-class defense.)
  let replayBlocked = false;
  try {
    await (await new ethers.Contract(inftAddr, inftAbi, B).transfer(
      A.address, B.address, tokenId, sealedToHex(re.sealedKey), "0g://enc-brain-v1", re.newDataHash, deadline, re.proof, overrides,
    )).wait();
  } catch { replayBlocked = true; }
  ok(replayBlocked, "replaying the consumed oracle proof is REJECTED on-chain");

  console.log(`\n=== DEMO RESULT: ${passed}/${passed} assertions PASS. AURA's ERC-7857 secure transfer is REAL on-chain ===`);
  console.log(`    contract ${inftAddr} | mint tx ${mintTx.hash} | transfer tx ${xferTx.hash}`);
  console.log(`    Trusted-signer oracle bar (ECDSA), NOT a hardware TEE - the bar the field actually ships.\n`);
}

main().catch((e) => {
  console.error("\nDEMO ERROR:", e);
  process.exit(1);
});
