// Career Depth Pass v1 - CoachBlurb.
//
// Compact card surfacing a coach line. Used post-match (MatchResultModal) and
// pre-match (scouting card). Pure presentation; the caller resolves the line
// from getCoachLine() / computeScoutingBlurb() in careerCoach.js and passes
// it in via props. No-op render when `line` is missing so callers can render
// it unconditionally and let the prop drive visibility.
//
// Tone variant `tone`:
//   - 'win'      => emerald accent
//   - 'loss'     => red accent
//   - 'scouting' => amber accent (pre-match)
//   - 'neutral'  => zinc accent (default)

import React from 'react';

const TONE_STYLES = {
  win:      { border: 'border-emerald-700/60', bg: 'bg-emerald-950/30', accent: 'text-emerald-300' },
  loss:     { border: 'border-red-800/60',     bg: 'bg-red-950/25',     accent: 'text-red-300' },
  scouting: { border: 'border-amber-700/60',   bg: 'bg-amber-950/25',   accent: 'text-amber-300' },
  neutral:  { border: 'border-zinc-800',       bg: 'bg-zinc-950',       accent: 'text-zinc-300' },
};

export default function CoachBlurb({ coachName, line, tone = 'neutral', label = 'Coach' }) {
  if (!line || !coachName) return null;
  const style = TONE_STYLES[tone] || TONE_STYLES.neutral;
  return (
    <div
      className={`flex items-start gap-3 ${style.bg} border ${style.border} rounded-xl px-3 py-2 mb-4`}
      role="status"
      aria-label={`${label}: ${coachName} says: ${line}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-zinc-500 text-[10px] font-black uppercase tracking-[0.18em] leading-none">
          {label}
        </div>
        <div className="text-white text-xs font-bold mt-1 truncate">
          {coachName}
        </div>
        <div className={`${style.accent} text-xs italic mt-1 leading-snug`}>
          &ldquo;{line}&rdquo;
        </div>
      </div>
    </div>
  );
}
