# PROOF

**Jury evidence for AURA.** Every claim here re-derives from a live endpoint or an on-chain read. Each row links to a proof you can run yourself. If a claim could not be verified live, it is not on this page. Live page: [aura.topengdev.com/proof](https://aura.topengdev.com/proof).

All values below were verified live on 2026-07-01 against the 0G Galileo testnet (chainId 16602) and 0G mainnet compute.

---

## 0. The mic-drop: we verify deeper than the chain does

On 0G mainnet the on-chain `verifiability: "TeeML"` flag is **over-inclusive**. It is set not only on providers that run the model inside a TEE, but also on TeeTLS relay-proxies that merely forward the request to an external cloud over an attested TLS tunnel. Those proxies are not in-enclave inference, yet they still carry `TeeML`. So `TeeML` alone does not prove in-enclave execution on mainnet.

AURA requires **both** `verifiability === "TeeML"` **and** the provider address on an allowlist of services we individually verified run genuine in-enclave inference. A provider that fails the second test is never selectable or served, even when the chain says TeeML. (Source: `server/src/aura/chat-compute.ts`, "TeeML integrity allowlist (THE MOAT)".)

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

Sixteen providers carry `TeeML` on mainnet right now. AURA serves three. The DeepSeek rows are the sharp case: they are online and TEE-flagged this minute, and AURA still refuses to route to them because they are relay-proxies, not enclaves.

> AURA catches 0G's own verifiability flag mislabeling a proxy as in-enclave.

---

## 1. Mainnet frontier chat, attested per reply

Auras chat on 0G **mainnet** GLM-5.1 (served as GLM-5.1-FP8), and each reply carries its own TEE attestation. A deterministic fallback is configured, and when it serves a reply the UI labels it as not attested.

**Verify live:** [`GET /chat/health`](https://api-aura.topengdev.com/chat/health)

```json
{ "zerogHealthy": true, "zerogModel": "zai-org/GLM-5.1-FP8", "zerogNetwork": "mainnet", "fallbackConfigured": true, "preferred": "zerog" }
```

---

## 2. The four 0G primitives

| Primitive | How AURA uses it | Honest bound | Live proof |
|---|---|---|---|
| **Compute (TEE)** | Chat + image generation run in a 0G Compute TEE, mainnet GLM-5.1, attested per reply. Relic attestation committed on-chain at mint. | Per-reply hardware attestation, not a blanket trustless-AI claim. | [`/chat/health`](https://api-aura.topengdev.com/chat/health), [Relic #25](https://aura.topengdev.com/outputs/25) |
| **Storage (0G)** | Every Relic image and sealed agent-brain is a 0G Storage content root, committed on-chain and finalized on 0G Storage. | Testnet 0G Storage evicts blobs within ~an hour, so v1 serves from a durable content-addressed cache keyed by the same 0G root. Full 0G persistence is a mainnet property. (Source: `server/src/routes/image.ts`.) | [0G Storage: finalized](https://indexer-storage-testnet-turbo.0g.ai/file/info/0x04a177d82e8e645ce01d6bf9a386465ea3d2f3607bcd2290aaaa13affdcfe616) |
| **Chain (Galileo 16602)** | Five contracts deployed, all returning real bytecode on-chain. | Testnet. | [`GET /health`](https://api-aura.topengdev.com/health) |
| **iNFT (ERC-7857)** | On transfer, AuraINFT recovers a signed re-encryption proof; the brain is re-encrypted with a fresh key and ECIES-sealed to the buyer. | Trusted ECDSA signer, not a hardware-TEE enclave. Mirrors mainnet ZeroArena's re-encryption oracle, the bar the field ships today. (Source: `server/src/aura/oracle.ts`.) | [AuraINFT on 0G Scan](https://chainscan-galileo.0g.ai/address/0x19738D5C8867EeAE9910dAbdc21Bf59f4bed843d) |

### Contracts (Galileo testnet, chainId 16602)

| Contract | Address | Verified |
|---|---|---|
| AgentRegistry | [`0xb5960cc08caa5195095cfb8aa270f122be09ba0a`](https://chainscan-galileo.0g.ai/address/0xb5960cc08caa5195095cfb8aa270f122be09ba0a) | `/health` + bytecode |
| OutputNFT | [`0xEecED1e6965f00a5f7cA459631370c886FAEFd3b`](https://chainscan-galileo.0g.ai/address/0xEecED1e6965f00a5f7cA459631370c886FAEFd3b) | `/health` + bytecode |
| Marketplace | [`0x815115Eb39987d3fAdb3b373f89fa0096433f228`](https://chainscan-galileo.0g.ai/address/0x815115Eb39987d3fAdb3b373f89fa0096433f228) | `/health` + bytecode |
| SummonEscrow | [`0xa5CeFBc097d84beE09b12fc1569B6CcA56992838`](https://chainscan-galileo.0g.ai/address/0xa5CeFBc097d84beE09b12fc1569B6CcA56992838) | `deployed-v2.json` + bytecode |
| AuraINFT (ERC-7857) | [`0x19738D5C8867EeAE9910dAbdc21Bf59f4bed843d`](https://chainscan-galileo.0g.ai/address/0x19738D5C8867EeAE9910dAbdc21Bf59f4bed843d) | bytecode + on-chain `name()` = "AURA Creative Agent" |

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
