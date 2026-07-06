// The AURA logo mark: a luminous "A" apex inside an aura/halo ring, with a bright apex point. This is the
// theme-adaptive, line-art lockup used in the app chrome (nav) beside the Ethereal Glamour wordmark. The
// "A" strokes ride currentColor (so they inherit the ink of whatever they sit in) and the halo + apex
// spark ride the site accent (ink-navy in light, periwinkle in dark), so the mark themes with the app for
// free. The full luminous gold-on-dark treatment lives in the favicon / PWA tile (src/app/icon.svg) and
// the OG card; this is the crisp monochrome sibling. Purely presentational, so it is aria-hidden by
// default and the accessible name is carried by the adjacent wordmark link.
export function AuraMark({
  size = 24,
  className,
  "aria-hidden": ariaHidden = true,
}: {
  size?: number;
  className?: string;
  "aria-hidden"?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden={ariaHidden}
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* aura: a faint outer halo + the main ring, both in the site accent */}
      <circle cx="16" cy="16" r="11.75" stroke="var(--color-accent)" strokeOpacity="0.22" strokeWidth="0.5" />
      <circle cx="16" cy="16" r="9.5" stroke="var(--color-accent)" strokeOpacity="0.55" strokeWidth="1" />
      {/* the A monogram, riding the ambient ink */}
      <path d="M9 23 L16 8 L23 23" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 17 L20 17" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" />
      {/* the luminous apex point */}
      <circle cx="16" cy="8" r="1.6" fill="var(--color-accent)" />
    </svg>
  );
}
