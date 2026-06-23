// Shared helpers for the AURA showcase-content pass. Throwaway scratch (NOT web/ or server/).
// NEVER prints the private key. Loads it in-memory from process.env only.
import "dotenv/config";
import { createPublicClient, createWalletClient, http, getAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

export const API = "http://localhost:8787";
export const RPC = "https://evmrpc-testnet.0g.ai";
export const CHAIN_ID = 16602;

export const CONTRACTS = {
  agentRegistry: getAddress("0xb5960cc08caa5195095cfb8aa270f122be09ba0a"),
  outputNFT: getAddress("0xc73a63726f5365646fdeb052164b18db836030d7"),
  marketplace: getAddress("0xc57d182fec6555a946795821b2e58be9a6385e18"),
};

const chain = {
  id: CHAIN_ID,
  name: "0G-Galileo",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [RPC] }, public: { http: [RPC] } },
};

function pk() {
  const k = process.env.PRIVATE_KEY;
  if (!k) throw new Error("PRIVATE_KEY missing in env");
  return k.startsWith("0x") ? k : `0x${k}`;
}

export const account = privateKeyToAccount(pk());
export const publicClient = createPublicClient({ chain, transport: http(RPC) });
export const walletClient = createWalletClient({ account, chain, transport: http(RPC) });

export const OUT_ABI = [
  { type: "function", name: "mintOutput", stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" }, { name: "creatorAgentId", type: "uint256" },
      { name: "imageRoot", type: "string" }, { name: "provenanceHash", type: "bytes32" },
      { name: "teeAttestation", type: "bytes32" }, { name: "seed", type: "uint256" },
      { name: "nonce", type: "bytes32" }, { name: "attestationSig", type: "bytes" },
    ], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nextTokenId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
  { type: "event", name: "OutputMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "creatorAgentId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "imageRoot", type: "string", indexed: false },
      { name: "provenanceHash", type: "bytes32", indexed: false },
      { name: "teeAttestation", type: "bytes32", indexed: false },
      { name: "seed", type: "uint256", indexed: false },
    ] },
];

export const MKT_ABI = [
  { type: "function", name: "list", stateMutability: "nonpayable", inputs: [{ name: "collection", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "price", type: "uint256" }], outputs: [] },
  { type: "function", name: "listingKey", stateMutability: "pure", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "listings", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ name: "seller", type: "address" }, { name: "price", type: "uint256" }, { name: "active", type: "bool" }] },
  { type: "function", name: "allowedCollection", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
];

export { parseEther };

// ---- SIWE ----
export async function siweLogin() {
  const nres = await fetch(`${API}/auth/nonce`, { cache: "no-store" });
  if (!nres.ok) throw new Error(`nonce fetch failed ${nres.status}`);
  const { nonce } = await nres.json();
  const message = createSiweMessage({
    address: account.address,
    chainId: CHAIN_ID,
    domain: "localhost:3000",
    nonce,
    uri: "http://localhost:3000",
    version: "1",
    statement: "Sign in to AURA to generate, mint, and create. Generation stays sponsored and free.",
  });
  const signature = await account.signMessage({ message });
  const vres = await fetch(`${API}/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!vres.ok) {
    const e = await vres.text();
    throw new Error(`SIWE verify failed ${vres.status}: ${e.slice(0, 200)}`);
  }
  const { token } = await vres.json();
  if (!token) throw new Error("no token in verify response");
  return token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Manual receipt poll loop. NEVER waitForTransactionReceipt (throws on this RPC).
export async function pollReceipt(hash, { tries = 60, intervalMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await publicClient.getTransactionReceipt({ hash });
      if (r) return r;
    } catch (_) { /* not mined yet */ }
    await sleep(intervalMs);
  }
  throw new Error(`receipt not found after ${tries} tries: ${hash}`);
}

// ---- generation ----
export async function generate(token, agentId, prompt, { pollTries = 90, intervalMs = 4000 } = {}) {
  const sres = await fetch(`${API}/generate`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ agentId, prompt }),
  });
  if (sres.status !== 202 && !sres.ok) {
    const e = await sres.text();
    throw new Error(`/generate failed ${sres.status}: ${e.slice(0, 200)}`);
  }
  const { jobId } = await sres.json();
  if (!jobId) throw new Error("no jobId");
  let last = null;
  for (let i = 0; i < pollTries; i++) {
    await sleep(intervalMs);
    const jres = await fetch(`${API}/generate/${jobId}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!jres.ok) { last = `poll ${jres.status}`; continue; }
    const job = await jres.json();
    last = job.status;
    if (job.status === "done") return { jobId, result: job.result };
    if (job.status === "error") return { jobId, error: job.error || "gen error" };
  }
  return { jobId, error: `gen timed out (last=${last})` };
}

export async function fetchMintArgs(token, jobId) {
  const res = await fetch(`${API}/mint-args`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
  });
  if (!res.ok) {
    const e = await res.text();
    throw new Error(`/mint-args failed ${res.status}: ${e.slice(0, 200)}`);
  }
  return res.json();
}

export async function fetchJobImage(token, jobId) {
  const res = await fetch(`${API}/generate/${jobId}/image`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`image fetch failed ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
