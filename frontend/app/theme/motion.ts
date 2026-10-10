import { useReducedMotion, type Transition, type Variants } from "framer-motion";

/** M3 easing curves as cubic-bezier tuples (for `motion` transitions). */
export const easing = {
  emphasized: [0.2, 0, 0, 1],
  emphasizedDecelerate: [0.05, 0.7, 0.1, 1],
  emphasizedAccelerate: [0.3, 0, 0.8, 0.15],
  standard: [0.2, 0, 0, 1],
  standardDecelerate: [0, 0, 0, 1],
  standardAccelerate: [0.3, 0, 1, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** M3 durations in milliseconds. */
export const durationMs = {
  short1: 50,
  short2: 100,
  short3: 150,
  short4: 200,
  medium1: 250,
  medium2: 300,
  medium3: 350,
  medium4: 400,
  long1: 450,
  long2: 500,
  long3: 550,
  long4: 600,
  extraLong1: 700,
  extraLong2: 800,
  extraLong3: 900,
  extraLong4: 1000,
} as const;

export type DurationToken = keyof typeof durationMs;

/** Durations in seconds (what `motion` expects). */
export const duration = Object.fromEntries(
  Object.entries(durationMs).map(([k, v]) => [k, v / 1000]),
) as Record<DurationToken, number>;

/**
 * Spring presets tuned to feel like M3 Expressive. Spatial springs are slightly
 * bouncy; effect springs (opacity / colour) are critically damped.
 */
export const springs = {
  spatialFast: { type: "spring", stiffness: 800, damping: 42, mass: 1 },
  spatialDefault: { type: "spring", stiffness: 380, damping: 30, mass: 1 },
  spatialSlow: { type: "spring", stiffness: 200, damping: 24, mass: 1 },
  effects: { type: "spring", stiffness: 1600, damping: 80, mass: 1, bounce: 0 },
} as const satisfies Record<string, Transition>;

/** Stagger-enter: 30 ms between items, capped at 10 items. */
export const STAGGER_MS = 30;
export const STAGGER_CAP = 10;
export function staggerDelay(index: number): number {
  return (Math.min(index, STAGGER_CAP) * STAGGER_MS) / 1000;
}

/** Full motion variants. */
const fullVariants = {
  /** Fade through: fade out 90ms → fade in 210ms + scale 0.92→1. */
  fadeThrough: {
    initial: { opacity: 0, scale: 0.92 },
    animate: {
      opacity: 1,
      scale: 1,
      transition: { duration: 0.21, delay: 0.09, ease: easing.emphasizedDecelerate },
    },
    exit: { opacity: 0, transition: { duration: 0.09, ease: easing.emphasizedAccelerate } },
  },
  sharedAxisX: {
    initial: { opacity: 0, x: 30 },
    animate: { opacity: 1, x: 0, transition: { duration: duration.medium2, ease: easing.emphasized } },
    exit: { opacity: 0, x: -30, transition: { duration: duration.short4, ease: easing.emphasizedAccelerate } },
  },
  sharedAxisY: {
    initial: { opacity: 0, y: 30 },
    animate: { opacity: 1, y: 0, transition: { duration: duration.medium2, ease: easing.emphasized } },
    exit: { opacity: 0, y: -30, transition: { duration: duration.short4, ease: easing.emphasizedAccelerate } },
  },
  staggerItem: {
    initial: { opacity: 0, y: 8 },
    animate: (i: number = 0) => ({
      opacity: 1,
      y: 0,
      transition: { ...springs.spatialDefault, delay: staggerDelay(i) },
    }),
  },
} satisfies Record<string, Variants>;

/** Reduced-motion variants: spatial motion swapped for opacity-only fades. */
const reducedVariants = {
  fadeThrough: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: duration.short3 } },
    exit: { opacity: 0, transition: { duration: duration.short2 } },
  },
  sharedAxisX: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: duration.short3 } },
    exit: { opacity: 0, transition: { duration: duration.short2 } },
  },
  sharedAxisY: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: duration.short3 } },
    exit: { opacity: 0, transition: { duration: duration.short2 } },
  },
  staggerItem: {
    initial: { opacity: 0 },
    animate: () => ({ opacity: 1, transition: { duration: duration.short3 } }),
  },
} satisfies Record<keyof typeof fullVariants, Variants>;

export type MotionPattern = keyof typeof fullVariants;

/**
 * Returns motion variants for a pattern, swapping spatial motion for
 * opacity-only fades when the user prefers reduced motion.
 */
export function useMotionPattern(pattern: MotionPattern): Variants {
  const reduce = useReducedMotion();
  return reduce ? reducedVariants[pattern] : fullVariants[pattern];
}

/** Spatial spring, or an instant/opacity-safe transition under reduced motion. */
export function useSpatialSpring(preset: "spatialFast" | "spatialDefault" | "spatialSlow" = "spatialDefault"): Transition {
  const reduce = useReducedMotion();
  return reduce ? { duration: 0 } : springs[preset];
}

export const motionVariants = fullVariants;
export const reducedMotionVariants = reducedVariants;
