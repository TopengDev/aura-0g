# AURA CLI - Build Report

**What:** a lean, jury-facing CLI that exposes AURA as a composable / scriptable protocol surface (the same actions as the app + AI-chat surface, driven from a terminal). Built with Bun, shipped as a single static binary per OS plus an `npx` fallback.

**Where:** `zerog-smoke/cli/` on branch `feat/aura-cli` (worktree `~/claude/Git/worktrees/aura-cli`, off `origin/v2`).

**Headline:** `aura verify <id>` recomputes a Relic's rarity + subject **locally** from the on-chain seed - the provable-pulls story made trustless and scriptable from any shell.

---

## Commands

| Command | Endpoint(s) | Notes |
|---|---|---|
| `aura agents` | `GET /agents` | All Auras: id, name, style, royalty, relic count, tagline |
| `aura explore [n]` | `GET /outputs?limit=n` | Recent Relics, rarity-tinted (default 15) |
| `aura aura <name\|id>` | `GET /agents/:id` (+ name resolve via `/agents`) | Lore, aesthetic, signature, model, royalty |
| `aura relic <id>` | `GET /outputs/:id` | Image URL, owner, seed, provenance, TEE attestation |
| `aura verify <id>` | `GET /summon/output/:id/proof` + `GET /outputs/:id` | **Local trustless recompute** (`--json` for scripts) |
| `aura summon <name\|id>` | `GET /summon/agent/:id` + `GET /summon/:req/status` | Explain + `--watch` to follow a summon to mint |
| `aura chat <name\|id> "<msg>"` | `POST /chat` (+ `/auth/nonce`, `/auth/verify`; `GET /chat/health`, `/chat/:id/history`) | Talk to an Aura: in-character, TEE-attested. SIWE sign-in via `AURA_KEY`. `--health` (no key), `--history`, `--json` |

Output: hand-rolled ANSI colors + Unicode box tables (no `chalk`/`cli-table` dependency, so cold-start stays fast). Respects `NO_COLOR` and non-TTY pipes. Rarity is tier-colored (Common gray, Rare cyan, Epic magenta, Legendary gold).

---

## The money command: `aura verify`

`verify` is the heart of the protocol claim. It does **not** trust the API's rarity verdict:

1. Fetch `/summon/output/:id/proof` - returns the on-chain economic proof + the **public preimage** (`domain`, `requestId`, `buyer`, `agentId`, `summonBlockHash`) and the committed `onChainSeed`.
2. **Recompute the seed locally**: `seedRoot = keccak256(abi.encode(DOMAIN_PULL, requestId, buyer, agentId, summonBlockHash))` - byte-for-byte the same derivation the contract anchors. The recompute code is a **verbatim copy of `server/src/aura/gacha.ts`** (ethers keccak/abi), so there is zero derivation drift between server, web verifier, and CLI.
3. **Assert** the recomputed `seedRoot == onChainSeed` (the rig-proof check).
4. **Derive locally** the rarity (`keccak(seed, TAG_RARITY) % 10000`, bucketed 80/15/4/1) and the 12-dimension subject (`keccak(seed, TAG_SUBJECT, i) % poolSize`).
5. Render: what was **recomputed locally (trustless)** is labeled separately from what was **fetched (on-chain values relayed by the API)**. A drift line flags if the local result ever disagrees with the API ("trust the local value").

**Trust boundary (honest):** the preimage fields + `onChainSeed` are public, immutable on-chain values that the API merely relays; the CLI re-derives the seed, rarity, and subject from them itself. The one remaining trust assumption is that the API reported those on-chain values faithfully - a fully paranoid verifier would read `onChainSeed` (`OutputNFT.provenanceOf`) and `summonBlockHash` (the `Summoned` event) directly from a 0G RPC. That direct-RPC cross-check is a clean future `--rpc` flag; v1 recomputes from the relayed preimage, which is the same model the web verifier uses.

### Verify evidence - `aura verify 23` (live API, the RARE pull)

