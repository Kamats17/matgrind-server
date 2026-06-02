// ─── CareerInterstitialScreen ───────────────────────────────────────────────
// Between-match event picker. Shown after a tournament round ends and before
// the next match starts. 2-3 cards; tap one to apply its buff. The picked
// buff lives on career.wrestler.tempBuffs[] and is consumed at the next
// career match start by applyCareerMatchModifiers (careerMatchModifiers.js),
// which forwards the consumed sourceIds to recordEventResult so the buff
// is ticked off and (if debuff) counted against seasonMeta.debuffEventCount.

import React from 'react';
import NavBar from '../ui/NavBar.jsx';

export default function CareerInterstitialScreen({ choices, roundLabel, onChoose, onSkip }) {
  if (!Array.isArray(choices) || choices.length === 0) {
    // No interstitial available - auto-skip
    onSkip?.();
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Between Rounds" onBack={onSkip} />
      <div className="flex-1 px-4 py-5 max-w-md mx-auto w-full">
        <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
          {roundLabel || 'Up Next'}
        </div>
        <div className="text-lg font-bold text-zinc-100 mb-1">Pick your edge</div>
        <div className="text-xs text-zinc-500 mb-5">
          Choose one. The effect lasts your next match only.
        </div>

        <div className="space-y-3">
          {choices.map(c => (
            <button
              key={c.id}
              onClick={() => onChoose?.(c)}
              className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 active:scale-[0.98] hover:border-emerald-700 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-zinc-100">{c.label}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">{c.description}</div>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold flex-shrink-0 mt-1">
                  {c.buff?.label || 'Buff'}
                </div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={onSkip}
          className="mt-6 w-full py-3 rounded-lg border border-zinc-800 bg-zinc-900/40 text-zinc-400 text-sm hover:text-zinc-200 transition"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
