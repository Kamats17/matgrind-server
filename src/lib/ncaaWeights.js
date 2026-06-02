// NCAA folkstyle weight classes (pounds). Ordered lightest → heaviest.
// Used by Dual Meets to structure a 10-bout dual and to scale team-generated
// wrestler stats across the weight spectrum.

export const NCAA_WEIGHT_CLASSES = [125, 133, 141, 149, 157, 165, 174, 184, 197, 285];

export const DUAL_BOUT_COUNT = NCAA_WEIGHT_CLASSES.length;

/** Human-readable label for a weight class. Heavyweight (285) renders as HWT. */
export function weightLabel(w) {
  if (w === 285) return 'HWT';
  return String(w);
}

export function isValidWeight(w) {
  return NCAA_WEIGHT_CLASSES.includes(w);
}

/**
 * Parameterized variant of isValidWeight used by career duals where the
 * canonical weight table varies by tier (NFHS HS, NCAA men's, NCAA women's).
 * Returns true when `w` exists in the supplied weights array.
 */
export function isValidWeightFor(w, weights) {
  if (!Array.isArray(weights) || weights.length === 0) return false;
  return weights.includes(w);
}

/** Zero-based index of a weight within the canonical order. -1 if not found. */
export function weightIndex(w) {
  return NCAA_WEIGHT_CLASSES.indexOf(w);
}

/**
 * Small stat tweak applied on top of the normal tournament stat budget so
 * heavier classes feel more physical and lighter classes feel quicker.
 * Returns delta object added to {str, spd, tec, end, grt}.
 *
 * Anchored at 157 (the middle bout) where delta is zero. Lightweights gain
 * speed and lose strength; heavyweights do the inverse. Keeps total budget
 * roughly constant so difficulty tier ordering still works.
 */
export function weightStatDeltas(weight) {
  const idx = weightIndex(weight);
  if (idx < 0) return { str: 0, spd: 0, tec: 0, end: 0, grt: 0 };
  // 0..9 → -4.5..+4.5 centred on 4.5 (between 157 and 165)
  const offset = idx - 4.5;
  // Cap magnitude so the heaviest/lightest still have all stats in a playable band
  const shift = Math.round(offset * 1.2); // ±5 ish
  return {
    str: shift,
    spd: -shift,
    tec: 0,
    end: 0,
    grt: 0,
  };
}
