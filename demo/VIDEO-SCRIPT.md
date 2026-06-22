# AURA demo video: shot-by-shot script

**Target length:** ~2:00 (judges skim; lead with the proof, end on the money-shot).
**Format:** screen recording. The accepted proof path is **live terminal trace + the collection montage + the on-chain explorer**. Everything below already exists in this repo or resolves on the public explorer, so nothing needs to be re-generated to record this.

**Assets you screen-record (all real, all in the repo):**
- Terminal trace: [`demo/run-highlights.log`](./run-highlights.log) (the clean run trace) or run `pnpm demo` live (it resumes from the journal in seconds and prints the full proof).
- The genesis hero: [`demo/hero.png`](./hero.png)
- The collection reveal: [`demo/collection-montage.png`](./collection-montage.png)
- On-chain proof: open any tx from [`demo/proof.json`](./proof.json) on https://chainscan-galileo.0g.ai
- The one script a judge reads: [`demo/run-aura.ts`](./run-aura.ts)

> Optional voiceover lines are in **VO:**. If recording silent, put each VO line on screen as a lower-third caption. Keep it confident and plain.

---

### Shot 0 - Title card (0:00 to 0:08)

**On screen:** the AURA banner + one line: *"A verifiable creative-agent marketplace. Everything you are about to see is live on the 0G Galileo testnet. 28 real transactions."*

**VO:** "AURA. Creative agents whose art carries unforgeable provenance, and whose royalties are enforced and transferable. All of this runs live on 0G. No mocks."

---

### Shot 1 - The problem, in one breath (0:08 to 0:22)

**On screen:** the competitor table from the README (OpenSea / Royal / Sound.xyz vs AURA), highlight the two red columns.

**VO:** "On every NFT marketplace today, who made the art is unprovable, and creator royalties are an opt-in suggestion most platforms ignore. AURA fixes both, and it can only be done on 0G."

---

### Shot 2 - Register the agent as an iNFT (0:22 to 0:38)

**On screen:** terminal, `PHASE 1 - AGENT`. Highlight these lines from `run-highlights.log`:
```
✅ agent-brain: stored on 0G Storage - root 0x47b95fdf…   local merkle == on-chain root: true
✅ agent iNFT minted - agentId #2  owner 0x2537…5540
   read-back: name="RISO" fingerprint=match ✓
```

**VO:** "A creative agent is an iNFT. Its private style-DNA brain is encrypted and sealed on 0G Storage; its model attestation and royalty are on-chain. This is RISO."

---

### Shot 3 - Generate on 0G Compute, TEE-verified (0:38 to 0:58)

**On screen:** terminal, `PHASE 2 - HERO`. Hold on the VERIFY line, this is the heart of the thesis:
```
✅ generated 1989822 bytes in 42747ms → demo/hero.png
✅ TEE VERIFY → processResponse = true  (signer 0x2A94D671…2e69)  chatId 1ad2b2df…
```
Then cut to `demo/hero.png` filling the screen.

**VO:** "The agent generates inside a TEE on 0G Compute. The hardware signs the result: this image was made by this model, provably. That is the provenance no other stack can give you."

---

### Shot 4 - Store + mint with provenance baked in (0:58 to 1:12)

**On screen:** continue PHASE 2:
```
✅ hero-image: stored on 0G Storage - root 0x4b37e41b…   local merkle == on-chain root: true
✅ OutputNFT minted - tokenId #3
   read-back: creatorAgentId=2 imageRoot match=true provenanceHash match=true
```
Cut to the mint tx open on the explorer (https://chainscan-galileo.0g.ai/tx/0x988939e7…ea15).

**VO:** "The image and its provenance record go onto 0G Storage, merkle-verified. Then we mint an OutputNFT with the agent ID, the storage root, and the TEE attestation baked in. Read straight back from chain: it all matches."

---

### Shot 5 - THE MONEY SHOT: royalty follows the agent (1:12 to 1:42)

**On screen:** terminal, `PHASE 3 - ROYALTY`. Step through slowly:
```
royaltyInfo before agent transfer → 0x2537…5540  (current agent owner = main)
✅ agent transferred - main → new owner
✅ royaltyInfo AFTER transfer → 0x388b…5C9C  (the SAME artwork's royalty now routes to the new agent owner)
✅ SOLD - tx 0x5fabf5f4…2808
  ── enforced split (from the on-chain Sold event) ──
    royalty  → agent  0.0014 0G   to 0x388b…5C9C
    platform fee      0.0005 0G
    seller proceeds   0.0181 0G
```
End on the SOLD tx open on the explorer.

**VO:** "Here is the part only 0G makes possible. Before the sale, we transfer the agent to a new owner. The same artwork's royalty now points to that new owner: the royalty stream followed the agent. Then someone buys it, and the royalty is paid inside buy(), before the seller, enforced on-chain. Sell the agent, and you sell its entire future income."

---

### Shot 6 - A real collection drop (1:42 to 1:54)

**On screen:** `demo/collection-montage.png` (the 7 Fennic foxes with on-chain token IDs). Then the line:
```
✅ collection drop complete - 7 pieces minted under agent #2
✅ 28 on-chain transactions recorded
```

**VO:** "And it is a real product: one signature character, seven trait variations, every one TEE-verified, stored on 0G, and minted on-chain under the same agent."

---

### Shot 7 - Close: it survived a kill (1:54 to 2:00)

**On screen:** scroll `run-highlights.log` to show the banner repeating with `already minted (#5)` / `reusing` lines.

**VO:** "One script, fully resumable. This run was killed mid-drop and picked up from its on-chain journal with zero rework. AURA. Verifiable creative agents, on 0G."

---

## Recording notes

- **Pacing:** linger on the three hero beats (TEE VERIFY = true, royalty AFTER transfer, the enforced split). Those are the three sentences a judge remembers.
- **Live vs log:** recording `pnpm demo` live is the strongest option because the resume behavior is genuine and fast (it replays from `demo/proof.json` in seconds and prints the same trace). If you prefer a clean cut, screen-record `run-highlights.log` in a pager.
- **Terminal-cast tooling:** `asciinema`/`agg`/`vhs` are not installed on this box. To produce an `.asciinema` cast instead of a screen recording, `pip install asciinema` (or `brew install asciinema`), then `asciinema rec aura.cast -c "pnpm demo"`. `ffmpeg` is available if you want to assemble stills/clips.
- **Proof tab:** keep one browser tab on `chainscan-galileo.0g.ai` and paste tx hashes from `proof.json` live, so judges see real confirmations, not screenshots.
