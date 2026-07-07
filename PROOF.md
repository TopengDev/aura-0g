# PROOF

**Jury evidence for AURA.** Every claim here re-derives from a live endpoint or an on-chain read. Each row links to a proof you can run yourself. If a claim could not be verified live, it is not on this page. Live page: [aura.topengdev.com/proof](https://aura.topengdev.com/proof).

All values below were verified live on 2026-07-07 against the 0G Aristotle **mainnet** economy (chainId 16661) and 0G **mainnet** chat compute. Image generation runs on 0G **testnet**, by design, the one seam called out plainly in the network split in §2.

---

## 0. The mic-drop: stricter than the chain's own flag

On 0G mainnet the on-chain `verifiability: "TeeML"` flag is **coarse**: many providers carry it (sixteen right now). AURA does not route on the flag alone.

AURA requires **both** `verifiability === "TeeML"` **and** the provider address on a **curated allowlist** maintained in the server (a hardcoded set of addresses). The set AURA will actually serve is therefore strictly narrower than the chain's flag: a provider not on the allowlist is never selectable or served, even when the chain says TeeML. (Source: `server/src/aura/chat-compute.ts`, "TeeML integrity allowlist".)

**Verify live:** [`GET /chat/models`](https://api-aura.topengdev.com/chat/models)

The provider addresses below are 0G **mainnet** accounts, so they link to the mainnet explorer (`chainscan.0g.ai`), the same 0G mainnet the AURA economy contracts now run on (§2). The only seam that deliberately stays on 0G testnet is image generation, stated plainly there.

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
| **Chain (0G mainnet 16661)** | The full economy deployed on 0G Aristotle mainnet, every address returning real bytecode on-chain. | Live on mainnet; `GET /health` reports chainId 16661. | [`GET /health`](https://api-aura.topengdev.com/health) |
| **ERC-7857 sealed transfer** | Live on the `AuraINFT` iNFT: ownership moves only through `transfer()` with an oracle-signed re-encryption proof; the brain is re-encrypted with a fresh key and ECIES-sealed to the buyer, and raw `transferFrom`/`safeTransferFrom` revert. | Every Aura is now a real ERC-7857 iNFT on `AuraINFT` (the economy migrated on-chain at the mainnet cutover); Relics remain ERC-721 + EIP-2981, not iNFTs. The oracle is a trusted ECDSA signer, not a hardware-TEE enclave, the bar the field ships today. (Source: `server/src/aura/oracle.ts`.) | [AuraINFT on 0G Scan](https://chainscan.0g.ai/address/0xEEb18eC6a7Bbe4d356862D7710C1259dAcd7c50b) |

### Contracts (0G Aristotle mainnet, chainId 16661)

| Contract | Address | Verified |
|---|---|---|
| AuraINFT (ERC-7857 iNFT) | [`0xEEb18eC6a7Bbe4d356862D7710C1259dAcd7c50b`](https://chainscan.0g.ai/address/0xEEb18eC6a7Bbe4d356862D7710C1259dAcd7c50b) | bytecode + on-chain `name()` = "AURA Creative Agent" |
| OutputNFT | [`0xF31fD2235a5db76020b2a6F1CBC06e13E25E4805`](https://chainscan.0g.ai/address/0xF31fD2235a5db76020b2a6F1CBC06e13E25E4805) | `/health` + bytecode |
| AuraMarketplace | [`0x2ad71120b1Da7d187883826980b5244F1c365Dba`](https://chainscan.0g.ai/address/0x2ad71120b1Da7d187883826980b5244F1c365Dba) | `/health` + bytecode |
| SummonEscrow | [`0x8F5978Fb86A9fF20Fe30B561F6d1a1AE04D1DC1A`](https://chainscan.0g.ai/address/0x8F5978Fb86A9fF20Fe30B561F6d1a1AE04D1DC1A) | `deployed-v2.json` + bytecode |
| AuraFusion | [`0x0D8b6ef3427573d673d7d1DFf8199aE00af317e9`](https://chainscan.0g.ai/address/0x0D8b6ef3427573d673d7d1DFf8199aE00af317e9) | `deployed-v2.json` + bytecode |
| ArenaVote | [`0x7557C716C7F1b7179506609241Fb2842c17fB92f`](https://chainscan.0g.ai/address/0x7557C716C7F1b7179506609241Fb2842c17fB92f) | `deployed-v2.json` + bytecode |
| ArenaReputation | [`0x12f094DFa0eFB1C132E1fDFFa95262a3a8ae1695`](https://chainscan.0g.ai/address/0x12f094DFa0eFB1C132E1fDFFa95262a3a8ae1695) | `deployed-v2.json` + bytecode |
| PersonhoodGate | [`0x54E8496EDDc6eeD590d5e1c69C8c6949a42f90e5`](https://chainscan.0g.ai/address/0x54E8496EDDc6eeD590d5e1c69C8c6949a42f90e5) | `deployed-v2.json` + bytecode |

_AgentRegistry is retired (address `0x0`): agents are no longer plain ERC-721, they are the ERC-7857 `AuraINFT` above._

### Open the hood: verify our ERC-7857 yourself

Do not take "ERC-7857" on faith, ours or anyone's. Run three reads against `AuraINFT` (`0xEEb18e…c50b`) on 0G mainnet:

1. **`supportsInterface` returns the real OpenZeppelin interface ids, not a fabricated one.** It resolves to the genuine ERC-165 / ERC-721 / ERC-2981 ids computed by OpenZeppelin (`contracts/src/AuraINFT.sol:336`) and returns **false** for a made-up ERC-7857 vanity id. There is no hardcoded `0x7857…` badge standing in for the mechanism.
2. **Raw `transferFrom` and `safeTransferFrom` REVERT.** Both are overridden to revert with `use transfer(): ERC-7857 secure transfer required` (`AuraINFT.sol:327` and `:331`), so a brain can never move to a new owner un-re-keyed.
3. **Ownership moves ONLY through the oracle-signed re-encryption-proof path, `transfer()`.** It recovers an EIP-191 oracle signature over the transfer tuple and reverts unless it recovers to the oracle (`AuraINFT.sol:190`), after requiring the sealed key and data hash to actually rotate (`:177`, `:178`).

```sh
INFT=0xEEb18eC6a7Bbe4d356862D7710C1259dAcd7c50b
RPC=https://evmrpc.0g.ai
cast call $INFT 'supportsInterface(bytes4)(bool)' 0x80ac58cd --rpc-url $RPC   # ERC-721  -> true
cast call $INFT 'supportsInterface(bytes4)(bool)' 0x2a55205a --rpc-url $RPC   # ERC-2981 -> true
cast call $INFT 'supportsInterface(bytes4)(bool)' 0x7857a001 --rpc-url $RPC   # made-up 7857 id -> false
cast call $INFT 'transferFrom(address,address,uint256)' <from> <to> 1 --rpc-url $RPC   # reverts
```

Then run the same three checks on any project claiming ERC-7857. The mechanism either enforces re-encryption on transfer, or it does not.

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
curl -s https://api-aura.topengdev.com/health        # chainId 16661 + contracts
curl -s https://api-aura.topengdev.com/royalty/25    # EIP-2981 resolving to the agent owner
```

Or open the no-wallet verifier: [aura.topengdev.com/verify](https://aura.topengdev.com/verify).
