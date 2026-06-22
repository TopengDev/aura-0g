// VERIFY (no on-chain spend): boot the app via app.inject(), do the full SIWE handshake with the
// sponsor wallet, get a JWT, then prove a protected route works WITH the token and 401s WITHOUT it.
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: path.resolve(__dirname, "..", "..", "..", ".env") });

import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount } from "viem/accounts";
import { buildApp } from "../app.js";
import { GALILEO, SIWE_DOMAIN, SIWE_URI, sponsorPrivateKey } from "../aura/config.js";

const app = await buildApp({ logger: false });
const acct = privateKeyToAccount(sponsorPrivateKey() as `0x${string}`);
console.log("wallet:", acct.address);

// 1. nonce
const nRes = await app.inject({ method: "GET", url: "/auth/nonce" });
const { nonce } = nRes.json() as { nonce: string };
console.log("GET /auth/nonce ->", nRes.statusCode, "nonce:", nonce.slice(0, 12), "...");

// 2. build + sign the SIWE message
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

// 3. verify -> JWT
const vRes = await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } });
const vBody = vRes.json() as { token?: string; address?: string; error?: string };
console.log("POST /auth/verify ->", vRes.statusCode, vBody.error ? `ERROR ${vBody.error}` : `address ${vBody.address}`);
if (!vBody.token) {
  console.log("=== AUTH VERIFY RED ===");
  await app.close();
  process.exit(1);
}
const token = vBody.token;

// 4. protected route WITH token (use /generate with bad body -> expect 400 not 401, proving auth passed)
const okRes = await app.inject({ method: "POST", url: "/generate", headers: { authorization: `Bearer ${token}` }, payload: {} });
console.log("POST /generate (auth, empty body) ->", okRes.statusCode, "(expect 400 = auth passed, validation failed)");

// 5. protected route WITHOUT token -> expect 401
const noRes = await app.inject({ method: "POST", url: "/generate", payload: { agentId: 1, prompt: "x" } });
console.log("POST /generate (no auth) ->", noRes.statusCode, "(expect 401)");

// 6. nonce replay -> expect 401 (single-use)
const replayRes = await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature } });
console.log("POST /auth/verify (replay same nonce) ->", replayRes.statusCode, "(expect 401 single-use)");

const green =
  vRes.statusCode === 200 &&
  okRes.statusCode === 400 &&
  noRes.statusCode === 401 &&
  replayRes.statusCode === 401;
console.log(green ? "\n=== AUTH VERIFY GREEN ===" : "\n=== AUTH VERIFY RED ===");
await app.close();
process.exit(green ? 0 : 1);
