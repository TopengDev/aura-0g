# 0G Zero Cup - submission field values (ready to paste)

**Where these go:** `https://0g.ai/arena/h/zero-cup/project` (the **My project** / Create-project form), then **Submit** tab → submit the created project to the open Group-Stage wave.
**Account:** `topengdev@outlook.com` (@chill_dawg) · **Team:** Aedifex (solo, owner). The AURA brand lives in the project TITLE; the team name does not need to change.
**Deadline:** Group Stage = **JUN 23, 2026** (no clock time / timezone surfaced on the platform). **Submit with margin.**

> ⚠️ Both outward actions are GATED and NOT done by the worker: the public repo push (see `PUSH-PLAN.md`) and this platform submission. Fill REPO URL + VIDEO URL after those, then submit.

---

## Required fields

### TITLE*
```
AURA - Verifiable Creative-Agent Marketplace on 0G
```
(If the form rejects long dashes or wants it shorter: `AURA: Verifiable Creative-Agent Marketplace`)

### SUMMARY*  (keep it one or two lines)
```
Creative agents are iNFTs that generate TEE-verified art on 0G Compute, giving every output unforgeable provenance and an enforced, transferable royalty that follows the agent on every sale. One end-to-end loop, proven live on 0G with 28 real on-chain transactions.
```

### REPO URL*
```
https://github.com/TopengDev/aura-0g
```
**(fill in AFTER the gated push in `PUSH-PLAN.md`. Until then this URL 404s.)**

---

## Optional fields

### DESCRIPTION  (Markdown, shown on the project page - paste as-is)
```markdown
**AURA makes AI-art provenance provable and creator royalties enforceable - and it is only possible on 0G.**

A creative **agent** is an **iNFT** (ERC-7857-style): a public identity, a private style-DNA "brain" sealed encrypted on 0G Storage, and the TEE attestation of the model it runs on. When the agent makes art, it generates on **0G Compute inside a TEE**, so every output carries **unforgeable provenance** (which agent, which model, proven in hardware). Because authorship is provable on-chain, the agent's owner earns an **enforced, transferable royalty on every output sale, forever**. Sell the agent and its entire future royalty stream goes with it.

### Why only on 0G
On a normal NFT marketplace, "who made this" is just what the uploader typed, and EIP-2981 royalties are an opt-in suggestion most platforms ignore. The missing piece everywhere is **verifiable compute** next to **permanent storage** and an **EVM chain** that resolves royalty dynamically to the agent's current owner. 0G is the only stack where all three are native.

### All four 0G primitives are load-bearing
- **0G Compute** - TEE-verified image generation (`qwen/qwen-image-edit-2511`, TeeML/dstack). `processResponse()` returns a hardware-signed pass.
- **0G Storage** - the artwork, the signed provenance record, and the agent's encrypted brain (every upload's merkle root verified equal to the on-chain root).
- **0G Chain (EVM)** - the iNFT, the on-chain provenance baked into each OutputNFT, and the enforced royalty split.
- **iNFT (ERC-7857-style)** - the agent itself is a transferable token; royalty resolves to `ownerOf(creatorAgentId)`.

### Proven live (0G Galileo testnet, chainId 16602, 28 real transactions)
- Contracts: AgentRegistry `0xEf948192c22957Eaa24a08782163b30037bA34bC`, OutputNFT `0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb`, Marketplace `0x4484071f199f16259d4a4F4b41DBa1359D5f7a8c`.
- Agent "RISO" minted as iNFT #2; genesis hero generated TEE-verified, stored, and minted as OutputNFT #3 (image root + provenance hash + TEE attestation read back on-chain, all matching).
- **The money shot:** transferring the agent re-routes the same artwork's `royaltyInfo()` to the new owner, then a sale pays the royalty inside `buy()` before the seller (0.02 0G sale → 0.0014 0G royalty to the agent's current owner, measured delta == on-chain `Sold` event).
- A real PFP collection: 7 OutputNFTs (#5-#11), one Fennic-fox character + 6 trait variations, each TEE-verified and on-chain.

Every transaction resolves on https://chainscan-galileo.0g.ai. Run it yourself: `pnpm install` → fund a testnet key → `pnpm demo`.
```

### TAGS  (comma-separated, max 10)
```
0g, inft, erc-7857, tee, verifiable-compute, ai-agents, nft-royalties, eip-2981, creative-ai, marketplace
```

### LICENSE
```
MIT
```

### DEMO URL  (optional - leave BLANK)
No live dapp this round (recon confirmed a live build is NOT required; the demo video is the accepted "prove it runs" path). Leave empty.

### VIDEO URL  (optional - fill after recording)
```
<paste the demo video link here - see demo/VIDEO-SCRIPT.md; Toper records + uploads (YouTube/Loom unlisted is fine)>
```

### LOGO URL  (optional, square)
Suggested: the genesis hero (1024×1024, square). After the repo is public:
```
https://raw.githubusercontent.com/TopengDev/aura-0g/main/demo/hero.png
```

### THUMBNAIL URL  (optional, cover/voting gallery)
Suggested: the collection montage. After the repo is public:
```
https://raw.githubusercontent.com/TopengDev/aura-0g/main/demo/collection-montage.png
```
(Note: GitHub raw is fine for the form; if the platform needs a hosted CDN, re-host the same two PNGs.)

---

## Eligibility self-check (per recon `findings.md`)
- ✅ **Own work, in-window:** all repo commits are dated Jun 21-22, 2026 (tournament window is Jun 15 onward). Not a pre-existing product, not a thin fork.
- ✅ **0G does real work:** remove any one of Compute / Storage / Chain and the loop breaks - not a bolt-on.
- ✅ **Repo public + must stay public** through the tournament (taking it private mid-tournament is a disqualifier).
- ✅ **Demo matches the code:** the video script is built only from real run output and on-chain txs (faking is a disqualifier).
- ⚠️ **Confirm the Jun 23 cutoff hour/TZ** via 0G Discord; submit early.

## Final submit sequence (after both gates)
1. (GATE 1) Push the repo public → `PUSH-PLAN.md`. Fill REPO URL above.
2. Toper records the demo video → fill VIDEO URL above.
3. (GATE 2) On `0g.ai/arena/h/zero-cup/project`: paste TITLE / SUMMARY / REPO URL / DESCRIPTION / TAGS / LICENSE (+ LOGO/THUMBNAIL/VIDEO) → **Create project**.
4. Go to the **Submit** tab → submit the project to the open Group-Stage wave. Verify it shows as submitted.
```
