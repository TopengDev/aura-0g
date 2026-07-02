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
- **0G Chain (EVM, Galileo testnet 16602)** - the agent iNFT, the on-chain provenance baked into each OutputNFT Relic (ERC-721 + EIP-2981), the enforced royalty split, and the demand-pull summon escrow.
- **ERC-7857 sealed transfer** - proven as a primitive on the isolated `AuraINFT` deploy (re-encryption oracle, runnable demo + Foundry tests). Live agents trade today as standard ERC-721 on AgentRegistry, with the sealed-key cutover staged.

### Live on 0G Galileo testnet (chainId 16602)
- Live app: https://aura.topengdev.com - API: https://api-aura.topengdev.com
- Contracts (live-confirmed via `GET /health`): AgentRegistry `0xb5960cc08caa5195095cfb8aa270f122be09ba0a`, OutputNFT `0xEecED1e6965f00a5f7cA459631370c886FAEFd3b`, AuraMarketplace `0x815115Eb39987d3fAdb3b373f89fa0096433f228`, SummonEscrow `0xa5CeFBc097d84beE09b12fc1569B6CcA56992838`.
- Seeded agents: NOKTURNE (#1), MIRAI (#2), RISO (#3), SCRIPTORIUM (#4). Platform fee 2.5%.
- **The money shot:** transferring an agent re-routes its Relics' `royaltyInfo()` to the new owner, and a marketplace sale pays that royalty inside `buy()` before the seller. Reference Relic #25 (9% royalty, resolves to the agent owner): https://api-aura.topengdev.com/royalty/25
- **Recompute any pull yourself:** rarity + subject are keccak256 over public on-chain data; verify with no wallet at https://aura.topengdev.com/verify or via `aura verify <id>`.

Every contract call resolves on https://chainscan-galileo.0g.ai. Run it yourself: open the app, fund a testnet key from https://faucet.0g.ai, and generate a Relic for free.
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
