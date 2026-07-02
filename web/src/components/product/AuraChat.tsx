"use client";

// Chat-with-an-Aura: the Living-Agents surface. Talk to THIS Aura in character; it is grounded in its
// on-chain identity + your private owner-relationship memory, every reply is TEE-attested when 0G serves
// it (honestly labeled, never overclaimed), and it can ACT - reading its own on-chain stats or creating a
// new Relic, which you mint NON-CUSTODIALLY by signing in your own wallet. SIWE-gated (owner-scoped).
//
// Two surfaces share ONE engine (the useAuraChat hook + the bubble/badge/tool/mint renderers):
//   - AuraChat       : the inline Panel (kept for any embedded use).
//   - AuraChatThread : the full-height column the dedicated /chat page mounts in its main area
//                      (Claude-AI style: header + flex-1 transcript + composer). Same rendering, no
//                      fixed max-height, so it fills the page.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "@/lib/motion";
import { Panel, Chip, ActionButton } from "@/components/product/primitives";
import { useAuth } from "@/components/web3/AuthProvider";
import { useMint } from "@/lib/useMint";
import {
  sendChat,
  fetchChatHistory,
  fetchChatHealth,
  fetchChatModels,
  fetchJob,
  fetchJobImageObjectUrl,
  fetchMintArgs,
  type ChatReply,
  type ChatToolInvocation,
  type ChatHealth,
  type ChatModelInfo,
  type MintArgs,
} from "@/lib/api";

type Turn = {
  role: "owner" | "aura";
  text: string;
  provider?: "zerog" | "anthropic";
  teeAttested?: boolean;
  attestation?: ChatReply["attestation"];
  tools?: ChatToolInvocation[];
  pending?: boolean;
  // model-picker honesty: set when the picked model was offline/unverifiable and another TEE model served.
  modelFallback?: boolean;
  requestedModel?: string | null;
  servedModel?: string | null;
};

