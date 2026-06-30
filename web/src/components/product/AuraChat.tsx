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
import { useCallback, useEffect, useRef, useState } from "react";
import { Panel, Chip, ActionButton } from "@/components/product/primitives";
import { useAuth } from "@/components/web3/AuthProvider";
import { useMint } from "@/lib/useMint";
import {
  sendChat,
  fetchChatHistory,
  fetchChatHealth,
  fetchJob,
  fetchJobImageObjectUrl,
  fetchMintArgs,
  type ChatReply,
  type ChatToolInvocation,
  type ChatHealth,
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
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchChatHealth().then(setHealth);
  }, []);

  // load the owner-scoped relationship history once signed in
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
        setTurns(seeded);
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
    let t = token;
    if (!t) {
      try {
        t = await signIn();
      } catch {
        return;
      }
    }
    setError(null);
    setInput("");
    setSending(true);
    setTurns((prev) => [...prev, { role: "owner", text: message }, { role: "aura", text: "", pending: true }]);
    try {
      const r = await sendChat(t, agentId, message);
      setTurns((prev) => {
        const next = [...prev];
        // replace the trailing pending aura bubble
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === "aura" && next[i].pending) {
            next[i] = { role: "aura", text: r.reply, provider: r.provider, teeAttested: r.teeAttested, attestation: r.attestation, tools: r.toolInvocations };
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
  }, [input, sending, token, signIn, agentId]);

  return { token, address: address ?? null, status, turns, input, setInput, sending, error, health, scrollRef, send };
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

// The empty-state prompt shown before the first turn.
function ChatEmpty({ agentName }: { agentName: string }) {
  return (
    <div className="m-auto max-w-[40ch] text-center">
      <p className="text-[14px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
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

// The honest framing footnote (verifiable scope of a turn).
function HonestFraming() {
  return (
    <p className="text-[11px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
      Replies served by 0G run inside a TEE and are hardware-attested per reply. Your relationship memory is private and owner-scoped (it re-seals on resale). A full turn is not a single proof: any on-chain action is separately verifiable, and your private memory is yours alone.
    </p>
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
        className="min-h-[44px] flex-1 resize-none rounded-[14px] border bg-transparent px-3 py-3 text-[14px] outline-none"
        style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
      />
      <div className="w-[120px]">
        <ActionButton onClick={() => void c.send()} disabled={c.sending || c.status === "signing"}>
          {c.sending ? "..." : !c.token ? "Sign in" : "Send"}
        </ActionButton>
      </div>
    </div>
  );
}

// ── Surface 1: the inline Panel (embeddable) ───────────────────────────────
export function AuraChat({ agentId, agentName, accent }: { agentId: number; agentName: string; accent: string }) {
  const c = useAuraChat(agentId);
  return (
    <Panel className="mt-7 overflow-hidden p-0">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 7%, var(--color-paper))` }}>
        <div>
          <div className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            Talk to the Aura
          </div>
          <div className="font-display" style={{ fontSize: "22px", lineHeight: 1.1 }}>
            {agentName}
          </div>
        </div>
        <HealthBadge health={c.health} accent={accent} />
      </div>

      {/* transcript */}
      <div ref={c.scrollRef} className="flex max-h-[440px] min-h-[220px] flex-col gap-4 overflow-y-auto px-5 py-5">
        <ChatBody c={c} agentName={agentName} accent={accent} />
      </div>

      {/* honest framing */}
      <div className="border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
        <HonestFraming />
      </div>

      {/* composer */}
      <ChatComposer c={c} agentName={agentName} />
      {c.error ? (
        <p className="px-5 pb-4 font-mono-x text-[11px]" style={{ color: "#c0392b" }}>
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
    <div className="flex h-full min-h-0 flex-col">
      {/* header */}
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4 sm:px-6" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 7%, var(--color-paper))` }}>
        <div>
          <div className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            Talk to the Aura
          </div>
          <div className="font-display" style={{ fontSize: "22px", lineHeight: 1.1 }}>
            {agentName}
          </div>
        </div>
        <HealthBadge health={c.health} accent={accent} />
      </div>

      {/* transcript (fills the available height) */}
      <div ref={c.scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-6 sm:px-6">
        <ChatBody c={c} agentName={agentName} accent={accent} />
      </div>

      {/* honest framing */}
      <div className="border-t px-5 py-3 sm:px-6" style={{ borderColor: "var(--color-border)" }}>
        <HonestFraming />
      </div>

      {/* composer */}
      <ChatComposer c={c} agentName={agentName} />
      {c.error ? (
        <p className="px-5 pb-4 font-mono-x text-[11px]" style={{ color: "#c0392b" }}>
          {c.error}
        </p>
      ) : null}
    </div>
  );
}

function ChatBubble({ turn, agentName, accent, token, address }: { turn: Turn; agentName: string; accent: string; token: string | null; address: string | null }) {
  if (turn.role === "owner") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[16px] px-4 py-2.5 text-[14px] leading-relaxed" style={{ background: "var(--color-cream-deep)", color: "var(--color-ink)" }}>
          {turn.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="max-w-[88%] rounded-[16px] border px-4 py-2.5 text-[14px] leading-relaxed" style={{ borderColor: "var(--color-border)", background: `color-mix(in oklab, ${accent} 8%, var(--color-paper))`, color: "var(--color-ink)" }}>
        {turn.pending ? <span style={{ color: "var(--color-ink-3)" }}>{agentName} is thinking...</span> : turn.text}
      </div>

      {/* per-reply provenance badge (honest) */}
      {!turn.pending && turn.provider ? (
        <ReplyBadge turn={turn} />
      ) : null}

      {/* command-surface tool results */}
      {turn.tools?.map((tool, i) => (
        <ToolCard key={i} tool={tool} agentName={agentName} accent={accent} token={token} address={address} />
      ))}
    </div>
  );
}

function ReplyBadge({ turn }: { turn: Turn }) {
  const attested = turn.teeAttested && turn.provider === "zerog";
  const model = turn.attestation?.model;
  const signer = turn.attestation?.teeSigner;
  return (
    <div className="flex flex-wrap items-center gap-2 pl-1">
      {attested ? (
        <span
          title={`TEE-verified by ${signer ?? "the TEE signer"} (verifiability ${turn.attestation?.verifiability ?? "TeeML"}). This reply provably ran in a 0G TEE.`}
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono-x text-[10px] uppercase tracking-[0.12em]"
          style={{ borderColor: "color-mix(in oklab, #1f9d55 50%, var(--color-border))", color: "#1f9d55" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 99, background: "#1f9d55" }} />
          TEE-verified{model ? ` · ${model.split("/").pop()}` : ""}
        </span>
      ) : (
        <span
          title="This reply was served by a fallback model (0G was unreachable). It is NOT TEE-attested."
          className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono-x text-[10px] uppercase tracking-[0.12em]"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink-3)" }}
        >
          Fallback · not TEE-attested
        </span>
      )}
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
      <div className="mb-1 font-mono-x text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
        {tool.ok ? "On-chain read" : "Action"} · {tool.name}
      </div>
      <div className="text-[13px]" style={{ color: "var(--color-ink-2)" }}>
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
        <div className="font-mono-x text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
          New Relic · {agentName}
        </div>
        {done && teeVerified === true ? (
          <span className="font-mono-x text-[10px] uppercase tracking-[0.12em]" style={{ color: "#1f9d55" }}>
            TEE-verified
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <p className="mb-3 text-[13px]" style={{ color: "var(--color-ink-2)" }}>
          &ldquo;{subject}&rdquo;
        </p>

        {preview ? (
          <div className="overflow-hidden rounded-[12px] border" style={{ borderColor: "var(--color-border)" }}>
            <img src={preview} alt={subject} className="w-full" />
          </div>
        ) : (
          <div className="flex h-[160px] items-center justify-center rounded-[12px] border" style={{ borderColor: "var(--color-border)", background: "var(--color-cream-deep)" }}>
            <span className="font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>
              {err ? "could not create" : `creating inside the TEE... ${job?.status ?? ""}`}
            </span>
          </div>
        )}

        {/* mint (non-custodial) */}
        {done ? (
          mintedId != null || mintState.phase === "success" ? (
            <p className="mt-3 font-mono-x text-[12px]" style={{ color: "#1f9d55" }}>
              Minted{mintedId != null ? ` · Relic #${mintedId}` : ""}. It is yours.
            </p>
          ) : (
            <div className="mt-3">
              <ActionButton onClick={() => void doMint()} disabled={minting || !mintArgs || !address}>
                {minting ? (mintState.step ?? "Signing...") : "Mint this Relic"}
              </ActionButton>
              <p className="mt-2 font-mono-x text-[10px]" style={{ color: "var(--color-ink-3)" }}>
                Non-custodial: you sign the mint in your own wallet. {agentName} never holds your keys.
              </p>
            </div>
          )
        ) : null}

        {err ? (
          <p className="mt-2 font-mono-x text-[11px]" style={{ color: "#c0392b" }}>
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
