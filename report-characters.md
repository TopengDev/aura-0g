# 0G Image-Gen Smoke-Test: FICTIONAL CHARACTERS (NFT character-collection de-risk)

**For:** Toper · **By:** zerog-character-smoketest (worker, Opus) · **Date:** 2026-06-21 · **Parent:** income-diversification-2026
**Scope:** Prove the 0G Compute image model can produce good, collection-worthy fictional CHARACTERS, and (the make-or-break) hold a CONSISTENT character identity across generations so a real PFP/character collection is buildable. Smoke-test only, testnet, reusing the proven `zerog-smoke` pipeline.

---

## 0. VERDICT (read this first)

| Question | Result | One-line |
|---|---|---|
| Can the model make GOOD fictional characters? | 🟢 GREEN | All 4 agent styles produced collection-worthy, maximally distinct signature characters, every one TEE-verified. |
| Does "edit-only" block character generation? | 🟢 NO | A near-blank base + a strong character prompt works as pseudo-text-to-image. Edit-only is not a real limit. |
| Collection cohesion (N different characters, one world)? | 🟢 GREEN | 4 distinct cyberpunk archetypes read as one cohesive collection. |
| **Character CONSISTENCY (same character, N variations = the PFP test)?** | 🟢 **STRONG GREEN** | **Image-conditioning (feed a generated character back as the base + "keep the same character, change only X") holds identity remarkably well, for both a mascot and a humanoid face.** This is the make-or-break and it passes. |
| Does it feel like a real mintable collection? | 🟢 GREEN | The "Fennic Foxes" 6-trait PFP drop reads as a genuine, mintable character collection. |

**Bottom line: GREEN. We can build a character-collection product on this model.** The model is genuinely good at characters, and the one thing a collection lives or dies on (a recognizable character reproduced across many trait variations) is achievable today with the image-conditioning technique below. The right collection format on this model is the market-proven PFP pattern: one signature character, N trait variations.

**Cost:** negligible. 26 character generations across T1+T2+T3 settled entirely from the prepaid compute ledger sub-account; the wallet balance never moved (3.214161... 0G before and after). Listed price is 5e-3 0G per call, so ~0.13 0G of metered inference total. Storage/chain not exercised here (already GREEN in the prior smoke-test).

---

## 1. THE BEST BASE -> CHARACTER APPROACH

The model is `qwen/qwen-image-edit-2511`, served TEE-verified (TeeML) on Galileo testnet, and it is EDIT-only (needs a base image; `/images/generations` is disabled). The key behaviour: **it preserves the base composition while fully restyling and re-rendering the content.** That single property is what makes character work, and character consistency, possible.

| Approach | What I fed it | Result | Use when |
|---|---|---|---|
| **Neutral bust silhouette base** (recommended for PFPs) | a plain gray head-and-shoulders avatar silhouette + character+style prompt | Clean, consistent head-and-shoulders PFP framing every time. The silhouette pins the composition; the prompt supplies identity + style. | Default for PFP/avatar collections where consistent framing matters. |
| **Near-blank base** (pseudo text-to-image) | a near-blank neutral gradient + a strong character prompt | Full-quality character, slightly more compositional freedom (less predictable framing). Proves the model can "generate" from almost nothing. | When you want more variety / less rigid framing, or have no template. |
| **Image-conditioning** (the consistency lever) | a previously generated character image as the base + "keep the same character, change only X" | The SAME character reproduced with a new trait/expression/pose/color. This is how you get a coherent N-piece collection of one identity. | Building the actual collection: 1 hero character -> N variations. |

Practical recipe (build should adopt all three): mint the canonical hero character once from a bust base, then drive the whole collection by feeding that hero back as the base image with per-trait prompts.

---

## 2. T1 - PER-AGENT SIGNATURE CHARACTER (quality + distinctiveness)

Each of the 4 demo agents generated a signature character on BOTH a neutral bust base and a near-blank base. 8/8 succeeded, 8/8 TEE-verified.

