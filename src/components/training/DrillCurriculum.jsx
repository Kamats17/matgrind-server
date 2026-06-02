// src/components/training/DrillCurriculum.jsx
//
// Step-by-step practice for one of the four in-match micro-mechanics
// (Charge, Reaction, Trace, Burst). Reads the per-mechanic curriculum from
// `lib/drillCurricula.js`, mounts the matching mechanic component with that
// step's tuning override, and advances when the player's resolution tier
// satisfies the step's `passOn` array (with `requireStreak` for steps that
// demand consecutive successes).
//
// Why this lives next to MechanicLoop instead of replacing it: free-play
// (MechanicLoop) is for grinding reps once you already understand the
// mechanic; the curriculum is for *learning* it. Both share the same
// underlying mechanic components - only the wrapper differs.

import React, { useState, useEffect } from 'react';
import { CURRICULA, totalSteps, loadProgress, saveProgress, resetProgress } from '../../lib/drillCurricula.js';
import { haptic } from '../../lib/haptics';

const TIER_LABEL = { PERFECT: 'PERFECT', GOOD: 'GOOD', MISS: 'MISS' };
const TIER_COLOR = {
  PERFECT: 'text-emerald-400',
  GOOD: 'text-amber-400',
  MISS: 'text-zinc-500',
};

const MECHANIC_DISPLAY_NAMES = {
  charge:   'Drive Through',
  reaction: 'Reaction',
  trace:    'Trace',
  burst:    'Burst',
};

export default function DrillCurriculum({ mechanic, Component }) {
  const steps = CURRICULA[mechanic] || [];
  const [stepIndex, setStepIndex] = useState(() => {
    // Resume at the user's furthest-reached step (capped at last step).
    const saved = loadProgress(mechanic);
    return Math.min(saved, Math.max(0, steps.length - 1));
  });
  const [iteration, setIteration] = useState(0);   // forces remount → reset
  const [streak, setStreak] = useState(0);          // current consecutive passes
  const [lastTier, setLastTier] = useState(null);   // for header readout
  const [graduated, setGraduated] = useState(false);

  // Reset transient state on step change so a stale streak doesn't carry
  // across step boundaries.
  useEffect(() => {
    setStreak(0);
    setLastTier(null);
    setIteration(0);
  }, [stepIndex]);

  if (steps.length === 0) {
    return (
      <div className="text-zinc-500 text-sm py-8 text-center">
        No curriculum defined for this mechanic.
      </div>
    );
  }

  const step = steps[stepIndex];
  const requireStreak = step.requireStreak ?? 1;
  const isFinalStep = stepIndex >= steps.length - 1;

  const handleResolve = (result) => {
    setLastTier(result.tier);
    const passed = step.passOn.includes(result.tier);

    if (!passed) {
      setStreak(0);
      // Brief pause then re-mount the mechanic so the player can try again.
      setTimeout(() => setIteration((i) => i + 1), 800);
      return;
    }

    const nextStreak = streak + 1;
    setStreak(nextStreak);

    if (nextStreak >= requireStreak) {
      // Step complete. Advance (or graduate) and persist.
      try { haptic.success(); } catch { /* silent */ }
      const nextStep = stepIndex + 1;
      saveProgress(mechanic, nextStep);
      if (isFinalStep) {
        setGraduated(true);
      } else {
        setTimeout(() => setStepIndex(nextStep), 700);
      }
    } else {
      // Pass but need more in a row - keep going.
      setTimeout(() => setIteration((i) => i + 1), 700);
    }
  };

  const handleRestart = () => {
    try { haptic.light(); } catch { /* silent */ }
    resetProgress(mechanic);
    setStepIndex(0);
    setStreak(0);
    setLastTier(null);
    setGraduated(false);
    setIteration((i) => i + 1);
  };

  if (graduated) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="text-5xl">🏆</div>
        <div className="text-emerald-400 text-2xl font-black">Graduated!</div>
        <div className="text-zinc-400 text-sm max-w-xs">
          You've cleared every step of the {MECHANIC_DISPLAY_NAMES[mechanic] ?? mechanic} curriculum. You're ready to
          stack reps in Free Play - or restart for a refresher.
        </div>
        <button
          onClick={handleRestart}
          className="mt-2 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold uppercase tracking-wider"
        >
          Restart curriculum
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2 w-full">
      {/* Header: step counter + streak readout */}
      <div className="w-full flex items-center justify-between text-xs">
        <span className="text-zinc-500 font-bold uppercase tracking-widest">
          Step {stepIndex + 1} / {totalSteps(mechanic)}
        </span>
        {requireStreak > 1 && (
          <span className="text-zinc-400 font-mono">
            Streak {streak}/{requireStreak}
          </span>
        )}
      </div>

      {/* Hint banner */}
      <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center">
        <div className="text-emerald-400 text-sm font-bold mb-1">{step.title}</div>
        <div className="text-zinc-400 text-xs">{step.hint}</div>
      </div>

      {/* Last-rep readout */}
      {lastTier && (
        <div className={`text-xs uppercase tracking-widest font-bold ${TIER_COLOR[lastTier]}`}>
          Last rep: {TIER_LABEL[lastTier]}
        </div>
      )}

      {/* Mechanic - remounts on iteration so each rep starts clean. */}
      <Component
        key={iteration}
        onResolve={handleResolve}
        tuningOverride={step.tuning}
      />

      {/* Restart hatch - small, low-emphasis link so the screen is mostly
          about practising, not about UI controls. */}
      <button
        onClick={handleRestart}
        className="text-zinc-600 hover:text-zinc-400 text-[10px] uppercase tracking-widest font-bold mt-2"
      >
        Restart curriculum
      </button>
    </div>
  );
}
