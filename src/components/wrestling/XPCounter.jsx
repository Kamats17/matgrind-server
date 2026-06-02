// src/components/wrestling/XPCounter.jsx
//
// Count-up animation for a single number (used for the post-match XP total).
// Replaces a static "+{xp}" line with a satisfying tick-up from 0 → target.
// The math is linear; ease-out feels better, so we use a cubic ease-out on
// the progress value while keeping the displayed integer monotonically
// increasing.
//
// Design choices:
//   - requestAnimationFrame-driven (not setInterval) - respects device
//     refresh rate, pauses when tab is backgrounded.
//   - Honors `prefers-reduced-motion` via useReducedMotion - falls back to
//     snapping the final value immediately. Vestibular users still see the
//     bonus; they just don't see it animate.
//   - Safe under rapid remount: the ref + cleanup cancel any in-flight RAF
//     so the component never leaks or double-writes a stale frame.
//   - Purely presentational. The parent still owns the XP number; this
//     component never mutates state outside itself.

import React, { useEffect, useRef, useState } from 'react';
import useReducedMotion from '../../lib/useReducedMotion.js';

// Ease-out cubic - fast start, gentle settle. Feels like a slot machine
// landing on its final value rather than a linear ramp.
function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

export default function XPCounter({
  to,
  from = 0,
  durationMs = 900,
  prefix = '+',
  suffix = '',
  className = '',
}) {
  const reduce = useReducedMotion();
  const target = Number.isFinite(to) ? to : 0;
  const start = Number.isFinite(from) ? from : 0;
  const [value, setValue] = useState(reduce ? target : start);
  const rafRef = useRef(null);
  const startedAtRef = useRef(null);

  useEffect(() => {
    // Reduced-motion users get the final value up front - no animation.
    if (reduce) {
      setValue(target);
      return;
    }
    // Degenerate cases: negative duration or no movement - snap immediately.
    if (durationMs <= 0 || target === start) {
      setValue(target);
      return;
    }
    setValue(start);
    startedAtRef.current = null;

    const tick = (now) => {
      if (startedAtRef.current == null) startedAtRef.current = now;
      const elapsed = now - startedAtRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOutCubic(t);
      const v = Math.round(start + (target - start) * eased);
      setValue(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // Intentionally depend only on target/start/duration. Reduce toggle
    // is handled above with an early return; the initial state honors it.
  }, [target, start, durationMs, reduce]);

  return (
    <span className={className}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
