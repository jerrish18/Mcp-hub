import type { Transition, Variants } from 'motion/react';

/**
 * Pixel Android Material 3 Expressive motion tokens
 * Compositor-only (transform + opacity) keeping routine UI feedback <= 200ms
 */
export const M3_SPRING: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.85,
};

export const M3_EMPHASIZED_EASE: Transition = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1],
};

export const M3_FAST_EASE: Transition = {
  duration: 0.14,
  ease: [0.16, 1, 0.3, 1],
};

export const screenTransitionVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: M3_EMPHASIZED_EASE },
  exit: { opacity: 0, y: -6, transition: M3_FAST_EASE },
};

export const cardStaggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.035,
    },
  },
};

export const cardStaggerItem: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: M3_EMPHASIZED_EASE },
};
