"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther } from "viem";
import { APP_CHAIN, EXPLORER } from "@/lib/chains";
import { CONTRACTS, SUMMON_ENABLED, summonEscrowAbi } from "@/lib/contracts";
import { fetchSummonStatus, imageUrl, shortHex, type SummonStatus } from "@/lib/api";
import { useSummon } from "@/lib/useSummon";
import { ActionButton, Chip, ProvLine, StepRail, type StepStatus } from "@/components/product/primitives";

// The wallet-signed SUMMON panel for the agent detail page. A buyer PAYS to commission the agent; the
// agent generates LIVE (the watcher runs the ~42s TEE gen), mints the 1/1 to the buyer, and the fee
// splits to the agent's CURRENT owner. We poll GET /summon/:id/status for the staged progress so the
// ~42s wait is a narrated sequence, never a dead spinner. Owner sees set-price + withdraw-earnings.

const TERMINAL = new Set(["fulfilled", "settled", "refunded"]);

function progressSteps(status: string, delivered: boolean): { label: string; status: StepStatus }[] {
  if (status === "expired") {
    return [
      { label: "Payment escrowed", status: "done" },
      { label: "Aura did not deliver in time", status: "error" },
      { label: "Attested + minted to you", status: "pending" },
      { label: "Delivered to your wallet", status: "pending" },
    ];
  }
  const fulfilling = status === "fulfilling";
  const isDelivered = delivered || status === "fulfilled" || status === "settled";
  return [
    { label: "Payment escrowed", status: "done" },
    { label: "Aura generating inside the TEE", status: isDelivered || fulfilling ? "done" : "active" },
    { label: "TEE attested + minting to you", status: isDelivered ? "done" : fulfilling ? "active" : "pending" },
    { label: "Delivered to your wallet", status: isDelivered ? "done" : "pending" },
  ];
}

