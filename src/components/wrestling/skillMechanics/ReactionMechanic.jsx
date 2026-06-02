import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { haptic } from '@/lib/haptics';
import { MECHANIC_TUNING, SKILL_TIERS } from '@/lib/cardArchetypeMechanics';

// Tap-on-prompt reaction window. Used by neutral_counter cards.
// After a random delay, the button turns green. Tap fast for PERFECT.
//
// Fake-out layer: 45 % of the time a false "GO!" flash fires first in
// red/orange so players can't just slam the button at the first hint of
// movement. Tapping during the fake resolves as MISS immediately.

// In online mode the parent supplies `serverDriven=true` and a controlled
// `serverPhase` ('waiting' | 'fake' | 'go' | 'done') that's flipped by
// challenge_prompt arrivals from the server. Offline keeps its existing
// local-timer logic so vs-AI / training drills are unchanged.
export default function ReactionMechanic({
  onResolve,
  tuningOverride = null,
  onInput = null,
  serverDriven = false,
  serverPhase = null,
}) {
  const tuning = tuningOverride ? { ...MECHANIC_TUNING.reaction, ...tuningOverride } : MECHANIC_TUNING.reaction;

  // OFFLINE-ONLY: decide at mount whether this challenge has a fake-out,
  // and how long the fake flashes before the real prompt fires. Skipped
  // when training curriculum passes explicit tuning OR the parent is
  // server-driving the visuals.
  const { hasFake, fakeDelayMs, fakeDurationMs, realExtraDelayMs } = useMemo(() => {
    if (serverDriven || tuningOverride) {
      return { hasFake: false, fakeDelayMs: 0, fakeDurationMs: 0, realExtraDelayMs: 0 };
    }
    const fake = Math.random() < 0.45;
    return {
      hasFake:         fake,
      fakeDelayMs:     250 + Math.random() * 400,
      fakeDurationMs:  200 + Math.random() * 150,
      realExtraDelayMs: 200 + Math.random() * 300,
    };
  }, [tuningOverride, serverDriven]);

  // phase: 'waiting' -> ('fake' ->) 'go' -> 'done'.
  // In server-driven mode we mirror serverPhase exactly. In offline we own
  // the state machine via local timers.
  const [localPhase, setLocalPhase] = useState('waiting');
  const phase = serverDriven ? (serverPhase || 'waiting') : localPhase;
  const setPhase = serverDriven ? () => {} : setLocalPhase;

  const promptTimeRef = useRef(null);
  const lastObservedPhaseRef = useRef('waiting');
  const resolvedRef   = useRef(false);
  const onResolveRef  = useRef(onResolve);
  useEffect(() => { onResolveRef.current = onResolve; }, [onResolve]);

  // In server-driven mode, capture the moment we first render the 'go'
  // visual so the local tap-time math (used for haptic / UX feel) is
  // measured against when the user could actually see green. The
  // authoritative tier comes from the server (which uses its own clock
  // minus full RTT); this local timestamp is for animation only.
  useEffect(() => {
    if (!serverDriven) return;
    if (lastObservedPhaseRef.current === serverPhase) return;
    lastObservedPhaseRef.current = serverPhase;
    if (serverPhase === 'fake') haptic.light();
    if (serverPhase === 'go') {
      promptTimeRef.current = performance.now();
      haptic.medium();
    }
  }, [serverDriven, serverPhase]);

  const safeResolve = (result) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    setPhase('done');
    onResolveRef.current(result);
  };

  // OFFLINE-ONLY: schedule the full prompt sequence locally.
  //   no fake  -> [promptDelay] -> go
  //   has fake -> [fakeDelay] -> fake -> [fakeDuration] -> waiting -> [realDelay] -> go
  useEffect(() => {
    if (serverDriven) return; // server controls the schedule in network mode
    const timers = [];
    const [lo, hi] = tuning.promptDelayMs;
    const baseDelay = lo + Math.random() * (hi - lo);

    if (hasFake) {
      timers.push(setTimeout(() => {
        if (resolvedRef.current) return;
        setPhase('fake');
        haptic.light();
        timers.push(setTimeout(() => {
          if (resolvedRef.current) return;
          setPhase('waiting');
          timers.push(setTimeout(() => {
            if (resolvedRef.current) return;
            setPhase('go');
            promptTimeRef.current = performance.now();
            haptic.medium();
          }, realExtraDelayMs));
        }, fakeDurationMs));
      }, fakeDelayMs));
    } else {
      timers.push(setTimeout(() => {
        if (resolvedRef.current) return;
        setPhase('go');
        promptTimeRef.current = performance.now();
        haptic.medium();
      }, baseDelay));
    }

    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDriven]);

  // Hard timeout (offline only): covers the case where the user never
  // taps at all. In server-driven mode the server owns the deadline and
  // sends challenge_resolved; the parent dismisses the mini-game then.
  useEffect(() => {
    if (serverDriven) return;
    const totalMs = tuning.timeoutMs + tuning.promptDelayMs[1]
      + (hasFake ? fakeDelayMs + fakeDurationMs + realExtraDelayMs : 0);
    const t = setTimeout(() => {
      if (!resolvedRef.current) {
        haptic.warning();
        safeResolve({ tier: 'MISS', ...SKILL_TIERS.MISS });
      }
    }, totalMs);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverDriven]);

  const handleTap = () => {
    if (resolvedRef.current) return;
    // Always emit the input first so the server (online) sees the tap
    // regardless of which phase the client thinks it's in.
    if (onInput) onInput('tap', { isFake: phase === 'fake' });
    if (serverDriven) {
      // Server determines tier authoritatively from input timing + RTT
      // compensation; client just provides haptic/visual feedback.
      if (phase === 'fake') haptic.warning();
      else if (phase === 'waiting') haptic.warning();
      else if (phase === 'go') haptic.heavy();
      return;
    }
    // Offline: compute tier locally and resolve.
    if (phase === 'fake') {
      haptic.warning();
      safeResolve({ tier: 'MISS', ...SKILL_TIERS.MISS });
      return;
    }
    if (phase === 'waiting') {
      haptic.warning();
      safeResolve({ tier: 'MISS', ...SKILL_TIERS.MISS });
      return;
    }
    const reactionMs = performance.now() - promptTimeRef.current;
    let result;
    if (reactionMs <= tuning.perfectWindowMs) {
      haptic.heavy();
      result = { tier: 'PERFECT', ...SKILL_TIERS.PERFECT };
    } else if (reactionMs <= tuning.goodWindowMs) {
      haptic.medium();
      result = { tier: 'GOOD', ...SKILL_TIERS.GOOD };
    } else {
      haptic.warning();
      result = { tier: 'MISS', ...SKILL_TIERS.MISS };
    }
    safeResolve(result);
  };

  // Button appearance per phase
  const bgColor = phase === 'go'
    ? '#10b981'   // emerald - the real prompt
    : phase === 'fake'
      ? '#ef4444'   // red - the fake
      : '#3f3f46';  // zinc - waiting

  const label = phase === 'go'
    ? 'WRESTLE!!'
    : phase === 'fake'
      ? 'NOW!'
      : '...';

  const hint = phase === 'waiting'
    ? 'Wait for the whistle…'
    : phase === 'fake'
      ? 'Wait…'           // don't telegraph that it's fake
      : phase === 'go'
        ? 'ATTACK!'
        : 'Done';

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div className="text-xs uppercase tracking-widest text-zinc-400">{hint}</div>
      <motion.button
        onPointerDown={handleTap}
        style={{ touchAction: 'none' }}
        className="w-32 h-32 rounded-full font-black text-zinc-900 text-lg leading-none"
        animate={{ backgroundColor: bgColor, scale: (phase === 'go' || phase === 'fake') ? 1.1 : 1 }}
        transition={{ duration: 0.08 }}
      >
        {label}
      </motion.button>
    </div>
  );
}
