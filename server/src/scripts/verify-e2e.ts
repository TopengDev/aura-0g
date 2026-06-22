// THE CRITICAL E2E (real, on Galileo): SIWE -> JWT -> sponsored POST /generate -> poll to a
// TEE-verified DONE -> POST /mint-args (get the attestationSig) -> submit mintOutput from a wallet
// (the .env wallet acting as the user) with those EXACT args + sig -> confirm the token lands with the
// exact provenance. Then prove the contract REJECTS (a) a tampered arg and (b) an absent/garbage sig.
//
// Uses app.inject() for the backend (no separate server) + viem for the user-side tx with the proven
// manual getTransactionReceipt poll (waitForTransactionReceipt throws on this RPC).
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { buildApp } from "../app.js";
import { GALILEO, SIWE_DOMAIN, SIWE_URI, sponsorPrivateKey, CONTRACTS } from "../aura/config.js";

const galileo = defineChain({
  id: GALILEO.chainId,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [GALILEO.rpc] } },
});

const OUT_MINT_ABI = [
  {
    type: "function",
    name: "mintOutput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "creatorAgentId", type: "uint256" },
      { name: "imageRoot", type: "string" },
      { name: "provenanceHash", type: "bytes32" },
      { name: "teeAttestation", type: "bytes32" },
      { name: "seed", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "attestationSig", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "nextTokenId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "provenanceOf",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creatorAgentId", type: "uint256" },
          { name: "imageRoot", type: "string" },
          { name: "provenanceHash", type: "bytes32" },
          { name: "teeAttestation", type: "bytes32" },
          { name: "seed", type: "uint256" },
        ],
      },
    ],
  },
] as const;

async function pollReceipt(pub: ReturnType<typeof createPublicClient>, hash: `0x${string}`) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await pub.getTransactionReceipt({ hash });
      if (r) return r;
    } catch {
      /* TransactionReceiptNotFoundError until indexed */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("receipt never indexed");
}

const log = (...a: unknown[]) => console.log(...a);
const AGENT_ID = Number(process.env.E2E_AGENT_ID ?? 1); // a seeded agent (NOKTURNE=1) exists on v2

async function authToken(app: Awaited<ReturnType<typeof buildApp>>, acct: ReturnType<typeof privateKeyToAccount>) {
  const { nonce } = (await (await app.inject({ method: "GET", url: "/auth/nonce" })).json()) as { nonce: string };
  const message = createSiweMessage({
    address: acct.address,
    chainId: GALILEO.chainId,
    domain: SIWE_DOMAIN,
    uri: SIWE_URI,
    nonce,
    version: "1",
    statement: "Sign in to AURA.",
  });
  const signature = await acct.signMessage({ message });
  const v = (await (await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } })).json()) as { token: string };
  return v.token;
}