```
Verify Relic #23   Rare ◆
  Recomputed locally by this CLI (trustless - re-derived from on-chain preimage)
  ✔ seed recomputes from public preimage  (seedRoot == on-chain seed)
  ✔ seed is a real provable-pull seed  (>= 2^64 keccak root)
  ✔ PROVABLE: this pull is unrigged

   rarity  Rare ◆  roll 8054 / 9999
  subject  tiger hermit as frost mechanical form, casting cradling something, in a salt-flat
           at dawn during an eclipse ...

  Public on-chain preimage (fetched - on-chain values relayed by the API)
    requestId  4
        buyer  0x6072C05AdD8Eb43f5aE7Dc7817889ab8AE64d8Fa
      agentId  20
    blockHash  0x2aa222b94b8864e990ea296703aaec86ad8e58f9ec9bafb6135d617e3c4b4e70
  onChainSeed  106543224641626748915671244648347594258244032279370252980128457404203602199003
   recomputed  106543224641626748915671244648347594258244032279370252980128457404203602199003   (== match)
```

`aura verify 23 --json | jq .recomputedLocally` →
```json
{ "provable": true, "seedMatches": true, "rarity": "Rare", "rarityRoll": 8054,
  "recomputedSeedRoot": "1065432246416267489156712446483475942582440322793702529801284574042036021990​03" }
```

The locally recomputed `seedRoot` is **byte-exact equal** to the on-chain seed; the locally derived rarity is **Rare**, roll **8054** - exactly the on-chain pull. Confirmed three ways: from source (`bun run`), from the **compiled linux-x64 binary**, and from the **node bundle** (npx path).

---

## Cross-platform build matrix (the HARD requirement)

`bun run build` (`build.ts`) cross-compiles a single static binary per target via `bun build --compile --target=...` (no Node/runtime dependency), gzips each for hosting, writes `SHA256SUMS`, and emits the `npx` node bundle.

| Target | `bun --target` | Binary | gz (downloaded) | Status |
|---|---|---|---|---|
| Linux x64 | `bun-linux-x64` | `aura-linux-x64` (97M) | 38M | ✔ built + **run-verified** |
| Linux arm64 | `bun-linux-arm64` | `aura-linux-arm64` (96M) | 38M | ✔ built |
| macOS x64 | `bun-darwin-x64` | `aura-darwin-x64` (65M) | 25M | ✔ built |
| macOS arm64 | `bun-darwin-arm64` | `aura-darwin-arm64` (59M) | 22M | ✔ built |
| Windows x64 | `bun-windows-x64` | `aura-windows-x64.exe` (112M) | 41M | ✔ built |
| npx fallback | `--target=node` | `dist/index.js` (489K) | - | ✔ built + **run-verified** |

