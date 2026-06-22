# 0G Stack Smoke-Test Report (Zero Cup de-risk)

**For:** Toper · **By:** zerog-smoke-test (worker, Opus) · **Date:** 2026-06-21 · **Parent:** income-diversification-2026
**Scope:** Prove every 0G primitive the "Verifiable Creative Agent Marketplace" build needs, on testnet, so the build phase hits zero walls. Prototype only, not the real build.
**Workspace:** `~/claude/Git/repositories/zerog-smoke` (Node/TS smoke scripts in `src/`, Foundry project in `contracts/`).

---

## 0. VERDICT (read this first)

| Area | Result | One-line |
|---|---|---|
| **0G Storage** | 🟢 GREEN | Upload + download byte-identical round-trip on Turbo. Works, with one critical SDK swap (below). |
| **0G Chain (EVM)** | 🟢 GREEN | All 3 contracts deployed live on Galileo. ERC-721 + EIP-2981 + iNFT-MVP + Marketplace verified on-chain. |
| **ERC-7857 (iNFT)** | 🟢 GREEN (MVP) | MVP-able in the window: YES. Official reference exists. The full transfer-oracle is the only hard part, and the build skips it (documented shortcut). |
| **End-to-end loop** | 🟢 GREEN | generate -> store -> mint(provenance+root) -> read-back, all proven live on testnet. |
| **0G Compute (image-gen)** | 🟢 STRONG GREEN | The #1 make-or-break. Generated 4 demo-grade, TEE-verified images on `qwen-image-edit-2511`. One nuance: it is EDIT-only (use `/images/edits`). See §1. |

**Bottom line:** ALL 5 areas are GREEN and proven live on testnet. The full architecture (provable TEE-verified creation + dynamic royalty that follows the agent + permanent storage + the iNFT) is proven end-to-end on real Galileo. The #1 make-or-break (image quality) is a STRONG GREEN: the art is demo-grade and maximally style-distinct. **Build is GO.**

**Biggest de-risk finding:** the storage SDK the research told us to use (`@0glabs/0g-ts-sdk@0.3.3`) is STALE and silently breaks every upload. The build MUST use `@0gfoundation/0g-ts-sdk@1.2.8` instead. This alone would have cost the build hours of confusion. See Gotcha #3.

---

## 1. 0G COMPUTE (image generation) - the #1 make-or-break

### 1a. Served model roster (LIVE testnet, enumerated fund-free)

I enumerated the marketplace via the read-only broker (`createZGComputeNetworkReadOnlyBroker`, needs no wallet/funds). **The research roster was stale.** The live testnet roster right now:

| # | model | serviceType | TEE (verifiability) | price | provider | notes |
|---|---|---|---|---|---|---|
| 0 | `qwen/qwen2.5-omni-7b` | chatbot | TeeML (dstack) | ~2.6e-6 0G / call | `0xa48f…7836` (aliyun, centralized-in-TEE) | multimodal-understanding LLM (generates text, not images) |
| 1 | `qwen/qwen-image-edit-2511` | **image-editing** | TeeML (dstack) | 5e-3 0G / call | `0x4b2a…4389` (integratenetwork) | **the image model** |

So there IS a TEE-verified image model on testnet (better than the research feared). The nuance: it is `qwen-image-edit-2511`, serviceType **`image-editing`**, not pure `text-to-image`. The SDK does expose a `/images/generations` (text-to-image) path and treats both `text-to-image` and `image-editing` as image services, so it may well accept a text-only prompt. That is the exact thing the live test answers.

The research said testnet served `qwen-2.5-7b / gpt-oss-20b / gemma-3-27b`. None of those are served now. **Confirmed: do not hardcode model names; query `listService()` at runtime** (build already planned this).

### 1b. Full broker lifecycle - PROVEN end-to-end on testnet

Every step ran successfully against live Galileo, all the way through generating real images:

1. `createZGComputeNetworkBroker(wallet)` ✅
2. `broker.inference.listService()` ✅ (the table above)
3. ledger create/fund ✅ (`depositFund`) -> on-chain ledger
4. `broker.inference.acknowledgeProviderSigner(provider)` ✅
5. `broker.ledger.transferFund(provider, "inference", neuron)` ✅ -> locks the provider sub-account
6. `broker.inference.getServiceMetadata(provider)` ✅ -> `{endpoint, model}`
7. `broker.inference.getRequestHeaders(provider, content)` ✅ -> single-use auth headers
8. signed multipart POST to `${endpoint}/images/edits` ✅ -> **image returned**
9. `broker.inference.processResponse(provider, chatId, content)` ✅ -> **TEE verify = true**

