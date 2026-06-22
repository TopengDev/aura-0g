# AURA - a verifiable creative-agent marketplace, on 0G

**One end-to-end loop, executed for real on the 0G Galileo testnet.** No mocks, no
testnet-but-pretend: every step below is a live `0G Compute` call, a real `0G Storage`
upload, or a confirmed `0G Chain` transaction. All hashes resolve on the explorer.

> Run it yourself: `pnpm install` → put a funded testnet key in `.env` → `pnpm demo`.
> The script is [`demo/run-aura.ts`](./run-aura.ts); the machine-readable proof of the
> run that already happened is [`demo/proof.json`](./proof.json).

---

## The thesis

A **creative agent** is an **iNFT** (ERC-7857-style). It carries a public identity, a
private **style-DNA "brain" sealed (encrypted) on 0G Storage**, and the **TEE attestation**
of the model it runs on. When that agent makes art, it generates on **0G Compute inside a
TEE**, so every output carries **unforgeable provenance** - *which agent, which model,
proven in hardware.* Because authorship is provable on-chain, the agent's owner earns an
**enforced, transferable royalty on every output sale, forever.** Sell the agent and its
entire future royalty stream goes with it.

This is only possible because **all four 0G primitives are load-bearing**:

| Primitive | Role in AURA |
|---|---|
| **0G Compute** | TEE-verified image generation (`qwen/qwen-image-edit-2511`, TeeML/dstack) - the unforgeable *who made it* |
| **0G Storage** | the artwork, the provenance record, **and** the agent's encrypted brain |
| **0G Chain** | the iNFT, the on-chain provenance, and the enforced royalty split |
| **iNFT (ERC-7857-style)** | the agent itself - its ownership is what every royalty routes to |

Take away 0G's TEE compute and the provenance is spoofable; on a normal NFT marketplace
the royalty is a polite suggestion. AURA makes both **provable** and **enforced**.

---

## The loop (what `pnpm demo` does, live)

```
register agent (iNFT)  →  generate on 0G Compute (TEE)  →  store on 0G Storage
   →  mint OutputNFT (provenance + storage root + attestation baked in)
   →  list + sell on the Marketplace  →  enforced royalty routes to the agent's
      CURRENT owner  →  drop a real PFP collection (1 character, N trait variations)
```

The script is **phased, idempotent, and resumable** - it journals every step to
`demo/proof.json`, skips work already proven, and never double-mints or double-spends.
(That resumability is real: this very run was killed mid-collection and resumed from its
journal with zero rework - see the `RESUME` markers in [`run.log`](./run.log).)

```
pnpm demo                 # full loop; resumes from demo/proof.json
pnpm demo --regen         # ignore the journal, run every phase fresh on-chain
pnpm demo --only=royalty  # run one phase: agent | hero | royalty | collection
```

---

## What actually happened on-chain (this run)

**Network:** 0G Galileo testnet · chainId **16602** · explorer https://chainscan-galileo.0g.ai
**28 transactions**, total spend ≈ **0.096 0G**.

**Contracts (deployed + on-chain verified):**

