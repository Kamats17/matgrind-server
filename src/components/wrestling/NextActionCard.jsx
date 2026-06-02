// src/components/wrestling/NextActionCard.jsx
//
// Post-match "what next" card shown above the sticky action buttons in
// the match-end modal. Two jobs:
//
//   1. Give the player a concrete sense of XP momentum - a thin bar
//      showing progress toward the next level, with a subtle pulse the
//      first time the modal appears so the eye is drawn to it.
//   2. Surface the most relevant follow-up action based on the match
//      context (win streak, online, daily-challenge progress, etc.) so
//      the player's next tap is an in-app action rather than a close.
//
// Pure presentational layer - the card never mutates anything. If any
// of the underlying data is missing (no profile, totalXP undefined, etc.)
// the card silently renders nothing so the modal never looks broken.

import React from 'react';
import { getLevelFromXP, getXPProgress, getXPToNextLevel } from '../../lib/profileUtils.js';

/**
 * Pick the contextual tip + CTA to show. Returns an object or null when
 * nothing interesting applies (a draw vs AI with no streak, no daily
 * progress, etc.). Pure function - easy to unit-test.
 *
 * @param {{ result?: string, winStreak?: number, gameMode?: string, dailyDone?: number, dailyTotal?: number }} ctx
 * @returns {{ label: string, ctaLabel: string, action: 'rematch'|'menu', accent: string }}
 */
function pickTip(ctx) {
  const { result, winStreak, gameMode, dailyDone, dailyTotal } = ctx || {};
  const streak = Number.isFinite(winStreak) ? winStreak : 0;

  // Daily-challenge progress takes priority when it's mid-way - the user
  // can usually finish it in another match and wants to know. We skip
  // this nudge when 0/3 (don't nag fresh players) and when 3/3 (done).
  if (
    Number.isFinite(dailyDone) &&
    Number.isFinite(dailyTotal) &&
    dailyDone > 0 && dailyDone < dailyTotal
  ) {
    return {
      label: `Daily challenges: ${dailyDone} of ${dailyTotal} done - one more match should seal it.`,
      ctaLabel: 'Play Another',
      action: 'rematch',
      accent: 'text-yellow-300',
    };
  }

  // On a streak after a win - push them to extend it.
  if (result === 'win' && streak >= 3) {
    return {
      label: `Keep the streak alive - that's ${streak} in a row.`,
      ctaLabel: 'Run It Back',
      action: 'rematch',
      accent: 'text-orange-300',
    };
  }

  // Online match - reframe Rematch as "find a new opponent" since the
  // actual next match won't be against the same player.
  if (gameMode === 'network') {
    return {
      label: result === 'win'
        ? 'Nice one. Queue up for another?'
        : 'Shake it off - fresh opponent is a tap away.',
      ctaLabel: 'Find Another Opponent',
      action: 'rematch',
      accent: 'text-sky-300',
    };
  }

  // Loss fallback - less aggressive language so we're not rubbing it in.
  if (result === 'loss') {
    return {
      label: 'Quick rematch - settle the score.',
      ctaLabel: 'Rematch',
      action: 'rematch',
      accent: 'text-zinc-300',
    };
  }

  // Win or draw vs. AI - generic "one more" nudge.
  return {
    label: 'Keep the grind going.',
    ctaLabel: 'One More Round',
    action: 'rematch',
    accent: 'text-emerald-300',
  };
}

export default function NextActionCard({
  profile,
  result,
  winStreak,
  gameMode,
  dailyDone,
  dailyTotal,
  onRematch,
  onMenu,
  isTournament,
}) {
  // Tournament mode already has a big purple "Continue Tournament" CTA -
  // a second card would be visual noise and the tournament flow owns the
  // "what's next" decision itself.
  if (isTournament) return null;

  const xp = (profile && Number.isFinite(profile.xp)) ? profile.xp : null;
  if (xp == null) return null;

  const level = getLevelFromXP(xp);
  const progress = getXPProgress(xp);
  const needed = getXPToNextLevel(xp);
  const remaining = Math.max(0, needed - progress);
  const pct = needed > 0 ? Math.max(0, Math.min(100, Math.round((progress / needed) * 100))) : 0;

  const tip = pickTip({ result, winStreak, gameMode, dailyDone, dailyTotal });
  const handleTap = () => {
    if (tip.action === 'menu' && typeof onMenu === 'function') onMenu();
    else if (typeof onRematch === 'function') onRematch();
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 mt-2 mb-3">
      <div className="flex items-end justify-between mb-1.5">
        <div className="text-white text-xs font-black uppercase tracking-[0.15em]">
          Level {level}
        </div>
        <div className="text-zinc-500 text-[11px] font-semibold">
          {remaining} XP to {level + 1}
        </div>
      </div>
      {/* XP progress bar - subtle pulse draws the eye without being loud */}
      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-yellow-500 to-amber-400 animate-pulse"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <div className={`mt-3 text-xs break-words ${tip.accent}`}>
        {tip.label}
      </div>
      <button
        type="button"
        onClick={handleTap}
        className="w-full mt-2 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white text-xs font-black uppercase tracking-wider transition-all"
      >
        {tip.ctaLabel} →
      </button>
    </div>
  );
}
