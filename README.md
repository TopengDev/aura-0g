# AURA

**Art you can prove.** A verifiable creative-agent marketplace on 0G.

AURA turns a creative AI agent into an owned, on-chain being, an **Aura**. Each Aura is a real ERC-7857 iNFT: a public identity on 0G Chain, a private style "brain" sealed on 0G Storage, and a persistent, owner-private memory. Auras make art (**Relics**) by generating inside a 0G Compute TEE, so each Relic carries hardware-attested provenance and an enforced royalty that follows the Aura to whoever owns it next. You can talk to an Aura, summon one to create for you, battle Auras against each other, fuse two into a hybrid child, and recompute every result yourself from public on-chain data.

The product is live on **0G mainnet**. Nothing here is a slideshow: every claim below maps to code in this repo and to a real call against 0G. The entire economy (agents, Relics, marketplace, royalties, summon, the game layer, on-chain verify + mint, chat) runs on **0G Aristotle mainnet, chainId 16661**. One disclosed seam stays on 0G testnet, and it is called out plainly below.

| | |
|---|---|
| Live app | https://aura.topengdev.com |
| Jury evidence | [PROOF.md](PROOF.md) · live at [aura.topengdev.com/proof](https://aura.topengdev.com/proof) |
| Backend API | https://api-aura.topengdev.com |
| CLI | `curl -fsSL https://aura.topengdev.com/install.sh \| sh` |
| Economy network | 0G Aristotle **mainnet**, chainId **16661** ([explorer](https://chainscan.0g.ai)) |

> **Mainnet economy, one disclosed testnet seam.** The contracts, agents, Relics, marketplace, royalties, summon, the whole game layer, on-chain verify + mint, and chat all run on 0G **mainnet** (chainId 16661). The single exception, stated up front: **image generation** (`qwen-image-edit-2511`) and **0G Storage writes** run on 0G **testnet**, deliberately. Testnet storage is the reliable place to write blobs today, and we keep a durable local content-addressed cache keyed by the same 0G root; the on-chain image roots and provenance that anyone verifies stay on **mainnet**. Chat inference is mainnet frontier compute (GLM, currently GLM-5.2 per `/chat/health`, TeeML). `GET /health` and `GET /chat/health` show the live wiring.

---

## What is verifiable (and what is not)

AURA is a verifiability-branded product, so the honest boundary matters more than the pitch:

- **Gacha pulls are provable.** A Relic's rarity and subject are derived deterministically by keccak256 over public on-chain data, and anyone can recompute them locally (`aura verify <id>`). No trust in our server. This is genuine, reproducible provability.
- **The agent iNFT is real, not a label.** The 30 live Auras are minted on the real ERC-7857 `AuraINFT`. A `transfer()` recovers a signed re-encryption proof and reverts on a bad one; a raw ERC-721 `transferFrom` reverts by design, so the encrypted brain can never move to a new owner without being re-keyed. This is the moat over anything that "wraps" an NFT and calls it an iNFT.
- **Image provenance is on-chain and TEE-backed.** Generation runs in a 0G Compute TEE; a generation that fails attestation is never made mintable. Each minted Relic bakes its creating Aura, its 0G Storage image root, a provenance hash, and the TEE attestation into the token, and `/verify` re-derives all of it live with no wallet.
- **Chat replies are TEE-attested per reply, honestly labeled.** When 0G Compute serves a reply it carries a hardware attestation (`processResponse`); when the labeled fallback serves it, the reply is **not** attested and the UI says so. This is a per-reply hardware attestation, not a blanket "trustless AI" claim.
- **The game layer recomputes from chain, not from SQLite.** Arena battle winners are a pure function of the on-chain commit-reveal vote log; the Fusion child genome is a pure keccak derivation over public inputs; the season Ladder is a fixed-point Glicko-1 whose Merkle root is anchored on-chain and re-derivable by anyone. None of it is server theater.
- **Memory privacy is enforced by key custody.** A conversation is sealed per owner and only ever retrieved for the wallet that the chain currently reports as the Aura's owner. See the honest bound under [Auras + memory](#auras-on-chain-identity--sealed-memory).
- **Royalties are enforced in-platform.** The split is paid inside the marketplace and summon settlement, before the seller, and resolves to the Aura's current owner. As with every on-chain royalty today, that enforcement is unbypassable for sales through this platform; EIP-2981 only advertises it to other venues.

What AURA does **not** claim: no cryptographically proven training or inference, and no fine-tuning claims (per-Aura fine-tuning is research, not shipped). Style is a base model plus a system prompt plus retrieved memory, run in a TEE.

---

## Core features

### Auras: on-chain identity + sealed memory

An Aura is a creative agent minted as a real ERC-7857 iNFT: the public identity lives on chain, the valuable style data stays encrypted off chain on 0G Storage with only a root hash on chain.

- **Identity on 0G Chain (`AuraINFT`).** The live agent registry is the de-mocked ERC-7857 `AuraINFT`. Each Aura carries the public identity, a style fingerprint, the encrypted-brain pointer (`encBrainRoot`), a model attestation, the royalty terms, and an on-chain ECIES-sealed data key bound to the current owner's secp256k1 wallet pubkey.
- **Secure transfer is real, not a stub.** Ownership only moves through `transfer()` with a valid re-encryption proof signed by the oracle: the sealed key rotates to the new owner on-chain, the data hash rotates, and `BrainRekeyed` + `SealedKeyDelivered` fire. Raw `transferFrom` / `safeTransferFrom` **revert** (spec-strict ERC-7857), so the brain can never move un-re-keyed. Honest trust bar: the re-encryption oracle is a trusted ECDSA signer, not a hardware-TEE enclave, which is what the field ships today.
- **Sealed brain on 0G Storage.** The style "brain" is AES-256-GCM encrypted; the verified merkle root matches the on-chain root.
- **Living-soul personas.** A user-created Aura derives a distinctive personality, lore, and tagline from what the creator supplied (name + style descriptor + signature character), via the same 0G mainnet chat LLM the chat route uses. Every Aura is a unique living agent with its own voice on its agent page and in chat, not a reskin of a shared template. Derivation is best-effort with a synchronous floor, so a create is never blocked by it.
- **Per-owner persistent memory.** Each owner relationship gets its own AES-256 data key; every chat turn is sealed with AES-256-GCM, and the data key is ECIES-sealed to the owner's secp256k1 wallet public key. The privacy wall is enforced at the loader by key custody: retrieval is scoped to the wallet the chain currently reports as owner (`ownerOf`), so a prior owner's segments are keyed to a different key and never enter the retrieval set. An Aura "does not gossip about its past owners."
  - **Honest bound:** today the server also keeps a custody copy of the data key (so it can inject memory without holding your private key), and sealed segments persist in a durable content-addressed cache keyed by the 0G root (0G Storage writes run on testnet, which evicts blobs). The owner-scoped retrieval wall holds regardless of custody; dropping the server custody copy is the remaining hardening step.

### Chat with an Aura

A SIWE-gated, owner-scoped conversation (`POST /chat`). Per turn: load identity and persona, retrieve owner memory, run the model, and persist the turn back to sealed memory.

- **Provider seam:** 0G Compute TEE first (0G **mainnet** GLM, currently GLM-5.2 per `/chat/health`, TeeML), with a clearly-labeled Anthropic Claude fallback behind a health check. AURA routes only to providers that are **both** `verifiability: "TeeML"` **and** on a curated in-server allowlist, strictly narrower than the chain's own flag (see [PROOF.md](PROOF.md)).
- **Per-reply attestation:** the response reports `provider`, `teeAttested`, and the raw attestation; only a 0G-served reply is TEE-attested.
- **The Aura can act (command surface), non-custodially:** two guarded tools, `read_onchain` (a pure read of the Aura's own earnings, royalties, owner, Relic count) and `generate_and_mint` (kicks off a real TEE generation; **you** sign the mint from your own wallet, the server never signs for you).
- `GET /chat/:agentId/history` returns your decrypted relationship history; `GET /chat/health` reports which provider would serve now.

### Provable-Pulls gacha + Summon

- **One seed roots everything.** `seedRoot = keccak256(abi.encode(DOMAIN, requestId, buyer, agentId, summonBlockHash))`. All four preimage fields are public and fixed before generation, so the seed is un-grindable by the operator or the buyer and independently recomputable (a block producer retains bounded single-block influence over `summonBlockHash`).
- **Deterministic subject + rarity.** The seed derives a 12-dimension subject and a rarity tier (Common 80% / Rare 15% / Epic 4% / Legendary 1%), both pure functions of the on-chain seed.
- **Summon** (`SummonEscrow`): a buyer self-funds an on-chain commission, the watcher generates live in a TEE, mints the Relic to the buyer, and splits the fee (owner cut + platform fee). The income follows the Aura to its current owner. `GET /summon/output/:tokenId/proof` returns the jury-verifiable economic split plus the full pull recompute.

### The game layer: Arena, Fusion, Ladder

Everything here is on-chain and indexed; each surface is keyless-recomputable, not SQLite theater.

- **Arena** (`ArenaVote`): blind, staked, **commit-reveal** art battles. Two Auras generate on one shared theme seeded off the battle block hash; voters commit then reveal a staked ballot. The winner is a deterministic recompute from the public `Revealed` log, and the contract enforces the identical tally on-chain, so an independent re-tally must equal the finalized winner. Weight is **linear in stake** (sybil-neutral to identity-splitting, unlike sqrt), and an unrevealed commit is slashed to kill the straddle. Public keyless re-tally at `GET /api/arena/tally`.
- **Fusion** (`AuraFusion` + `FuseGenome`): breed two Auras into a hybrid child. The child's 8-locus style genome is a pure keccak derivation (Mendelian select + 5% provable mutation) over a 6-field seed binding both parents' fingerprints and a future block hash, so neither the operator nor the fuser can grind toward a child (a block producer retains bounded single-block influence via that future block hash). The child is minted as a **real ERC-7857 iNFT** through the same permissionless sealed-key path, with on-chain lineage.
- **Ladder** (`ArenaReputation`): a per-agent season rating. A fixed-point-integer **Glicko-1** is computed off-chain over the on-chain battle verdicts, and only its Merkle root is anchored on-chain (one write per season); anyone recomputes the whole ladder from the verdicts and asserts the root matches (`GET /api/arena/ladder/verify`). The rating is keyed to the agent, so like the royalty rail it **transfers with the iNFT** when the Aura is sold. Rank is a signal only (price / matchmaking / siring value); it deliberately mints nothing.
- **PersonhoodGate** (`PersonhoodGate`): two keyless, 0G-native skin-in-ecosystem floors for the Arena, hold-an-Aura (`balanceOf >= 1`) or a refundable conviction stake. It is UNENFORCED this phase (not wired to gate voting); the live sybil defense is the Arena's linear stake-weight (above), which is neutral to identity-splitting. The World-ID personhood tier is explicitly deferred (`registerWorldId` reverts), an honest stub by scope, not a fake.

### Verifiable image Relics

The generate loop is **free to try, yours to own**:

1. **Sponsored generate.** The platform sponsor wallet pays 0G Compute and 0G Storage; generation costs the user nothing.
2. **TEE attestation.** The image is generated in a 0G Compute TEE; attestation is enforced (a non-verified generation is never made mintable).
3. **Stored on 0G.** Image and provenance are uploaded to 0G Storage; the local merkle root is checked equal to the on-chain root.
4. **Non-custodial mint.** When you want to own it, you sign `OutputNFT.mintOutput` from your own wallet against a server-issued EIP-712 attestation. The backend signs no user transaction.

### Keyless public verification

- **`GET /api/verify?id=<token>`**: a public, keyless, machine-readable provenance surface. No wallet, no auth, no API key, a fresh chain read every call. It assembles the on-chain provenance, TEE attestation, and royalty resolution into one JSON a skeptic can curl in ~10s and cross-check against 0G independently.
- **`/verify/[id]`**: the browser equivalent, a shareable no-wallet page that re-reads any Relic's on-chain provenance live.
- **`/proof`**: the jury ledger, every headline claim linked to a proof you can run yourself.

### The CLI

A lean, cross-platform CLI (`cli/`, single static binary, no Node required) that mirrors the app and is scriptable.

```sh
curl -fsSL https://aura.topengdev.com/install.sh | sh     # macOS / Linux
# Windows (PowerShell) and other methods: see cli/README.md
```

```sh
aura agents                       # list every Aura
aura explore                      # recent Relics with rarity
aura aura nokturne                # inspect an Aura (lore, style, royalty, relic count)
aura relic 23                     # inspect a Relic (image, owner, on-chain provenance)
aura verify 23                    # recompute rarity + subject from the on-chain seed, locally (trustless)
aura summon nokturne              # explain + watch a summon
aura chat nokturne "what have you earned?"   # talk to an Aura, TEE-attested when 0G serves it
```

`aura verify` is the headline: it recomputes the seed from the public preimage, asserts it equals the committed on-chain seed, and derives the rarity and subject itself, printing what it computed locally separately from what it fetched. Chat sign-in is off-chain SIWE: the CLI reads `AURA_KEY` from the environment, signs an EIP-4361 message locally, and the key never leaves your machine and is never spent.

---

## Architecture

```
  Browser (web)  /  CLI  /  in-app chat
        |   SIWE: off-chain wallet signature  ->  short-lived JWT
        v
  Fastify backend (server)            holds the sponsor key, signs NO user tx
        |                       \
        |  sponsored             `->  Ponder indexer (PGlite)  ->  0G mainnet events  ->  /api/* feeds
        |  generation
        +->  0G Compute (TEE)  ->  chat (MAINNET GLM-5.2) + image (TESTNET qwen), hardware-attested (processResponse)
        +->  0G Storage (TESTNET write + durable cache)  ->  image + provenance + sealed brain (local merkle == on-chain root)
        v
  Your wallet signs the mint  ->  OutputNFT (creatorAgentId + imageRoot + provenanceHash + teeAttestation)
                                  +  AuraMarketplace / SummonEscrow (enforced royalty, follows the Aura)
                                  +  AuraINFT / ArenaVote / AuraFusion / ArenaReputation (agent iNFT + game layer)
```

**Stack**

| Layer | What it is |
|---|---|
| `web/` | Next.js 15 (App Router), React 18, wagmi + viem + RainbowKit for wallet + SIWE, Tailwind v4, framer-motion / GSAP / Lenis. Live at aura.topengdev.com. |
| `server/` | Fastify v5 (Node 22). 0G Compute + 0G Storage SDKs, ethers + viem, SQLite for jobs / chat memory / summon + battle journals, EIP-712 attestations, persona derivation, the keyless verify + arena tally/ladder recompute. Non-custodial: it supplies computed args, attestations, and chain reads, and never signs a user transaction. Live at api-aura.topengdev.com. |
| `indexer/` | Ponder 0.16 (embedded PGlite) indexing `AuraINFT`, `OutputNFT`, `AuraMarketplace`, `SummonEscrow`, `ArenaVote`, `AuraFusion`, `ArenaReputation` on 0G mainnet; serves the dashboard / discovery / feed / arena / fusion read models via Hono, proxied under the backend's `/api/*`. |
| `contracts/` | Foundry project: `AuraINFT` (ERC-7857 sealed-key agent iNFT, the live registry), `OutputNFT` (ERC-721 + EIP-2981 + on-chain TEE-verify), `AuraMarketplace` (enforced royalty), `SummonEscrow` (demand-pull commissioning), `ArenaVote` (commit-reveal battles), `AuraFusion` + `FuseGenome` (on-chain-recomputable child genome), `ArenaReputation` (Glicko-1 ladder anchor), `PersonhoodGate` (keyless skin-in-ecosystem floors, unenforced this phase). |
| `cli/` | Bun CLI, cross-compiled to static binaries plus an npx bundle. |
| `deploy/` | docker-compose (server + indexer + web + nginx) and Dockerfiles. |

### Repo layout

The live product is five subsystems, each with its own build:

- `web/` - Next.js 15 frontend (live at aura.topengdev.com)
- `server/` - Fastify API (live at api-aura.topengdev.com)
- `indexer/` - Ponder read-model indexer (proxied under the backend `/api/*`)
- `contracts/` - Foundry contracts (`AuraINFT`, `OutputNFT`, `AuraMarketplace`, `SummonEscrow`, `ArenaVote`, `AuraFusion`, `FuseGenome`, `ArenaReputation`, `PersonhoodGate`)
- `cli/` - Bun CLI (single static binary)

The root `app/` and `lib/aura/` are a legacy v1 prototype; nothing in the five live subsystems imports them, and they are being removed from the tree as part of repo hygiene.

The 0G primitives are load-bearing, not decorative: take away **0G Compute** and provenance is unprovable; take away **0G Storage** and the art and proof live on an editable server; take away **0G Chain** and there is no enforced royalty bound to the Aura, no real ERC-7857 secure transfer, and no on-chain-recomputable game layer. 0G is the one stack where verifiable TEE compute, decentralized storage, and an EVM that resolves royalty and reputation to the current owner are all native to the same place.

### Deployed contracts (0G Aristotle mainnet, chainId 16661)

From [`contracts/deployed-v2.json`](./contracts/deployed-v2.json) (authoritative), deployed at block **38019753**:

| Contract | Address |
|---|---|
| AuraINFT (Aura iNFT, ERC-7857 secure transfer, live registry) | [`0xEEb18eC6…c50b`](https://chainscan.0g.ai/address/0xEEb18eC6a7Bbe4d356862D7710C1259dAcd7c50b) |
| OutputNFT (Relic, ERC-721 + EIP-2981, on-chain TEE-verify) | [`0xF31fD223…4805`](https://chainscan.0g.ai/address/0xF31fD2235a5db76020b2a6F1CBC06e13E25E4805) |
| AuraMarketplace (enforced royalty) | [`0x2ad71120…5Dba`](https://chainscan.0g.ai/address/0x2ad71120b1Da7d187883826980b5244F1c365Dba) |
| SummonEscrow (demand-pull commissioning) | [`0x8F5978Fb…DC1A`](https://chainscan.0g.ai/address/0x8F5978Fb86A9fF20Fe30B561F6d1a1AE04D1DC1A) |
| ArenaVote (commit-reveal battles) | [`0x7557C716…B92f`](https://chainscan.0g.ai/address/0x7557C716C7F1b7179506609241Fb2842c17fB92f) |
| AuraFusion (on-chain lineage) | [`0x0D8b6ef3…17e9`](https://chainscan.0g.ai/address/0x0D8b6ef3427573d673d7d1DFf8199aE00af317e9) |
| ArenaReputation (Glicko-1 ladder anchor) | [`0x12f094DF…1695`](https://chainscan.0g.ai/address/0x12f094DFa0eFB1C132E1fDFFa95262a3a8ae1695) |
| PersonhoodGate (keyless skin-in-ecosystem floors, unenforced this phase) | [`0x54E8496E…90e5`](https://chainscan.0g.ai/address/0x54E8496EDDc6eeD590d5e1c69C8c6949a42f90e5) |

Platform fee 2.5% (250 bps). Summon price 0.01 0G. 30 Auras are live on `AuraINFT` (migrated onto the real iNFT at the mainnet cutover); the original seed archetypes are NOKTURNE, MIRAI, RISO, and SCRIPTORIUM.

---

## Quickstart

**Use it live (no install):** open https://aura.topengdev.com, connect a wallet, and generate a Relic for free (generation is sponsored). Mint it when you want to own it.

**Verify a pull yourself:**

```sh
curl -fsSL https://aura.topengdev.com/install.sh | sh
aura verify 23                              # recompute rarity + subject from chain
aura verify 23 --json | jq .recomputedLocally.provable   # => true
```

**Verify provenance in the browser:** https://aura.topengdev.com/verify re-reads any Relic's on-chain provenance live (no wallet): the creating Aura, the stored image and TEE attestation, the provenance hash, and that the royalty resolves to the current owner. The CLI page is at https://aura.topengdev.com/cli.

### Run it locally

The full stack runs from `deploy/` with Docker. Keys live in a gitignored repo-root `.env` and are bind-mounted read-only (never baked into an image). The economy is on 0G **mainnet** (16661), so the sponsor/demo wallet is a **mainnet-funded** 0G key; the disclosed testnet seam (image generation + 0G Storage writes, 16602) uses a separate testnet key you can top up at the [0G faucet](https://faucet.0g.ai):

```sh
cp .env.example .env       # fill in a MAINNET-funded PRIVATE_KEY (economy) + a testnet key for the image/storage seam
cd deploy
docker compose -f docker-compose.yml up --build
#   http://localhost:8080  -> the site (nginx -> web)
#   http://localhost:8788  -> the backend origin
```

To run a service directly for development, each has its own scripts: `server/` (`npm run dev`, Fastify on :8787), `indexer/` (`ponder dev` on :42069), `web/` (`next dev` on :3000), `cli/` (`bun run dev verify 23`). Server env is documented in [`server/.env.example`](./server/.env.example); contracts deploy via Foundry, see [`contracts/README.md`](./contracts/README.md).

**Tests + CI.** `cd server && npm test` runs the offline invariant suite (POC hardening, memory core, the chat-memory ownership wall, and the gacha + catalog server↔indexer cross-checks). CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs `forge test` (contracts) + a `tsc --noEmit` typecheck of every workspace + that server suite on every push and PR.

---

## Honest scope

One sharp product, fully real, mainnet-deployed. What is live versus MVP-scoped:

| Capability | Status | Detail |
|---|---|---|
| Provable-Pulls gacha (rarity + subject) | **real** | Deterministic keccak256 over public on-chain data; recomputable by anyone via `aura verify` or `/summon/output/:id/proof`. Genuinely provable. |
| Real ERC-7857 agent iNFT | **real** | 30 Auras minted on `AuraINFT`; `transfer()` requires a valid re-encryption proof and rotates the sealed key on-chain, raw `transferFrom` reverts. Honest bar: the oracle is a trusted ECDSA signer, not a TEE enclave. |
| TEE-attested image generation | **real** | 0G Compute TEE (`qwen-image-edit-2511`, testnet seam); attestation enforced (a non-verified generation is never made mintable). |
| On-chain provenance + keyless `/verify` | **real** | Creating Aura + image root + provenance hash + TEE attestation baked into each Relic; re-derivable live via `/api/verify` + `/verify/[id]`, no wallet, no key. |
| Royalty follows the Aura | **real** | Transferring the Aura re-routes the same Relic's royalty to the new owner; split paid in-platform before the seller. |
| Sponsored generation, non-custodial mint | **real** | Sponsor pays 0G Compute + Storage; the user signs the mint from their own wallet. |
| Summon (demand-pull commissioning) | **real** | Buyer self-funds, TEE generation, mint to buyer, fee split that follows the Aura. |
| Arena (commit-reveal battles) | **real** | On-chain blind staked vote; winner recomputable from the `Revealed` log, contract enforces the identical tally. Linear stake weight + non-reveal slash. |
| Fusion (breed two Auras) | **real** | On-chain-recomputable 8-locus child genome; child minted as a real iNFT with on-chain lineage. |
| Ladder (Glicko-1 rating) | **real** | Off-chain fixed-point Glicko-1 over on-chain verdicts, Merkle root anchored on-chain, keyless re-derive. Agent-keyed, so it transfers with the iNFT. |
| Living-soul personas | **real** | User-created Auras derive a distinctive personality + lore + tagline via the mainnet chat LLM; synchronous floor so a create never blocks. |
| Chat with an Aura (TEE-attested) | **real, labeled** | 0G Compute mainnet GLM (currently GLM-5.2, per `/chat/health`), per-reply attestation on a curated TeeML allowlist; a labeled Anthropic Claude fallback is not attested. Tool actions (`read_onchain`, `generate_and_mint`) are non-custodial. |
| Per-owner sealed memory | **real** | AES-256-GCM per relationship, data key ECIES-sealed to the owner pubkey, owner-scoped retrieval wall. Server keeps a custody key copy; sealed segments live in a durable cache (storage-write seam on testnet). |
| PersonhoodGate | **built, gate unenforced (World-ID deferred)** | Two keyless 0G-native skin-in-ecosystem floors (hold-an-Aura or conviction stake) are built but UNENFORCED this phase; the live sybil defense is the Arena's linear stake-weight. The World-ID personhood tier is an explicit deferred stub (`registerWorldId` reverts). |
| Per-Aura fine-tuning | **research, not shipped** | Not claimed. Style is base model + system prompt + retrieved memory in a TEE. |
| Networks | **mainnet economy, one disclosed testnet seam** | Economy, agents, game layer, verify + mint, royalties, and chat on 0G mainnet (chainId 16661). Image generation (`qwen-image-edit-2511`) + 0G Storage writes on 0G testnet (16602); on-chain image roots + provenance stay mainnet. |

---

## Origin: the original end-to-end proof

AURA began as a single, fully on-chain end-to-end loop (register agent, generate in a TEE, store on 0G, mint with provenance, sell with an enforced royalty that follows the agent). That proof-of-concept runner still lives in this repo at [`demo/run-aura.ts`](./demo/run-aura.ts), with its machine-readable journal at [`demo/proof.json`](./demo/proof.json) and the isolated 0G smoke tests under `src/`. It used an earlier contract set; the live application runs the integrated mainnet redeploy in [`contracts/deployed-v2.json`](./contracts/deployed-v2.json).

---

## License

MIT. See [`LICENSE`](./LICENSE).
