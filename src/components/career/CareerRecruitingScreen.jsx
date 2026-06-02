// --- CareerRecruitingScreen ---------------------------------------------
// Renders when career.phase === 'recruiting'. The wrestler has just finished
// HS senior year. They pick a college offer (Accept), take the walk-on path,
// or retire from wrestling.

import React, { useState } from 'react';
import NavBar from '../ui/NavBar.jsx';

const STAT_FOCUS_LABEL = {
  str: 'Strength',
  spd: 'Speed',
  tec: 'Technique',
  end: 'Endurance',
  grt: 'Grit',
};

function PrestigeStars({ prestige }) {
  return (
    <div className="text-amber-300 text-xs tracking-wider">
      {'★'.repeat(prestige)}
      <span className="text-zinc-700">{'☆'.repeat(5 - prestige)}</span>
    </div>
  );
}

function OfferCard({ offer, onAccept }) {
  return (
    <button
      onClick={onAccept}
      className="w-full text-left rounded-2xl border-2 border-zinc-800 bg-zinc-900/60 hover:border-emerald-700 hover:bg-emerald-950/20 p-4 active:scale-[0.99] transition"
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <div className="text-base font-bold text-zinc-100 truncate">{offer.schoolName}</div>
        <PrestigeStars prestige={offer.prestige} />
      </div>
      <div className="text-[11px] text-zinc-400 mb-2">
        {offer.conference}{offer.stateOfSchool ? ` · ${offer.stateOfSchool}` : ''} · {offer.scholarshipNote}
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {offer.statFocus && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800/60 text-emerald-300">
            +3 {STAT_FOCUS_LABEL[offer.statFocus] || offer.statFocus}
          </span>
        )}
        {offer.deckBonus?.label && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 border border-amber-800/60 text-amber-300">
            {offer.deckBonus.label}
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-300 italic">"{offer.pitch}"</div>
      <div className="mt-3 text-center text-xs text-emerald-300 font-bold uppercase tracking-wider">
        Tap to Accept
      </div>
    </button>
  );
}

export default function CareerRecruitingScreen({
  career,
  onAcceptOffer,
  onWalkOn,
  onRetire,
  onBack,
}) {
  const [confirmWalkOn, setConfirmWalkOn] = useState(false);
  const [confirmRetire, setConfirmRetire] = useState(false);

  const offers = career?.recruiting?.offers || [];
  const score = career?.recruiting?.recruitingScore || 0;
  const wrestler = career?.wrestler;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Recruiting" onBack={onBack} />

      <div className="flex-1 px-4 py-4 max-w-md mx-auto w-full overflow-auto">
        <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4 mb-4">
          <div className="text-xs uppercase tracking-widest text-emerald-300 mb-1">
            Senior Year Complete
          </div>
          <div className="text-xl font-bold">{wrestler?.name}</div>
          <div className="text-sm text-zinc-400 mt-0.5">
            {career?.record?.careerWins ?? 0}-{career?.record?.careerLosses ?? 0} HS career
            · {career?.record?.titles?.length || 0} title{(career?.record?.titles?.length || 0) === 1 ? '' : 's'}
          </div>
          <div className="text-xs text-zinc-500 mt-2">
            Recruiting score: <span className="text-zinc-300 font-semibold">{score}</span> / 100
          </div>
        </div>

        {offers.length > 0 && (
          <>
            <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">
              Offers ({offers.length})
            </div>
            <div className="space-y-3 mb-5">
              {offers.map(o => (
                <OfferCard key={o.id} offer={o} onAccept={() => onAcceptOffer?.(o.id)} />
              ))}
            </div>
          </>
        )}

        {offers.length === 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 mb-5 text-center">
            <div className="text-zinc-300 font-bold mb-1">No D1 programs reached out.</div>
            <div className="text-xs text-zinc-500">
              Your HS resume didn't catch any recruiters' attention. You can still walk on at a smaller program, or retire.
            </div>
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={() => setConfirmWalkOn(true)}
            className="w-full py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold active:scale-95 transition"
          >
            Walk-On at Smaller Program
          </button>
          <button
            onClick={() => setConfirmRetire(true)}
            className="w-full py-2 text-xs text-zinc-500 hover:text-red-400 underline underline-offset-4 decoration-dotted"
          >
            Retire from wrestling
          </button>
        </div>
      </div>

      {confirmWalkOn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="text-zinc-300 text-xs font-black uppercase tracking-[0.2em] mb-2">Walk-On Path</div>
            <div className="text-white font-bold text-lg mb-1">Walk on at a smaller D1?</div>
            <div className="text-zinc-400 text-sm mb-4">
              No scholarship, no signature card unlock, no stat focus. You'll be a roster member at the lowest D1 tier and have to earn your starting spot.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmWalkOn(false)}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
              >
                Back
              </button>
              <button
                onClick={() => {
                  setConfirmWalkOn(false);
                  onWalkOn?.();
                }}
                className="flex-1 py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-black"
              >
                Walk On
              </button>
            </div>
          </div>
        </div>
      )}

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