Two intermediate gotchas surfaced and were resolved (both important for the build):
- **Provider needs a 1.0 0G locked reserve** in its sub-account before it will serve (HTTP 400 "required minimum 1.0 0G" below that). Lock >= 1.0 0G via `transferFund`. (Resolved by funding.)
- **`/images/generations` returns "Image generation not enabled"** for this model. It is EDIT-only. The working path is `/images/edits`. (See §1e.)

### 1c. Image-gen request recipe

This model is EDIT-only, so the working recipe is the `/images/edits` multipart call in §1e. For reference, a pure text-to-image provider (if one is served) would instead use JSON on `/images/generations`:

```ts
// text-to-image (NOT supported by qwen-image-edit-2511; for a future generations-enabled provider):
const body = { model, prompt, size: "512x512", n: 1, response_format: "b64_json" };
const headers = await broker.inference.getRequestHeaders(provider, JSON.stringify(body));
const res = await fetch(`${endpoint}/images/generations`, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
```

Async variants also exist (`/v1/async/images/{generations,edits}` + poll `/v1/async/jobs/{id}`) for providers that run jobs async. Working edit script: `src/03b-compute-edit.ts`.

### 1d. TEE attestation shape (for the "VERIFY" moment)

What we get to surface in the UI verify moment:
- **Per-service (on-chain, from `listService()`):** `verifiability: "TeeML"`, `teeSignerAddress` (the on-chain TEE signer), and `additionalInfo` JSON with `TEEVerifier: "dstack"` + a `VerifierURL` pointing at the Dstack-TEE/dstack verifier release. The compute SDK even bundles a `dcap-qvl-web_bg.wasm` (DCAP quote-verification) binary.
- **Per-response:** `processResponse(provider, chatId, content)` does the TEE verification + settlement. chatId priority: the `ZG-Res-Key` response header, else `data.id`. If no chatId is passed, verification is skipped (returns null), so the build MUST thread the chatId to get a pass/fail. This boolean (plus the teeSigner + model name) is exactly the "provably created by model X in a TEE" proof for the verify moment.

### 1e. THE IMAGES - 🟢 STRONG GREEN (demo-grade)

**Generated all 4 agent styles, live on 0G Compute, every one TEE-verified.** Saved to `images/` (1024x1024 PNG each). Honest verdict: **demo-grade, genuinely impressive, maximally style-distinct.**

| Agent | File | latency | bytes | TEE verified | chatId (zg-res-key) |
|---|---|---|---|---|---|
| NOKTURNE | `images/NOKTURNE.png` | 56.4 s | 1.28 MB | ✅ true | 98c84e9c… |
| MIRAI | `images/MIRAI.png` | 42.6 s | 1.37 MB | ✅ true | 274be0fb… |
| RISO | `images/RISO.png` | 41.9 s | 2.07 MB | ✅ true | 512dd620… |
| SCRIPTORIUM | `images/SCRIPTORIUM.png` | 41.4 s | 2.01 MB | ✅ true | a7562446… |

What the images show (one base scene -> 4 worlds): NOKTURNE = chiaroscuro noir oil painting (candle, steam, wet reflections); MIRAI = neon cyberpunk (magenta/cyan, rain, holographic signage); RISO = fluorescent pink/blue risograph with halftone grain; SCRIPTORIUM = illuminated medieval manuscript with a gilded jeweled marginalia border around a fully-rendered espresso bar. They are unmistakably different. This IS the "marketplace feels alive" screen from the build-plan.

**CRITICAL nuance (build must handle): `qwen-image-edit-2511` is EDIT-only.** `/images/generations` returns `"Image generation not enabled"`. You MUST call `/images/edits` (multipart: `prompt` + `image` file + `response_format=b64_json`), i.e. provide an INPUT image. I used one synthetic base scene (`images/_base-scene.png`, drawn with ImageMagick) and edited it 4 ways. The model preserves the base composition while fully restyling, which is a BONUS for brand consistency (NOKTURNE always has the same layout). For the build: give each agent a fixed base composition + its style-DNA prompt. (Pure text-to-image would need a different provider; not available on testnet right now.)

Other captured facts:
- **Output:** always 1024x1024 PNG (input was 512x512; the model upscales). `response_format: b64_json` returns base64 in `data[0].b64_json`.
- **Latency:** 42-56 s per image. The demo needs a loading state (not instant).
- **Cost:** inference settled from the prepaid ledger sub-account (wallet balance unchanged across the 4 calls); listed price 5e-3 0G/call.
- **Seed/style-reference:** the input image IS the style/composition reference (great for consistency). Seed control not separately exposed on this provider; the base image + prompt give strong control.
- **TEE verify:** `processResponse(provider, chatId, content)` returned **true** for all 4. chatId came from the `zg-res-key` response header. This boolean + the on-chain teeSigner + model name = the VERIFY moment proof.

