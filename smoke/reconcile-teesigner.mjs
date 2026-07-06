// Reconcile the mainnet OutputNFT pinned teeSigner to the ACTUAL live 0G enclave signer.
// The enclave rotated: contract pins 0x2A94D671 (stale, deploy-time) but the live z-image enclave signs
// 0x592056 -> every mintOutputVerified reverts "bad TEE attestation". setTeeSigner (callable ONLY by the
// attestor = 0x8a3b) is the contract's DOCUMENTED 1-tx fix for exactly an enclave-key rotation.
// We recover the signer from the REAL teeText/teeSig in the reverted mint tx (no transcription), assert it,
// then pin it. Reversible: setTeeSigner(0x2A94D671) restores. Attestor key read from ~/.claude/aura-mainnet.env, NEVER printed.
import { readFileSync } from "node:fs";
import os from "node:os";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, createPublicClient, http, defineChain, decodeFunctionData, recoverMessageAddress } from "viem";

const RPC = "https://evmrpc.0g.ai";
const OUT = "0xF31fD2235a5db76020b2a6F1CBC06e13E25E4805";
const REVERTED_TX = "0x5b64507a5b93fcad69ce60323728a2a8cf9fe4c0e3f04f364898000ab0c56677";
const EXPECTED = "0x592056E413aB456646a50441e52D5BA89527877D"; // sanity anchor (config IMAGE_MAINNET_TEE_SIGNER)
const APPLY = process.env.APPLY === "1";

const chain = defineChain({ id: 16661, name: "0G Aristotle", nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const commonInputs = [
  { name: "to", type: "address" }, { name: "creatorAgentId", type: "uint256" }, { name: "imageRoot", type: "string" },
  { name: "provenanceHash", type: "bytes32" }, { name: "teeAttestation", type: "bytes32" }, { name: "seed", type: "uint256" },
  { name: "nonce", type: "bytes32" }, { name: "attestationSig", type: "bytes" },
];
const abi = [
  { type: "function", name: "mintOutputVerified", stateMutability: "nonpayable", inputs: [...commonInputs, { name: "teeText", type: "string" }, { name: "teeSig", type: "bytes" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "teeSigner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "attestor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "setTeeSigner", stateMutability: "nonpayable", inputs: [{ name: "newSigner", type: "address" }], outputs: [] },
];

let pk = readFileSync(os.homedir() + "/.claude/aura-mainnet.env", "utf8").match(/AURA_MAINNET_SPONSOR_KEY=\s*"?([^"\n\r]+)"?/)[1].trim();
if (!pk.startsWith("0x")) pk = "0x" + pk;
const account = privateKeyToAccount(pk);

(async () => {
  const pub = createPublicClient({ chain, transport: http(RPC) });
  const tx = await pub.getTransaction({ hash: REVERTED_TX });
  const { args } = decodeFunctionData({ abi, data: tx.input });
  const teeText = args[8]; const teeSig = args[9];
  const recovered = await recoverMessageAddress({ message: teeText, signature: teeSig });
  console.log("recovered enclave signer from real teeSig:", recovered);
  console.log("expected (config default)            :", EXPECTED);
  if (recovered.toLowerCase() !== EXPECTED.toLowerCase()) throw new Error("recovered signer != expected; ABORT (unexpected enclave)");
  const before = await pub.readContract({ address: OUT, abi, functionName: "teeSigner" });
  const attestor = await pub.readContract({ address: OUT, abi, functionName: "attestor" });
  console.log("current on-chain teeSigner (stale):", before);
  console.log("contract attestor (must == signer key):", attestor, "| my addr:", account.address, "| match:", attestor.toLowerCase() === account.address.toLowerCase());
  if (!APPLY) { console.log("\nDRY: set APPLY=1 to send setTeeSigner(" + recovered + "). Rollback = setTeeSigner(" + before + ")."); return; }
  if (before.toLowerCase() === recovered.toLowerCase()) { console.log("already reconciled; no tx needed."); return; }
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  const hash = await wallet.writeContract({ address: OUT, abi, functionName: "setTeeSigner", args: [recovered], gas: 80000n });
  console.log("setTeeSigner tx:", hash, "| ROLLBACK: setTeeSigner(" + before + ")");
  let receipt; for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 2500)); try { receipt = await pub.getTransactionReceipt({ hash }); } catch {} if (receipt) break; }
  if (!receipt || receipt.status !== "success") throw new Error("setTeeSigner failed/timeout tx " + hash);
  const after = await pub.readContract({ address: OUT, abi, functionName: "teeSigner" });
  console.log("teeSigner AFTER:", after, "| reconciled:", after.toLowerCase() === recovered.toLowerCase());
})().catch((e) => { console.error("ERROR:", e.shortMessage || e.message); process.exit(1); });
