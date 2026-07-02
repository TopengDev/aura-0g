# PROOF

**Jury evidence for AURA.** Every claim here re-derives from a live endpoint or an on-chain read. Each row links to a proof you can run yourself. If a claim could not be verified live, it is not on this page. Live page: [aura.topengdev.com/proof](https://aura.topengdev.com/proof).

All values below were verified live on 2026-07-01 against the 0G Galileo testnet (chainId 16602) and 0G mainnet compute.

---

## 0. The mic-drop: stricter than the chain's own flag

On 0G mainnet the on-chain `verifiability: "TeeML"` flag is **coarse**: many providers carry it (sixteen right now). AURA does not route on the flag alone.

AURA requires **both** `verifiability === "TeeML"` **and** the provider address on a **curated allowlist** maintained in the server (a hardcoded set of addresses). The set AURA will actually serve is therefore strictly narrower than the chain's flag: a provider not on the allowlist is never selectable or served, even when the chain says TeeML. (Source: `server/src/aura/chat-compute.ts`, "TeeML integrity allowlist".)

**Verify live:** [`GET /chat/models`](https://api-aura.topengdev.com/chat/models)

The provider addresses below are 0G **mainnet** accounts, so they link to the mainnet explorer (`chainscan.0g.ai`). This is a different network from the app's Galileo testnet contracts further down, which is the whole point.

| Model | Provider (0G mainnet) | `teeAttested` | `allowlisted` | `selectable` |
|---|---|---|---|---|
| GLM 5.1 | [0xDB7B...b2e8](https://chainscan.0g.ai/address/0xDB7B465300B0acf454867683c5481055f698b2e8) | true | **true** | **true** |
| GLM 5.1 FP8 | [0x7DCF...e87D](https://chainscan.0g.ai/address/0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D) | true | **true** | **true** |
| 0GM 1.0 35B A3B | [0x4870...a4E9](https://chainscan.0g.ai/address/0x4870CbC4D07d6Ac2EE5aA865588e5985FE77a4E9) | true | **true** | **true** |
| Deepseek Chat V3 | [0x1B3A...5EB0](https://chainscan.0g.ai/address/0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0) | true (online) | false | **false** |
| Deepseek V4 Flash | [0x61C0...B9F6](https://chainscan.0g.ai/address/0x61C0007197E7D4d6A842d6768E8035728877B9F6) | true (online) | false | **false** |
| Deepseek V4 Pro | [0xB01E...2FdB](https://chainscan.0g.ai/address/0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB) | true (online) | false | **false** |
| GPT OSS 20B | [0x44ba...ef64](https://chainscan.0g.ai/address/0x44ba5021daDa2eDc84b4f5FC170b85F7bC51ef64) | true | false | **false** |

Sixteen providers carry `TeeML` on mainnet right now. AURA serves three. The other thirteen are TeeML-flagged and still not on AURA's allowlist, so the app will not route to them on the chat path, even the ones online this minute.

> AURA's curated allowlist is strictly narrower than the chain's TeeML flag.

---

## 1. Mainnet frontier chat, attested per reply

Auras chat on 0G **mainnet** GLM-5.1 (served as GLM-5.1-FP8), and each reply carries its own TEE attestation. A labeled fallback (Anthropic Claude) is configured for when 0G is unavailable; it is **not** TEE-attested, and the UI says so on any reply it serves.

**Verify live:** [`GET /chat/health`](https://api-aura.topengdev.com/chat/health)

```json
{ "zerogHealthy": true, "zerogModel": "zai-org/GLM-5.1-FP8", "zerogNetwork": "mainnet", "fallbackConfigured": true, "preferred": "zerog" }
```

---

## 2. The four 0G primitives

| Primitive | How AURA uses it | Honest bound | Live proof |
|---|---|---|---|
| **Compute (TEE)** | Chat runs on 0G **mainnet** GLM-5.1 (attested per reply); image generation runs on 0G **testnet** (`qwen-image-edit-2511`), attestation committed on-chain at mint. | Per-reply hardware attestation, not a blanket trustless-AI claim. | [`/chat/health`](https://api-aura.topengdev.com/chat/health), [Relic #25](https://aura.topengdev.com/outputs/25) |
| **Storage (0G)** | Every Relic image and sealed agent-brain is a 0G Storage content root, committed on-chain and finalized on 0G Storage. | Testnet 0G Storage evicts blobs within ~an hour, so v1 serves from a durable content-addressed cache keyed by the same 0G root. Full 0G persistence is a mainnet property. (Source: `server/src/routes/image.ts`.) | [0G Storage: finalized](https://indexer-storage-testnet-turbo.0g.ai/file/info/0x04a177d82e8e645ce01d6bf9a386465ea3d2f3607bcd2290aaaa13affdcfe616) |
| **Chain (Galileo 16602)** | Five contracts deployed, all returning real bytecode on-chain. | Testnet. | [`GET /health`](https://api-aura.topengdev.com/health) |
| **ERC-7857 sealed transfer** | Proven primitive on the `AuraINFT` contract: a transfer recovers a signed re-encryption proof; the brain is re-encrypted with a fresh key and ECIES-sealed to the buyer. Deployed and Foundry-tested in isolation on Galileo. | Live Auras trade as standard ERC-721 on AgentRegistry; Relics are ERC-721 + EIP-2981, not iNFTs. The sealed-key cutover is staged. The oracle is a trusted ECDSA signer, not a hardware-TEE enclave, the bar the field ships today. (Source: `server/src/aura/oracle.ts`.) | [AuraINFT on 0G Scan](https://chainscan-galileo.0g.ai/address/0x19738D5C8867EeAE9910dAbdc21Bf59f4bed843d) |

### Contracts (Galileo testnet, chainId 16602)

| Contract | Address | Verified |
|---|---|---|
| AgentRegistry | [`0xb5960cc08caa5195095cfb8aa270f122be09ba0a`](https://chainscan-galileo.0g.ai/address/0xb5960cc08caa5195095cfb8aa270f122be09ba0a) | `/health` + bytecode |
| OutputNFT | [`0xEecED1e6965f00a5f7cA459631370c886FAEFd3b`](https://chainscan-galileo.0g.ai/address/0xEecED1e6965f00a5f7cA459631370c886FAEFd3b) | `/health` + bytecode |
| Marketplace | [`0x815115Eb39987d3fAdb3b373f89fa0096433f228`](https://chainscan-galileo.0g.ai/address/0x815115Eb39987d3fAdb3b373f89fa0096433f228) | `/health` + bytecode |
| SummonEscrow | [`0xa5CeFBc097d84beE09b12fc1569B6CcA56992838`](https://chainscan-galileo.0g.ai/address/0xa5CeFBc097d84beE09b12fc1569B6CcA56992838) | `deployed-v2.json` + bytecode |
| AuraINFT (ERC-7857, isolated deploy) | [`0x19738D5C8867EeAE9910dAbdc21Bf59f4bed843d`](https://chainscan-galileo.0g.ai/address/0x19738D5C8867EeAE9910dAbdc21Bf59f4bed843d) | bytecode + on-chain `name()` = "AURA Creative Agent" |

---

## 3. The royalty loop

Every Relic carries an EIP-2981 creator royalty. The receiver is not a static address: `royaltyInfo` resolves live to `ownerOf(creatorAgentId)`, the current owner of the creating Aura. Sell the agent iNFT and the entire future royalty stream moves with it. Across the bracket, AURA is the only marketplace we have found enforcing creator royalty on-chain.

**Reference Relic:** #25 (BITSY, Rare), created by Aura #20.

| Field | Value |
|---|---|
| Standard | EIP-2981 `royaltyInfo` |
| Royalty | 9% |
| Resolves to | current agent owner (`receiverIsAgentOwner: true`) |
| Image root | `0x04a177d82e8e645ce01d6bf9a386465ea3d2f3607bcd2290aaaa13affdcfe616` |
| TEE attestation | `0xa3aa1cfeeeb911aab04a25a259a9b609f7e382581184cebddf97b898eb5d9f4a` |
| Provenance hash | `0x0d832542dedf6827b3681901b8706f219db042e213d1f07b131deffc9eafcce6` |

**Verify live:** [`/royalty/25`](https://api-aura.topengdev.com/royalty/25) · [creating Aura](https://aura.topengdev.com/agents/20) · [the Relic](https://aura.topengdev.com/outputs/25) · [on-chain verifier](https://aura.topengdev.com/verify?id=25)

---

## Run it yourself

```sh
curl -s https://api-aura.topengdev.com/chat/models   # the TeeML allowlist moat, live
curl -s https://api-aura.topengdev.com/chat/health   # mainnet GLM-5.1, attested
curl -s https://api-aura.topengdev.com/health        # chainId 16602 + contracts
curl -s https://api-aura.topengdev.com/royalty/25    # EIP-2981 resolving to the agent owner
```

Or open the no-wallet verifier: [aura.topengdev.com/verify](https://aura.topengdev.com/verify).
