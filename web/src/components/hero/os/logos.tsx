// Marks for the faux-OS windows. The terminal runs an AURA agent (a small seeded sigil); the
// browser is AURA's own Explore surface (the AURA monogram). No third-party brand marks.

export function AgentSigil({ size = 16, color = "#C8A24B" }: { size?: number; color?: string }) {
  // A compact noir-agent sigil: a ringed candle-point, echoing NOKTURNE's chiaroscuro single flame.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.4" strokeOpacity="0.55" />
      <circle cx="12" cy="12" r="4.4" stroke={color} strokeWidth="1.4" />
      <circle cx="12" cy="12" r="1.6" fill={color} />
    </svg>
  );
}

export function AuraMark({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  // AURA monogram: concentric apertures (an "aura" radiating) with a centered slit.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.3" strokeOpacity="0.4" />
      <circle cx="12" cy="12" r="6.4" stroke={color} strokeWidth="1.3" strokeOpacity="0.7" />
      <path d="M12 6.5v11" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
