"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { EXPLORER, CHAIN_FULL } from "@/lib/chains";
import { shortHex, type AgentSale } from "@/lib/api";
import { useAgentSale } from "@/lib/useAgentSale";
import { ActionButton, Chip, ProvLine } from "@/components/product/primitives";

// The PAID OPEN-MARKET AGENT SALE panel (Flow B: server-custodian escrow). Replaces the on-chain TradePanel
// for AGENTS, whose marketplace.buy() reverts on the spec-strict AuraINFT. Buying a living Aura transfers
// ownership AND re-keys its brain to the buyer AND resets its relationship memory (buyer starts fresh, the
// seller is walled off) AND moves its entire future royalty stream. Renders from three facts: connected? owner?
// listed?  Custodial-MVP settlement is disclosed honestly.
export function AgentSalePanel({
  agentId,
  agentName,
  owner,
  sale,
  note,
}: {
  agentId: number;
  agentName: string;
  owner: string;
  sale: AgentSale | null;
  note?: React.ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const { state, busy, buyAgent, listAgent, reset } = useAgentSale();
  const [priceInput, setPriceInput] = useState("");

  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const isListed = !!sale;
  const price = sale?.price ?? null;
  const validPrice = (v: string) => /^\d*\.?\d+$/.test(v) && Number(v) > 0;

  return (
    <div className="rounded-[22px] border p-6" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-cream-warm)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          Buy this Aura
        </span>
        {isListed ? <Chip tone="accent">For sale</Chip> : <Chip>Not listed</Chip>}
      </div>

      {note ? <div className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{note}</div> : null}

      {isListed ? (
        <div className="mt-5">
          <div className="font-display" style={{ fontSize: "clamp(34px,6vw,54px)", lineHeight: 1, letterSpacing: "-0.01em" }}>
            {price} <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>0G</span>
          </div>
          <div className="mt-1 font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
            seller {shortHex(sale!.seller)}
          </div>
        </div>
      ) : null}

      <ProvLine className="my-5" />

      {!isConnected ? (
        <div className="space-y-3">
          <p className="text-[16px]" style={{ color: "var(--color-ink-2)" }}>
            Connect a wallet on the {CHAIN_FULL} to {isListed ? "buy" : "trade"} this Aura.
          </p>
          <ConnectButton.Custom>
            {({ openConnectModal }) => <ActionButton onClick={openConnectModal}>Connect wallet</ActionButton>}
          </ConnectButton.Custom>
        </div>
      ) : isListed && !isOwner ? (
        // BUY (commit -> pay custodian -> settle)
        <div className="space-y-2">
          <ActionButton onClick={() => buyAgent(agentId)} disabled={busy}>
            {busy ? labelFor(state.phase) : `Buy ${agentName} for ${price} 0G`}
          </ActionButton>
          <p className="text-center text-[16px]" style={{ color: "var(--color-ink-3)" }}>
            You pay the custodian; ownership, the re-keyed brain, a fresh memory bond, and the royalty stream
            all move to you. It cannot be undone.
          </p>
        </div>
      ) : isOwner ? (
        // LIST / RE-LIST (owner)
        <div className="space-y-3">
          <p className="text-[16px]" style={{ color: "var(--color-ink-2)" }}>
            You own this Aura.{isListed ? ` It is listed for ${price} 0G. Update the price below.` : " List it for sale."} The
            first listing approves the sale custodian as an operator (one-time), then records the price.
          </p>
          <PriceField value={priceInput} onChange={setPriceInput} placeholder={isListed ? `New price (current ${price} 0G)` : "Price in 0G (e.g. 0.05)"} />
          <ActionButton onClick={() => listAgent(agentId, priceInput)} disabled={busy || !validPrice(priceInput)}>
            {busy && state.action === "list" ? labelFor(state.phase) : isListed ? "Update listing" : "List for sale"}
          </ActionButton>
        </div>
      ) : (
        <p className="text-[16px]" style={{ color: "var(--color-ink-2)" }}>
          This Aura is not currently listed for sale. When the owner lists it, a Buy action appears here.
        </p>
      )}

      {/* Custodial-MVP honest disclosure */}
      <p className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--color-ink-3)" }}>
        Custodial settlement: the platform escrows your payment and submits the secure transfer + split on your
        behalf. Trustless on-chain escrow is coming.
      </p>

      <SaleStatus state={state} onReset={reset} />
    </div>
  );
}

