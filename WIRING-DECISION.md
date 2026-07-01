# AuraINFT Wiring Decision (Task 2, Step 2a)

Branch: `feat/wire-inft-memory` off `origin/v2` (b18a66e). Galileo testnet only. The live
demo is FROZEN (Jul-3 Top-16): nothing live is touched, `origin/v2` is not pushed.

## TL;DR decision

**Option (a): AuraINFT is the target contract.** Wire the SERVER (contracts.ts + create
flow + a new oracle-proof transfer flow) to AuraINFT, deploy a FRESH AuraINFT instance on
Galileo (isolated from the live 0xb596 AgentRegistry), and prove the whole path end to end.
The live-30-agent migration + the marketplace-resale-UX replacement are a separate,
main-reviewed PROD CUTOVER, explicitly OUT of this frozen-demo window (steps documented
below, not executed).

## Why (a), not (b) or (c)

The two contracts were compared field by field (`contracts/src/AuraINFT.sol` vs
`AgentRegistry.sol`):

| Feature the app needs | AgentRegistry | AuraINFT |
|---|---|---|
| permissionless `mintAgent` | yes (7 args) | yes (9 args: + `dataHash`, `sealedKey`) |
| `getAgent` tuple | 7 fields | 8 fields (+ `dataHash` at index 3) |
| `creatorResaleBps` (ERC2981 creator resale) | yes | yes |
| `royaltyBps` (output royalty) + `royaltyBpsOf` | yes | yes |
| `ownerOf` / `agentCreator` / `nextAgentId` | yes | yes |
| `updateBrain` | yes | yes (+ dataHash + sealedKey) |
| per-owner ECIES `sealedKey` | NO | yes |
| proof-gated secure `transfer()` | NO (self-labeled STUB, ignores proofs) | REAL (oracle EIP-191, replay guard) |
| raw `transferFrom` / `safeTransferFrom` | allowed | REVERT (spec-strict ERC-7857) |
| `authorizeUsage` / `usageAuthorized` | yes | dropped |
| oracle | mocked `verifier` (unused) | real `oracle` + `setOracle` |

- **AuraINFT carries every registry feature the app actually reads** (verified by a full
  cross-repo survey: all `getAgent` readers use NAMED field access, so they are safe across
  the `dataHash`-at-index-3 shift once the ABI strings are updated; no positional decoders
  exist anywhere). The only dropped feature, `authorizeUsage`, has ZERO references in
  server/web/cli/indexer, so dropping it is safe.
- **AuraINFT is finished and proven**: `contracts/src/AuraINFT.sol` (identical in v2 and the
  `feat/sealed-key-transfer` branch) + `contracts/test/AuraINFT.t.sol` ship in v2 and pass
  (forge: 103/103 across the repo, including all AuraINFT reject + happy paths). A standalone
  AuraINFT is even already deployed on Galileo (`0x19738D5C...843d`, referenced by the proof
  page): the contract half of the de-mock is DONE; only the app wiring is missing.
- **Option (b) [port the transfer into AgentRegistry] is strictly worse**: it would
  re-implement AuraINFT's entire proof-gated machinery (sealedKey mapping, EIP-191 verify,
  replay guard, dataHash rotation) inside a second contract, requiring a fresh audit + re-test,
  for the SOLE benefit of keeping the generic-marketplace `safeTransferFrom` resale path. But
  that path is exactly the MOCK ERC-7857 removes: moving the NFT without re-keying the brain is
  the vulnerability. Preserving it is wrong for the security model. AuraINFT's docstring names
  itself "the de-mocked SUCCESSOR to AgentRegistry" for precisely this reason.
- Modifying AgentRegistry (option b) ALSO forces a redeploy + re-mint (a non-proxy contract
  cannot gain a function in place), so it saves nothing on the migration cost while adding
  duplicate-code risk.

## The one real consequence: agent resale changes shape

Today an agent resale is a pure FRONTEND action through the generic `AuraMarketplace`
(`marketplace.buy(collection, tokenId)` -> `IERC721(collection).safeTransferFrom`). There is
NO server route for it. Under AuraINFT, `safeTransferFrom` REVERTS by design, so
`marketplace.buy()` on an agent listing would revert inside `_settleSale`.

**Correct ERC-7857 resale path** (what this task wires): ownership moves only through the
oracle-proof `AuraINFT.transfer(from, to, tokenId, newSealedKey, newEncBrainRoot, newDataHash,
deadline, proof)`. The SERVER (which holds the oracle key + the brain custody) produces the
re-encryption + the EIP-191 proof; the USER submits the on-chain `transfer()` with their own
wallet (same "server computes args, user signs" shape as the mint flow). This is what the new
`POST /agents/:id/transfer-proof` route does, and it is the same path `demo-secure-transfer.ts`
already drives end to end on-chain.

## Scope executed in this task (frozen-demo-safe)

1. contracts.ts: add the AuraINFT ABI + read/write factories.
2. config.ts + deployed-v2.json: ADD an `auraINFT` field (additive; the live `agentRegistry`
   address is untouched) + the on-chain oracle address.
3. create flow: return the already-computed `dataHash` + `sealedKey`, target AuraINFT, require
   the seal (AuraINFT mandates it).
4. transfer flow: a server route that produces the oracle re-encryption proof + fires the
   memory dual-wall re-seal (Task 1's module) so the relationship memory resets on resale.
5. Deploy a FRESH AuraINFT to Galileo (isolated), `setOracle` to the server oracle address.
6. E2E on Galileo: mint (sealed) -> chat (new memory + ownerOf gate) -> secure transfer
   (happy + forged + expired + replay reject) -> royalty resolves to the new owner.

## Deferred to a main-reviewed PROD CUTOVER (NOT executed here, touches the frozen demo)

- Re-mint the live 30 agents onto AuraINFT WITH per-owner sealed keys (each needs the owner's
  recovered secp256k1 pubkey; owners must have logged in via SIWE so `wallet_pubkeys` has them,
  else re-seal after login).
- Redeploy OutputNFT pointed at the AuraINFT address (its `registry` ref is IMMUTABLE) + move
  the marketplace allowlist + SummonEscrow to the new set.
- Replace the frontend marketplace-resale UX for agents with the oracle-proof transfer flow
  (TradePanel / useTrade -> the new transfer route). Output-NFT trading is unaffected (OutputNFT
  keeps standard ERC721 transfers).
- Repoint `CONTRACTS.agentRegistry` + the 7 ABI-definition sites (server/lib/web/demo/indexer/
  smoke) once the cutover happens.
