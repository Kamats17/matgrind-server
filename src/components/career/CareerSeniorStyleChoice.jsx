// --- CareerSeniorStyleChoice (v7 celebration screen) ---------------------
// Renders when career.phase === 'senior_style_choice'. v7 turned this from
// a fork into a celebration: the senior tier no longer requires picking a
// single style.
//   - Men: wrestle BOTH freestyle and greco events all year. Both UWW kg
//     snaps shown. One button.
//   - Women: women's freestyle only (no greco at any women's level
//     worldwide). Single kg snap shown. One button.
//
// onChooseStyle is preserved as the callback name for back-compat with
// WrestlingGame.jsx, but the style argument is informational - the engine
// decides the senior setup from career.wrestler.gender.

import React, { useState } from 'react';
import NavBar from '../ui/NavBar.jsx';

function WeightRow({ label, weightKg }) {
  return (
    <div className="flex items-baseline justify-between py-2 border-b border-zinc-800 last:border-b-0">
      <div className="text-sm text-zinc-300 font-semibold">{label}</div>
      <div className="text-base text-white font-black">{weightKg} kg</div>
    </div>
  );
}

export default function CareerSeniorStyleChoice({ career, onChooseStyle, onRetire, onBack }) {
  const [confirmRetire, setConfirmRetire] = useState(false);

  const choice = career?.seniorChoice;
  const wrestler = career?.wrestler;
  const isFemale = wrestler?.gender === 'female';

  // v7: weights map is the source of truth. Fall back to legacy fields
  // for any pre-v7 senior choice context that might still be in flight.
  const weights = choice?.weights || {};
  const freestyleKg = weights.freestyle ?? choice?.freestyleWeight;
  const grecoKg = weights.greco ?? choice?.grecoWeight;
  const womensKg = weights.womens_freestyle ?? choice?.womensFreestyleWeight;

  function handleBegin() {
    // Style argument preserved for back-compat (WrestlingGame.jsx still
    // forwards it). The engine reads gender to decide the actual setup,
    // so what we pass here is informational.
    if (isFemale) {
      onChooseStyle?.('womens_freestyle');
    } else {
      onChooseStyle?.('freestyle');
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Senior International" onBack={onBack} />

      <div className="flex-1 px-4 py-4 max-w-md mx-auto w-full overflow-auto">
        <div className="rounded-xl border border-teal-800/40 bg-teal-950/20 p-4 mb-4">
          <div className="text-xs uppercase tracking-widest text-teal-300 mb-1">
            College Career Complete
          </div>
          <div className="text-xl font-bold">{wrestler?.name}</div>
          <div className="text-sm text-zinc-400 mt-0.5">
            Final national rank: {choice?.collegeFinalRank ? `#${choice.collegeFinalRank}` : '-'}
          </div>
        </div>

        {isFemale ? (
          // Women's senior celebration: single style.
          <div className="rounded-2xl border-2 border-teal-700 bg-teal-950/30 p-4 mb-5">
            <div className="text-base font-black tracking-tight mb-1">Women's Freestyle</div>
            <div className="text-[11px] text-zinc-400 mb-3">
              UWW International Rules. Olympic since 2004. Same on-mat engine
              as men's freestyle: leg attacks legal, exposure scoring, grand
              amplitude throws worth 5 points.
            </div>
            <WeightRow label="Senior weight" weightKg={womensKg ?? '-'} />
            <div className="text-[11px] text-zinc-500 mt-3">
              Was {choice?.weightLbs} lbs in college.
            </div>
          </div>
        ) : (
          // Men's senior celebration: dual-style.
          <div className="rounded-2xl border-2 border-emerald-800 bg-emerald-950/20 p-4 mb-5">
            <div className="text-base font-black tracking-tight mb-1">Senior International</div>
            <div className="text-[11px] text-zinc-400 mb-3">
              You'll wrestle both Freestyle AND Greco-Roman events at the
              senior international level - both styles, all year, snapped
              to the right kg per event.
            </div>
            <WeightRow label="Freestyle" weightKg={freestyleKg ?? '-'} />
            <WeightRow label="Greco-Roman" weightKg={grecoKg ?? '-'} />
            <div className="text-[11px] text-zinc-500 mt-3">
              Was {choice?.weightLbs} lbs in college.
            </div>
          </div>
        )}

        <button
          onClick={handleBegin}
          className="w-full py-3 rounded-lg bg-teal-700 hover:bg-teal-600 text-white font-black text-sm uppercase tracking-wider active:scale-[0.99] transition mb-4"
        >
          Begin Senior Career
        </button>

        <button
          onClick={() => setConfirmRetire(true)}
          className="w-full py-2 text-xs text-zinc-500 hover:text-red-400 underline underline-offset-4 decoration-dotted"
        >
          Retire from wrestling
        </button>
      </div>

      {confirmRetire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-red-800/60 bg-zinc-950 p-5">
            <div className="text-red-300 text-xs font-black uppercase tracking-[0.2em] mb-2">Retire</div>
            <div className="text-white font-bold text-lg mb-1 break-words">End {wrestler?.name}'s career?</div>
            <div className="text-zinc-400 text-sm mb-4">
              The wrestler is preserved in your Hall of Fame. This cannot be undone.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRetire(false)}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmRetire(false);
                  onRetire?.();
                }}
                className="flex-1 py-3 rounded-lg bg-red-700 hover:bg-red-600 text-white font-black"
              >
                Retire
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