// ── The shared chat engine ────────────────────────────────────────────────
// All state + effects + the send loop for ONE Aura, owner-scoped. Both surfaces consume this so the
// rendering and behavior never drift. The history effect is keyed on (token, agentId), so switching
// Auras re-seeds the transcript; the /chat page also remounts per Aura (key=agentId) for a clean reset.
function useAuraChat(agentId: number) {
  const { token, address, status, signIn } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<ChatHealth | null>(null);
  const [models, setModels] = useState<ChatModelInfo[]>([]);
  const [modelsDefault, setModelsDefault] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchChatHealth().then(setHealth);
    fetchChatModels().then((r) => {
      setModels(r.models);
      setModelsDefault(r.default);
    });
  }, []);

  // Default the selection to the auto-picked online model once discovered. NEVER auto-select a model that
  // is not selectable (offline / unverified), and never overwrite an explicit user choice.
  useEffect(() => {
    if (selectedModel || !models.length) return;
    const def = models.find((m) => m.id === modelsDefault && m.selectable) ?? models.find((m) => m.selectable) ?? null;
    if (def) setSelectedModel(def.id);
  }, [models, modelsDefault, selectedModel]);

  // Clear the transcript when the Aura changes. The /chat thread is keyed by agentId so it REMOUNTS
  // (this is a no-op there: a fresh mount inits agentRef to the current agentId). It matters only for the
  // embedded inline surface, which does NOT remount on an agentId change - without this, the non-
  // destructive seed below would keep the previous Aura's transcript instead of loading the new one.
  const agentRef = useRef(agentId);
  useEffect(() => {
    if (agentRef.current !== agentId) {
      agentRef.current = agentId;
      setTurns([]);
    }
  }, [agentId]);

  // Load the owner-scoped relationship history once signed in. NON-DESTRUCTIVE: it only fills an EMPTY
  // transcript, so it can never wipe a live/optimistic one. Critical because signing in during the first
  // send flips `token` null->JWT, which re-fires this effect; for a brand-new relationship the server
  // history is still empty (the turn is not persisted until sendChat completes), so an unconditional
  // setTurns() would erase the just-added optimistic owner + pending-reply bubbles - and then the reply-
  // replace loop in send() would find no pending bubble and drop the reply too. Guarding on prev.length
  // defeats BOTH race orderings (history-resolves-before-reply and reply-before-history). A genuine Aura
  // switch still reseeds, because by then the transcript is empty (thread remounted / inline cleared above).
  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetchChatHistory(token, agentId)
      .then((hist) => {
        if (!alive) return;
        const seeded: Turn[] = [];
        for (const t of hist) {
          if (t.ownerText) seeded.push({ role: "owner", text: t.ownerText });
          if (t.auraText) seeded.push({ role: "aura", text: t.auraText });
        }
        setTurns((prev) => (prev.length ? prev : seeded));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, agentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || sending) return;
    // Show the owner message + a pending reply IMMEDIATELY - even when this first send must SIWE sign-in,
    // so the transcript never waits on the wallet. The optimistic bubbles go in BEFORE awaiting the
    // signature; if sign-in is cancelled or throws, roll them back cleanly and restore the input.
    setError(null);
    setInput("");
    setSending(true);
    setTurns((prev) => [...prev, { role: "owner", text: message }, { role: "aura", text: "", pending: true }]);

    let t = token;
    if (!t) {
      try {
        t = await signIn();
      } catch {
        setTurns((prev) => prev.slice(0, -2)); // remove the optimistic owner + pending we just added
        setInput(message);
        setSending(false);
        return;
      }
    }

    try {
      const r = await sendChat(t, agentId, message, selectedModel);
      setTurns((prev) => {
        const next = [...prev];
        // replace the trailing pending aura bubble
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "aura" && next[i].pending) {
            next[i] = { role: "aura", text: r.reply, provider: r.provider, teeAttested: r.teeAttested, attestation: r.attestation, tools: r.toolInvocations, modelFallback: r.modelFallback, requestedModel: r.requestedModel, servedModel: r.servedModel };
            break;
          }
        }
        return next;
      });
    } catch (e) {
      setTurns((prev) => prev.filter((x) => !x.pending));
      setError(e instanceof Error ? e.message : "chat failed");
    } finally {
      setSending(false);
    }
  }, [input, sending, token, signIn, agentId, selectedModel]);

  return { token, address: address ?? null, status, turns, input, setInput, sending, error, health, models, selectedModel, setSelectedModel, scrollRef, send };
}

type ChatEngine = ReturnType<typeof useAuraChat>;

// The honest provenance badge for the header (which provider would serve a reply right now).
function HealthBadge({ health, accent }: { health: ChatHealth | null; accent: string }) {
  const badge = health
    ? health.zerogHealthy
      ? { label: "0G TEE-attested", tone: "ok" as const, hint: `replies run in a TEE on ${health.zerogModel ?? "0G"}` }
      : health.fallbackConfigured
        ? { label: "Fallback active", tone: "muted" as const, hint: "0G is unreachable; replies are served by a fallback model and are NOT TEE-attested" }
        : { label: "0G", tone: "muted" as const, hint: "" }
    : null;
  if (!badge) return null;
  return (
    <span title={badge.hint}>
      <Chip tone={badge.tone === "ok" ? "accent" : "default"} accent={accent}>
        {badge.label}
      </Chip>
    </span>
  );
}