Binaries are large because Bun embeds its runtime (the trade for "zero runtime dependency, runs on any box"). Hosting + download uses the gz (~a third the size); `install.sh` gunzips after a checksum check. CLI cold start is fast (~0.17s user on the linux binary; wall time is dominated by the API's chain-scan on `verify`).

**Builds run sequentially** (one `--compile` at a time) - intentional, to avoid an OOM spike on the shared 4-vCPU box.

### Checksums (`dist/SHA256SUMS`, over the gz artifacts)
```
590fd9abbd9c...  aura-linux-x64.gz
3665f7a53e0d...  aura-linux-arm64.gz
08780295616...   aura-darwin-x64.gz
24d66ab823f1...  aura-darwin-arm64.gz
e921ad94e06f...  aura-windows-x64.exe.gz
```

---

## Install flow

- **`install.sh`** (POSIX, any sh/bash/zsh): `uname` → OS/arch → download `aura-<os>-<arch>.gz` → verify sha256 vs `SHA256SUMS` (best-effort, skips cleanly if absent) → gunzip → `chmod +x` → place on PATH (`~/.local/bin`, else `/usr/local/bin` with sudo). Prints a PATH hint if needed. Override source via `AURA_INSTALL_BASE`, dir via `AURA_INSTALL_DIR`.
  - One-liner: `curl -fsSL https://aura.topengdev.com/install.sh | sh`
- **`install.ps1`** (Windows PowerShell 5+): downloads the `.exe.gz`, checksum, gunzips to `%LOCALAPPDATA%\aura`, adds to user PATH. `irm https://aura.topengdev.com/install.ps1 | iex`.
- **npx fallback** (Node ≥18): `npx @aura/cli verify 23` runs the node bundle - no install.

### Install evidence (end-to-end on this Linux box, against a local mirror)
```
=> platform: linux/x64  ->  aura-linux-x64.gz
=> downloading http://127.0.0.1:8799/aura-linux-x64.gz
✔ checksum verified
✔ installed aura -> .../installtest/aura
$ aura verify 23 --json | grep provable   →   "provable": true   (rarityRoll 8054)
```

---

## Files

```
cli/
  package.json        @aura/cli, bin: aura -> dist/index.js
  tsconfig.json
  build.ts            cross-compile matrix + gz + SHA256SUMS + npx bundle
  install.sh          POSIX installer (tested e2e)
  install.ps1         Windows installer
  README.md           user-facing
  src/
    index.ts          arg dispatch, help, version, error handling
    api.ts            typed live-API client (AURA_API overridable)
    ui.ts             ANSI color + box table + rarity tinting (zero-dep)
    gacha.ts          VERBATIM copy of server gacha.ts - the trustless recompute
    commands/         agents · explore · aura · relic · verify · summon
```

Only runtime dependency: `ethers` (keccak/abi for the byte-exact recompute - the same version the server + web use). Everything else (colors, tables, arg parsing) is hand-rolled to keep it lean.

## v0.2 - chat with an Aura (the Living-Agents surface)

`aura chat <name|id> "<message>"` exposes AURA's chat-with-an-Aura moat on the scriptable surface: an in-character reply grounded in the Aura's on-chain identity + the caller's private relationship memory, **TEE-attested when 0G serves it** (the reply footer prints `provider`, the attestation `verifiability`/`teeSigner`/`model`, and an honest "not TEE-attested" when the anthropic fallback serves). The Aura can ACT through the same guarded, non-custodial tools as the app (`read_onchain`; `generate_and_mint`, which starts a real TEE generation but never signs a mint - the owner mints from their own wallet).

- **Auth is off-chain SIWE, non-custodial.** The CLI reads `AURA_KEY` from the env ONLY (the env the summon command already anticipated for "a future signed path"), builds the EIP-4361 message, and signs it locally with ethers; only the message + signature reach `/auth/verify` for a ~1h JWT. The key never leaves the process, and chat is a sign-in signature only - **no gas, no on-chain tx, no spend** (distinct from summon, which is why summon stays explain-only). The SIWE message binds the SITE origin `aura.topengdev.com` (NOT the API host) + chainId 16602, matching the server's `SIWE_DOMAIN`; `AURA_SIWE_DOMAIN` overrides it for a local backend.
- **Still zero new dependencies.** SIWE message construction is hand-rolled (canonical EIP-4361) and signed with the existing `ethers` dep - the runtime dependency set is unchanged (`ethers` only). The whole `/chat` round-trip was validated end-to-end against the live API (SIWE -> JWT -> `POST /chat` returns a `zerog` reply with `teeAttested: true`).
- **Sub-modes:** `--health` (PUBLIC, no key - is 0G TEE chat live + which model), `--history` (the caller's decrypted relationship history), `--json` (scriptable).

## Honest limitations

- `summon` is **explain + watch**, not a bundled wallet: a real summon is a self-funded on-chain tx, and the CLI never holds or auto-spends a key. It prints the exact escrow tx + an `AURA_KEY` env note, and `--watch <requestId>` polls to mint and reveals the Relic. `verify` is the real, trustless core.
- `verify` recomputes from the API-relayed on-chain preimage; a direct-from-RPC cross-check (`--rpc`) is the obvious next step for maximal paranoia.
- No `windows-arm64` native target (Bun has no such `--compile` triple yet); `install.ps1` falls back to x64 under emulation.
