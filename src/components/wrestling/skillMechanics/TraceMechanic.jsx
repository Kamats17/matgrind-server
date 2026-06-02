import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { haptic } from '@/lib/haptics';
import { MECHANIC_TUNING, SKILL_TIERS } from '@/lib/cardArchetypeMechanics';

// 2-arrow directional swipe sequence. Used by top_turns cards.
// Player must swipe in the shown directions in order, fast enough for bonus.
//
// Arrow colours (redesigned for legibility on dark bg):
//   Pending  - zinc-400 (dim, "not yet")
//   Current  - yellow-300 + scale-up pulse (bright, "do this now")
//   Completed - emerald-400 (muted green, "done")

const DIRECTIONS = ['up', 'right', 'down', 'left'];

// Unicode arrows that render cleanly at large sizes on iOS/Android
const ARROW_GLYPH = { up: '↑', right: '→', down: '↓', left: '←' };

function pickDelta(dx, dy, threshold = 32) {
  if (Math.hypot(dx, dy) < threshold) return null;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle > -45 && angle <= 45) return 'right';
  if (angle > 45 && angle <= 135) return 'down';
  if (angle < -45 && angle >= -135) return 'up';
  return 'left';
}

export default function TraceMechanic({ onResolve, tuningOverride = null, onInput = null }) {
  const tuning = tuningOverride ? { ...MECHANIC_TUNING.trace, ...tuningOverride } : MECHANIC_TUNING.trace;

  // Sequence comes from the server in online mode (tuningOverride.sequence)
  // so the rendered arrows match what the server grades against. Offline,
  // we randomize locally per mount.
  const sequence = useMemo(() => {
    if (Array.isArray(tuningOverride?.sequence) && tuningOverride.sequence.length > 0) {
      return tuningOverride.sequence;
    }
    return Array.from(
      { length: tuning.arrowCount },
      () => DIRECTIONS[Math.floor(Math.random() * 4)],
    );
  }, [tuning.arrowCount, tuningOverride]);

  const [progress, setProgress] = useState(0);
  const startRef    = useRef(null);
  const lastRef     = useRef(null);
  const resolvedRef = useRef(false);
  // Ref-tracked progress so handlePointerMove never reads stale closure state.
  const progressRef = useRef(0);
  // Always-current onResolve ref - see ChargeMechanic for rationale.
  const onResolveRef = useRef(onResolve);
  useEffect(() => { onResolveRef.current = onResolve; }, [onResolve]);

  const safeResolve = (result) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolveRef.current(result);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      if (!resolvedRef.current) {
        haptic.warning();
        safeResolve({ tier: 'MISS', ...SKILL_TIERS.MISS });
      }
    }, tuning.timeoutMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePointerDown = (e) => {
    if (resolvedRef.current) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    // Start timing on the very first touch of the sequence.
    if (progressRef.current === 0 && !startRef.current?.t) {
      startRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    }
    lastRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e) => {
    if (!lastRef.current || resolvedRef.current) return;
    const dx = e.clientX - lastRef.current.x;
    const dy = e.clientY - lastRef.current.y;
    const dir = pickDelta(dx, dy);
    if (!dir) return;
    if (dir === sequence[progressRef.current]) {
      haptic.light();
      if (onInput) onInput('swipe', { direction: dir });
      // Null out lastRef so the same continuous swipe can't immediately fire
      // the next arrow too - the player must start a fresh drag.
      lastRef.current = null;
      const next = progressRef.current + 1;
      progressRef.current = next;
      setProgress(next);
      if (next >= sequence.length) {
        const elapsed = performance.now() - (startRef.current?.t ?? performance.now());
        let result;
        if (elapsed <= tuning.perfectWindowMs) {
          haptic.heavy();
          result = { tier: 'PERFECT', ...SKILL_TIERS.PERFECT };
        } else if (elapsed <= tuning.goodWindowMs) {
          haptic.medium();
          result = { tier: 'GOOD', ...SKILL_TIERS.GOOD };
        } else {
          haptic.warning();
          result = { tier: 'MISS', ...SKILL_TIERS.MISS };
        }
        safeResolve(result);
      }
    } else {
      // Wrong direction = immediate miss
      haptic.warning();
      safeResolve({ tier: 'MISS', ...SKILL_TIERS.MISS });
    }
  };

  const handlePointerUp = () => { lastRef.current = null; };

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      <div className="text-xs uppercase tracking-widest text-zinc-400">Trace the path</div>

      {/* Arrow sequence - three visual states per arrow */}
      <div className="flex gap-4 items-center">
        {sequence.map((d, i) => {
          const isDone    = i < progress;
          const isCurrent = i === progress;
          return (
            <motion.span
              key={i}
              className={[
                // Uniform text-5xl across every state. Previously isDone /
                // pending used text-4xl while isCurrent used text-5xl, which
                // shifted the row width every time the player advanced an
                // arrow. Color + opacity now carry state, sizing stays put.
                'font-black leading-none select-none text-5xl',
                isDone    ? 'text-emerald-400 opacity-60' : '',
                isCurrent ? 'text-yellow-300'             : '',
                (!isDone && !isCurrent) ? 'text-zinc-500' : '',
              ].join(' ')}
              // Pulse the current-target arrow so the eye is drawn to it.
              // The pulse is a transform (no layout shift) - safe to keep
              // even with the uniform sizing above.
              animate={isCurrent ? { scale: [1, 1.18, 1] } : { scale: 1 }}
              transition={isCurrent ? { duration: 0.7, repeat: Infinity, ease: 'easeInOut' } : {}}
            >
              {ARROW_GLYPH[d]}
            </motion.span>
          );
        })}
      </div>

      {/* Swipe target pad */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
        className="w-48 h-48 rounded-2xl bg-zinc-800 border-2 border-zinc-700 flex items-center justify-center"
      >
        {/* Current arrow mirrored inside the pad as a dim guide */}
        <span className="text-zinc-600 text-5xl pointer-events-none select-none">
          {progress < sequence.length ? ARROW_GLYPH[sequence[progress]] : '✓'}
        </span>
      </div>
    </div>
  );
}
