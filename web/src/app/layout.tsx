import type { Metadata, Viewport } from "next";
import { Geist_Mono, Playfair_Display } from "next/font/google";
import { MotionProvider } from "@/components/MotionProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { ThemeScript } from "@/components/theme/ThemeScript";
import { MotionTierScript } from "@/components/theme/MotionTierScript";
import { FontClass } from "@/components/theme/FontClass";
import { Web3Provider } from "@/components/web3/Web3Provider";
import { Nav } from "@/components/chrome/Nav";
import "./globals.css";
import { SITE_URL } from "@/lib/share";
import { CHAIN_SHORT } from "@/lib/chains";

// Type system: Switzer (body, self-hosted @font-face) x display (Ethereal Glamour self-hosted, OR
// Playfair Display from next/font via ?font=playfair) x Geist Mono (labels, exact).
const playfair = Playfair_Display({ subsets: ["latin"], style: ["normal", "italic"], display: "swap", variable: "--font-playfair" });
const geistMono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-geist-mono" });

const SITE_DESCRIPTION =
  `A marketplace for verifiable creative Auras on 0G ${CHAIN_SHORT}. Every Relic is created by an autonomous on-chain Aura, attested in a TEE, stored on 0G, and minted with provenance and royalties that follow the work. Sign in once and generate (the platform sponsors it); mint when you want to own it.`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "AURA",
  // Icons (favicon.ico, icon.svg, apple-icon.png) + the web manifest are wired via the file-based Metadata
  // conventions in src/app (icon.svg / apple-icon.png / favicon.ico / manifest.ts). Setting metadata.icons
  // here would suppress that static-file detection, so it is deliberately omitted. Per-page titles already
  // carry the " | AURA" suffix, so no title.template is set (it would double the suffix).
  appleWebApp: { capable: true, title: "AURA", statusBarStyle: "black-translucent" },
  title: "AURA. Art you can prove.",
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "AURA",
    title: "AURA. Art you can prove.",
    description: SITE_DESCRIPTION,
    url: "/",
    images: [{ url: "/og", width: 1200, height: 630, alt: "AURA. Art you can prove." }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@aura0g",
    creator: "@aura0g",
    title: "AURA. Art you can prove.",
    description: SITE_DESCRIPTION,
    images: ["/og"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f8f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0d0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <ThemeScript />
        <MotionTierScript />
      </head>
      <body>
        {/* Keyboard bypass-block (WCAG 2.4.1): first in tab order, off-screen until focused, jumps past
            the fixed nav to the main content region. */}
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <ThemeProvider>
          <FontClass />
          <Web3Provider>
            <MotionProvider>
              <Nav />
              <div id="main-content" tabIndex={-1}>
                {children}
              </div>
            </MotionProvider>
          </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
