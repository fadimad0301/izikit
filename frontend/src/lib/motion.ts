export { useReducedMotion } from 'framer-motion';

// "Confident, not bouncy" — a single easing curve shared by every animated
// component so the product feels like one system rather than a pile of
// per-component tweaks.
export const DOXI_EASE = [0.22, 1, 0.36, 1] as const;

export const DURATION = {
  fast: 0.15,
  base: 0.25,
  slow: 0.4,
} as const;