The edit-based recipe (verified working):
```ts
const headers = await broker.inference.getRequestHeaders(provider, prompt);
delete headers["Content-Type"];                       // let FormData set the multipart boundary
const form = new FormData();
form.append("prompt", prompt);
form.append("response_format", "b64_json");
form.append("model", model);
form.append("image", new Blob([baseImageBytes], { type: "image/png" }), "image.png");
const res = await fetch(`${endpoint}/images/edits`, { method: "POST", headers, body: form });
const b64 = (await res.json()).data[0].b64_json;      // -> save PNG
const chatId = res.headers.get("zg-res-key");
const verified = await broker.inference.processResponse(provider, chatId, prompt); // true
```

---

## 2. 0G STORAGE - 🟢 GREEN

Round-trip PROVEN live on the Turbo network (server-side Node):

| Step | Result |
|---|---|
| local merkle root (fund-free) | `0xd2dacc0b6bddce356196e31ca6adefdf0f740d21a14bc6339d9bda9045111df1` |
| indexer reachable (Turbo) | yes (6 sharded nodes, chainId 16602) |
| upload | ✅ tx `0x5a8380f0a110f6d13be68aa59513cfa612deab9746596a8ffdb863126c54f918` |
| on-chain rootHash == local merkle | ✅ true |
| download by rootHash | ✅ 257 bytes, 4 storage locations found |
| byte-identical round-trip | ✅ true |
| storage fee | ~6.1e-8 0G per 2 sectors (negligible) + gas |

