// src/lib/motionFeedback.js
//
// Shared framer-motion primitives for the "3-layer feedback" system
// (visual + motion + haptic). Haptics live in src/lib/haptics.js; this file
// owns only the motion layer so any component can import a consistent
// shake / pulse / flash without each author reinventing their own curves.
//
// Why centralize: in v2.0 every meaningful moment - tab switch, radial
// commit, takedown landing, low-stamina warning - is supposed to feel
// the same across screens. If the amplitudes and durations drift per
// component the app reads as inconsistent, which is exactly the
// "website" feel Apple flagged. One source of truth keeps the app
// native-feeling and cheap to tune.
//
// Reduced-motion: every primitive here checks the user's setting via
// `useReducedMotion`. If reduce is on we return static variants so the
// element still responds (opacity-only flash, no translation) without
// vestibular discomfort.

import { useEffect, useRef } from 'react';
import { useAnimationControls } from 'framer-motion';
import confetti from 'canvas-confetti';
import useReducedMotion from './useReducedMotion.js';

// ---------------------------------------------------------------------------
// Confetti (match-end celebration)
// ---------------------------------------------------------------------------
//
// Imperative - not hook-based - because confetti doesn't fit the declarative
// animation model and is only fired from match-end / pin / tech-fall events.
// We check the same OS-level `prefers-reduced-motion` signal the motion
// primitives above use so vestibular users never see a burst.
//
// `level` picks the flavor:
//   'win'        → a modest shower from the center
//   'pin'        → big dual-burst from both sides (the loudest moment in the app)
//   'tech_fall'  → medium burst (slightly less than pin)
//
// Idempotent - safe to call multiple times; canvas-confetti queues internally.
// Returns early (no-op) if the environment doesn't support it.

function _prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function fireConfetti(level = 'win') {
  if (typeof window === 'undefined') return;
  if (_prefersReducedMotion()) return;
  // Respect MatGrind's sound/motion toggles: if a user has opted into
  // reduced motion via the accessibility setting it's already honored by
  // matchMedia. We don't re-query other app settings here to keep this
  // helper dependency-free.
  try {
    if (level === 'pin') {
      // Big dual-burst for a pin - the loudest celebration moment.
      confetti({
        particleCount: 90,
        spread: 70,
        startVelocity: 45,
        origin: { x: 0.2, y: 0.7 },
      });
      confetti({
        particleCount: 90,
        spread: 70,
        startVelocity: 45,
        origin: { x: 0.8, y: 0.7 },
      });
      // Center crown
      setTimeout(() => {
        confetti({
          particleCount: 60,
          spread: 100,
          startVelocity: 35,
          origin: { x: 0.5, y: 0.55 },
        });
      }, 200);
    } else if (level === 'tech_fall') {
      confetti({
        particleCount: 80,
        spread: 85,
        startVelocity: 40,
        origin: { x: 0.5, y: 0.6 },
      });
    } else {
      // Default 'win'
      confetti({
        particleCount: 55,
        spread: 65,
        startVelocity: 35,
        origin: { x: 0.5, y: 0.65 },
      });
    }
  } catch {
    // canvas-confetti can throw on very old browsers / SSR contexts - never
    // let celebration crash the match-end modal.
  }
}

// ---------------------------------------------------------------------------
// Screen shake
// ---------------------------------------------------------------------------
//
// Usage:
//   const shakeRef = useShake(impactTrigger, 'heavy');
//   <motion.div ref={shakeRef} animate={...}>match content</motion.div>
//
// `trigger` is any value that changes when you want the shake to fire -
// typically a counter that increments on takedown/pin events, or the
// resolved-round index. We compare against a ref so the very first render
// doesn't auto-shake.
//
// Amplitudes are tuned for a handheld screen; they're intentionally small
// so a heavy shake still reads as "whoa" without making text unreadable.
const SHAKE_AMPLITUDES = {
  light:  { x: [0, -4,  4, -3,  3, 0], duration: 0.18 },
  medium: { x: [0, -8,  8, -6,  6, 0], duration: 0.22 },
  heavy:  { x: [0, -12, 12, -9,  9, -4, 4, 0], duration: 0.32 },
};

export function useShake(trigger, intensity = 'medium') {
  const controls = useAnimationControls();
  const reduce = useReducedMotion();
  const lastTrigger = useRef(trigger);

  useEffect(() => {
    if (trigger === lastTrigger.current) return;
    lastTrigger.current = trigger;
    if (reduce) return; // Respect the user's motion preference
    const preset = SHAKE_AMPLITUDES[intensity] || SHAKE_AMPLITUDES.medium;
    controls.start({
      x: preset.x,
      transition: { duration: preset.duration, ease: 'easeInOut' },
    });
  }, [trigger, intensity, reduce, controls]);

  return controls;
}

// ---------------------------------------------------------------------------
// Flash (e.g. "you got a takedown" overlay pulse)
// ---------------------------------------------------------------------------
//
// Designed for an absolutely-positioned overlay div that pulses once and
// fades. Reduced-motion keeps the opacity change but drops the scale.

export const flashVariants = {
  idle:  { opacity: 0, scale: 1 },
  flash: {
    opacity: [0, 0.8, 0],
    scale: [0.95, 1.02, 1],
    transition: { duration: 0.45, ease: 'easeOut' },
  },
};

export const flashVariantsReduced = {
  idle:  { opacity: 0 },
  flash: { opacity: [0, 0.8, 0], transition: { duration: 0.3 } },
};

export function useFlashVariants() {
  const reduce = useReducedMotion();
  return reduce ? flashVariantsReduced : flashVariants;
}

// ---------------------------------------------------------------------------
// Pulse (e.g. low-stamina warning ring, move-timer sub-5s red hub)
// ---------------------------------------------------------------------------
//
// A repeating, subtle breath. Use `animate="pulse"` with `repeat: Infinity`
// handled by framer-motion. Amplitude is small on purpose - the scene
// should feel alive, not epileptic.

export const pulseVariants = {
  idle:  { scale: 1, opacity: 1 },
  pulse: {
    scale: [1, 1.04, 1],
    opacity: [1, 0.85, 1],
    transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
  },
};

export const pulseVariantsReduced = {
  idle:  { opacity: 1 },
  pulse: { opacity: [1, 0.7, 1], transition: { duration: 1.2, repeat: Infinity } },
};

export function usePulseVariants() {
  const reduce = useReducedMotion();
  return reduce ? pulseVariantsReduced : pulseVariants;
}

// ---------------------------------------------------------------------------
// Screen / tab transition variants
// ---------------------------------------------------------------------------
//
// Used by AppShell's <AnimatePresence> wrapper and any per-screen
// transition container. Small Y translate so screens feel like they
// "lift in" the way iOS navigation transitions do. Reduced-motion
// flattens to opacity only.

export const screenVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } },
  exit:    { opacity: 0, y: -4, transition: { duration: 0.16, ease: 'easeIn' } },
};

export const screenVariantsReduced = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, transition: { duration: 0.12 } },
};

export function useScreenVariants() {
  const reduce = useReducedMotion();
  return reduce ? screenVariantsReduced : screenVariants;
}
