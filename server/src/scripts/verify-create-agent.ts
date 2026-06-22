// CREATE-AGENT E2E (real, on Galileo): SIWE -> JWT -> POST /agents/create (multipart reference image)
// -> get mintAgent args -> submit mintAgent from the user wallet -> confirm a new agentId -> POST
// /agents/confirm-mint (promote the staged brain key to the agentId) -> POST /generate under the NEW
// agent -> confirm the gen used the DECRYPTED BRAIN (usedBrain:true), not the catalog fallback.
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..", "..");
dotenvConfig({ path: path.join(REPO, ".env") });

import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { encodeMultipart } from "./multipart-encode.js";
import { buildApp } from "../app.js";
import { GALILEO, SIWE_DOMAIN, SIWE_URI, sponsorPrivateKey, CONTRACTS } from "../aura/config.js";

const galileo = defineChain({
  id: GALILEO.chainId,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [GALILEO.rpc] } },
});

const REG_ABI = [
  {
    type: "function",
    name: "mintAgent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "name", type: "string" },
      { name: "styleFingerprint", type: "bytes32" },
      { name: "encBrainRoot", type: "string" },
      { name: "modelAttestation", type: "bytes32" },
      { name: "royaltyBps", type: "uint16" },
      { name: "creatorResaleBps", type: "uint16" },
    ],
    outputs: [{ type: "uint256" }],
  },
  { type: "function", name: "nextAgentId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

async function pollReceipt(pub: ReturnType<typeof createPublicClient>, hash: `0x${string}`) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await pub.getTransactionReceipt({ hash });
      if (r) return r;
    } catch {
      /* not indexed yet */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("receipt never indexed");
}

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const app = await buildApp({ logger: false });
  const acct = privateKeyToAccount(sponsorPrivateKey() as `0x${string}`);
  const pub = createPublicClient({ chain: galileo, transport: http() });
  const wallet = createWalletClient({ account: acct, chain: galileo, transport: http() });
  log("user wallet:", acct.address);

  // SIWE -> JWT
  const { nonce } = (await (await app.inject({ method: "GET", url: "/auth/nonce" })).json()) as { nonce: string };
  const message = createSiweMessage({ address: acct.address, chainId: GALILEO.chainId, domain: SIWE_DOMAIN, uri: SIWE_URI, nonce, version: "1", statement: "Sign in to AURA." });
  const signature = await acct.signMessage({ message });
  const token = ((await (await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } })).json()) as { token: string }).token;
  log("SIWE -> JWT: OK");

  // POST /agents/create (multipart). Use a compact 512px reference. Distinct style so on-style is visible.
  const imgPath = path.join(REPO, "smoke", "inputs", "face.png");
  const img = readFileSync(imgPath);
  const agentName = "TESTAGENT_" + Date.now().toString().slice(-6);
  const enc = encodeMultipart([
    { name: "name", value: agentName },
    { name: "royaltyBps", value: "750" },
    { name: "creatorResaleBps", value: "1000" },
    { name: "styleDescriptor", value: "Style: bold risograph duotone, fluorescent pink and blue, halftone grain, flat indie-zine shapes." },
    { name: "identityLock", value: "Keep the EXACT same person (same face shape, features, expression, hair)." },
    { name: "negative", value: "no photorealism, no gradients, no 3d render" },
    { name: "image", filename: "face.png", contentType: "image/png", data: img },
  ]);
  const caRes = await app.inject({ method: "POST", url: "/agents/create", headers: { authorization: `Bearer ${token}`, ...enc.headers }, payload: enc.body });
  const ca = caRes.json() as any;
  log("POST /agents/create ->", caRes.statusCode);
  if (caRes.statusCode !== 200) {
    log("create-agent failed:", JSON.stringify(ca));
    await app.close();
    process.exit(1);
  }
  log("  name:", ca.name, "| styleFingerprint:", ca.styleFingerprint, "| encBrainRoot:", ca.encBrainRoot);
  log("  canonicalBaseRoot:", ca.canonicalBaseRoot, "| modelAttestation:", ca.modelAttestation);

  // submit mintAgent from the user wallet
  const beforeAgents = (await pub.readContract({ address: CONTRACTS.agentRegistry as `0x${string}`, abi: REG_ABI, functionName: "nextAgentId" })) as bigint;
  log("\n[user mint] submitting mintAgent ...");
  const hash = await wallet.writeContract({
    address: CONTRACTS.agentRegistry as `0x${string}`,
    abi: REG_ABI,
    functionName: "mintAgent",
    args: [ca.to as `0x${string}`, ca.name as string, ca.styleFingerprint as `0x${string}`, ca.encBrainRoot as string, ca.modelAttestation as `0x${string}`, ca.royaltyBps, ca.creatorResaleBps],
    type: "legacy",
    gasPrice: 5_000_000_000n,
  });
  log("mintAgent tx:", hash);
  const rcpt = await pollReceipt(pub, hash);
  const newAgentId = Number(beforeAgents); // nextAgentId before == the id just minted
  const owner = (await pub.readContract({ address: CONTRACTS.agentRegistry as `0x${string}`, abi: REG_ABI, functionName: "ownerOf", args: [BigInt(newAgentId)] })) as string;
  log("mined: status", rcpt.status, "| new agentId:", newAgentId, "| owner:", owner);

  // confirm-mint: promote the staged brain key to this agentId
  const cmRes = await app.inject({ method: "POST", url: "/agents/confirm-mint", headers: { authorization: `Bearer ${token}` }, payload: { encBrainRoot: ca.encBrainRoot, agentId: newAgentId } });
  log("POST /agents/confirm-mint ->", cmRes.statusCode, JSON.stringify(cmRes.json()));

  // generate under the NEW agent -> must use the decrypted brain
  const genRes = await app.inject({ method: "POST", url: "/generate", headers: { authorization: `Bearer ${token}` }, payload: { agentId: newAgentId, prompt: "add round eyeglasses" } });
  const { jobId } = genRes.json() as { jobId: string };
  log("\nPOST /generate (new agent) ->", genRes.statusCode, "jobId:", jobId);
  let job: any = null;
  for (let i = 0; i < 60; i++) {
    job = (await app.inject({ method: "GET", url: `/generate/${jobId}`, headers: { authorization: `Bearer ${token}` } })).json();
    if (job.status === "done" || job.status === "error") break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  log("gen status:", job?.status, "| usedBrain:", job?.result?.usedBrain, "| TEE verified:", job?.result?.teeVerified, "| imageRoot:", job?.result?.imageRoot);

  const green = rcpt.status === "success" && job?.status === "done" && job?.result?.usedBrain === true && job?.result?.teeVerified === true;
  log(green ? "\n=== CREATE-AGENT E2E GREEN: agent minted + gen used the DECRYPTED BRAIN ===" : "\n=== CREATE-AGENT E2E RED ===");
  log("EVIDENCE", JSON.stringify({ newAgentId, mintAgentTx: hash, encBrainRoot: ca.encBrainRoot, canonicalBaseRoot: ca.canonicalBaseRoot, genJobId: jobId, usedBrain: job?.result?.usedBrain, genImageRoot: job?.result?.imageRoot }));
  await app.close();
  process.exit(green ? 0 : 1);
}

main();
