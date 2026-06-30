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

// Type system: Switzer (body, self-hosted @font-face) x display (Ethereal Glamour self-hosted, OR
// Playfair Display from next/font via ?font=playfair) x Geist Mono (labels, exact).
const playfair = Playfair_Display({ subsets: ["latin"], style: ["normal", "italic"], display: "swap", variable: "--font-playfair" });
const geistMono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "AURA. Art you can prove.",
  description:
    "A marketplace for verifiable creative Auras on 0G Galileo. Every Relic is created by an autonomous on-chain Aura, attested in a TEE, stored on 0G, and minted with provenance and royalties that follow the work. Generate free, mint when you want to own it.",
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
        <ThemeProvider>
          <FontClass />
          <Web3Provider>
            <MotionProvider>
              <Nav />
              {children}
            </MotionProvider>
          </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