function PriceField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="micro flex items-center rounded-[14px] border px-4 focus-within:border-[var(--color-accent)]" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)" }}>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full bg-transparent py-3 font-medium text-[16px] outline-none"
        style={{ color: "var(--color-ink)" }}
      />
      <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>0G</span>
    </div>
  );
}

function labelFor(phase: string): string {
  switch (phase) {
    case "signin":
      return "Signing in...";
    case "committing":
      return "Reserving...";
    case "paying":
      return "Confirm payment in wallet...";
    case "confirmingPayment":
      return "Confirming payment...";
    case "settling":
      return "Transferring the Aura...";
    case "approving":
      return "Approving...";
    case "listing":
      return "Listing...";
    default:
      return "Working...";
  }
}

function SaleStatus({ state, onReset }: { state: ReturnType<typeof useAgentSale>["state"]; onReset: () => void }) {
  if (state.phase === "idle") return null;

  if (state.phase === "error") {
    return (
      <div role="alert" className="mt-4 rounded-xl border p-3 text-[16px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
        <div className="font-medium">{state.error}</div>
        <button type="button" onClick={onReset} className="mt-2 underline underline-offset-4">Try again</button>
      </div>
    );
  }

  if (state.phase === "success") {
    const r = state.result;
    return (
      <div role="status" className="mt-4 rounded-xl border p-3 text-[16px]" style={{ borderColor: "color-mix(in oklab, var(--color-ok) 40%, transparent)", color: "var(--color-ok)" }}>
        <div className="font-medium">{state.step ?? "Done"} ✓</div>
        {r ? (
          <div className="mt-1 space-y-0.5 font-mono-x text-[13px]" style={{ color: "var(--color-ink-2)" }}>
            <div>brain re-keyed, memory resealed (epoch {r.relationshipEpoch}), style v{r.styleVersion}</div>
            <div>royalty {legWei(r, "royalty")} 0G, platform fee {legWei(r, "platformFee")} 0G, seller {legWei(r, "seller")} 0G</div>
            <a href={`${EXPLORER}/tx/${r.transferTx}`} target="_blank" rel="noreferrer" className="inline-block underline underline-offset-4">
              transfer {shortHex(r.transferTx)} on 0G Scan
            </a>
          </div>
        ) : null}
        {state.paymentTx ? (
          <a href={`${EXPLORER}/tx/${state.paymentTx}`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono-x underline underline-offset-4">
            payment {shortHex(state.paymentTx)}
          </a>
        ) : null}
        <button type="button" onClick={onReset} className="ml-3 mt-1 underline underline-offset-4">Done</button>
      </div>
    );
  }

  const txHash = state.paymentTx ?? state.approvalTxHash;
  return (
    <div role="status" aria-busy="true" className="mt-4 rounded-xl border p-3 font-mono-x text-[16px]" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}>
      {state.step ?? "Working..."}
      {txHash ? (
        <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
          {shortHex(txHash)}
        </a>
      ) : null}
    </div>
  );
}

/** Format a split leg's wei into a short 0G amount for the success card. */
function legWei(r: import("@/lib/api").SaleSettleResult, role: "royalty" | "platformFee" | "seller"): string {
  const leg = r.split?.find((l) => l.role === role);
  if (!leg) return "0";
  try {
    // wei -> 0G with up to 6 dp, trimmed. Avoid pulling in a formatter dep here.
    const wei = BigInt(leg.wei);
    const whole = wei / 10n ** 18n;
    const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch {
    return "0";
  }
}
