"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { EXPLORER } from "@/lib/chains";
import { shortHex, type MarketListing } from "@/lib/api";
import { useTrade, type TradeKind } from "@/lib/useTrade";
import { ActionButton, Chip, ProvLine } from "@/components/product/primitives";

// The shared, wallet-signed trade panel for BOTH the agent detail and the output detail page. The
// backend only supplies the read data (the current listing); this component builds + sends every
// transaction via useTrade (wagmi/viem on chain 16602, manual receipt poll). It renders the correct
// controls from three facts: connected? owner? listed?
//
//   listed + not owner  -> BUY (marketplace.buy(collection, tokenId) { value: price })
//   owner + listed      -> UPDATE PRICE + CANCEL
//   owner + not listed  -> LIST (setApprovalForAll if needed, then list(collection, tokenId, price))
//   not owner + unlisted -> "not listed" (+ the buy story is shown when it later lists)
export function TradePanel({
  kind,
  tokenId,
  owner,
  listing,
  /** Extra story shown under the panel header (e.g. the royalty-follows-the-agent note). */
  note,
}: {
  kind: TradeKind;
  tokenId: number;
  owner: string;
  listing: MarketListing | null;
  note?: React.ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const { state, busy, buy, list, cancel, updatePrice, reset } = useTrade();
  const [priceInput, setPriceInput] = useState("");

  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const isListed = !!listing;
  const price = listing?.price ?? null;
  // User-facing noun for this asset kind (the lexicon: an agent is an "Aura", an output is a "Relic").
  const noun = kind === "agent" ? "Aura" : "Relic";

  const validPrice = (v: string) => /^\d*\.?\d+$/.test(v) && Number(v) > 0;

  return (
    <div className="rounded-[22px] border p-6" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-cream-warm)" }}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono-x text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          Trade
        </span>
        {isListed ? (
          <Chip tone="accent">For sale</Chip>
        ) : (
          <Chip>Not listed</Chip>
        )}
      </div>

      {note ? <div className="mt-4 text-[13px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>{note}</div> : null}

      {/* Price headline when listed */}
      {isListed ? (
        <div className="mt-5">
          <div className="font-display" style={{ fontSize: "clamp(34px,6vw,54px)", lineHeight: 1, letterSpacing: "-0.01em" }}>
            {price} <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>0G</span>
          </div>
          <div className="mt-1 font-mono-x text-[11px]" style={{ color: "var(--color-ink-3)" }}>
            seller {shortHex(listing!.seller)}
          </div>
        </div>
      ) : null}

      <ProvLine className="my-5" />

      {/* ── The controls ── */}
      {!isConnected ? (
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: "var(--color-ink-2)" }}>
            Connect a wallet on the 0G Galileo testnet to {isListed ? "buy" : "trade"} this {noun}.
          </p>
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <ActionButton onClick={openConnectModal}>Connect wallet</ActionButton>
            )}
          </ConnectButton.Custom>
        </div>
      ) : isListed && !isOwner ? (
        // BUY
        <ActionButton onClick={() => buy(kind, tokenId, price!)} disabled={busy}>
          {busy ? labelFor(state.phase) : `Buy for ${price} 0G`}
        </ActionButton>
      ) : isOwner && isListed ? (
        // UPDATE PRICE + CANCEL (seller-only)
        <div className="space-y-3">
          <PriceField value={priceInput} onChange={setPriceInput} placeholder={`New price (current ${price} 0G)`} />
          <ActionButton onClick={() => updatePrice(kind, tokenId, priceInput)} disabled={busy || !validPrice(priceInput)}>
            {busy && state.action === "updatePrice" ? labelFor(state.phase) : "Update price"}
          </ActionButton>
          <ActionButton variant="warn" onClick={() => cancel(kind, tokenId)} disabled={busy}>
            {busy && state.action === "cancel" ? labelFor(state.phase) : "Cancel listing"}
          </ActionButton>
        </div>
      ) : isOwner && !isListed ? (
        // LIST (with the one-time approval pre-step)
        <div className="space-y-3">
          <p className="text-[13px]" style={{ color: "var(--color-ink-2)" }}>
            You own this {noun}. List it for sale. The first listing approves the marketplace as an
            operator (one-time), then posts the price on-chain.
          </p>
          <PriceField value={priceInput} onChange={setPriceInput} placeholder="Price in 0G (e.g. 0.05)" />
          <ActionButton onClick={() => list(kind, tokenId, priceInput)} disabled={busy || !validPrice(priceInput)}>
            {busy && state.action === "list" ? labelFor(state.phase) : "List for sale"}
          </ActionButton>
        </div>
      ) : (
        // not owner + not listed
        <p className="text-[13px]" style={{ color: "var(--color-ink-2)" }}>
          This {noun} is not currently listed for sale. When the owner lists it, a Buy action appears
          here.
        </p>
      )}

      {/* ── Status / receipt feedback ── */}
      <TradeStatus state={state} onReset={reset} />
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
    <div className="flex items-center rounded-full border px-4" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)" }}>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent py-3 font-mono-x text-[13px] outline-none"
        style={{ color: "var(--color-ink)" }}
      />
      <span className="font-mono-x text-[12px]" style={{ color: "var(--color-ink-3)" }}>0G</span>
    </div>
  );
}

function labelFor(phase: string): string {
  switch (phase) {
    case "signin":
      return "Signing in...";
    case "approving":
      return "Approving...";
    case "pending":
      return "Confirm in wallet...";
    case "confirming":
      return "Confirming...";
    default:
      return "Working...";
  }
}

function TradeStatus({ state, onReset }: { state: ReturnType<typeof useTrade>["state"]; onReset: () => void }) {
  if (state.phase === "idle") return null;

  const txHash = state.txHash ?? state.approvalTxHash;
  if (state.phase === "error") {
    return (
      <div className="mt-4 rounded-xl border p-3 text-[12px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
        <div className="font-mono-x">{state.error}</div>
        <button type="button" onClick={onReset} className="mt-2 underline underline-offset-4">Try again</button>
      </div>
    );
  }
  if (state.phase === "success") {
    return (
      <div className="mt-4 rounded-xl border p-3 text-[12px]" style={{ borderColor: "color-mix(in oklab, var(--color-ok) 40%, transparent)", color: "var(--color-ok)" }}>
        <div className="font-mono-x">{state.step ?? "Done"} ✓</div>
        {txHash ? (
          <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono-x underline underline-offset-4">
            {shortHex(txHash)} on 0G Scan
          </a>
        ) : null}
        <button type="button" onClick={onReset} className="ml-3 mt-1 underline underline-offset-4">Done</button>
      </div>
    );
  }
  // in-flight
  return (
    <div className="mt-4 rounded-xl border p-3 font-mono-x text-[12px]" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}>
      {state.step ?? "Working..."}
      {txHash ? (
        <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
          {shortHex(txHash)}
        </a>
      ) : null}
    </div>
  );
}