| Agent | Style | Signature character | Quality | Collection-worthy? |
|---|---|---|---|---|
| NOKTURNE | chiaroscuro noir | hard-boiled detective: fedora, trench coat, cigarette smoke, half-shadowed face | excellent | yes |
| MIRAI | neon cyberpunk | hooded street samurai with a glowing cybernetic eye implant, neon city behind | excellent (strongest PFP) | yes |
| RISO | risograph duotone | pink/blue fox mascot, knit scarf, halftone grain, mischievous grin | excellent (best identity for a collection) | yes |
| SCRIPTORIUM | illuminated manuscript | haloed knight-saint in engraved armor inside a gilded jeweled border | excellent (most ornate) | yes |

**Honest quality assessment:** these are demo-grade and genuinely appealing. Each is unmistakably its own style, and each works as a character (not just a styled scene). The bust base produced tighter, more avatar-like framing; the near-blank base produced equally high quality with more compositional variety. Notably, the RISO fox came out nearly identical from BOTH bases, the first hint that this model has a stable "mode" for a strong character prompt (good for consistency).

Sample images: `images/characters/T1/NOKTURNE-bust.png`, `MIRAI-bust.png`, `RISO-bust.png`, `SCRIPTORIUM-bust.png` (+ `*-blank.png` variants).

---

## 3. T2 - CHARACTER CONSISTENCY (the make-or-break)

### 3a. Collection cohesion: N DIFFERENT characters, one world

Generated 4 different MIRAI cyberpunk archetypes (street samurai, netrunner, corpo enforcer, street medic) on the same bust base + same style DNA.

**Result: PASS.** They read as one cohesive neon-cyberpunk collection (shared palette, lighting, world, framing) while being clearly distinct characters. This is the "roster collection" format. Montage: `images/characters/montages/T2a-MIRAI-collection.png`.

### 3b. Reproduce ONE character across variations (the PFP test)

This is the question a PFP collection lives on: can the model produce the SAME recognizable character many times with different traits? Tested two techniques.

| Technique | How | Identity retention | Verdict |
|---|---|---|---|
| **Image-conditioning** (recommended) | feed the generated character back as the base image, prompt "keep the EXACT same character, change ONLY X" | Very high. Core features (face, markings, scarf / face structure, hood, cybernetic eye) stay locked while the requested trait changes. | 🟢 strong |
| **Trait-prompt-only** | no reference image; a detailed "character bible" prompt on a fresh base, varied per trait | Recognizably the same character, looser variation in exact proportions/shading | 🟢 viable |

Tested image-conditioning on BOTH a mascot and a humanoid face:
- **RISO fox** (mascot): original -> wink -> glasses+beanie -> angry+headphones. Identity held tightly across all four. Montage: `montages/T2b-RISO-identity.png`.
- **MIRAI samurai** (humanoid, harder): original -> smirk -> breathing mask -> full green recolor. Same face/hood/cyber-eye throughout, even under a complete palette change. Montage: `montages/T2b-MIRAI-identity.png`.

**This is the critical finding: identity reproduction works, for both cute mascots and human faces.** Trait-prompt-only is a useful fallback when you have no reference image yet (montage: `montages/T2b-RISO-promptonly.png`), but image-conditioning is the tighter, more reliable lever.

Caveats / honest notes:
- No explicit seed control is exposed by this provider, so determinism comes from the base image, not a seed. Image-conditioning is therefore the practical consistency mechanism.
- Image-conditioning trades a little background/pose variety for identity lock. For PFPs that is exactly the right trade.
- Trait-prompt-only drifts more (rounder vs sharper face, slight shading differences). Fine for "same vibe" sets, weaker for strict 1-identity PFPs.

---

## 4. T3 - THE COLLECTION FEEL ("Fennic Foxes" mock drop)

Picked RISO (best single-character identity) and built a 6-trait PFP drop from one canonical fox via image-conditioning: pirate, astronaut, wizard, punk, king, samurai.

**Result: STRONG PASS.** All 7 (canonical + 6 traits) are unmistakably the SAME fox (same fur, cheek/ear markings, eyes, blue knit scarf, risograph duotone) with clean, recognizable trait swaps and a cohesive style. It reads exactly like a real, mintable PFP collection drop (Cool Cats / Pudgy Penguins energy). Contact sheet: `images/characters/montages/T3-fennic-collection.png`.