// The shared chat header: title + the model picker + the provenance badge. Used by both surfaces so the
// picker + badge never drift between the inline panel and the /chat thread.
function ChatHeaderBar({ c, agentName, accent }: { c: ChatEngine; agentName: string; accent: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 7%, var(--color-paper))` }}>
      <div className="min-w-0">
        <div className="label-caps text-[12px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          Talk to the Aura
        </div>
        <div className="truncate font-display" style={{ fontSize: "22px", lineHeight: 1.1 }}>
          {agentName}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ModelPicker models={c.models} selected={c.selectedModel} onSelect={c.setSelectedModel} accent={accent} />
        <HealthBadge health={c.health} accent={accent} />
      </div>
    </div>
  );
}

// Just the model id tail (drop the "vendor/" prefix) for compact display. "" -> "auto".
function shortModelId(id?: string | null): string {
  if (!id) return "auto";
  return id.split("/").pop() || id;
}

// A SHARP TEXT status tag (online / offline / unverified / unknown). NEVER a status dot - text only.
function ModelStatusTag({ m }: { m: ChatModelInfo }) {
  const s =
    m.online === false
      ? { t: "offline", fg: "var(--color-ink-3)", bd: "var(--color-border-strong)", bg: "transparent" }
      : m.online == null
        ? { t: "unknown", fg: "var(--color-ink-3)", bd: "var(--color-border-strong)", bg: "transparent" }
        : !m.teeAttested
          ? { t: "unverified", fg: "var(--color-warn)", bd: "color-mix(in oklab, var(--color-warn) 42%, var(--color-border))", bg: "color-mix(in oklab, var(--color-warn) 8%, transparent)" }
          : { t: "online", fg: "var(--color-ok)", bd: "color-mix(in oklab, var(--color-ok) 42%, var(--color-border))", bg: "color-mix(in oklab, var(--color-ok) 10%, transparent)" };
  return (
    <span className="tag" style={{ border: `1px solid ${s.bd}`, background: s.bg, color: s.fg }}>
      {s.t}
    </span>
  );
}

// The TEE attestation tag (shown on any hardware-attestable model). A sharp text tag, not a mark.
function TeeTag() {
  return (
    <span className="tag" style={{ border: "1px solid color-mix(in oklab, var(--color-ok) 42%, var(--color-border))", background: "color-mix(in oklab, var(--color-ok) 9%, transparent)", color: "var(--color-ok)" }}>
      TEE
    </span>
  );
}

// A hairline chevron for the picker trigger (rotates when open). Not a dot.
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ color: "var(--color-ink-3)", transform: open ? "rotate(180deg)" : "none", transition: "transform 200ms cubic-bezier(0.22,1,0.36,1)" }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// The MODEL PICKER: a sharp technical-editorial disclosure (NOT a native select). Lists every 0G chat model
// with a status TEXT tag + a TEE tag on attested ones. Offline / unverified models are disabled + greyed
// (shown for transparency, never selectable). The chosen model rides on every POST /chat. NO status dots.
function ModelPicker({ models, selected, onSelect, accent }: { models: ChatModelInfo[]; selected: string | null; onSelect: (id: string) => void; accent: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  // Keyboard cursor: the index of the option the arrow keys have moved to (drives aria-activedescendant).
  const [activeIdx, setActiveIdx] = useState(-1);
  const optionId = (i: number) => `${listId}-opt-${i}`;
  // Only TEE-attested/online models can be chosen; arrow-key nav skips the disabled ones.
  const nextSelectable = useCallback(
    (from: number, dir: 1 | -1) => {
      if (!models.length) return -1;
      let i = from;
      for (let step = 0; step < models.length; step++) {
        i = (i + dir + models.length) % models.length;
        if (models[i]?.selectable) return i;
      }
      return from;
    },
    [models],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // On open, seed the cursor on the selected (or first selectable) option and move focus into the list so
  // the arrow keys work immediately; the disclosure now behaves like a real single-select listbox.
  useEffect(() => {
    if (!open) return;
    const cur = models.findIndex((m) => m.id === selected && m.selectable);
    setActiveIdx(cur >= 0 ? cur : nextSelectable(-1, 1));
    const t = window.setTimeout(() => listRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open, models, selected, nextSelectable]);

  if (!models.length) return null; // discovery not ready / empty -> the backend auto-picks; nothing to choose

  const current = models.find((m) => m.id === selected) ?? null;

  const commit = (i: number) => {
    const m = models[i];
    if (m?.selectable) {
      onSelect(m.id);
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx((i) => nextSelectable(i, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx((i) => nextSelectable(i, -1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIdx(nextSelectable(-1, 1));
        break;
      case "End":
        e.preventDefault();
        setActiveIdx(nextSelectable(0, -1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIdx >= 0) commit(activeIdx);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="micro inline-flex items-center gap-2 rounded-[11px] border px-3 py-1.5 hover:-translate-y-px active:scale-[0.98]"
        style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)" }}
      >
        <span className="label-caps text-[12px]" style={{ color: "var(--color-ink-3)", letterSpacing: "0.12em" }}>
          Model
        </span>
        <span className="font-mono-x text-[13px]" style={{ color: "var(--color-ink)" }}>
          {shortModelId(current?.id)}
        </span>
        <Caret open={open} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: EASE }}
            className="absolute right-0 z-40 mt-2 w-[320px] max-w-[86vw] overflow-hidden rounded-[16px] border"
            style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)", boxShadow: "var(--shadow-card)" }}
          >
            <div className="border-b px-4 py-2.5 label-caps text-[12px] uppercase tracking-[0.14em]" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-3)" }}>
              Chat model
            </div>
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Chat model"
              tabIndex={-1}
              aria-activedescendant={activeIdx >= 0 ? optionId(activeIdx) : undefined}
              onKeyDown={onListKeyDown}
              data-lenis-prevent
              className="max-h-[320px] overflow-y-auto overscroll-contain py-1 outline-none scroll-affordance"
            >
              {models.map((m, i) => {
                const active = m.id === selected;
                const cursored = i === activeIdx;
                return (
                  <li key={m.id}>
                    <button
                      id={optionId(i)}
                      type="button"
                      role="option"
                      aria-selected={active}
                      aria-disabled={!m.selectable}
                      tabIndex={-1}
                      disabled={!m.selectable}
                      onClick={() => commit(i)}
                      onMouseEnter={() => m.selectable && setActiveIdx(i)}
                      className={`micro relative flex w-full items-start gap-3 px-4 py-2.5 text-left ${m.selectable ? "hover:bg-[color-mix(in_oklab,var(--color-ink)_5%,transparent)]" : ""}`}
                      style={{
                        cursor: m.selectable ? "pointer" : "not-allowed",
                        opacity: m.selectable ? 1 : 0.55,
                        background: active
                          ? `color-mix(in oklab, ${accent} 12%, var(--color-paper))`
                          : cursored
                            ? "color-mix(in oklab, var(--color-ink) 6%, transparent)"
                            : undefined,
                        boxShadow: cursored ? `inset 0 0 0 2px color-mix(in oklab, var(--color-accent) 45%, transparent)` : undefined,
                      }}
                    >
                      {active ? <span className="absolute left-1.5 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full" style={{ background: accent }} aria-hidden /> : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display" style={{ fontSize: 15, lineHeight: 1.15, color: "var(--color-ink)" }}>
                          {m.label}
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {m.sizeB ? (
                            <span className="tag" style={{ border: "1px solid var(--color-border-strong)", background: "var(--color-paper)", color: "var(--color-ink-3)" }}>
                              {m.sizeB}B
                            </span>
                          ) : null}
                          {m.teeAttested ? <TeeTag /> : null}
                          <ModelStatusTag m={m} />
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t px-4 py-2.5 text-[12.5px] leading-snug" style={{ borderColor: "var(--color-border)", color: "var(--color-ink-3)" }}>
              Only TEE-attested, online models are selectable. Offline and unverified models are shown for transparency, never served silently.
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// The empty-state prompt shown before the first turn.
function ChatEmpty({ agentName }: { agentName: string }) {
  return (
    <div className="m-auto max-w-[40ch] text-center">
      <p className="text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        {agentName} remembers your conversations, knows its own on-chain record, and can create a Relic on request. Ask who it is, what it has made, or tell it to paint something.
      </p>
    </div>
  );
}

// The transcript body (no scroll container - each surface supplies its own so the height policy differs).
function ChatBody({ c, agentName, accent }: { c: ChatEngine; agentName: string; accent: string }) {
  if (c.turns.length === 0) return <ChatEmpty agentName={agentName} />;
  return (
    <>
      {c.turns.map((t, i) => (
        <ChatBubble key={i} turn={t} agentName={agentName} accent={accent} token={c.token} address={c.address} />
      ))}
    </>
  );
}

// The honest-framing notice. Shown ONCE: the user dismisses it with OK and it stays gone (persisted in
// localStorage), collapsing away smoothly. Starts hidden to avoid a flash before the stored flag is read.
const NOTICE_KEY = "aura-chat-notice-dismissed";
function HonestFraming() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(NOTICE_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(NOTICE_KEY, "1");
    } catch {
      /* storage unavailable - just hide for this session */
    }
  };
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.32, ease: EASE }}
          className="overflow-hidden border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-start gap-4 px-5 py-3.5 sm:px-6" style={{ background: "color-mix(in oklab, var(--color-accent) 5%, transparent)" }}>
            <p className="flex-1 text-[15px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
              Replies served by 0G run inside a TEE and are hardware-attested per reply. Your relationship memory is private and owner-scoped (it re-seals on resale). A full turn is not a single proof: any on-chain action is separately verifiable, and your private memory is yours alone.
            </p>
            <button
              type="button"
              onClick={dismiss}
              className="micro shrink-0 rounded-[10px] px-3.5 py-1.5 text-[15px] font-semibold hover:-translate-y-px active:scale-[0.96]"
              style={{ background: "var(--color-ink)", color: "var(--color-cream)" }}
            >
              OK
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// The shared composer (textarea + send/sign-in). Enter sends, Shift+Enter newlines.
function ChatComposer({ c, agentName }: { c: ChatEngine; agentName: string }) {
  return (
    <div className="flex items-end gap-2 border-t px-5 py-4" style={{ borderColor: "var(--color-border)" }}>
      <textarea
        value={c.input}
        onChange={(e) => c.setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void c.send();
          }
        }}
        rows={1}
        placeholder={c.token ? `Message ${agentName}...` : `Sign in to talk to ${agentName}`}
        aria-label={`Message ${agentName}`}
        className="micro min-h-[44px] flex-1 resize-none rounded-[14px] border bg-transparent px-3 py-3 text-[16px] outline-none focus:border-[var(--color-accent)]"
        style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
      />
      <div className="shrink-0 whitespace-nowrap" style={{ width: c.token ? 120 : 156 }}>
        <ActionButton onClick={() => void c.send()} disabled={c.sending || c.status === "signing"}>
          {c.sending ? "..." : !c.token ? "Sign in & send" : "Send"}
        </ActionButton>
      </div>
    </div>
  );
}

// ── Surface 1: the inline Panel (embeddable) ───────────────────────────────
export function AuraChat({ agentId, agentName, accent }: { agentId: number; agentName: string; accent: string }) {
  const c = useAuraChat(agentId);
  return (
    <Panel className="mt-7 overflow-visible p-0">
      <ChatHeaderBar c={c} agentName={agentName} accent={accent} />

      {/* transcript: a live log so new replies (and the "thinking" state) are announced to screen readers */}
      <div
        ref={c.scrollRef}
        data-lenis-prevent
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={c.sending}
        aria-label={`Conversation with ${agentName}`}
        className="scroll-affordance flex max-h-[440px] min-h-[220px] flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-5"
      >
        <ChatBody c={c} agentName={agentName} accent={accent} />
      </div>

      {/* honest framing (one-time, dismissable) */}
      <HonestFraming />

      {/* composer */}
      <ChatComposer c={c} agentName={agentName} />
      {c.error ? (
        <p role="alert" className="px-5 pb-4 font-mono-x text-[16px]" style={{ color: "var(--color-warn)" }}>
          {c.error}
        </p>
      ) : null}
    </Panel>
  );
}

// ── Surface 2: the full-height thread (the /chat page main area) ───────────
// Same engine + same renderers, laid out to FILL its container (Claude-AI style): a header, a flex-1
// scrolling transcript, the honest framing, and the composer pinned to the bottom. The parent supplies a
// bounded-height container so the transcript scrolls; mount it keyed by agentId for a clean per-Aura reset.
export function AuraChatThread({ agentId, agentName, accent }: { agentId: number; agentName: string; accent: string }) {
  const c = useAuraChat(agentId);
  return (
    <motion.div className="flex h-full min-h-0 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, ease: EASE }}>
      <ChatHeaderBar c={c} agentName={agentName} accent={accent} />

      {/* transcript (fills the available height): a live log for screen-reader announcement */}
      <div
        ref={c.scrollRef}
        data-lenis-prevent
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={c.sending}
        aria-label={`Conversation with ${agentName}`}
        className="scroll-affordance flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 py-6 sm:px-6"
      >
        <ChatBody c={c} agentName={agentName} accent={accent} />
      </div>

      {/* honest framing (one-time, dismissable) */}
      <HonestFraming />

      {/* composer */}
      <ChatComposer c={c} agentName={agentName} />
      {c.error ? (
        <p role="alert" className="px-5 pb-4 font-mono-x text-[16px]" style={{ color: "var(--color-warn)" }}>
          {c.error}
        </p>
      ) : null}
    </motion.div>
  );
}

function ChatBubble({ turn, agentName, accent, token, address }: { turn: Turn; agentName: string; accent: string; token: string | null; address: string | null }) {
  if (turn.role === "owner") {
    return (
      <motion.div className="flex justify-end" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
        <div className="max-w-[80%] rounded-[16px] px-4 py-2.5 text-[16px] leading-relaxed" style={{ background: "var(--color-cream-deep)", color: "var(--color-ink)" }}>
          {turn.text}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div className="flex flex-col items-start gap-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
      <div className="max-w-[88%] rounded-[16px] border px-4 py-2.5 text-[16px] leading-relaxed" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 8%, var(--color-paper))`, color: "var(--color-ink)" }}>
        {turn.pending ? <span style={{ color: "var(--color-ink-3)" }}>{agentName} is thinking...</span> : turn.text}
      </div>

      {/* per-reply honesty labels (ReplyBadge self-hides on a verified, no-substitution reply) */}
      {!turn.pending && turn.provider ? (
        <ReplyBadge turn={turn} />
      ) : null}

      {/* command-surface tool results */}
      {turn.tools?.map((tool, i) => (
        <ToolCard key={i} tool={tool} agentName={agentName} accent={accent} token={token} address={address} />
      ))}
    </motion.div>
  );
}

