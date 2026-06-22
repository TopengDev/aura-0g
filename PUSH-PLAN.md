# PUSH-PLAN - the gated public push (GATE 1)

The repo is **LOCAL-committed and gitleaks-clean**. Going public is **gated**: the supervisor + Toper approve, then run ONE command. The worker did NOT push.

## Pre-push state (already done by the worker)
- ✅ `git init` + one tidy local commit on branch `main`.
- ✅ `.gitignore` excludes `.env`, `.env.*`, `*.key`, `wallet.json`, `.helpers.json`, `node_modules/`, `contracts/{lib,out,cache,broadcast}/`.
- ✅ `git ls-files` contains **no** secret file. `gitleaks detect` = **no leaks** (see `SECURITY-SCAN.txt`).
- ✅ No remote configured (`git remote -v` is empty).

## The one command (run after the gate)
GitHub account `TopengDev` is authed (`gh auth status` ✓, repo scope). Repo name `aura-0g` was confirmed **available**.

```bash
cd ~/claude/Git/repositories/zerog-smoke
gh repo create TopengDev/aura-0g \
  --public \
  --source=. \
  --remote=origin \
  --push \
  --description "AURA - a verifiable creative-agent marketplace on 0G. Creative agents are iNFTs that generate TEE-verified art; provable provenance + enforced, transferable royalties. One end-to-end loop, proven live with 28 on-chain txs."
```

This creates the public repo, adds it as `origin`, and pushes `main` in one step.

**Fallback repo name** if `aura-0g` is taken at push time: `aura-zerog-marketplace` (then update REPO URL in `submission-fields.md` to match).

## Verify immediately after push
```bash
gh repo view TopengDev/aura-0g --web    # opens it; confirm it loads
```
- [ ] Repo is **public** (the org/lock badge shows Public, not Private).
- [ ] **README renders** on the repo home (tables + architecture diagram + tx links intact).
- [ ] **No secret files** in the GitHub tree: confirm `.env`, `.helpers.json` are absent (search the file list).
- [ ] Spot-check 2-3 tx links from the README open real confirmations on `chainscan-galileo.0g.ai`.
- [ ] Then fill `REPO URL = https://github.com/TopengDev/aura-0g` into `submission-fields.md`.

## ⚠️ This is GATE 1 of 2
- **GATE 1 (this file):** push the repo public. Reversible-ish but public-is-public; supervisor + Toper call.
- **GATE 2 (separate):** create the project + submit on `0g.ai/arena/h/zero-cup` (see `submission-fields.md`). Needs REPO URL (from GATE 1) and ideally the VIDEO URL. Also Toper's call.
- **Keep the repo public** through the tournament - taking it private mid-tournament is an explicit disqualifier.
