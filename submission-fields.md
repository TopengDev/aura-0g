# 0G Zero Cup - submission field values (ready to paste)

**Where these go:** the 0G Arena project form (the **My project** / Create-project form), then the **Submit** tab.
**Account / team:** chill_dawg (0G Arena) - Team: Aedifex (solo, owner). The AURA brand lives in the project TITLE.
**Status:** the app is live and the repo is public, so REPO URL and DEMO URL are fillable now.

> These values reflect the **live v2 product** (aura.topengdev.com). Every claim maps to a live endpoint or an on-chain read; see [PROOF.md](PROOF.md).

---

## Required fields

### TITLE*
```
AURA - Verifiable Creative-Agent Marketplace on 0G
```
(If the form wants it shorter: `AURA: Verifiable Creative-Agent Marketplace`)

### SUMMARY*  (one or two lines)
```
Creative agents are on-chain iNFTs that generate TEE-verified art on 0G Compute, so every Relic carries hardware-attested provenance and an EIP-2981 creator royalty that follows the agent to its current owner on every sale through the marketplace. Live on 0G: talk to an agent, summon one to create, and recompute any gacha pull yourself from public on-chain data.
```

### REPO URL*
```
https://github.com/TopengDev/aura-0g
```

---

## Optional fields

### DESCRIPTION  (Markdown, shown on the project page - paste as-is)
```markdown
**AURA makes AI-art provenance provable and creator royalties enforceable in-platform - and it is only possible on 0G.**

A creative **agent** is an **iNFT** (ERC-7857 sense): a public on-chain identity, a private style "brain" sealed encrypted on 0G Storage (only a root hash on chain), and a persistent owner-private memory. When the agent makes art, it generates on **0G Compute inside a TEE**, so every Relic carries **hardware-attested provenance** (which agent, which model, proven in hardware). Because authorship is provable on-chain, the agent's owner earns an **EIP-2981 creator royalty**; on sales **through the AURA marketplace and summon settlement** that royalty is paid on-chain before the seller and resolves to whoever owns the agent now. Sell the agent and its future royalty stream goes with it.

### Why only on 0G
On a normal NFT marketplace, "who made this" is just what the uploader typed, and EIP-2981 royalties are an opt-in suggestion most platforms ignore off-venue. The missing piece is **verifiable compute** next to **permanent storage** and an **EVM chain** that resolves royalty dynamically to the agent's current owner. 0G is the only stack where all three are native.

### The 0G primitives are load-bearing
- **0G Compute (TEE)** - chat runs on 0G **mainnet** GLM-5.1 (`zai-org/GLM-5.1-FP8`); image generation runs on 0G **testnet** (`qwen-image-edit-2511`). A hardware attestation is returned per reply / per generation, and a generation that fails attestation is never made mintable.
- **0G Storage** - the artwork, the signed provenance record, and the agent's encrypted brain (each upload's merkle root verified equal to the on-chain root).
- **0G Chain (EVM, 0G Aristotle mainnet 16661)** - the agent iNFT, the on-chain provenance baked into each OutputNFT Relic (ERC-721 + EIP-2981), the enforced royalty split, and the demand-pull summon escrow.
- **ERC-7857 sealed transfer** - live on the `AuraINFT` iNFT (re-encryption oracle, replay + expiry guards): every Aura is minted on it, raw ERC-721 transfers revert, and ownership moves only through the oracle-proof `transfer()`. The oracle is a trusted ECDSA signer, not a hardware-TEE enclave.

### Live on 0G Aristotle mainnet (chainId 16661)
- Live app: https://aura.topengdev.com - API: https://api-aura.topengdev.com
- Contracts (live-confirmed via `GET /health`): AuraINFT `0xEEb18eC6a7Bbe4d356862D7710C1259dAcd7c50b`, OutputNFT `0xF31fD2235a5db76020b2a6F1CBC06e13E25E4805`, AuraMarketplace `0x2ad71120b1Da7d187883826980b5244F1c365Dba`, SummonEscrow `0x8F5978Fb86A9fF20Fe30B561F6d1a1AE04D1DC1A`. Full economy incl. the arena/fusion game layer in `contracts/deployed-v2.json`.
- Seeded agents: NOKTURNE (#1), MIRAI (#2), RISO (#3), SCRIPTORIUM (#4). Platform fee 2.5%.
- **The money shot:** transferring an agent re-routes its Relics' `royaltyInfo()` to the new owner, and a marketplace sale pays that royalty inside `buy()` before the seller. Reference Relic #25 (9% royalty, resolves to the agent owner): https://api-aura.topengdev.com/royalty/25
- **Recompute any pull yourself:** rarity + subject are keccak256 over public on-chain data; verify with no wallet at https://aura.topengdev.com/verify or via `aura verify <id>`.

Every contract call resolves on https://chainscan.0g.ai. Run it yourself: open the app and generate a Relic for free (generation is server-sponsored). The image-gen + 0G Storage seam runs on 0G testnet, which you can top up at https://faucet.0g.ai.
```

### TAGS  (comma-separated, max 10)
```
0g, inft, erc-7857, tee, verifiable-compute, ai-agents, nft-royalties, eip-2981, creative-ai, marketplace
```

### LICENSE
```
MIT
```

### DEMO URL
```
https://aura.topengdev.com
```

### VIDEO URL  (optional - fill after recording)
```
<paste the demo video link here - Toper records + uploads; YouTube/Loom unlisted is fine>
```

### LOGO URL  (optional, square)
After choosing a square asset (e.g. the genesis hero at 1024x1024), host it and paste the URL here.

### THUMBNAIL URL  (optional, cover/voting gallery)
A collection montage or hero cover; host it and paste the URL here.

---

## Eligibility self-check
- **0G does real work:** remove any one of Compute / Storage / Chain and the loop breaks - not a bolt-on.
- **Repo public + must stay public** through the tournament (taking it private mid-tournament is a disqualifier).
- **Demo matches the code:** the live app and every on-chain value are real and recomputable; nothing in the pitch is faked.
