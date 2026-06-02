import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { haptic } from '@/lib/haptics';
import { MECHANIC_TUNING, SKILL_TIERS } from '@/lib/cardArchetypeMechanics';

// Hold-and-release power bar. Used by neutral_attack, throw, par_terre_top.
// Player presses and holds; a fill bar grows; releasing inside the green
// zone yields PERFECT, near it yields GOOD, otherwise MISS.
export default function ChargeMechanic({ onResolve, accentColor = '#f97316', tuningOverride = null, onInput = null }) {
  // Merge any per-step overrides (used by the training curriculum) onto the
  // production tuning. Live matches pass nothing, so behaviour is unchanged
  // outside of training.
  const baseTuning = tuningOverride ? { ...MECHANIC_TUNING.charge, ...tuningOverride } : MECHANIC_TUNING.charge;

  // Randomise the target zone at mount so players can't muscle-memorise
  // "stop the bar right here". Width stays fixed (0.20) so the skill floor
  // is constant - only the position shifts. The good zone is padded around
  // the perfect zone. Skipped when training curriculum supplies explicit zones.
  const zoneVariance = useMemo(() => {
    if (tuningOverride) return null;
    const center = 0.40 + Math.random() * 0.38; // center in [0.40, 0.78]
    const pLo = +(center - 0.10).toFixed(3);
    const pHi = +(center + 0.10).toFixed(3);
    return {
      perfectZone: [pLo, pHi],
      goodZone:    [Math.max(0, pLo - 0.12), Math.min(1, pHi + 0.12)],
    };
  }, [tuningOverride]);

  const tuning = zoneVariance ? { ...baseTuning, ...zoneVariance } : baseTuning;
  const [holding, setHolding] = useState(false);
  const [fill, setFill] = useState(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  const resolvedRef = useRef(false);
  // Keep a ref to the latest onResolve so the mount-time auto-miss timeout
  // (which captures handlers via a stale closure) always calls the current
  // handler. Fixes the online multiplayer "stuck on move 1" bug where the
  // result was delivered to a dead handler.
  const onResolveRef = useRef(onResolve);
  useEffect(() => { onResolveRef.current = onResolve; }, [onResolve]);

  const safeResolve = (result) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    onResolveRef.current(result);
  };

  // Animate fill while holding
  useEffect(() => {
    if (!holding) return;
    startRef.current = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      const ratio = Math.min(elapsed / tuning.fillDurationMs, 1);
      setFill(ratio);
      if (ratio < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [holding, tuning.fillDurationMs]);

  // Haptic when entering perfect zone
  const inPerfectRef = useRef(false);
  useEffect(() => {
    const inPerfect = fill >= tuning.perfectZone[0] && fill <= tuning.perfectZone[1];
    if (inPerfect && !inPerfectRef.current) {
      haptic.medium();
      inPerfectRef.current = true;
    } else if (!inPerfect) {
      inPerfectRef.current = false;
    }
  }, [fill, tuning.perfectZone]);

  // Auto-miss if the user never interacts. Cleared on first pointer-down so an
  // active hold is never cut short. If somehow they hold past fillDuration+3s
  // without releasing, a backstop fires to prevent an eternal pending challenge.
  const idleTimerRef = useRef(null);
  useEffect(() => {
    idleTimerRef.current = setTimeout(
      () => safeResolve({ tier: 'MISS', ...SKILL_TIERS.MISS }),
      tuning.fillDurationMs + 3000,
    );
    return () => clearTimeout(idleTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePointerDown = (e) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    clearTimeout(idleTimerRef.current);
    haptic.light();
    setHolding(true);
    if (onInput) onInput('press');
  };

  const handlePointerUp = () => {
    if (!holding) return;
    setHolding(false);
    cancelAnimationFrame(rafRef.current);
    if (onInput) onInput('release');
    const final = fill;
    const [pLo, pHi] = tuning.perfectZone;
    const [gLo, gHi] = tuning.goodZone;
    let result;
    if (final >= pLo && final <= pHi) {
      haptic.heavy();
      result = { tier: 'PERFECT', ...SKILL_TIERS.PERFECT };
    } else if (final >= gLo && final <= gHi) {
      haptic.medium();
      result = { tier: 'GOOD', ...SKILL_TIERS.GOOD };
    } else {
      haptic.warning();
      result = { tier: 'MISS', ...SKILL_TIERS.MISS };
    }
    safeResolve(result);
  };

  const [pLo, pHi] = tuning.perfectZone;
  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="text-xs uppercase tracking-widest text-zinc-400">
        {holding ? 'Release in the green zone' : 'Hold to charge'}
      </div>
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
        className="relative w-64 h-12 rounded-full bg-zinc-800 border-2 border-zinc-700 overflow-hidden cursor-pointer"
      >
        {/* Perfect zone marker */}
        <div
          className="absolute top-0 bottom-0 bg-emerald-500/30 border-l-2 border-r-2 border-emerald-400"
          style={{ left: `${pLo * 100}%`, width: `${(pHi - pLo) * 100}%` }}
        />
        {/* Fill bar */}
        <motion.div
          className="absolute top-0 bottom-0 left-0"
          style={{ width: `${fill * 100}%`, background: accentColor }}
          transition={{ duration: 0 }}
        />
      </div>
    </div>
  );
}
