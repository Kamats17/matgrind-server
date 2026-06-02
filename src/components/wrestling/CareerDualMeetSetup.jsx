// Pre-dual choice screen for a career dual_meet event. The player picks
// between wrestling only their own weight class (Wrestle My Match) or
// stepping in for every bout in the dual (Wrestle Full Dual). Choice is
// reported via onChoose; the parent (WrestlingGame) builds the dual
// snapshot and routes onward.

import React, { useEffect } from 'react';
import { getWeightsForTier } from '../../lib/career/careerWeights.js';

export default function CareerDualMeetSetup({ career, event, onBack, onChoose }) {
  // Land at the top of the screen so the dual title is visible without a
  // manual scroll-up. Inheriting scroll position from the career dashboard
  // pushed the header off-screen on mobile.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [event?.id]);

  if (!career || !event) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="text-zinc-400">No dual to set up.</div>
      </div>
    );
  }

  const tier = career.wrestler?.tier || 'hs';
  const style = event.style || career.wrestler?.style || 'folkstyle';
  const gender = career.wrestler?.gender || 'male';
  const weights = getWeightsForTier(tier, style, gender);
  const heroWeight = career.wrestler?.weightClass;
  const boutCount = weights.length;

  const playerTeamName = career.wrestler?.school?.name
    || career.wrestler?.school
    || 'Your Team';
  const opponentTeamName = event.opponentTeamName || 'Visiting Team';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-6 flex flex-col">
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-5 flex-1">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="text-sm text-zinc-400 hover:text-zinc-100 underline-offset-2 hover:underline"
          >
            Back
          </button>
        </div>

        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-5 md:p-6">
          <div className="text-amber-300 text-xs font-black uppercase tracking-[0.25em] mb-1">
            Dual Meet
          </div>
          <div className="text-2xl md:text-3xl font-black mb-2">{event.name || 'Dual Meet'}</div>
          <div className="text-zinc-300 text-sm mb-4">
            <span className="font-bold">{playerTeamName}</span>
            <span className="text-zinc-500 mx-2">vs</span>
            <span className="font-bold">{opponentTeamName}</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-zinc-950/60 border border-zinc-800 p-3">
              <div className="text-zinc-500 text-xs uppercase tracking-wider">Your Weight</div>
              <div className="text-lg font-bold text-emerald-300">{heroWeight} lbs</div>
            </div>
            <div className="rounded-lg bg-zinc-950/60 border border-zinc-800 p-3">
              <div className="text-zinc-500 text-xs uppercase tracking-wider">Bouts</div>
              <div className="text-lg font-bold">{boutCount}</div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => onChoose('my_match')}
            className="text-left rounded-2xl bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-700/60 p-5 transition-colors flex flex-col gap-2"
          >
            <div className="text-emerald-300 text-xs font-black uppercase tracking-[0.2em]">Choice A</div>
            <div className="text-xl md:text-2xl font-black">Wrestle My Match</div>
            <div className="text-sm text-zinc-300">
              Step in only at <span className="font-bold text-emerald-300">{heroWeight} lbs</span>.
              The other {boutCount - 1} bouts simulate, then the team result is locked in.
            </div>
            <div className="text-xs text-zinc-500 mt-1">Faster. Your career W/L only counts your bout.</div>
          </button>
          <button
            type="button"
            onClick={() => onChoose('full_dual')}
            className="text-left rounded-2xl bg-amber-900/30 hover:bg-amber-900/50 border border-amber-700/60 p-5 transition-colors flex flex-col gap-2"
          >
            <div className="text-amber-300 text-xs font-black uppercase tracking-[0.2em]">Choice B</div>
            <div className="text-xl md:text-2xl font-black">Wrestle Full Dual</div>
            <div className="text-sm text-zinc-300">
              Wrestle every bout - all {boutCount} weights, one after another.
              Your career W/L still records only your own bout, but the team result is in your hands.
            </div>
            <div className="text-xs text-zinc-500 mt-1">Longer. Best for a true dual-meet experience.</div>
          </button>
        </div>
      </div>
    </div>
  );
}