// Per-reply provenance, DECLUTTERED: a TEE-verified reply renders NOTHING here (the model picker + the
// one-time honest-framing notice now carry the model + TEE story). We keep only the two honest labels the
// verifiability promise requires: (a) a "not TEE-attested" tag whenever a NON-attested fallback served the
// reply (the README commits the UI says so), and (b) a plain note when the model you PICKED was offline and
// another model served instead (so a substitution is never silent). A verified, no-substitution reply => null.
function ReplyBadge({ turn }: { turn: Turn }) {
  const attested = turn.teeAttested && turn.provider === "zerog";
  const showFallbackTag = !attested; // the reply itself was NOT TEE-attested
  const showModelNote = !!turn.modelFallback && !!turn.requestedModel;
  if (!showFallbackTag && !showModelNote) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 pl-1">
      {showFallbackTag ? (
        <span
          title="This reply was served by a fallback model (0G was unreachable). It is NOT TEE-attested."
          className="tag"
          style={{ border: "1px solid var(--color-border-strong)", background: "var(--color-paper)", color: "var(--color-ink-3)" }}
        >
          Fallback, not TEE-attested
        </span>
      ) : null}
      {showModelNote ? (
        <span className="text-[12.5px]" style={{ color: "var(--color-ink-3)" }}>
          picked {shortModelId(turn.requestedModel)} was offline, served by {shortModelId(turn.servedModel)}
        </span>
      ) : null}
    </div>
  );
}

