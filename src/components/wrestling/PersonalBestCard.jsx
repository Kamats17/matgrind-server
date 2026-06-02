// src/components/wrestling/PersonalBestCard.jsx
//
// Compact match-end chip listing the personal bests the player just broke.
// Fed by the `newBests` array from `checkPersonalBests` (profileUtils.js);
// each entry carries {key, label, icon, value, previous}. The card renders
// nothing when the array is empty, so the modal stays quiet on quiet
// matches.
//
// Pure presentation - never computes or persists. The parent already
// merged the updated `personal_bests` object into the saved profile.

import React from 'react';

export default function PersonalBestCard({ newBests = [] }) {
  if (!Array.isArray(newBests) || newBests.length === 0) return null;

  return (
    <div
      className="bg-amber-950/35 border border-amber-700/60 rounded-xl p-3 mb-4"
      role="status"
      aria-label={`Personal best${newBests.length === 1 ? '' : 's'} broken`}
    >
      <div className="text-amber-300 text-[11px] font-black uppercase tracking-[0.18em] mb-2 flex items-center gap-1.5">
        <span aria-hidden="true">🏅</span>
        <span>New Personal Best{newBests.length === 1 ? '' : 's'}!</span>
      </div>
      <div className="space-y-1">
        {newBests.map((b) => (
          <div key={b.key} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-base leading-none shrink-0" aria-hidden="true">{b.icon}</span>
              <span className="text-white font-bold truncate">{b.label}</span>
            </div>
            <div className="text-right shrink-0">
              <span className="text-amber-300 font-black">{b.value}</span>
              {Number.isFinite(b.previous) && (
                <span className="text-zinc-500 text-[10px] ml-1.5">
                  (was {b.previous})
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