| # | Trait | File |
|---|---|---|
| 1 | canonical | `images/characters/T1/RISO-bust.png` |
| 2 | pirate (eyepatch + bandana) | `images/characters/T3/fennic-01-pirate.png` |
| 3 | astronaut (helmet) | `images/characters/T3/fennic-02-astronaut.png` |
| 4 | wizard (starry hat) | `images/characters/T3/fennic-03-wizard.png` |
| 5 | punk (mohawk + collar) | `images/characters/T3/fennic-04-punk.png` |
| 6 | king (crown + ermine cape) | `images/characters/T3/fennic-05-king.png` |
| 7 | samurai (headband + topknot) | `images/characters/T3/fennic-06-samurai.png` |

This is the concrete proof of the verdict: a one-character, N-trait collection is buildable end-to-end on this model today.

---

## 5. RECOMMENDATION: how to build a character-collection on this model

1. **Format:** PFP pattern (one signature character, N trait variations). It is market-proven (BAYC, Pudgy Penguins, Cool Cats) and it is exactly what this model does best.
2. **Pipeline:**
   - (a) Generate the canonical hero character once from a neutral bust base + a strong style+identity prompt. Lock it.
   - (b) Build the collection by feeding that hero back as the base image, one generation per trait/accessory/expression, prompt "keep the EXACT same character, change ONLY X."
   - (c) Optionally compose traits in layers (hat, then eyewear, then background) by chaining edits.
3. **Per-agent angle (fits the Verifiable Creative Agent Marketplace):** each agent owns a signature character + a style DNA. A buyer mints variations of that agent's character; the agent's dynamic royalty (already proven on-chain) follows every secondary sale. Characters make this far more compelling than styled scenes, because a recognizable character is what people actually collect.
4. **TEE proof still stands:** every character generation returned `processResponse = true` (TEE-verified), so each mint carries the "provably created by model X in a TEE" attestation, unchanged from the prior smoke-test.

---

## 6. NEW GOTCHAS (this run)

| # | Gotcha | Impact | Workaround |
|---|---|---|---|
| C1 | **Per-call auto-funding WARN** | The SDK logs `[Auto-funding] Requires 1.0 0G ... ledger available balance is insufficient` before every call once the ledger's *available* (unlocked) balance drops below 1.0 0G. | Non-fatal. The provider's existing locked reserve (funded by the prior run) keeps serving. To silence it, keep >=1.0 0G available in the ledger (depositFund) so auto-funding can top up the provider sub-account. |
| C2 | **No seed parameter** | You cannot get determinism from a seed on this provider. | Use image-conditioning (the base image is the determinism anchor). |
| C3 | **Edit-only is a non-issue for characters** | Initially looks like a blocker (no text-to-image). | A near-blank base + strong prompt = pseudo-text-to-image; a real character base = better framing. Either way, characters generate fine. |
| C4 | **Latency 42-57 s per image** | A live "mint your variation" UX needs a loading state; bulk collection gen should be batched/queued. | Pre-generate the collection server-side; show progress in the UI. |

(All prior gotchas from the first smoke-test still apply: chainId 16602, compute broker via CJS, storage SDK `@0gfoundation/0g-ts-sdk@1.2.8`, provider 1.0 0G reserve, etc.)

---

## 7. ARTIFACTS

- `images/characters/T1/` - 8 signature characters (4 styles x bust + blank bases)
- `images/characters/T2a/` - 4 MIRAI archetypes (collection cohesion)
- `images/characters/T2b/` - identity-reproduction tests (image-conditioning + trait-prompt-only)
- `images/characters/T3/` - the 6-piece "Fennic Foxes" PFP drop
- `images/characters/montages/` - contact sheets for quick viewing
- `images/characters/char-log.json` - per-generation log (latency, bytes, TEE verified, chatId, prompt)
- `src/char.ts` - the resume-safe manifest generator (reuses the proven `/images/edits` pipeline)
