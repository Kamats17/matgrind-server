// src/components/wrestling/WinStreakBanner.jsx
//
// Celebration banner shown on the match-end modal when the player is on an
// active win streak of 3+. Tiered by flame count and color:
//
//   streak 3-4  : 🔥   orange - "on a 3-match win streak"
//   streak 5-9  : 🔥🔥  red/orange - "5-match win streak!"
//   streak 10-19: 🔥🔥🔥 red - "10-match streak - hot"
//   streak 20+  : 🔥🔥🔥🔥 gold-outline - "X-match streak - unreal"
//
// Also celebrates when the match just broke the player's personal best
// (passed via `isNewBest`), adding a "NEW BEST!" chip. The banner is pure
// presentation - it only reads props and never mutates anything.

import React from 'react';

function streakTier(n) {
  if (n >= 20) return { flames: '🔥🔥🔥🔥', border: 'border-amber-400', bg: 'bg-amber-950/40', text: 'text-amber-200', label: 'unreal' };
  if (n >= 10) return { flames: '🔥🔥🔥',   border: 'border-red-500',   bg: 'bg-red-950/40',   text: 'text-red-300',   label: 'hot' };
  if (n >= 5)  return { flames: '🔥🔥',     border: 'border-orange-500',bg: 'bg-orange-950/40',text: 'text-orange-300',label: 'rolling' };
  return           { flames: '🔥',       border: 'border-amber-600/70', bg: 'bg-amber-950/30', text: 'text-amber-300', label: 'on a streak' };
}

export default function WinStreakBanner({ winStreak = 0, isNewBest = false }) {
  if (!Number.isFinite(winStreak) || winStreak < 3) return null;
  const tier = streakTier(winStreak);
  return (
    <div
      className={`flex items-center justify-between gap-3 ${tier.bg} border ${tier.border} rounded-xl px-3 py-2 mb-3`}
      role="status"
      aria-label={`Win streak: ${winStreak} matches`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-lg leading-none shrink-0" aria-hidden="true">{tier.flames}</span>
        <div className="min-w-0">
          <div className={`${tier.text} text-[11px] font-black uppercase tracking-[0.15em] truncate`}>
            {winStreak}-match win streak
          </div>
          <div className="text-zinc-400 text-[11px] leading-tight truncate">
            Keep it {tier.label}.
          </div>
        </div>
      </div>
      {isNewBest && (
        <span className="shrink-0 bg-yellow-500 text-black text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md">
          New Best!
        </span>
      )}
    </div>
  );
}
