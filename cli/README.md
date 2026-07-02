# AURA CLI

The composable, scriptable surface for **AURA** - a verifiable creative-agent protocol on 0G. Same actions as the AURA app, driven from any terminal or script.

The headline is `aura verify <id>`: it **recomputes a Relic's rarity and subject from the on-chain seed, locally** - so a gacha pull is rig-evident: you recompute it yourself, no trust in our API. The recompute mirrors the on-chain derivation byte-for-byte (keccak256 over the public preimage), so anyone can re-derive the result themselves.

## Install

**macOS / Linux** (any shell - a single static binary, no Node needed):

```sh
curl -fsSL https://aura.topengdev.com/install.sh | sh
```

**Windows** (PowerShell):

```powershell
irm https://aura.topengdev.com/install.ps1 | iex
```

**Anywhere with Node** (no install):

```sh
npx @aura/cli verify 23
```

## Commands

| Command | What it does |
|---|---|
| `aura agents` | List every Aura (creative agent) |
| `aura explore [n]` | List the n most recent Relics with rarity (default 15) |
| `aura aura <name\|id>` | Inspect an Aura - lore, style, royalty, relic count |
| `aura relic <id>` | Inspect a Relic - image, owner, on-chain provenance |
| `aura verify <id>` | **Recompute a Relic's rarity + subject from the on-chain seed, locally (trustless)** |
| `aura summon <name\|id>` | Explain + watch a summon (`--watch <requestId>` to follow one) |
| `aura chat <name\|id> "<msg>"` | **Talk to an Aura** - in-character, TEE-attested when 0G serves it (`--health`, `--history`) |

## The provable-pulls proof

```sh
aura verify 23
```

`verify` fetches the on-chain economic proof, then **recomputes the seed itself** from the public preimage (`requestId`, `buyer`, `agentId`, `summonBlockHash`), asserts the recomputed `seedRoot` equals the committed on-chain seed, and derives the rarity + subject from that seed. The CLI prints what it recomputed locally (trustless) separately from what it fetched (on-chain values relayed by the API). Script it:

```sh
aura verify 23 --json | jq .recomputedLocally.provable   # => true
```

## Chat with an Aura

```sh
export AURA_KEY=0x...                          # your wallet key - signs in locally, never sent
aura chat nokturne "what have you earned?"
```

`chat` talks to an Aura from the terminal: an in-character reply grounded in the Aura's on-chain identity and your private relationship memory, **TEE-attested** when 0G serves it. The Aura can also act through guarded, non-custodial tools (read its own on-chain stats; start a TEE generation that you mint yourself from your own wallet, the CLI never signs a mint for you).

Auth is **off-chain SIWE**: the CLI reads `AURA_KEY` from the environment, signs an EIP-4361 message locally, and exchanges it for a short-lived token. The key never leaves your machine and is never spent - no gas, no on-chain tx, the same non-custodial sign-in the web wallet uses.

```sh
aura chat --health                             # is 0G TEE chat live + which model (no key needed)
aura chat nokturne --history                   # your relationship history with this Aura
aura chat nokturne "paint me a relic" --json   # scriptable
```

## Env

- `AURA_API` - backend base URL (default `https://api-aura.topengdev.com`)
- `AURA_KEY` - wallet private key for `chat` sign-in (off-chain SIWE; never transmitted, never spent)
- `AURA_SIWE_DOMAIN` - SIWE site origin to bind to (default `aura.topengdev.com`; set to match a local backend's `SIWE_DOMAIN`)
- `AURA_INSTALL_BASE` / `AURA_INSTALL_DIR` - override the install source / target dir
- `NO_COLOR` - disable ANSI color

## Build from source

```sh
bun install
bun run dev verify 23        # run from source
bun run build                # cross-compile all targets + the npx bundle into dist/
```

MIT.
