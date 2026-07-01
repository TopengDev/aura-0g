# AURA persistent-memory v2 — the dual-wall MVP (LOCAL)

The MOAT: a sold agent keeps its whole intrinsic life, starts a clean relationship with the buyer, and
**provably cannot read the seller's private past** — enforced by **key custody (ECIES + AES-GCM), not a
prompt**. This is the MVP cut (M1 + M2-core + M3-minimal) of the validated build roadmap.

## One mechanism, two layers, two re-seal policies

| Layer | Holds | Spans | On sale A→B |
|---|---|---|---|
| **L1 INTRINSIC** | the agent's owner-AGNOSTIC self (style evolution, skills, taste, public catalog) | ALL epochs | RE-SEAL every past epoch key to B + mint a fresh epoch sealed to B |
| **L2 RELATIONSHIP** | the owner-SPECIFIC bond (chat, prefs, owner-identity vault) | current epoch only | re-seal NOTHING + mint a fresh epoch sealed to B (the dual wall) |

Built on the shipped de-mock primitives, unchanged in shape: `brain.ts` (AES-256-GCM envelope),
`sealing.ts` (ECIES seal-to-pubkey), `pubkey.ts` (SIWE pubkey recovery). The transfer re-seal generalizes
`oracle.ts reencryptForTransfer` to a two-policy keyring loop (`transfer.ts`).

## Modules

- `types.ts` — the two-layer type model (no-owner-field `IntrinsicRecord`, `Manifest` with two sub-manifests).
- `local-store.ts` — LOCAL content-addressed backend (mirrors `storage.ts` shape; **no network**).
- `segment.ts` — immutable AES-GCM record-batch seal/open (the segment primitive; wrong key → throws).
- `keyring.ts` — epoch-key gen + seal/open keyrings to an owner pubkey (intrinsic escrowed, L2 no-escrow).
- `core.ts` — `MemoryService` (manifest + intrinsic escrow + append) + `readLayer` (the wall at the loader).
- `scrubber.ts` — basic fail-closed scrubber (format rules + epoch-local denylist; full NER is fast-follow).
- `reflect.ts` — `selfReflect()` one-way dataflow membrane: the ONLY writer to L1, fed derived self-state.
- `transfer.ts` — `dualWallTransfer()` (M2-core): the two-policy re-seal.

## Verify

```
npx tsx src/scripts/test-memory-core.ts        # 21/21 — M1 core + M3 membrane mechanics
npx tsx src/scripts/demo-memory-dualwall.ts     # 18/18 — the four walls, end to end
```

## Honesty ledger (do not over-claim)

- **CRYPTOGRAPHIC** (a cipher): L2 cross-owner privacy. B is never given A's L2 epoch key, so A's
  relationship bytes are opaque AES-GCM to B forever. A is forward-secret: A's old keys open neither of B's
  new epochs. The smoke test asserts both adversarially (B holds all its keys; none decrypt A's L2).
- **STRUCTURAL** (a membrane, not a cipher): L1 owner-agnosticism. Enforced by the dataflow membrane
  (selfReflect-only writer) + no-owner-field schema + fail-closed scrubber. **RS1**: a content filter is
  never provably complete — a determined seller has a low-bandwidth covert channel via obfuscated free text
  (the basic scrubber misses ambiguous leet; full NER is the M3-full fast-follow). Named, not hidden.
- **MAINNET property** (not proven here): permanence. This MVP uses a LOCAL durable backend. The dual wall
  is about key custody, not durability; durability co-ships with the 0G mainnet pin (M5).

## Out of scope (fast-follow)

M4 chat orchestrator/RAG, M5 mainnet durability, M6 chat UI, M7 migration, M8 breeding, the full-NER
scrubber + complete fail-closed matrix. The MVP proves the **dual wall** — the part that makes the demo
visceral and the moat real.
