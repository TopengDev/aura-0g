// The synthwave perspective grid (T20) - the page's ONE big buildable signature.
// Pure CSS, no WebGL. A receding neon floor that scrolls toward the viewer.
export default function SynthGrid({ className = "" }: { className?: string }) {
  return <div className={`synth-grid ${className}`} aria-hidden />;
}
