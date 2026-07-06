"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { EASE } from "@/lib/motion";
import { ZeroG } from "@/components/atoms/ZeroG";
import { CHAIN_SHORT, CHAIN_TIER } from "@/lib/chains";
import { CLI_AGENT, CLI_EXCHANGES, CLI_REPLY } from "@/lib/scene";
import { BrowserGallery } from "./BrowserGallery";
import { CliTerminal } from "./CliTerminal";
import { ProcessPanel } from "./ProcessPanel";

const MINIMIZE_AT = 9200; // CLI generates + mints + the 0G pipeline finishes, then minimize
const LOOP_MS = 17500;

// One machine: an AURA agent generates art in the terminal while a side panel shows the real 0G
// pipeline (sign -> generate -> attest -> store -> mint); then both minimize and AURA's Explore
// surface recalls the minted output with its provenance chip + Verify. The provenance line draws
// across the menubar (the motif origin). DOM-only, no WebGL.
export function OsScene() {
  const [phase, setPhase] = useState<"cli" | "browser">("cli");
  const [reduced, setReduced] = useState(false);
  const lineRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    if (mq.matches) return; // reduced-motion: hold the completed state (browser/verify done)

    let mounted = true;
    let visible = true;
    let tMin: ReturnType<typeof setTimeout>;
    let tLoop: ReturnType<typeof setTimeout>;
    const clear = () => {
      clearTimeout(tMin);
      clearTimeout(tLoop);
    };
    const run = () => {
      setPhase("cli");
      tMin = setTimeout(() => mounted && setPhase("browser"), MINIMIZE_AT);
      // Only re-arm the loop while the scene is on-screen -- no point re-typing + re-running the pipeline
      // animation when the faux-OS is scrolled out of view (wasted main-thread + raster work on mobile).
      tLoop = setTimeout(() => mounted && visible && run(), LOOP_MS);
    };

    // Visibility gate: freeze the loop while off-screen, resume it on re-entry. No visual change when in
    // view; it just stops animating an invisible element.
    const el = rootRef.current;
    let io: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        ([entry]) => {
          const nowVisible = entry.isIntersecting;
          if (nowVisible === visible) return;
          visible = nowVisible;
          if (visible) run();
          else clear();
        },
        { threshold: 0.05 },
      );
      io.observe(el);
    }
    run();
    return () => {
      mounted = false;
      clear();
      io?.disconnect();
    };
  }, []);

  // Reduced motion shows the rich END state: the recall/verify view, fully resolved.
  const effectivePhase = reduced ? "browser" : phase;
  const onCli = effectivePhase === "cli";
  const hidden = { opacity: 0, scale: 0.9, y: 26 };

  return (
    <div
      ref={rootRef}
      id="aura-os-hero"
      className="relative mx-auto aspect-[4/3] sm:aspect-[16/10] w-full max-w-[1240px] overflow-hidden rounded-[18px] border border-[var(--color-border)] shadow-[var(--shadow-doc)]"
    >
      <Wallpaper />

      {/* menubar - the provenance line draws across it (motif origin) */}
      <div
        className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-1.5 font-mono-x text-[10px] tracking-[0.06em] text-[var(--color-ink-3)] backdrop-blur-sm"
        style={{ background: "rgb(var(--rgb-cream) / 0.45)" }}
      >
        <span className="flex items-center gap-2">
          AURA · art you can prove
        </span>
        <span className="hidden sm:inline"><ZeroG /> · {CHAIN_SHORT.toLowerCase()} {CHAIN_TIER.toLowerCase()}</span>
      </div>
      {/* the provenance hairline under the menubar */}
      <span
        ref={lineRef}
        aria-hidden
        className="prov-rule prov-rule-draw is-in absolute inset-x-0 top-[26px] z-30 h-px"
      />

      {/* generate view: terminal beside the generate pipeline */}
      <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 px-4 pt-8 pb-8 sm:gap-4 sm:px-8 sm:pt-10 sm:pb-14">
        <motion.div
          className="h-[72%] w-full overflow-hidden rounded-xl border bg-[#0d1117] shadow-[var(--shadow-card)] sm:h-[78%] sm:w-[52%]"
          animate={onCli ? { opacity: 1, scale: 1, y: 0 } : hidden}
          transition={{ duration: 0.55, ease: EASE }}
          style={{ borderColor: "rgba(0,0,0,0.4)" }}
        >
          <WindowBar title={`${CLI_AGENT} · zsh`} kind="terminal" dark />
          <div className="h-[calc(100%-34px)] overflow-hidden">
            <CliTerminal play={onCli} exchanges={CLI_EXCHANGES} reply={CLI_REPLY} />
          </div>
        </motion.div>

        <motion.div
          className="hidden h-[78%] w-[34%] sm:block"
          animate={onCli ? { opacity: 1, scale: 1, y: 0 } : hidden}
          transition={{ duration: 0.55, ease: EASE, delay: onCli ? 0.08 : 0 }}
        >
          <ProcessPanel play={onCli} variant="generate" startDelay={1900} />
        </motion.div>
      </div>

      {/* recall view: Explore gallery beside the verify pipeline */}
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 px-4 pt-8 pb-8 sm:gap-4 sm:px-8 sm:pt-10 sm:pb-14">
        <motion.div
          className="h-[74%] w-full overflow-hidden rounded-xl border shadow-[var(--shadow-doc)] sm:h-[80%] sm:w-[56%]"
          initial={false}
          animate={!onCli ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.96, y: 24 }}
          transition={{ duration: 0.55, ease: EASE, delay: !onCli ? 0.2 : 0 }}
          style={{ borderColor: "var(--color-border)" }}
        >
          <WindowBar title="aura.app/explore" kind="browser" />
          <div className="h-[calc(100%-34px)] overflow-hidden">
            <BrowserGallery play={!onCli} startDelay={450} />
          </div>
        </motion.div>
        <motion.div
          className="hidden h-[80%] w-[32%] sm:block"
          initial={false}
          animate={!onCli ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.96, y: 24 }}
          transition={{ duration: 0.55, ease: EASE, delay: !onCli ? 0.32 : 0 }}
        >
          <ProcessPanel play={!onCli} variant="verify" startDelay={1200} />
        </motion.div>
      </div>

      {/* dock */}
      <div className="absolute inset-x-0 bottom-2 z-30 flex justify-center">
        <div
          className="flex items-center gap-2 rounded-2xl border border-[var(--color-border)] px-2.5 py-1.5 backdrop-blur-md"
          style={{ background: "rgb(var(--rgb-cream) / 0.55)" }}
        >
          <DockIcon active={onCli} kind="terminal" />
          <DockIcon active={!onCli} kind="browser" />
        </div>
      </div>
    </div>
  );
}