function ToolCard({ tool, agentName, accent, token, address }: { tool: ChatToolInvocation; agentName: string; accent: string; token: string | null; address: string | null }) {
  if (tool.name === "generate_and_mint" && tool.job) {
    return <RelicMintCard jobId={tool.job.jobId} subject={tool.job.subject} agentName={agentName} accent={accent} token={token} address={address} />;
  }
  // read_onchain (or any other read tool) - a compact result card
  return (
    <div className="w-full max-w-[88%] rounded-[14px] border px-4 py-3" style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}>
      <div className="mb-1 label-caps text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
        {tool.ok ? "On-chain read" : "Action"} · {tool.name}
      </div>
      <div className="text-[16px]" style={{ color: "var(--color-ink-2)" }}>
        {tool.display}
      </div>
    </div>
  );
}

// Non-custodial mint card: the Aura started a REAL TEE generation; the owner mints by signing in their own
// wallet. Polls the job, previews the result, then signs OutputNFT.mintOutput via the existing useMint flow.
function RelicMintCard({ jobId, subject, agentName, accent, token, address }: { jobId: string; subject: string; agentName: string; accent: string; token: string | null; address: string | null }) {
  const [job, setJob] = useState<{ status: string; progress?: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [teeVerified, setTeeVerified] = useState<boolean | string | null>(null);
  const [mintArgs, setMintArgs] = useState<MintArgs | null>(null);
  const [mintedId, setMintedId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { state: mintState, busy: minting, mintOutput, reset: resetMint } = useMint();

  // poll the job until done|error
  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const j = await fetchJob(token, jobId);
        if (!alive) return;
        setJob({ status: j.status, progress: j.progress });
        if (j.status === "done" && j.result) {
          setTeeVerified(j.result.teeVerified);
          const url = await fetchJobImageObjectUrl(token, jobId);
          if (alive) setPreview(url);
          try {
            const ma = await fetchMintArgs(token, jobId);
            if (alive) setMintArgs(ma);
          } catch (e) {
            if (alive) setErr(e instanceof Error ? e.message : "mint-args failed");
          }
          return; // stop polling
        }
        if (j.status === "error") {
          setErr(j.error ?? "generation failed");
          return;
        }
        timer = setTimeout(tick, 3000);
      } catch {
        timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, jobId]);

  // Honor fetchJobImageObjectUrl's documented contract: the caller owns the blob URL and must revoke it.
  // Mirror GenerateView's pattern (revoke on change / unmount) so a chat-driven gen doesn't leak a blob.
  const previewRef = useRef<string | null>(null);
  useEffect(() => {
    previewRef.current = preview;
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, [preview]);

  const doMint = useCallback(async () => {
    if (!mintArgs) return;
    try {
      const id = await mintOutput(mintArgs);
      setMintedId(id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "mint failed");
    }
  }, [mintArgs, mintOutput]);

  const done = job?.status === "done";
  return (
    <div className="w-full max-w-[88%] overflow-hidden rounded-[16px] border" style={{ borderColor: "var(--color-border)", background: "var(--color-paper)" }}>
      <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 8%, var(--color-paper))` }}>
        <div className="label-caps text-[12px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
          New Relic · {agentName}
        </div>
        {done && teeVerified === true ? (
          <span className="label-caps text-[12px] uppercase tracking-[0.12em]" style={{ color: "var(--color-ok)" }}>
            TEE-verified
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <p className="mb-3 text-[16px]" style={{ color: "var(--color-ink-2)" }}>
          &ldquo;{subject}&rdquo;
        </p>

        {preview ? (
          <div className="overflow-hidden rounded-[12px] border" style={{ borderColor: "var(--color-border)" }}>
            <img src={preview} alt={subject} className="w-full" />
          </div>
        ) : (
          <div className="flex h-[160px] items-center justify-center rounded-[12px] border" style={{ borderColor: "var(--color-border)", background: "var(--color-cream-deep)" }} aria-busy={!err}>
            <span role="status" className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
              {err ? "could not create" : `creating inside the TEE... ${job?.status ?? ""}`}
            </span>
          </div>
        )}

        {/* mint (non-custodial) */}
        {done ? (
          mintedId != null || mintState.phase === "success" ? (
            <p role="status" className="mt-3 font-mono-x text-[16px]" style={{ color: "var(--color-ok)" }}>
              Minted{mintedId != null ? ` · Relic #${mintedId}` : ""}. It is yours.
            </p>
          ) : (
            <div className="mt-3">
              <ActionButton onClick={() => void doMint()} disabled={minting || !mintArgs || !address}>
                {minting ? (mintState.step ?? "Signing...") : "Mint this Relic"}
              </ActionButton>
              <p className="mt-2 font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                Non-custodial: you sign the mint in your own wallet. {agentName} never holds your keys.
              </p>
            </div>
          )
        ) : null}

        {err ? (
          <p role="alert" className="mt-2 font-mono-x text-[16px]" style={{ color: "var(--color-warn)" }}>
            {err}{" "}
            {mintState.phase === "error" ? (
              <button onClick={resetMint} className="underline">
                retry
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
