// --- CareerTierTransitionScreen -----------------------------------------
// Renders when career.phase === 'tier_transition'. One-shot celebration
// after a tier change (HS -> college, college -> senior). Shows old rank
// vs new rank, weight class change, stat cap raise, and a Continue CTA
// that calls confirmTierTransition.

import React from 'react';
import NavBar from '../ui/NavBar.jsx';
import { formatStyle } from '../../lib/career/careerWeights.js';

const TIER_LABEL = { hs: 'High School', college: 'College', senior: 'Senior International' };
const STAT_CAP = { hs: 80, college: 90, senior: 99 };

const STAT_FOCUS_LABEL = {
  str: 'Strength', spd: 'Speed', tec: 'Technique', end: 'Endurance', grt: 'Grit',
};

function fmtRank(rank, scope) {
  if (rank == null) return null;
  const scopeLabel = scope === 'state' ? 'state' : scope === 'section' ? 'section' : 'conference';
  return `#${rank} ${scopeLabel}`;
}

export default function CareerTierTransitionScreen({ career, onContinue }) {
  const t = career?.tierTransition;
  const wrestler = career?.wrestler;

  if (!t) {
    // Defensive: if somehow rendered without context, just show Continue.
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center px-4">
        <button
          onClick={() => onContinue?.()}
          className="py-3 px-6 rounded-lg bg-emerald-700 text-white font-bold"
        >
          Continue
        </button>
      </div>
    );
  }

  const toCollege = t.toTier === 'college';
  const toSenior = t.toTier === 'senior';

  const headline = toCollege
    ? `Welcome to ${t.schoolName || 'College'}`
    : toSenior
      ? `Welcome to Senior International`
      : 'Tier Transition';

  const subline = toCollege
    ? t.conference
    : toSenior
      ? `${formatStyle(t.style)} · UWW`
      : '';

  const oldStateRank = fmtRank(t.oldRank?.state, 'state');
  const newStateRank = fmtRank(t.newRank?.state, 'state');

  const oldCap = STAT_CAP[t.fromTier] ?? 80;
  const newCap = STAT_CAP[t.toTier] ?? 99;

  const weightLine = t.weightChanged
    ? toSenior
      ? `${t.oldWeight} lbs -> ${t.newWeight} kg (UWW)`
      : `${t.oldWeight} lbs -> ${t.newWeight} lbs (NCAA)`
    : `${t.newWeight}${toSenior ? ' kg' : ' lbs'}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-950/40 via-zinc-950 to-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="New Stage" onBack={null} />

      <div className="flex-1 px-4 py-6 max-w-md mx-auto w-full overflow-auto">
        <div className="text-center mb-6">
          <div className="text-[11px] uppercase tracking-[0.3em] text-emerald-300 mb-1">
            {TIER_LABEL[t.fromTier]} {'->'} {TIER_LABEL[t.toTier]}
          </div>
          <div className="text-2xl font-black tracking-tight">{headline}</div>
          {subline && <div className="text-sm text-zinc-400 mt-1">{subline}</div>}
          <div className="text-base text-zinc-300 mt-3">{wrestler?.name}</div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-3">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Ranking Reset</div>
          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1">
              <div className="text-zinc-500 text-[10px] uppercase">Was</div>
              <div className="text-zinc-200 font-bold">{oldStateRank || '-'}</div>
            </div>
            <div className="text-zinc-500">→</div>
            <div className="flex-1 text-right">
              <div className="text-zinc-500 text-[10px] uppercase">Now</div>
              <div className="text-emerald-300 font-bold">{newStateRank || '-'}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-3">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Weight Class</div>
          <div className="text-zinc-200 font-bold text-base">{weightLine}</div>
          {t.weightChanged && (
            <div className="text-[11px] text-zinc-500 mt-1">
              Snapped to nearest valid weight at this stage.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-3">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Stat Cap Raised</div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-zinc-400 font-bold">{oldCap}</div>
            <div className="text-zinc-500">→</div>
            <div className="text-emerald-300 font-bold text-lg">{newCap}</div>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            You can now train past your old cap.
          </div>
        </div>

        {t.statBump && (
          <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-4 mb-3">
            <div className="text-[10px] uppercase tracking-widest text-emerald-300 mb-1">Program Focus</div>
            <div className="text-emerald-200 font-bold text-sm">
              +{t.statBump.amount} {STAT_FOCUS_LABEL[t.statBump.stat] || t.statBump.stat}
            </div>
          </div>
        )}

        {t.deckBonus?.label && (
          <div className="rounded-2xl border border-amber-800/60 bg-amber-950/20 p-4 mb-3">
            <div className="text-[10px] uppercase tracking-widest text-amber-300 mb-1">Recruiting Bonus</div>
            <div className="text-amber-200 font-bold text-sm">{t.deckBonus.label}</div>
          </div>
        )}

        <button
          onClick={() => onContinue?.()}
          className="mt-4 w-full py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-black text-base active:scale-[0.98] transition"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
