// Career Depth Pass v1 - ChampionshipMintCard.
//
// Special trophy reveal shown in MatchResultModal when the player wins a
// championship or tournament. Replaces the generic XP chip with a celebratory
// medal/title card. Pulls structured trophy data from
// `nextCareer.lastEventTrophy` (populated by recordEventResult). No-op render
// when trophy is missing or has no name.
//
// Tone variants by prestige:
//   - 'gold'   -> amber/gold gradient with crown emoji
//   - 'silver' -> zinc/silver gradient with medal emoji
//   - null     -> bronze/zinc fallback (tournament wins, conference titles)

import React from 'react';

const PRESTIGE_STYLES = {
  gold: {
    border: 'border-amber-400/80',
    bg: 'bg-gradient-to-br from-amber-900/40 to-amber-600/30',
    label: 'text-amber-300',
    title: 'text-amber-100',
    icon: '\u{1F451}', // crown
    accent: 'GOLD',
  },
  silver: {
    border: 'border-zinc-300/60',
    bg: 'bg-gradient-to-br from-zinc-700/40 to-zinc-400/20',
    label: 'text-zinc-200',
    title: 'text-white',
    icon: '\u{1F948}', // 2nd place medal
    accent: 'SILVER',
  },
  default: {
    border: 'border-orange-700/60',
    bg: 'bg-gradient-to-br from-orange-900/30 to-orange-700/20',
    label: 'text-orange-300',
    title: 'text-orange-100',
    icon: '\u{1F3C6}', // trophy
    accent: 'CHAMPION',
  },
};

export default function ChampionshipMintCard({ trophy }) {
  if (!trophy || !trophy.name) return null;
  const style = PRESTIGE_STYLES[trophy.prestige] || PRESTIGE_STYLES.default;
  return (
    <div
      className={`relative ${style.bg} border-2 ${style.border} rounded-2xl p-4 mb-4 overflow-hidden`}
      role="status"
      aria-label={`Trophy earned: ${trophy.name}`}
    >
      <div className="flex items-center gap-3">
        <div className="text-4xl shrink-0" aria-hidden="true">{style.icon}</div>
        <div className="min-w-0 flex-1">
          <div className={`${style.label} text-[10px] font-black uppercase tracking-[0.22em] leading-none`}>
            {style.accent} TITLE EARNED
          </div>
          <div className={`${style.title} text-sm font-black mt-1`}>
            {trophy.name}
          </div>
          {trophy.weightClass && (
            <div className="text-white/70 text-[11px] font-semibold mt-1">
              {trophy.weightClass} lbs &middot; Season {trophy.season}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
