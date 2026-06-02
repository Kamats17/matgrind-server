import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { haptic } from '@/lib/haptics';
import { MECHANIC_TUNING, SKILL_TIERS } from '@/lib/cardArchetypeMechanics';

// Rapid multi-tap escape urgency. Used by bottom escape cards.
// Window starts on first tap; tap count threshold and window length drift
// slightly each challenge so players can't lock in a fixed muscle rhythm.
export default function BurstMechanic({ onResolve, tuningOverride = null, onInput = null }) {
  // Merge per-step overrides (training curriculum) onto production tuning;
  // live matches pass nothing so behaviour is unchanged.
  const baseTuning = tuningOverride ? { ...MECHANIC_TUNING.burst, ...tuningOverride } : MECHANIC_TUNING.burst;

  // Drift thresholds and window at mount. The range is narrow enough that
  // the feel stays the same, but the player never knows the exact target -
  // they just have to go as hard as they can. Skipped for training drills.
  const driftTuning = useMemo(() => {
    if (tuningOverride) return null;
    return {
      perfectTaps: 8  + Math.floor(Math.random() * 5),  // 8-12
      goodTaps:    5  + Math.floor(Math.random() * 3),  // 5-7
      windowMs:    1800 + Math.floor(Math.random() * 401), // 1800-2200 ms
    };
  }, [tuningOverride]);

  const tuning = driftTuning ? { ...baseTuning, ...driftTuning } : baseTuning;
  const [taps, setTaps] = useState(0);
  const [phase, setPhase] = useState('ready'); // ready | active | done
  const tapsRef = useRef(0);
  const tappedRef = useRef(false); // ref-tracked so the idle timeout reads current state
  const resolvedRef = useRef(false);
  // Always-current onResolve ref - see ChargeMechanic for rationale.
  const onResolveRef = useRef(onResolve);
  useEffect(() => { onResolveRef.current = onResolve; }, [onResolve]);

  const safeResolve = (result) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    setPhase('done');
    onResolveRef.current(result);
  };

  // Once active, resolve after windowMs based on tap count
  useEffect(() => {
    if (phase !== 'active') return;
    const t = setTimeout(() => {
      const finalTaps = tapsRef.current;
      let result;
      if (finalTaps >= tuning.perfectTaps) {
        haptic.heavy();
        result = { tier: 'PERFECT', ...SKILL_TIERS.PERFECT };
      } else if (finalTaps >= tuning.goodTaps) {
        haptic.medium();
        result = { tier: 'GOOD', ...SKILL_TIERS.GOOD };
      } else {
        haptic.warning();
        result = { tier: 'MISS', ...SKILL_TIERS.MISS };
      }
      safeResolve(result);
    }, tuning.windowMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Hard timeout if user never taps. Uses tappedRef (not stale `phase` state)
  // so the check reflects whether the user actually interacted.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!resolvedRef.current && !tappedRef.current) {
        haptic.warning();
        safeResolve({ tier: 'MISS', ...SKILL_TIERS.MISS });
      }
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTap = () => {
    if (resolvedRef.current) return;
    if (phase === 'ready') {
      tappedRef.current = true;
      setPhase('active');
    }
    haptic.light();
    tapsRef.current += 1;
    setTaps(tapsRef.current);
    if (onInput) onInput('tap');
  };

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="text-xs uppercase tracking-widest text-zinc-400">
        {phase === 'ready' && 'Tap fast to escape!'}
        {phase === 'active' && `Taps: ${taps}`}
        {phase === 'done' && 'Done'}
      </div>
      <motion.button
        onPointerDown={handleTap}
        style={{ touchAction: 'none' }}
        className="w-40 h-40 rounded-full bg-amber-600 font-bold text-zinc-900 text-2xl"
        animate={{ scale: phase === 'active' ? [1, 1.05, 1] : 1 }}
        transition={{ duration: 0.1 }}
      >
        TAP
      </motion.button>
    </div>
  );
}
