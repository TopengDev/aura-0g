# AURA Home — /artifex Variance & Quality Audit (Technical Editorial)

> The pre-build gate (artifex §7). Filled BEFORE code. Archetype = Technical Editorial
> (warm editorial-minimal + mono labels + oklab ambient gradient + faux-OS hero), modeled on
> arca/dashboard. Light-first, dark available. English-only. No em-dashes anywhere.
> Variance is reserved for Home (the marketing surface); app/product pages apply the archetype consistently.

## The motif (N6) — the through-line that licenses the variance

**"The provenance line"** — a thin 1px ink-navy/periwinkle hairline that, in the hero, traces the
pipeline `prompt -> generate -> attest -> store -> mint`. It reappears as:
- the **left rail / timeline spine** in How-it-works (the same hairline, now vertical, connecting 4 steps),
- the **underline that draws** under the thesis keyword,
- the **baseline ledger rule** separating the live-stats figures,
- the **connective tie** in the activity ticker (events strung on one moving line).
Threads sections 1 -> 2 -> 3 -> 6 -> 7 (5 sections, >= 3 required). It is literally the product's promise
(verifiable provenance) rendered as a graphic mark. This is what makes the section variance read as
intentional, not random.

Secondary coherence held CONSTANT across every section (the cohesion paradox):
- ONE type system: **display** (Ethereal Glamour OR Playfair, owner picks) x **Switzer** body x **Geist Mono** labels.
- ONE color discipline: warm cream/near-black + warm-charcoal inks + ONE accent (ink-navy light / periwinkle dark) + warm-tinted shadows.
- ONE motion language: `EASE = cubic-bezier(0.22, 1, 0.36, 1)`, blur-into-focus reveals (arca's `Reveal`).
- The oklab ambient gradient (4 fixed corner glows) is the constant ground under everything.

## The Variance Map (one row per section, each column value unique)

| # | Beat | SKELETON | SIGNATURE TECHNIQUE (artifex T#) | The SURPRISE | TRANSITION OUT | Build |
|---|------|----------|----------------------------------|--------------|----------------|-------|
| 1 | HERO — faux-OS | `centered-device` (OS window framed by oversized type) | **T12 atmospheric framed environment** — a live faux-OS: a CLI terminal generating beside a "behind the scenes" 0G process panel (attest -> store -> mint) that fills in real time, then minimizes to a gallery-browser recall. The provenance line draws across the menubar. | the process panel ticking `sign -> generate -> attest -> store -> mint` live, the art resolving inside the window | the OS window's accent line extends DOWN and becomes the thesis underline; soft scale-out | B (no WebGL) |
| 2 | THESIS strip | `centered-statement` | **T3 oversized editorial display type AS layout** — one architectural sentence; the keyword ("verifiable") gets the provenance-line underline that DRAWS on enter (T4 kinetic on the rule only) | the underline drawing left-to-right under the single load-bearing word | hard color settle into a sunken band; figures rise | B |
| 3 | LIVE STATS — ledger | `split-asymmetric` (label column left, big figures right, ledger rules between) | **T13 big-number count-up** — real counts (agents, outputs, royalties, chainId) count up on enter, set as an accounting ledger with the provenance hairline as each baseline rule | the numbers being REAL (pulled live) and counting up like a balance sheet | ledger rules fan out; cards float in (panel reveal) | B |
| 4 | FEATURED AGENTS | `bento-grid` (mixed-scale: one hero agent card + 3 smaller, each agent's own accent) | **T7 bento + T9 tilted-card hover** — agent cards on the warm paper surface, each tinted by its own catalog accent (NOKTURNE gold, MIRAI magenta, RISO pink, SCRIPTORIUM gold); hero card larger | each card carrying its real style accent + tagline + live output/sales counts; subtle tilt-to-cursor | the grid recedes; a horizontal rail slides in from the right | B |
| 5 | RECENT OUTPUTS | `horizontal-rail` (pinned-section sideways scroll of output cards) | **T10 horizontal-scroll rail** — recent minted outputs scroll sideways while the section is pinned (CSS sticky), each card a provenance chip (agent, seed, TEE attestation, storage root) | the lateral motion breaking the vertical rhythm exactly once; each card a verifiable artifact | unpin; the moving activity line threads in | B (CSS sticky pin, ScrollTrigger scrub only) |
| 6 | ACTIVITY ticker | `full-bleed-marquee` (edge-to-edge single moving line) | **T15-adjacent continuous marquee** — real on-chain events (mint / sale / transfer) strung on ONE horizontal moving line (the provenance line, now in motion), monospace event chips | events being real + live (NOKTURNE mint, NOKTURNE sale 0.001 0G) gliding past on the motif line | the line slows to a stop and pins as the how-it-works vertical spine | B |
| 7 | HOW-IT-WORKS | `index-numbered-vertical-timeline` (left spine, 01-04 oversized markers, alternating L/R content) | **T8 index-numbered case panels** — 4 steps (pick agent / generate sponsored / attest+store on 0G / mint when ready) on the vertical provenance spine, each with an oversized index marker | the provenance line from the hero now the literal backbone of the steps; sponsored-not-connected called out | quiet fade to the closing statement | B |
| 8 | CTA close | `centered-form` (max-contrast, minimal) | **T1 full-bleed color-field settle** — invert to a calm ink field (light: deep ink card on cream / dark: lifted panel), two CTAs (Explore / Generate free), the provenance line returns as a single steady underscore bookend | the motif line completing its journey as a quiet closing mark | (end -> footer) | B |

## The audit (artifex §7)

```
Hard-bans (A1-A4): scan
  A1 aurora/glow-blobs as decor      -> the oklab ambient gradient is the archetype's SIGNATURE ground
                                        (color-mix in oklab, fixed corner washes), NOT a blurred-radial
                                        hero orb used as the focal decor. arca ships it; Technical Editorial
                                        §2 mandates it. It is a flat ambient wash behind structured content
                                        (the faux-OS window, ledgers, bento), never the hero's subject.   -> PASS (0 decorative glow-blobs)
  A2 timid mono micro-eyebrow        -> mono is used CONFIDENTLY: oversized 01-04 index markers (How),
                                        integrated menubar/ledger/event labels. NO tiny separate tracked
                                        eyebrow stacked over each section header.                          -> PASS (0)
  A3 AI-default fonts                -> Ethereal Glamour / Playfair (display) x Switzer (body) x Geist Mono.
                                        NO Instrument Serif / Plus Jakarta / Inter-only.                   -> PASS (0)
  A4 AI-generated photo backgrounds  -> no photographic backgrounds. The art shown is REAL minted output
                                        (on-chain), agent portraits are the project's own seeded assets.   -> PASS (0)
                                                                                          HARD-BANS: 0 hits  ✅

Sections: 8
A skeletons:   centered-device · centered-statement · split-asymmetric · bento-grid ·
               horizontal-rail · full-bleed-marquee · index-vertical-timeline · centered-form  -> 8/8 = 1.00 ✅
B techniques:  T12 faux-OS · T3 display-type · T13 count-up · T7 bento+tilt · T10 h-rail ·
               marquee · T8 index-panels · T1 color-field                                       -> 8/8 = 1.00 ✅
C scrollytelling (by distinct technique): ONE pinned scroll-scrubbed technique (Beat-5 h-rail). The
               marquee (Beat-6) is autoplay continuous, NOT scroll-scrubbed -> different model.  -> <= 1 ✅
D heavy effects (WebGL/canvas/3D): ZERO. The faux-OS is DOM + framer-motion timers (arca proves it).
               Entire hard budget deliberately UNSPENT (Technical Editorial is restraint-led).   -> <= 1 ✅
E designed transitions: 7/7 interior boundaries are events (line-extend, color-settle, fan-out,
               recede-to-rail, line-threads-in, line-pins-to-spine, invert-to-field).            -> 1.00 ✅
F motif: the provenance line threads beats 1 -> 2 -> 3 -> 6 -> 7 (-> bookend at 8)               -> 5 ✅
G banned defaults (frontend-design §8 + N5): none.                                               -> 0 ✅
H type-size variance: architectural display (hero clamp ~clamp(36px,7vw,92px); thesis ~clamp(40px,
               8vw,110px); count-up figures ~clamp(48px,9vw,140px); index markers ~120px) vs 15-16px
               Switzer body + 10-11px Geist Mono labels. Dramatic + intentional.                 -> large ✅
I confident type moments: >= 1 per major section (hero swap word, thesis keyword underline, ledger
               figures, bento agent names, oversized 01-04 markers). Markers oversized, not labels. -> ✅
J eased motion / no snap: one EASE everywhere; alignment via transform tweens; bento tilt is
               transform-only; Beat-5 pinned via CSS position:sticky (NOT GSAP pin:true), ScrollTrigger
               for scrub only, opaque full-viewport bg, flick-tested both directions.            -> 0 snaps ✅
K rich hero frame-one: the faux-OS is layered + busy from frame one (menubar + terminal + process
               panel + dock), a choreographed multi-beat entrance (lines blur-in, window rises, panel
               ticks). Reduced-motion = the rich static end-state (all steps shown done). No empty stage. -> ✅
L extras: distinct-technique scrollytelling honored; how-it-works alternates L/R.                -> ✅
M display-type containment: hero/thesis/count-up display in w-full text-center (or contained grid
               cells) with clamp() maxes kept <= ~85% content width; verified 320 -> 1920.        -> ✅  (build+verify gate)
VERDICT: PASS — cleared to build.
```

## Reference grounding (artifex N8 — technique : reference)
- Beat 1 faux-OS         : arca `components/hero/os/OsScene` (the literal model) + KPR cinematic framing (T12).
- Beat 2 thesis          : Chungi Yoo / Mana — architectural single-statement type (T3).
- Beat 3 ledger stats    : KPR big-number + Wix editorial figures (T13), set as an accounting ledger.
- Beat 4 bento agents    : Wix Pantone bento texture collage (T7) + Chungi tilted cards (T9).
- Beat 5 outputs rail    : Lusion / Mammut horizontal pinned rail (T10), CSS-sticky pin.
- Beat 6 activity ticker : editorial running-headline marquee (connective-tissue motif in motion).
- Beat 7 how-it-works    : Synchronized index-numbered case panels on a spine (T8).
- Beat 8 CTA             : Crescente color-field settle (T1) + the bookend motif callback.

## Perf budget (artifex §9 / N7)
- 0 heavy canvas. Scroll hits 60fps with ALL effects off (the page is DOM + transforms/opacity + one marquee + one scrubbed rail).
- prefers-reduced-motion: faux-OS shows static done-state; rail becomes a normal wrapped grid; marquee static; reveals -> instant.
- coarse-pointer / small viewport: bento tilt off; rail -> horizontal snap-scroll (native), marquee keeps but slower.
- Below-fold sections mount their motion on IntersectionObserver (arca Reveal pattern, viewport once).
