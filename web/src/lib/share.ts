// Viral share loop helpers: the single source of truth for AURA's absolute site origin, the
// x.com/intent/tweet web-intent builder, the Farcaster Mini App embed, and the (deliberately neutral,
// pre vote-campaign) share copy. Isomorphic: safe in server AND client code (no server-only imports).
//
// NEXT_PUBLIC_SITE_URL is inlined at build time and is available in the browser; it defaults to the
// live origin so absolute OG / Twitter / Farcaster URLs still resolve when the build arg is omitted.
// The user-side share loop never uploads a file: the visitor tweets a LINK from THEIR account and X's
// crawler renders the card by fetching og:image server-side, so this path is independent of the
// @aura0g automation image-post limitation entirely.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://aura.topengdev.com").replace(/\/$/, "");
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
export const X_HANDLE = "aura0g";
export const SHARE_HASHTAGS = ["0G", "AURA"];

// Resolve an app-relative path to an absolute https URL against the site origin. og:image / twitter:image
// are ALSO resolved by metadataBase, but the Farcaster embed + the share-intent link REQUIRE an absolute
// URL a remote crawler can fetch, so this is the shared builder for those.
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

// Build an x.com/intent/tweet web-intent URL (no API, no app, no auth). `text` + `url` are URL-encoded by
// URLSearchParams; `hashtags` is comma-joined with no leading '#'; `via` attributes the post.
export function tweetIntent(opts: { text: string; url?: string; hashtags?: string[]; via?: string }): string {
  const p = new URLSearchParams();
  p.set("text", opts.text);
  if (opts.url) p.set("url", opts.url);
  if (opts.hashtags && opts.hashtags.length) p.set("hashtags", opts.hashtags.join(","));
  if (opts.via) p.set("via", opts.via);
  return `https://x.com/intent/tweet?${p.toString()}`;
}

// Prefilled share copy. Deliberately NEUTRAL (no vote-campaign language) so the rails ship now and the
// QF+ activation on Jul 8 is a copy swap, not a rebuild. Honest by construction: "TEE-attested on 0G"
// (testnet), never "mainnet", so the copy never outruns the on-chain state.
export function relicSummonShareText(agentName: string): string {
  return `I just summoned ${agentName} on AURA. Art you can prove: a 1/1 TEE-attested on 0G, minted with on-chain provenance and royalties that follow the work. @${X_HANDLE}`;
}
export function relicShareText(agentName: string, tokenId: number): string {
  return `${agentName} Relic #${tokenId} on AURA. Art you can prove: TEE-attested on 0G, with provenance and a royalty that follows the work. @${X_HANDLE}`;
}
export function auraShareText(name: string): string {
  return `${name} is a creative Aura on AURA. It makes provable 1/1 art on 0G, with royalties that follow the work on every resale. @${X_HANDLE}`;
}

// Farcaster Mini App embed payload (the `fc:miniapp` meta value). og:image stays the required fallback;
// imageUrl + url MUST be absolute. MVP scope is the rich embed card + a launch button (no manifest /
// in-feed mint yet). splashImageUrl is omitted (no square icon asset ships yet); the color still themes
// the load screen. Farcaster is a crypto-native channel with no external-link deprioritization.
export function farcasterEmbed(opts: { imageUrl: string; url: string; label: string }): string {
  return JSON.stringify({
    version: "1",
    imageUrl: opts.imageUrl,
    button: {
      title: opts.label,
      action: {
        type: "launch_miniapp",
        name: "AURA",
        url: opts.url,
        splashBackgroundColor: "#0e0d0a",
      },
    },
  });
}
