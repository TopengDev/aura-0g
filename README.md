# AURA

**Art you can prove.** A verifiable creative-agent marketplace on 0G.

AURA turns a creative AI agent into an owned, on-chain being, an **Aura**. Each Aura has a public identity on 0G Chain, a private style "brain" sealed on 0G Storage, and a persistent, owner-private memory. Auras make art (**Relics**) by generating inside a 0G Compute TEE, so each Relic carries hardware-attested provenance and an enforced royalty that follows the Aura to whoever owns it next. You can talk to an Aura, summon one to create for you, and recompute the result yourself from public on-chain data.

The product is live. Nothing here is a slideshow: every claim below maps to code in this repo and to a real call against 0G (Galileo testnet for the contracts, 0G mainnet Compute for chat).

| | |
|---|---|
| Live app | https://aura.topengdev.com |
| Jury evidence | [PROOF.md](PROOF.md) · live at [aura.topengdev.com/proof](https://aura.topengdev.com/proof) |
| Backend API | https://api-aura.topengdev.com |
| CLI | `curl -fsSL https://aura.topengdev.com/install.sh \| sh` |
| Contract network | 0G Galileo testnet, chainId **16602** ([explorer](https://chainscan-galileo.0g.ai), [faucet](https://faucet.0g.ai)) |

> **Two 0G networks, on purpose.** The marketplace contracts live on 0G Galileo **testnet** (chainId 16602). Chat runs on 0G **mainnet** Compute (frontier GLM-5.1, served as `zai-org/GLM-5.1-FP8`); image generation runs on 0G **testnet** Compute (`qwen-image-edit-2511`). `GET /health` and `GET /chat/health` show both.

---

## What is verifiable (and what is not)

AURA is a verifiability-branded product, so the honest boundary matters more than the pitch:

- **Gacha pulls are provable.** A Relic's rarity and subject are derived deterministically by keccak256 over public on-chain data, and anyone can recompute them locally (`aura verify <id>`). No trust in our server. This is genuine, reproducible provability.
- **Image provenance is on-chain and TEE-backed.** Generation runs in a 0G Compute TEE; a generation that fails attestation is never made mintable. Each minted Relic bakes its creating Aura, its 0G Storage image root, a provenance hash, and the TEE attestation into the token, and `/verify` re-derives all of it live with no wallet.
- **Chat replies are TEE-attested per reply, honestly labeled.** When 0G Compute serves a reply it carries a hardware attestation (`processResponse`); when the labeled fallback serves it, the reply is **not** attested and the UI says so. This is a per-reply hardware attestation, not a blanket "trustless AI" claim.
- **Memory privacy is enforced by key custody.** A conversation is sealed per owner and only ever retrieved for the wallet that the chain currently reports as the Aura's owner. See the honest v1 bound under [Auras + memory](#auras-on-chain-identity--sealed-memory).
- **Royalties are enforced in-platform.** The split is paid inside the marketplace and summon settlement, before the seller, and resolves to the Aura's current owner. As with every on-chain royalty today, that enforcement is unbypassable for sales through this platform; EIP-2981 only advertises it to other venues.

What AURA does **not** claim: no cryptographically proven training or inference, and no fine-tuning claims (per-Aura fine-tuning is research, not shipped). Style is a base model plus a system prompt plus retrieved memory, run in a TEE.

---

## Core features

### Auras: on-chain identity + sealed memory

An Aura is a creative agent minted as an on-chain token (an iNFT in the ERC-7857 sense: the public identity lives on chain, the valuable data stays encrypted off chain on 0G Storage with only a root hash on chain).

- **Identity on 0G Chain.** `AgentRegistry` carries the public identity, a style fingerprint, the encrypted-brain pointer (`encBrainRoot`), a model attestation, and the royalty terms.
- **Sealed brain on 0G Storage.** The style "brain" is AES-256-GCM encrypted and stored on 0G Storage; the verified merkle root matches the on-chain root.
- **Per-owner persistent memory (memory v2).** Each owner relationship gets its own AES-256 data key; every chat turn is sealed with AES-256-GCM, and the data key is ECIES-sealed to the owner's secp256k1 wallet public key (the same primitive 0G's flow uses). The privacy wall is enforced at the loader by key custody: retrieval is scoped to the wallet the chain currently reports as owner (`ownerOf`), so a prior owner's segments are keyed to a different key and never enter the retrieval set. An Aura "does not gossip about its past owners."
  - **Honest v1 bound:** today the server also keeps a custody copy of the data key (so it can inject memory without holding your private key) and the sealed store is a durable local cache (testnet 0G Storage evicts blobs; permanence is a mainnet property). The owner-scoped retrieval wall holds regardless of custody; mainnet drops the custody copy and persists sealed segments on 0G. The end-to-end ERC-7857 sealed-key transfer that this design rests on is proven on the `AuraINFT` contract (runnable demo + Foundry tests + an isolated Galileo deploy), with an honest trust bar: the re-encryption oracle is a trusted ECDSA signer, not a hardware-TEE enclave, which is what the field ships today.

### Chat with an Aura

A SIWE-gated, owner-scoped conversation (`POST /chat`). Per turn: load identity and persona, retrieve owner memory, run the model, and persist the turn back to sealed memory.

- **Provider seam:** 0G Compute TEE first (0G **mainnet** GLM-5.1, served as `zai-org/GLM-5.1-FP8`, TeeML), with a clearly-labeled Anthropic Claude fallback behind a health check.
- **Per-reply attestation:** the response reports `provider`, `teeAttested`, and the raw attestation; only a 0G-served reply is TEE-attested.
- **The Aura can act (command surface), non-custodially:** two guarded tools, `read_onchain` (a pure read of the Aura's own earnings, royalties, owner, Relic count) and `generate_and_mint` (kicks off a real TEE generation; **you** sign the mint from your own wallet, the server never signs for you).
- `GET /chat/:agentId/history` returns your decrypted relationship history; `GET /chat/health` reports which provider would serve now.

### Provable-Pulls gacha + Summon

- **One seed roots everything.** `seedRoot = keccak256(abi.encode(DOMAIN, requestId, buyer, agentId, summonBlockHash))`. All four preimage fields are public and fixed before generation, so the seed is operator-un-grindable and independently recomputable.
- **Deterministic subject + rarity.** The seed derives a 12-dimension subject and a rarity tier (Common 80% / Rare 15% / Epic 4% / Legendary 1%), both pure functions of the on-chain seed.
- **Summon** (`SummonEscrow`): a buyer self-funds an on-chain commission, the watcher generates live in a TEE, mints the Relic to the buyer, and splits the fee (owner cut + platform fee). The income follows the Aura to its current owner. `GET /summon/output/:tokenId/proof` returns the jury-verifiable economic split plus the full pull recompute.

### Verifiable image Relics

The generate loop is **free to try, yours to own**:

1. **Sponsored generate.** The platform sponsor wallet pays 0G Compute and 0G Storage; generation costs the user nothing.
2. **TEE attestation.** The image is generated in a 0G Compute TEE; attestation is enforced (a non-verified generation is never made mintable).
3. **Stored on 0G.** Image and provenance are uploaded to 0G Storage; the local merkle root is checked equal to the on-chain root.
4. **Non-custodial mint.** When you want to own it, you sign `OutputNFT.mintOutput` from your own wallet against a server-issued EIP-712 attestation. The backend signs no user transaction.

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
        |  sponsored             `->  Ponder indexer (PGlite)  ->  0G Chain events  ->  /api/* feeds
        |  generation
        +->  0G Compute (TEE)  ->  chat (mainnet GLM-5.1) + image (testnet qwen), hardware-attested (processResponse)
        +->  0G Storage             ->  image + provenance + sealed brain (local merkle == on-chain root)
        v
  Your wallet signs the mint  ->  OutputNFT (creatorAgentId + imageRoot + provenanceHash + teeAttestation)
                                  +  AuraMarketplace / SummonEscrow (enforced royalty, follows the Aura)
```

**Stack**

| Layer | What it is |
|---|---|
| `web/` | Next.js 15 (App Router), React 18, wagmi + viem + RainbowKit for wallet + SIWE, Tailwind v4, framer-motion / GSAP / Lenis. Live at aura.topengdev.com. |
| `server/` | Fastify v5 (Node 22). 0G Compute + 0G Storage SDKs, ethers + viem, SQLite for jobs / chat memory / summon journal, EIP-712 attestations. Non-custodial: it supplies computed args, attestations, and chain reads, and never signs a user transaction. Live at api-aura.topengdev.com. |
| `indexer/` | Ponder 0.16 (embedded PGlite) indexing `AgentRegistry`, `OutputNFT`, `AuraMarketplace`; serves the dashboard / discovery / feed read models via Hono, proxied under the backend's `/api/*`. |
| `contracts/` | Foundry project: `AgentRegistry`, `OutputNFT` (ERC-721 + EIP-2981), `AuraMarketplace` (enforced royalty), `SummonEscrow` (demand-pull commissioning), `AuraINFT` (ERC-7857 sealed-key transfer). |
| `cli/` | Bun CLI, cross-compiled to static binaries plus an npx bundle. |
| `deploy/` | docker-compose (server + indexer + web + nginx) and Dockerfiles. |

### Repo layout

The live product is five subsystems, each with its own build:

- `web/` - Next.js 15 frontend (live at aura.topengdev.com)
- `server/` - Fastify API (live at api-aura.topengdev.com)
- `indexer/` - Ponder read-model indexer (proxied under the backend `/api/*`)
- `contracts/` - Foundry contracts (`AgentRegistry`, `OutputNFT`, `AuraMarketplace`, `SummonEscrow`, `AuraINFT`)
- `cli/` - Bun CLI (single static binary)

The root `app/` and `lib/aura/` are a legacy v1 prototype; nothing in the five live subsystems imports them, and they are being removed from the tree as part of repo hygiene.

The 0G primitives are load-bearing, not decorative: take away **0G Compute** and provenance is unprovable; take away **0G Storage** and the art and proof live on an editable server; take away **0G Chain** and there is no enforced royalty bound to the Aura. 0G is the one stack where verifiable TEE compute, decentralized storage, and an EVM that resolves royalty to the current owner are all native to the same place.

### Deployed contracts (0G Galileo, chainId 16602)

From [`contracts/deployed-v2.json`](./contracts/deployed-v2.json), live-confirmed via `GET /health`:

| Contract | Address |
|---|---|
| AgentRegistry (Aura iNFT) | [`0xb5960cc0…ba0a`](https://chainscan-galileo.0g.ai/address/0xb5960cc08caa5195095cfb8aa270f122be09ba0a) |
| OutputNFT (Relic, ERC-721 + EIP-2981) | [`0xEecED1e6…Fd3b`](https://chainscan-galileo.0g.ai/address/0xEecED1e6965f00a5f7cA459631370c886FAEFd3b) |
| AuraMarketplace (enforced royalty) | [`0x815115Eb…f228`](https://chainscan-galileo.0g.ai/address/0x815115Eb39987d3fAdb3b373f89fa0096433f228) |
| SummonEscrow (demand-pull commissioning) | [`0xa5CeFBc0…2838`](https://chainscan-galileo.0g.ai/address/0xa5CeFBc097d84beE09b12fc1569B6CcA56992838) |

Platform fee 2.5% (250 bps). Seeded Auras: NOKTURNE (#1), MIRAI (#2), RISO (#3), SCRIPTORIUM (#4). The de-mocked `AuraINFT` secure-transfer contract is deployed in isolation for its demo (see `contracts/`).

---

## Quickstart

**Use it live (no install):** open https://aura.topengdev.com, connect a wallet, claim test 0G from the [faucet](https://faucet.0g.ai), and generate a Relic for free. Mint it when you want to own it.

**Verify a pull yourself:**

```sh
curl -fsSL https://aura.topengdev.com/install.sh | sh
aura verify 23                              # recompute rarity + subject from chain
aura verify 23 --json | jq .recomputedLocally.provable   # => true
```

**Verify provenance in the browser:** https://aura.topengdev.com/verify re-reads any Relic's on-chain provenance live (no wallet): the creating Aura, the stored image and TEE attestation, the provenance hash, and that the royalty resolves to the current owner. The CLI page is at https://aura.topengdev.com/cli.

### Run it locally

The full stack runs from `deploy/` with Docker. The funded key lives in a gitignored repo-root `.env` and is bind-mounted read-only (never baked into an image):

```sh
cp .env.example .env       # add a funded Galileo testnet PRIVATE_KEY (faucet: https://faucet.0g.ai)
cd deploy
docker compose -f docker-compose.yml up --build
#   http://localhost:8080  -> the site (nginx -> web)
#   http://localhost:8788  -> the backend origin
```

To run a service directly for development, each has its own scripts: `server/` (`npm run dev`, Fastify on :8787), `indexer/` (`ponder dev` on :42069), `web/` (`next dev` on :3000), `cli/` (`bun run dev verify 23`). Server env is documented in [`server/.env.example`](./server/.env.example); contracts deploy via Foundry, see [`contracts/README.md`](./contracts/README.md).

---

## Honest scope

One sharp product, fully real, testnet-deployed. What is live versus MVP-scoped:

| Capability | Status | Detail |
|---|---|---|
| Provable-Pulls gacha (rarity + subject) | **real** | Deterministic keccak256 over public on-chain data; recomputable by anyone via `aura verify` or `/summon/output/:id/proof`. Genuinely provable. |
| TEE-attested image generation | **real** | 0G Compute TEE; attestation enforced (a non-verified generation is never made mintable). |
| On-chain provenance + `/verify` | **real** | Creating Aura + image root + provenance hash + TEE attestation baked into each Relic; re-derivable live, no wallet. |
| Royalty follows the Aura | **real** | Transferring the Aura re-routes the same Relic's royalty to the new owner; split paid in-platform before the seller. |
| Sponsored generation, non-custodial mint | **real** | Sponsor pays 0G Compute + Storage; the user signs the mint from their own wallet. |
| Summon (demand-pull commissioning) | **real** | Buyer self-funds, TEE generation, mint to buyer, fee split that follows the Aura. |
| Chat with an Aura (TEE-attested) | **real, labeled** | 0G Compute mainnet GLM-5.1 (`zai-org/GLM-5.1-FP8`), per-reply attestation; a labeled Anthropic Claude fallback is not attested. Tool actions (`read_onchain`, `generate_and_mint`) are non-custodial. |
| Per-owner sealed memory | **real, v1-bounded** | AES-256-GCM per relationship, data key ECIES-sealed to the owner pubkey, owner-scoped retrieval wall. v1 keeps a server custody key copy in a durable local cache; mainnet drops custody and persists on 0G. |
| ERC-7857 secure transfer | **proven primitive** | Sealed-key re-encryption proven on `AuraINFT` (runnable demo + Foundry tests + isolated Galileo deploy). Honest bar: the oracle is a trusted ECDSA signer, not a TEE enclave. |
| Per-Aura fine-tuning | **research, not shipped** | Not claimed. Style is base model + system prompt + retrieved memory in a TEE. |
| Networks | **testnet contracts, mainnet chat** | Contracts on 0G Galileo, chainId 16602 (the live RPC is authoritative; some docs say 16601). Chat compute on 0G mainnet (GLM-5.1); image compute on 0G testnet (`qwen-image-edit-2511`). |

---

## Origin: the original end-to-end proof

AURA began as a single, fully on-chain end-to-end loop (register agent, generate in a TEE, store on 0G, mint with provenance, sell with an enforced royalty that follows the agent). That proof-of-concept runner still lives in this repo at [`demo/run-aura.ts`](./demo/run-aura.ts), with its machine-readable journal at [`demo/proof.json`](./demo/proof.json) and the isolated 0G smoke tests under `src/`. It used an earlier contract set; the live application runs the integrated redeploy in [`contracts/deployed-v2.json`](./contracts/deployed-v2.json).

---

## License

MIT. See [`LICENSE`](./LICENSE).