Server-side path uses `MemData(buffer)` (no fs needed) -> `Indexer.upload(mem, rpc, signer, opts)` -> `{rootHash, txHash}` -> `Indexer.download(rootHash, path, true)`. The full script is `src/04-storage.ts`. Encrypted style-DNA: client-side encrypt (e.g. AES via the bundled crypto) then upload the ciphertext bytes the same way; store the key off-band. The build keeps all storage server-side (see Gotcha #7).

---

## 3. 0G CHAIN (EVM, Galileo) - 🟢 GREEN

Deployed live on Galileo testnet (chainId **16602**), independently verified with `cast`:

| Contract | Address | Standard |
|---|---|---|
| AgentRegistry (iNFT MVP) | `0xEf948192c22957Eaa24a08782163b30037bA34bC` | ERC-721 + iNFT data model |
| OutputNFT | `0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb` | ERC-721 + EIP-2981 |
| Marketplace | `0x4484071f199f16259d4a4F4b41DBa1359D5f7a8c` | custom (enforced royalty split) |

On-chain reads (`cast`, independent of the deploy script):
- `AgentRegistry.ownerOf(1)` = the deployer ✅
- `AgentRegistry.royaltyBpsOf(1)` = 700 (7%) ✅
- `OutputNFT.royaltyInfo(1, 1e18)` = `[deployer, 0.07 0G]` ✅
- `OutputNFT.supportsInterface(0x2a55205a)` (EIP-2981) = true ✅

Deploy of all 3 contracts + 2 seed mints cost only ~0.017 0G.

### 3a. The thesis, proven on-chain (5/5 forge tests)

`contracts/test/Smoke.t.sol` proves the whole economic thesis locally, including the key one:

- `test_RoyaltyFollowsAgentOnTransfer` - mint an artwork, sell the AGENT to a new owner, and the SAME artwork's `royaltyInfo()` now routes to the new owner. **Selling the agent transfers its entire future royalty stream.** This is the primitive that only works because royalty resolves dynamically to `AgentRegistry.ownerOf(creatorAgentId)`.
- `test_Marketplace_EnforcedRoyaltySplit` - `buy()` pays the agent-owner royalty + platform fee BEFORE the seller and BEFORE transfer, so in-platform royalty is unbypassable.
- plus mint/provenance/EIP-2981-interface tests.

```
[PASS] test_Marketplace_EnforcedRoyaltySplit
[PASS] test_MintAgent_And_ReadBack
[PASS] test_MintOutput_Provenance_And_Royalty
[PASS] test_RoyaltyFollowsAgentOnTransfer
[PASS] test_SupportsERC2981Interface
5 passed; 0 failed
```

### 3b. ERC-7857 (iNFT) feasibility - MVP-able: YES

- **Official reference:** `github.com/0gfoundation/0g-agent-nft` (branch `eip-7857-draft`). Reference `ERC7857` contract = ERC721 + Ownable + ReentrancyGuard, with `_metadataHashes`, `_encryptedURIs`, `_authorizations`, an `oracle` address, `PROOF_VALIDITY_PERIOD = 1 hours`, constructor `(name, symbol, oracle, ogStorage)`.
- **The hard part:** the secure-transfer oracle (a TEE re-encrypts the encrypted "brain" to the new owner's key on transfer). This is the only genuinely hard piece.
- **The MVP (what we ship):** our `AgentRegistry` mints the iNFT with a public identity + an **encrypted style-DNA pointer** (`encBrainRoot` on 0G Storage) + style fingerprint + model attestation hash, and uses standard ERC-721 transfer (brain stays sealed to the original key). This is the documented MVP shortcut and is honest to judges. Adding the oracle later is a clean upgrade, not a rewrite.

---

## 4. END-TO-END mini-loop

generate (Compute) -> store (Storage) -> mint OutputNFT (Chain) with creatorAgentId + provenanceHash + storageRoot -> read back.

**PROVEN live end-to-end** (`src/05-e2e.ts`): took the real generated `images/NOKTURNE.png` (1.28 MB) ->
- stored on 0G Storage: `imageRoot = 0x614ce2f2ad80b9c00326e522fed68af7f35feff7469e04cd0c17d8ac9f3c4780`
- minted OutputNFT #2 on Galileo (tx `0xda97d51b49c03de8d888663bf5b5d1a4b75b1d0b778a153d027ea9767de860c5`) with `creatorAgentId=1` + `provenanceHash` + `imageRoot` baked in
- read back on-chain: **imageRoot matches stored = true**, **provenanceHash matches = true**, `royaltyInfo` -> 0.07 0G to the agent owner.

So: generate (Compute, TEE-verified) -> store (Storage) -> mint (Chain, with provenance) -> read-back. The whole architecture runs on real testnet. The loop is closed.

---

## 5. Build-risk table (build-plan §5) - resolved

| Risk (from build-plan) | Status | Resolution / finding |
|---|---|---|
| Compute image-gen quality (#1) | 🟢 resolved GREEN | Generated 4 demo-grade TEE-verified images on `qwen-image-edit-2511`. Art is genuinely good. The model is EDIT-only -> use `/images/edits`. |
| Style consistency (seed/ref) | 🟢 resolved | The input base image IS the composition/style reference. Edit model preserves layout while restyling -> strong per-agent consistency (NOKTURNE always same composition). Better than free text-to-image for branding. |
| Surfacing the TEE attestation | 🟢 resolved | `verifiability=TeeML`, on-chain `teeSignerAddress`, dstack verifier, + `processResponse()` pass/fail (thread the chatId). Enough for the verify moment. |
| Royalty enforcement | 🟢 resolved | EIP-2981 + dynamic resolution to current agent owner, enforced in `buy()`. Proven on-chain + 5/5 tests. |
| ERC-7857 full secure-transfer | 🟢 resolved (MVP) | Skip the oracle for MVP; mint a simple iNFT pointer. Official reference exists for later. |
| Browser polyfills | 🟢 resolved | Confirmed the storage SDK imports fs/crypto and `Downloader` uses `appendFileSync`. Keep ALL 0G ops server-side (Next.js route handlers). |
| Funding ritual | 🟢 characterized | depositFund/addLedger floors are client-side (3 0G); the contract allows less. Provider needs a 1.0 0G locked reserve. transferFund 1 0G floor is warn-only. |
| Node/SDK version compat | 🟡 critical | See Gotcha #3 (storage SDK) + #2 (compute ESM). Pinned versions in §7. |
| Supply chain (official pkgs) | 🟢 clean | axios 1.18.0 + 0.27.2 (NOT the compromised 1.14.1/0.30.4), no `plain-crypto-js`. All `@0glabs`/`@0gfoundation` scopes. |

---

## 6. GOTCHAS (every one hit, with the workaround)

| # | Gotcha | Impact | Workaround |
|---|---|---|---|
| **1** | **chainId is 16602, not 16601** | Every tx fails (chain-id mismatch) if you trust the old docs/research | Use **16602**. The live RPC + the SDK's `TESTNET_CHAIN_ID` + the current docs all agree on 16602. (Mainnet = 16661.) |
| **2** | **Compute SDK ESM entry is broken** | `import` from `@0glabs/0g-serving-broker` throws `SyntaxError` (named exports C/F/H… not provided) under native ESM | Load via CommonJS `createRequire` (see `src/zg-compute.ts`). The CJS build is fine. |
| **3** | **Storage SDK `@0glabs/0g-ts-sdk@0.3.3` is STALE** (npm "latest" but abandoned) | EVERY upload reverts `require(false)`. Its `submit` ABI (selector `0xef3e12dc`) no longer matches the live flow contract (which wants `0xbc8c11f8`) | **Use `@0gfoundation/0g-ts-sdk@1.2.8`.** The research's "prefer @0glabs, foundation is a mirror" is BACKWARDS for storage. (Root-caused by decoding a live successful submit on-chain.) |
| **4** | **Galileo min gas tip = 2 gwei** | forge broadcast fails: "gas tip cap 1, minimum needed 2000000000" | `forge ... --legacy --gas-price 5000000000` (or set a priority fee >= 2 gwei). |
| **5** | **0G Chain wants `evmVersion: cancun`** | Contract weirdness with older evm versions | solc 0.8.28 defaults to cancun (we were fine). Set `evm_version = "cancun"` explicitly to be safe. |
| **6** | **Ledger 3 0G floor is client-side only** | SDK refuses `addLedger`/`depositFund` < 3 0G even though the contract allows it | For constrained funds, patch `LedgerProcessor.MIN_LEDGER_BALANCE_OG = 0` (smoke-test only) or call the ledger contract directly. The build should just fund 3 0G normally. |
| **7** | **Storage SDK is server-side only** | `Downloader` uses `fs.appendFileSync`; SDK imports fs/crypto at load | Do all storage in Next.js route handlers / Node, keep the browser thin (matches the planned architecture). |
| **8** | **Provider sub-account needs 1.0 0G locked** | Image requests rejected below the provider's reserve | Lock >= 1.0 0G via `transferFund` to the provider before calling. Budget for it. |
| **9** | **ethers provider keeps the process alive** | scripts hang after finishing (open polling handle) | call `provider.destroy()` at the end, or `process.exit(0)`. Minor. |

---

## 7. Exact versions (pin these)

| Package | Version | Note |
|---|---|---|
| `@0glabs/0g-serving-broker` | 0.7.8 | compute/inference; wraps `@0gfoundation/0g-compute-ts-sdk@0.8.4` |
| `@0gfoundation/0g-compute-ts-sdk` | 0.8.4 | the real compute SDK (transitive) |
| **`@0gfoundation/0g-ts-sdk`** | **1.2.8** | **storage - USE THIS, not @0glabs** |
| ~~`@0glabs/0g-ts-sdk`~~ | ~~0.3.3~~ | **STALE - do not use for storage** |
| `ethers` | 6.13.1 | pinned (storage SDK peer wants exactly 6.13.1) |
| `openai` | 6.44.0 | optional (OpenAI-compatible client) |
| Foundry | forge 1.2.3-stable | |
| OpenZeppelin contracts | 5.6.1 | |
| solc | 0.8.28 (cancun) | |
| Node | 22.16.0 | |

---

## 8. BUILD-READY checklist

- [x] Fresh testnet wallet flow + faucet characterized (Turnstile captcha, 0.5 0G/claim)
- [x] chainId 16602 everywhere (wallet, Foundry, frontend)
- [x] Storage upload/download proven (use `@0gfoundation/0g-ts-sdk@1.2.8`, server-side)
- [x] Contracts written + deployed live + on-chain verified (ERC-721 + EIP-2981 + iNFT MVP + Marketplace)
- [x] Royalty-follows-agent thesis proven on-chain (5/5 tests)
- [x] Compute lifecycle proven end-to-end; recipe + TEE shape documented
- [x] All 9 gotchas captured with workarounds
- [x] **Image-gen quality assessed** - 4 styles, demo-grade, TEE-verified (use `/images/edits`, edit-only model)
- [x] Full e2e: generate -> store -> mint(provenance+root) -> read-back, proven live

**Walls to avoid in the build:** (1) do NOT use `@0glabs/0g-ts-sdk` for storage. (2) chainId 16602. (3) keep storage server-side. (4) fund the compute provider with >= 1.0 0G. (5) forge needs `--legacy --gas-price 5gwei`. (6) load the compute broker via CJS, not ESM.

**If image-gen comes back RED** (weak art from `qwen-image-edit-2511`): pivot per build-plan, generate art on a stronger model, and keep 0G Compute load-bearing for a TEE-verified originality/attestation check (the verify moment + provenance + dynamic royalty all still stand, since they are chain+storage, both GREEN).