function Wallpaper() {
  return (
    <div
      className="absolute inset-0 z-0"
      style={{ background: "linear-gradient(155deg, var(--color-cream-warm), var(--color-cream-deep))" }}
    >
      {/* blueprint dot grid (theme-aware via --color-border) */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: "radial-gradient(circle, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      {/* soft color orbs for depth (inside the OS frame, not page decor) */}
      <div className="absolute -left-16 -top-16 h-56 w-56 rounded-full opacity-40 blur-3xl" style={{ background: "var(--color-accent)" }} />
      <div className="absolute -bottom-20 -right-10 h-64 w-64 rounded-full opacity-30 blur-3xl" style={{ background: "#c2683f" }} />
      <div className="absolute left-1/3 top-1/2 h-40 w-40 rounded-full opacity-20 blur-3xl" style={{ background: "#3a8e5e" }} />
    </div>
  );
}

function WindowBar({ title, kind, dark = false }: { title: string; kind: "terminal" | "browser"; dark?: boolean }) {
  const barBg = dark ? "#1d1a13" : "color-mix(in oklab, var(--color-ink) 3%, transparent)";
  const barBorder = dark ? "rgba(233,228,219,0.08)" : "var(--color-border)";
  const titleColor = dark ? "#8b8578" : "var(--color-ink-3)";
  const dotBorder = dark ? "rgba(233,228,219,0.22)" : "var(--color-border-strong)";
  return (
    <div className="flex h-[34px] items-center gap-2 border-b px-3" style={{ background: barBg, borderColor: barBorder }}>
      <span className="flex gap-1.5">
        <Dot c={dotBorder} />
        <Dot c={dotBorder} />
        <Dot c={dotBorder} />
      </span>
      {kind === "browser" ? (
        <span
          className="ml-2 flex-1 truncate rounded-md px-2.5 py-0.5 text-center font-mono-x text-[10px]"
          style={
            dark
              ? { border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#9a9a9a" }
              : { border: "1px solid var(--color-border)", background: "var(--color-paper)", color: "var(--color-ink-3)" }
          }
        >
          {title}
        </span>
      ) : (
        <span className="ml-2 font-mono-x text-[10.5px]" style={{ color: titleColor }}>
          {title}
        </span>
      )}
    </div>
  );
}

function Dot({ c = "var(--color-border-strong)" }: { c?: string }) {
  return <span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: c }} />;
}

function DockIcon({ active, kind }: { active: boolean; kind: "terminal" | "browser" }) {
  return (
    <div
      className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] transition-colors"
      style={{ background: active ? "var(--color-ink)" : "var(--color-paper)" }}
    >
      <span className="font-mono-x text-[12px]" style={{ color: active ? "var(--color-cream)" : "var(--color-ink-3)" }}>
        {kind === "terminal" ? ">_" : "◐"}
      </span>
      {active && <span className="absolute -bottom-1 h-1 w-1 rounded-full" style={{ background: "var(--color-accent)" }} />}
    </div>
  );
}