| Contract | Address |
|---|---|
| AgentRegistry (iNFT) | [`0xEf948192…34bC`](https://chainscan-galileo.0g.ai/address/0xEf948192c22957Eaa24a08782163b30037bA34bC) |
| OutputNFT (ERC-721 + EIP-2981) | [`0xC55A80Dd…33ccb`](https://chainscan-galileo.0g.ai/address/0xC55A80DdA3baC1704311B89DfB44A60c19e33ccb) |
| Marketplace (enforced royalty) | [`0x4484071f…7a8c`](https://chainscan-galileo.0g.ai/address/0x4484071f199f16259d4a4F4b41DBa1359D5f7a8c) |

### 1 - Agent iNFT "RISO" (agentId #2)
- Encrypted style-DNA brain sealed on 0G Storage → root `0x47b95fdf…afcd`
- Model attestation `0xe97eddfb…5091` (keccak of model | TEE signer | verifiability)
- Mint tx [`0x61ad27bf…f4fe`](https://chainscan-galileo.0g.ai/tx/0x61ad27bf062c96cd725c45d1958060e32709c02a2e7b7a921bfad85d7cc1f4fe) · read-back: style fingerprint matches ✓

### 2 - Genesis hero: generate (TEE) → store → mint (OutputNFT #3)
- **0G Compute, TEE-verified:** `processResponse = true` · signer `0x2A94D671…2e69` · chatId `1ad2b2df…` · 42.7 s · 1.99 MB → [`demo/hero.png`](./hero.png)
- Stored on 0G Storage: image root `0x4b37e41b…76b0`, provenance root `0x894df9a7…757e` (local merkle == on-chain root ✓)
- Mint tx [`0x988939e7…ea15`](https://chainscan-galileo.0g.ai/tx/0x988939e7b932ba2ad3322e608b1513a6d4f24624f790dd8b71a79e13a810ea15) · read-back: `imageRootMatches=true`, `provenanceHashMatches=true`

### 3 - The economic proof: enforced royalty that follows the agent (OutputNFT #4)
The money shot, all live, with **four distinct addresses** so nothing is ambiguous:

1. Royalty before the agent moves → routes to **main** (the current agent owner).
2. **Transfer the agent iNFT** main → a new owner ([tx `0xdb2f5634…3385b`](https://chainscan-galileo.0g.ai/tx/0xdb2f56342376cfce1c976658bf0ca4047b6fbd394bfb27b1d98e91f77bb3385b)). The *same artwork's* `royaltyInfo()` now resolves to the **new** owner - **the royalty stream followed the agent.**
3. Seller lists #4 @ 0.02 0G → buyer buys it ([SOLD tx `0x5fabf5f4…2808`](https://chainscan-galileo.0g.ai/tx/0x5fabf5f4ef510a434015995f6e0cd0989564b942e3d10b85c8a7b0b887c12808)).

Enforced split, straight from the on-chain `Sold` event - and independently confirmed by measured balance deltas:

| Recipient | Amount | Role |
|---|---:|---|
| **agent's current owner** | **0.0014 0G** | royalty (7%) - *measured delta == event `royaltyPaid` ✓* |
| platform | 0.0005 0G | fee (2.5%) |
| seller | 0.0181 0G | proceeds |
| buyer | −0.0205 0G | price + gas |

The royalty is paid **inside `buy()`, before the seller is paid and before the NFT
transfers** - so in-platform it is unbypassable. On-chain, OutputNFT #4 is now owned by
the buyer; the agent was returned to main.

### 4 - A real PFP collection drop (OutputNFTs #5-#11)
One signature character - **Fennic**, the risograph fennec fox - minted as the canonical
piece plus **6 trait variations**, each generated TEE-verified on 0G Compute, each stored
on 0G Storage and minted on-chain as an OutputNFT of agent #2:

| # | trait | mint tx |
|---|---|---|
| 5 | canonical | [`0x59a276f5…1a0f`](https://chainscan-galileo.0g.ai/tx/0x59a276f5081c7f8fa26df8cacf8b986d28052fb07721ddd96ed22de7cb961a0f) |
| 6 | pirate | [`0xab163664…a821`](https://chainscan-galileo.0g.ai/tx/0xab1636644821e0d53b3c3224944fd1b3b5ac0577025dedd1518f15020225a821) |
| 7 | astronaut | [`0x81c40476…7302`](https://chainscan-galileo.0g.ai/tx/0x81c40476fa47a59e6f78d11ddc7b0d07c858ebbef2ccb9ff5a1a8b2578c17302) |
| 8 | wizard | [`0x902ca315…646e`](https://chainscan-galileo.0g.ai/tx/0x902ca31500319468e3e371c2391178c8ee1e50566430fcf96d7c18dab0d7646e) |
| 9 | punk | [`0x14f29e40…eeb1`](https://chainscan-galileo.0g.ai/tx/0x14f29e40899de2d3a15afcf704e4b7e6ae2eb1597fac6406da5a4acc9dc7eeb1) |
| 10 | king | [`0x8e4ce1ae…af44`](https://chainscan-galileo.0g.ai/tx/0x8e4ce1ae6c36d42f712bd6428031661d469d4ecf7ef39e11e3484893c43aaf44) |
| 11 | samurai | [`0x89f710d1…1fd5`](https://chainscan-galileo.0g.ai/tx/0x89f710d17bbbd53ed3590303212b65b5ead015cf9f039c5b321165b1ef2d1fd5) |

Contact sheet (labelled with on-chain token IDs): [`demo/collection-montage.png`](./collection-montage.png).

---

## Files

| File | What it is |
|---|---|
| [`run-aura.ts`](./run-aura.ts) | the whole loop - the one script a judge reads + the video shows |
| [`proof.json`](./proof.json) | machine-readable proof: every tx hash + explorer URL, storage roots, the royalty split, TEE attestation refs, contract addresses, all token IDs |
| [`run.log`](./run.log) | tee'd log of the real run (incl. a genuine kill→resume) |
| [`run-highlights.log`](./run-highlights.log) | the same run, key lines only (clean trace for the video) |
| [`hero.png`](./hero.png) | the genesis hero, generated live on 0G Compute this run |
| [`collection-montage.png`](./collection-montage.png) | the 7-piece PFP drop, one cohesive character |

---

## Honest scope (what's MVP, flagged for judges)

- **iNFT secure transfer:** AURA mints the agent iNFT with its public identity + an
  *encrypted* brain pointer on 0G Storage + model attestation, and transfers it with
  standard ERC-721. The full ERC-7857 **TEE re-encryption oracle** (re-seals the brain to
  the new owner's key on transfer) is documented and out of MVP scope - a clean upgrade,
  not a rewrite. The royalty routing (the thesis) needs only ownership, which is fully real.
- **Royalty enforcement** is unbypassable **for sales through this Marketplace** (the
  honest boundary of any on-chain royalty today). EIP-2981 also advertises it to any
  compliant venue.
- **The image model is edit-only** (`qwen-image-edit-2511`): generation is conditioned on
  a base image, which is exactly what locks character identity across the collection.
- **Testnet only**, chainId **16602** (the live RPC is authoritative - docs say 16601).
