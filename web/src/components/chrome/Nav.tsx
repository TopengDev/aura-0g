"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { EASE } from "@/lib/motion";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { CustomConnectButton } from "@/components/web3/CustomConnectButton";

type NavLink = { href: string; label: string; connectedOnly?: boolean };

const LINKS: NavLink[] = [
  { href: "/agents", label: "Auras" },
  { href: "/explore", label: "Explore" },
  { href: "/generate", label: "Generate" },
  { href: "/create", label: "Create" },
  { href: "/cli", label: "CLI" },
  { href: "/dashboard", label: "Dashboard", connectedOnly: true },
];

// Fixed top bar: transparent -> frosted hairline on scroll. Left = AURA wordmark. Center (md+) =
// 5 mono links (Dashboard only when connected). Right = Connect + theme toggle. Mobile collapses
// into a clean full-width slide-down overlay menu.
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { isConnected } = useAccount();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile menu on route change.
  useEffect(() => setOpen(false), [pathname]);

  // /chat is a full-height app surface (its own sidebar + back affordance), so the global top bar is
  // hidden there - it otherwise crops the sidebar header and steals 56px of the conversation height.
  const hidden = pathname === "/chat" || pathname.startsWith("/chat/");

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const visibleLinks = LINKS.filter((l) => !l.connectedOnly || isConnected);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  if (hidden) return null;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        open
          ? "border-b border-[var(--color-border)] backdrop-blur-md"
          : scrolled
            ? "border-b border-[var(--color-border)] md:backdrop-blur-md"
            : "border-b border-transparent"
      }`}
      style={{ background: scrolled || open ? "rgb(var(--rgb-cream) / 0.8)" : "transparent" }}
    >
      <div className="mx-auto flex h-14 w-full max-w-[var(--container-wrap)] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center transition-opacity duration-200 hover:opacity-60" style={{ color: "var(--color-ink)" }} aria-label="AURA home">
          <span className="font-display" style={{ fontSize: 22, letterSpacing: "0.18em", lineHeight: 1 }}>
            AURA
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {visibleLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              data-active={isActive(l.href)}
              aria-current={isActive(l.href) ? "page" : undefined}
              className="navlink micro text-[16px] font-medium tracking-[0.005em] hover:text-[var(--color-ink)]"
              style={{ color: isActive(l.href) ? "var(--color-ink)" : "var(--color-ink-2)" }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden sm:block">
            <CustomConnectButton />
          </div>
          <div className="hidden md:block">
            <ThemeToggle />
          </div>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--color-border-strong)] md:hidden"
            style={{ background: "var(--color-paper)", color: "var(--color-ink)" }}
          >
            <Burger open={open} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            key="mobile-menu"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="md:hidden"
            style={{ background: "rgb(var(--rgb-cream) / 0.98)", borderTop: "1px solid var(--color-border)" }}
          >
            <nav className="mx-auto flex w-full max-w-[var(--container-wrap)] flex-col gap-1 px-5 pb-6 pt-3 sm:px-8">
              {visibleLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={isActive(l.href) ? "page" : undefined}
                  className="flex items-center justify-between rounded-xl px-3 py-3 font-display text-[clamp(22px,7vw,30px)] transition-colors"
                  style={{ color: isActive(l.href) ? "var(--color-ink)" : "var(--color-ink-2)" }}
                >
                  {l.label}
                  <span className="font-mono-x tabular-nums text-[16px]" style={{ color: "var(--color-ink-3)" }}>
                    {String(visibleLinks.indexOf(l) + 1).padStart(2, "0")}
                  </span>
                </Link>
              ))}
              <div className="mt-4 flex items-center justify-between gap-4 border-t border-[var(--color-border)] pt-5">
                <CustomConnectButton />
                <ThemeToggle />
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Burger({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      {open ? (
        <>
          <path d="M3 3l10 10" />
          <path d="M13 3L3 13" />
        </>
      ) : (
        <>
          <path d="M2 5h12" />
          <path d="M2 11h12" />
        </>
      )}
    </svg>
  );
}
