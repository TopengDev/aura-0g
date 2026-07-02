"use client";

// App Router root error boundary. Without this, a single render throw during the demo drops the user on
// Next's raw unstyled error page. This degrades gracefully in the Technical-Editorial system (PageHeader
// + Panel) and offers reset() (re-render the segment) plus an escape home. Client component by contract.
import { useEffect } from "react";
import Link from "next/link";
import { PageHeader, Panel, ProvLine, ActionButton } from "@/components/product/primitives";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for debugging; no external logging is wired (privacy-branded product, no silent egress).
    console.error(error);
  }, [error]);

  return (
    <section className="relative px-5 py-20 sm:px-8 sm:py-28">
      <div className="mx-auto w-full max-w-[var(--container-wrap)]">
        <PageHeader
          kicker="Something broke"
          marker="error"
          title={<>An unexpected error.</>}
          lede="A render error interrupted this page. The rest of AURA is unaffected. Try again, or head back home."
        />
        <Panel className="mt-8 p-6 sm:p-8">
          <div className="label-caps text-[13px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-3)" }}>
            What you can do
          </div>
          <ProvLine className="my-4" />
          <p className="max-w-[58ch] text-[16px] leading-relaxed" style={{ color: "var(--color-ink-2)" }}>
            Retrying re-renders just this section. If it keeps failing, the backend or the chain read may be
            momentarily unavailable; the live demo elsewhere is unaffected.
          </p>
          {error?.digest ? (
            <p className="mt-4 font-mono-x text-[16px]" style={{ color: "var(--color-ink-3)" }}>
              ref {error.digest}
            </p>
          ) : null}
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:max-w-[520px]">
            <ActionButton onClick={() => reset()}>Try again</ActionButton>
            <Link
              href="/"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 font-semibold text-[16px] transition-opacity hover:opacity-85"
              style={{ background: "transparent", color: "var(--color-ink)", border: "1px solid var(--color-border-strong)" }}
            >
              Back to home
            </Link>
          </div>
        </Panel>
      </div>
    </section>
  );
}
