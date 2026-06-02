// src/components/wrestling/RivalryCard.jsx
//
// Compact head-to-head chip shown on the match-end modal. Tells the
// player "You're now 4-2 vs. Medium AI" after the match is recorded so
// the rivalry meter gets immediate feedback.
//
// Pure presentation - never touches localStorage. The caller (WrestlingGame
// → MatchResultModal) has already called `recordRivalry` and passes the
// updated tally via props.
//
// Renders nothing when wins+losses === 0 (first match against that
// opponent, pre-recording) or when label/wins/losses are missing, so the
// modal stays clean for unsupported modes (local 2p, random online).

import React from 'react';

// Career Depth Pass v1 - Rivalry Heat flame escalation thresholds.
// Mirrors careerRivals.js (kept local to avoid a circular import path from
// this presentation component into career-mode logic). UI-only constants.
const FLAME_HOT = 3;
const FLAME_BLOOD = 5;
const FLAME_OWNED = 8;

function flameChip(level) {
  if (!Number.isFinite(level)) return null;
  if (level >= FLAME_OWNED) return '\u{1F525}\u{1F525}\u{1F525}';
  if (level >= FLAME_BLOOD) return '\u{1F525}\u{1F525}';
  if (level >= FLAME_HOT) return '\u{1F525}';
  return null;
}

export default function RivalryCard({ label, wins = 0, losses = 0, didWin = null, feudLevel = null }) {
  const total = (wins | 0) + (losses | 0);
  if (!label || total === 0) return null;
  const flames = flameChip(feudLevel);

  // Visual accent mirrors the most recent outcome - greens for a win just
  // logged, reds for a loss, neutral zinc for draws / unknown.
  const accent =
    didWin === true
      ? { border: 'border-emerald-700/60', bg: 'bg-emerald-950/30', text: 'text-emerald-300' }
      : didWin === false
        ? { border: 'border-red-800/60', bg: 'bg-red-950/25', text: 'text-red-300' }
        : { border: 'border-zinc-800', bg: 'bg-zinc-950', text: 'text-zinc-300' };

  // Summary line: "4-2" with "Your lead" / "Behind" / "Even" hint.
  const diff = wins - losses;
  const hint = diff > 0 ? `You lead by ${diff}` : diff < 0 ? `Behind by ${-diff}` : 'All tied up';

  return (
    <div
      className={`flex items-center justify-between gap-3 ${accent.bg} border ${accent.border} rounded-xl px-3 py-2 mb-4`}
      role="status"
      aria-label={`Rivalry: ${wins} wins to ${losses} losses vs ${label}`}
    >
      <div className="min-w-0">
        <div className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.18em] leading-none">
          {flames ? `Rivalry Heat ${flames}` : 'Head-to-Head'}
        </div>
        <div className="text-white text-xs font-bold mt-1 truncate">
          vs {label}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={`${accent.text} text-base font-black leading-none`}>
          {wins}-{losses}
        </div>
        <div className="text-zinc-500 text-[10px] font-semibold mt-1">
          {hint}
        </div>
      </div>
    </div>
  );
}
