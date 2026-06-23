// Shared motion vocabulary. One ease + one duration scale so every entrance,
// hover, and swap reads as one hand (arca's [0.22, 1, 0.36, 1]).
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const DUR = {
  xfast: 0.15,
  fast: 0.2,
  base: 0.3,
  slow: 0.45,
} as const;
