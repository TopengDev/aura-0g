import Link from "next/link";

// Persistent broadcast-terminal nav. The chrome AURA wordmark + the live
// network channel readout, threaded across every page.
export default function Nav({ active }: { active?: string }) {
  const links = [
    { href: "/agents", label: "AGENTS" },
    { href: "/generate", label: "GENERATE" },
    { href: "/collection", label: "COLLECTION" },
    { href: "/royalty", label: "ROYALTY" },
  ];
  return (
    <header className="fixed top-0 inset-x-0 z-40">
      <div
        className="flex items-center justify-between px-5 sm:px-8 py-4"
        style={{
          background:
            "linear-gradient(180deg, rgba(6,5,13,0.92), rgba(6,5,13,0.55) 70%, transparent)",
          backdropFilter: "blur(6px) saturate(1.3)",
        }}
      >
        <Link href="/" className="flex items-baseline gap-2 group">
          <span
            className="chrome-text font-display tracking-tight"
            style={{ fontSize: "1.6rem", fontWeight: 700 }}
          >
            AURA
          </span>
          <span className="mono-label hidden sm:inline" style={{ fontSize: "1rem" }}>
            //0G
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-7">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="mono-label transition-colors"
              style={{
                fontSize: "1rem",
                color: active === l.label ? "var(--color-cyan)" : undefined,
              }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center">
          <span className="mono-label" style={{ fontSize: "1rem", color: "var(--color-mute)" }}>
            GALILEO · 16602
          </span>
        </div>
      </div>
    </header>
  );
}
