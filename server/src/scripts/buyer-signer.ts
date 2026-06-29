// DEMO-ONLY local signer for the Live Summon recording. Holds the demo BUYER key (from .env,
// SUMMON_BUYER_KEY) SERVER-SIDE and signs+broadcasts the txs the injected EIP-6963 browser provider
// relays — so the buyer key NEVER enters the browser. localhost-only, testnet-only (Galileo 16602).
// NOT a production component: it's a recording convenience that keeps the key out of page JS.
//
//   GET  /address               -> { address }            (the buyer address; public)
//   POST /send  { to,data,value,gas } -> { hash }          (sign + broadcast on Galileo, legacy 5 gwei)
//   GET  /health                -> { ok, address, chainId }
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const REPO = path.resolve(import.meta.dirname, "..", "..", "..");
const env = readFileSync(path.join(REPO, ".env"), "utf8");
const m = env.match(/^SUMMON_BUYER_KEY=(.+)$/m);
if (!m) throw new Error("SUMMON_BUYER_KEY not found in .env");
const KEY = (m[1].trim().startsWith("0x") ? m[1].trim() : `0x${m[1].trim()}`) as string;

const RPC = "https://evmrpc-testnet.0g.ai";
const CHAIN_ID = 16602;
const PORT = 8799;
const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
const wallet = new ethers.Wallet(KEY, provider);

function json(res: import("node:http").ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

function toBig(v: unknown): bigint | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "bigint") return v;
  return BigInt(v as string); // handles "0x..." and decimal strings
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/address") return json(res, 200, { address: wallet.address });
  if (req.method === "GET" && req.url === "/health") return json(res, 200, { ok: true, address: wallet.address, chainId: CHAIN_ID });

  if (req.method === "POST" && req.url === "/send") {
    let body = "";
    for await (const c of req) body += c;
    try {
      const tx = JSON.parse(body || "{}") as { to?: string; data?: string; value?: string; gas?: string };
      if (!tx.to) throw new Error("missing `to`");
      const sent = await wallet.sendTransaction({
        to: tx.to,
        data: tx.data ?? "0x",
        value: toBig(tx.value) ?? 0n,
        gasLimit: toBig(tx.gas),
        gasPrice: 5_000_000_000n, // legacy, Galileo min-tip safe (matches the deploy + e2e)
      });
      // eslint-disable-next-line no-console
      console.log(`[buyer-signer] sent ${sent.hash} to ${tx.to} value ${tx.value ?? "0"}`);
      return json(res, 200, { hash: sent.hash });
    } catch (e: unknown) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[buyer-signer] http://127.0.0.1:${PORT} signing as ${wallet.address} on Galileo ${CHAIN_ID}`);
});