export function SummonPanel({
  agentId,
  agentName,
  owner,
  note,
}: {
  agentId: number;
  agentName: string;
  owner: string;
  note?: React.ReactNode;
}) {
  const { address, isConnected } = useAccount();
  const { state, busy, summon, setSummonPrice, withdraw, refund, reset } = useSummon();
  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const escrow = CONTRACTS.summonEscrow || undefined;

  // live commission price (on-chain)
  const { data: priceWei, refetch: refetchPrice } = useReadContract({
    address: escrow,
    abi: summonEscrowAbi,
    functionName: "summonPrice",
    args: [BigInt(agentId)],
    chainId: APP_CHAIN.id,
    query: { enabled: SUMMON_ENABLED },
  });
  const price = priceWei !== undefined ? formatEther(priceWei) : null;
  const summonable = priceWei !== undefined && priceWei > 0n;

  // owner's accrued summon earnings (pull balance)
  const { data: pendingWei, refetch: refetchPending } = useReadContract({
    address: escrow,
    abi: summonEscrowAbi,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    chainId: APP_CHAIN.id,
    query: { enabled: SUMMON_ENABLED && isOwner && !!address },
  });
  const earnings = pendingWei !== undefined ? formatEther(pendingWei) : "0";
  const hasEarnings = pendingWei !== undefined && pendingWei > 0n;

  // active request tracking + status poll (the ~42s narrated progress)
  const [requestId, setRequestId] = useState<number | null>(null);
  const [status, setStatus] = useState<SummonStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const terminal = !!status && (TERMINAL.has(status.status) || status.expired);

  useEffect(() => {
    if (requestId === null) return;
    let stop = false;
    const tick = async () => {
      const s = await fetchSummonStatus(requestId);
      if (stop) return;
      setStatus(s);
      if (s && (TERMINAL.has(s.status) || s.expired)) {
        void refetchPending();
        return; // stop polling on a terminal state
      }
      setTimeout(tick, 3000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [requestId, refetchPending]);

  useEffect(() => {
    if (requestId === null || terminal) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [requestId, terminal]);

  // Resume tracking a summon from the URL (?summon=<requestId>) - survives a refresh, and lets a shared
  // status link (or the just-paid redirect) land straight on the live progress / delivered card.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = new URLSearchParams(window.location.search).get("summon");
    if (s && /^\d+$/.test(s)) setRequestId(Number(s));
  }, []);

  const [priceInput, setPriceInput] = useState("");
  const validPrice = (v: string) => /^\d*\.?\d+$/.test(v) && Number(v) > 0;

  const onSummon = useCallback(async () => {
    if (!price) return;
    const id = await summon(agentId, price);
    if (id !== null) {
      setRequestId(id);
      setStatus(null);
      setElapsed(0);
    }
  }, [price, summon, agentId]);

  const onSetPrice = useCallback(async () => {
    const okPrice = await setSummonPrice(agentId, priceInput);
    if (okPrice) {
      setPriceInput("");
      void refetchPrice();
    }
  }, [setSummonPrice, agentId, priceInput, refetchPrice]);

  // not wired on this deployment -> render nothing (the page still shows trade).
  if (!SUMMON_ENABLED) return null;

  const delivered = !!status && (status.status === "fulfilled" || status.status === "settled") && !!status.tokenId;

  return (
    <div
      className="rounded-[22px] border p-6"
      style={{ borderColor: "var(--color-border-strong)", background: "var(--color-cream-warm)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
          Summon
        </span>
        {summonable ? <Chip tone="accent">Live commission</Chip> : <Chip>Not summonable</Chip>}
      </div>

      {note ? (
        <div className="mt-4 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
          {note}
        </div>
      ) : null}

      {/* price headline */}
      {summonable ? (
        <div className="mt-5">
          <div className="font-display" style={{ fontSize: "clamp(34px,6vw,54px)", lineHeight: 1, letterSpacing: "-0.01em" }}>
            {price} <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>0G</span>
          </div>
          <div className="mt-1 font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
            commission an original 1/1, generated live by {agentName}
          </div>
        </div>
      ) : null}

      <ProvLine className="my-5" />

      {/* ── in-flight / delivered summon ── */}
      {requestId !== null ? (
        <div className="space-y-4">
          <StepRail steps={progressSteps(status?.status ?? "pending", delivered)} />

          {!terminal ? (
            <div role="status" aria-live="polite" className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
              live generation takes ~42s inside the TEE · {elapsed}s elapsed
            </div>
          ) : null}

          {delivered ? (
            <DeliveredCard status={status!} />
          ) : status?.expired ? (
            <div className="space-y-3">
              <div role="alert" className="rounded-xl border p-3 text-[16px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
                The Aura did not deliver before the deadline. Reclaim your payment (anti-rug).
              </div>
              <ActionButton variant="warn" onClick={() => refund(requestId)} disabled={busy}>
                {busy && state.action === "refund" ? "Refunding…" : "Refund my payment"}
              </ActionButton>
            </div>
          ) : null}
        </div>
      ) : !isConnected ? (
        <div className="space-y-3">
          <p className="text-[16px]" style={{ color: "var(--color-ink-2)" }}>
            Connect a wallet on the 0G Galileo testnet to summon {agentName}.
          </p>
          <ConnectButton.Custom>
            {({ openConnectModal }) => <ActionButton onClick={openConnectModal}>Connect wallet</ActionButton>}
          </ConnectButton.Custom>
        </div>
      ) : summonable ? (
        <ActionButton onClick={onSummon} disabled={busy || !price}>
          {busy && state.action === "summon" ? phaseLabel(state.phase) : `Summon for ${price} 0G`}
        </ActionButton>
      ) : (
        <p className="text-[16px]" style={{ color: "var(--color-ink-2)" }}>
          {isOwner
            ? "You own this Aura. Set a commission price below to let collectors summon it."
            : "The owner hasn’t opened this Aura for commissions yet."}
        </p>
      )}

      {/* ── owner controls: price + earnings ── */}
      {isOwner ? (
        <div className="mt-6 space-y-3 rounded-[16px] border p-4" style={{ borderColor: "var(--color-border)" }}>
          <div className="label-caps text-[13px] uppercase tracking-[0.14em]" style={{ color: "var(--color-ink-3)" }}>
            Owner · this Aura earns for you
          </div>
          <div className="micro flex items-center rounded-[14px] border px-4 focus-within:border-[var(--color-accent)]" style={{ borderColor: "var(--color-border-strong)", background: "var(--color-paper)" }}>
            <input
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              placeholder={summonable ? `Update price (now ${price} 0G)` : "Set a commission price (e.g. 0.05)"}
              aria-label={summonable ? `Update commission price for ${agentName} in 0G` : `Set a commission price for ${agentName} in 0G`}
              className="w-full bg-transparent py-3 font-medium text-[16px] outline-none"
              style={{ color: "var(--color-ink)" }}
            />
            <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>0G</span>
          </div>
          <ActionButton variant="outline" onClick={onSetPrice} disabled={busy || !validPrice(priceInput)}>
            {busy && state.action === "setPrice" ? phaseLabel(state.phase) : summonable ? "Update commission price" : "Open for commissions"}
          </ActionButton>
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
              earnings to withdraw
            </div>
            <div className="font-mono-x text-[16px]" style={{ color: hasEarnings ? "var(--color-ok)" : "var(--color-ink-3)" }}>
              {earnings} 0G
            </div>
          </div>
          {hasEarnings ? (
            <ActionButton
              onClick={() => {
                void withdraw().then((okW) => {
                  if (okW) void refetchPending();
                });
              }}
              disabled={busy}
            >
              {busy && state.action === "withdraw" ? phaseLabel(state.phase) : `Withdraw ${earnings} 0G`}
            </ActionButton>
          ) : null}
        </div>
      ) : null}

      {/* ── write-tx status feedback (wallet prompt / confirm / error) ── */}
      <WriteStatus state={state} onReset={reset} />
    </div>
  );
}

function DeliveredCard({ status }: { status: SummonStatus }) {
  return (
    <div className="rounded-[16px] border p-4" style={{ borderColor: "color-mix(in oklab, var(--color-ok) 40%, transparent)" }}>
      <div className="flex items-center gap-2">
        <Chip tone="ok">Delivered</Chip>
        <span className="font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
          relic #{status.tokenId}
        </span>
      </div>
      {status.imageRoot ? (
        <Link href={`/outputs/${status.tokenId}`} className="mt-3 block overflow-hidden rounded-[12px] border" style={{ borderColor: "var(--color-border)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(status.imageRoot)} alt={`Summoned relic #${status.tokenId}`} className="block w-full" loading="lazy" />
        </Link>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[16px]">
        <Link href={`/verify?id=${status.tokenId}`} className="underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
          Verify provenance + the paid split
        </Link>
        {status.fulfillTx ? (
          <a href={`${EXPLORER}/tx/${status.fulfillTx}`} target="_blank" rel="noreferrer" className="font-mono-x underline underline-offset-4" style={{ color: "var(--color-ink-3)" }}>
            {shortHex(status.fulfillTx)} on 0G Scan
          </a>
        ) : null}
      </div>
      <p className="mt-3 text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
        Yours now. The {status.fee ?? ""} 0G fee just paid the Aura&rsquo;s current owner, and every future
        resale royalty follows the Aura too.
      </p>
    </div>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "pending":
      return "Confirm in wallet…";
    case "confirming":
      return "Confirming…";
    default:
      return "Working…";
  }
}

function WriteStatus({ state, onReset }: { state: ReturnType<typeof useSummon>["state"]; onReset: () => void }) {
  if (state.phase === "idle") return null;
  if (state.phase === "error") {
    return (
      <div role="alert" className="mt-4 rounded-xl border p-3 text-[16px]" style={{ borderColor: "var(--color-warn)", color: "var(--color-warn)" }}>
        <div className="font-medium">{state.error}</div>
        <button type="button" onClick={onReset} className="mt-2 underline underline-offset-4">
          Try again
        </button>
      </div>
    );
  }
  if (state.phase === "success" && state.action !== "summon") {
    return (
      <div role="status" className="mt-4 rounded-xl border p-3 text-[16px]" style={{ borderColor: "color-mix(in oklab, var(--color-ok) 40%, transparent)", color: "var(--color-ok)" }}>
        <div className="font-medium">{state.step ?? "Done"} ✓</div>
        <button type="button" onClick={onReset} className="mt-1 underline underline-offset-4">
          Done
        </button>
      </div>
    );
  }
  if (state.phase === "pending" || state.phase === "confirming") {
    return (
      <div role="status" aria-busy="true" className="mt-4 rounded-xl border p-3 font-mono-x text-[16px]" style={{ borderColor: "var(--color-border-strong)", color: "var(--color-ink-2)" }}>
        {state.step ?? "Working…"}
        {state.txHash ? (
          <a href={`${EXPLORER}/tx/${state.txHash}`} target="_blank" rel="noreferrer" className="ml-2 underline underline-offset-4" style={{ color: "var(--color-accent)" }}>
            {shortHex(state.txHash)}
          </a>
        ) : null}
      </div>
    );
  }
  return null;
}