async function main() {
  const app = await buildApp({ logger: false });
  const acct = privateKeyToAccount(sponsorPrivateKey() as `0x${string}`);
  const pub = createPublicClient({ chain: galileo, transport: http() });
  const wallet = createWalletClient({ account: acct, chain: galileo, transport: http() });
  log("user/sponsor wallet:", acct.address, "| agentId:", AGENT_ID);

  const token = await authToken(app, acct);
  log("SIWE -> JWT: OK");

  // 1. sponsored generate
  const genRes = await app.inject({
    method: "POST",
    url: "/generate",
    headers: { authorization: `Bearer ${token}` },
    payload: { agentId: AGENT_ID, prompt: "a serene mountain at dawn, soft light" },
  });
  const { jobId } = genRes.json() as { jobId: string };
  log("POST /generate ->", genRes.statusCode, "jobId:", jobId);

  // 2. poll to done
  let job: any = null;
  for (let i = 0; i < 60; i++) {
    const jr = await app.inject({ method: "GET", url: `/generate/${jobId}`, headers: { authorization: `Bearer ${token}` } });
    job = jr.json();
    if (job.status === "done" || job.status === "error") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  log("gen status:", job?.status, "| TEE verified:", job?.result?.teeVerified, "| usedBrain:", job?.result?.usedBrain, "| imageRoot:", job?.result?.imageRoot);
  if (job?.status !== "done") {
    log("=== E2E RED: generation did not complete ===", job?.error ?? "");
    await app.close();
    process.exit(1);
  }

  // 3. mint-args (get the attestationSig)
  const maRes = await app.inject({ method: "POST", url: "/mint-args", headers: { authorization: `Bearer ${token}` }, payload: { jobId } });
  const ma = maRes.json() as any;
  log("POST /mint-args ->", maRes.statusCode);
  log("  to:", ma.to, "| creatorAgentId:", ma.creatorAgentId, "| seed:", ma.seed);
  log("  imageRoot:", ma.imageRoot);
  log("  nonce:", ma.nonce);
  log("  attestationSig:", String(ma.attestationSig).slice(0, 26), "...", "(len", String(ma.attestationSig).length, ")");

  const before = (await pub.readContract({ address: CONTRACTS.outputNFT as `0x${string}`, abi: OUT_MINT_ABI, functionName: "nextTokenId" })) as bigint;

  // 4. submit mintOutput from the USER wallet (acting as the user) with the EXACT args + sig.
  const args = [
    ma.to as `0x${string}`,
    BigInt(ma.creatorAgentId),
    ma.imageRoot as string,
    ma.provenanceHash as `0x${string}`,
    ma.teeAttestation as `0x${string}`,
    BigInt(ma.seed),
    ma.nonce as `0x${string}`,
    ma.attestationSig as `0x${string}`,
  ] as const;
  log("\n[user mint] submitting mintOutput with backend-supplied args + attestationSig ...");
  const hash = await wallet.writeContract({ address: CONTRACTS.outputNFT as `0x${string}`, abi: OUT_MINT_ABI, functionName: "mintOutput", args, type: "legacy", gasPrice: 5_000_000_000n });
  log("mint tx:", hash);
  const rcpt = await pollReceipt(pub, hash);
  log("mined: status", rcpt.status, "block", rcpt.blockNumber.toString(), "gasUsed", rcpt.gasUsed.toString());

  const tokenId = before; // nextTokenId before == the id just minted
  const owner = (await pub.readContract({ address: CONTRACTS.outputNFT as `0x${string}`, abi: OUT_MINT_ABI, functionName: "ownerOf", args: [tokenId] })) as string;
  const prov = (await pub.readContract({ address: CONTRACTS.outputNFT as `0x${string}`, abi: OUT_MINT_ABI, functionName: "provenanceOf", args: [tokenId] })) as any;
  const ownerOk = owner.toLowerCase() === ma.to.toLowerCase();
  const rootOk = prov.imageRoot === ma.imageRoot;
  const provOk = prov.provenanceHash === ma.provenanceHash;
  const teeOk = prov.teeAttestation === ma.teeAttestation;
  const seedOk = prov.seed === BigInt(ma.seed);
  log("\n=== ON-CHAIN VERIFY (tokenId", tokenId.toString(), ") ===");
  log("owner == to:", ownerOk, `(${owner})`);
  log("imageRoot matches:", rootOk, "| provenanceHash matches:", provOk, "| teeAttestation matches:", teeOk, "| seed matches:", seedOk);
  const mintGreen = rcpt.status === "success" && ownerOk && rootOk && provOk && teeOk && seedOk;

  // 5a. NEGATIVE: tampered arg (flip creatorAgentId) with the SAME sig -> must REVERT.
  log("\n[negative] tampered creatorAgentId with the same sig (expect revert) ...");
  let tamperRejected = false;
  try {
    // fresh nonce required? No - use the SAME nonce; the digest won't match so it reverts on bad attestation
    // BEFORE the nonce is consumed. We simulate to capture the revert without spending gas.
    await pub.simulateContract({
      address: CONTRACTS.outputNFT as `0x${string}`,
      abi: OUT_MINT_ABI,
      functionName: "mintOutput",
      account: acct,
      args: [ma.to, BigInt(ma.creatorAgentId) + 1n, ma.imageRoot, ma.provenanceHash, ma.teeAttestation, BigInt(ma.seed), ma.nonce, ma.attestationSig],
    });
    log("  tampered mint SIMULATED OK - THIS IS BAD (should revert)");
  } catch (e: any) {
    tamperRejected = true;
    log("  tampered mint reverted:", String(e?.shortMessage ?? e?.message).slice(0, 90));
  }

  // 5b. NEGATIVE: garbage/absent sig -> must REVERT.
  log("[negative] garbage attestationSig (expect revert) ...");
  let badSigRejected = false;
  const garbageSig = ("0x" + "11".repeat(65)) as `0x${string}`;
  try {
    await pub.simulateContract({
      address: CONTRACTS.outputNFT as `0x${string}`,
      abi: OUT_MINT_ABI,
      functionName: "mintOutput",
      account: acct,
      args: [ma.to, BigInt(ma.creatorAgentId), ma.imageRoot, ma.provenanceHash, ma.teeAttestation, BigInt(ma.seed), ("0x" + "22".repeat(32)) as `0x${string}`, garbageSig],
    });
    log("  garbage-sig mint SIMULATED OK - THIS IS BAD (should revert)");
  } catch (e: any) {
    badSigRejected = true;
    log("  garbage-sig mint reverted:", String(e?.shortMessage ?? e?.message).slice(0, 90));
  }

  const green = mintGreen && tamperRejected && badSigRejected;
  log("\nSUMMARY: mint landed =", mintGreen, "| tampered rejected =", tamperRejected, "| garbage-sig rejected =", badSigRejected);
  log(green ? "=== CRITICAL E2E GREEN ===" : "=== CRITICAL E2E RED ===");
  log("EVIDENCE", JSON.stringify({ jobId, tokenId: tokenId.toString(), mintTx: hash, imageRoot: ma.imageRoot, nonce: ma.nonce, teeVerified: job.result.teeVerified }));
  await app.close();
  process.exit(green ? 0 : 1);
}

main();
