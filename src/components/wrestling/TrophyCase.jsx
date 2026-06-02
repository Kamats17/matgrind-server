import React from 'react';
import { ACHIEVEMENTS, BETA_TESTER_MEDAL_META, betaTesterMedalTier, getBetaTesterMedals, isFoundersClubMember } from '../../lib/profileUtils';

// ─── RARITY TIERS ────────────────────────────────────────────────────────────

const RARITY = {
  bronze: {
    ids: ['first_win', 'first_pin', 'first_tf', 'takedown_5'],
    border: 'border-amber-800/50',
    label: 'Common',
    labelColor: 'text-amber-700',
    glow: 'shadow-amber-900/20',
  },
  silver: {
    ids: ['shutout', 'comeback', 'perfect_period', 'ride_time_3', 'streak_5', 'beat_elijah'],
    border: 'border-zinc-400/50',
    label: 'Hard',
    labelColor: 'text-zinc-400',
    glow: 'shadow-zinc-500/20',
  },
  gold: {
    ids: ['win_50', 'win_100', 'pin_10', 'level_25', 'level_50', 'level_100', 'beat_elijah_legend'],
    border: 'border-yellow-400/50',
    label: 'Legendary',
    labelColor: 'text-yellow-400',
    glow: 'shadow-yellow-500/20',
  },
};

function getRarity(id) {
  for (const [tier, cfg] of Object.entries(RARITY)) {
    if (cfg.ids.includes(id)) return { tier, ...cfg };
  }
  // Default fallback for any achievement not explicitly categorized
  return { tier: 'bronze', ...RARITY.bronze };
}

// ─── TROPHY CARD ─────────────────────────────────────────────────────────────

function TrophyCard({ achievement, unlocked }) {
  const rarity = getRarity(achievement.id);

  return (
    <div
      className={`rounded-xl border p-3 transition-all ${
        unlocked
          ? `bg-zinc-800 ${rarity.border} ${rarity.glow} shadow-md`
          : 'bg-zinc-950 border-zinc-800'
      }`}
    >
      {/* Rarity label */}
      {unlocked && (
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${rarity.labelColor}`}>
          {rarity.label}
        </div>
      )}

      {/* Icon */}
      <div className={`text-2xl mb-1 ${unlocked ? '' : 'grayscale opacity-40'}`}>
        {unlocked ? achievement.icon : '🔒'}
      </div>

      {/* Name */}
      <div className={`text-xs font-bold leading-tight ${
        unlocked ? 'text-white' : 'text-zinc-600'
      }`}>
        {achievement.name}
      </div>

      {/* Description */}
      <div className={`text-xs mt-0.5 leading-tight ${
        unlocked ? 'text-zinc-400' : 'text-zinc-700'
      }`}>
        {achievement.desc}
      </div>
    </div>
  );
}

// ─── BETA TESTER MEDAL ───────────────────────────────────────────────────────
//
// One-time permanent award for players who placed in the top 8 of wins /
// top 8 of pins / top 1 of reflex speed on the pre-v1.0 leaderboard (see
// scripts/launch-reset-leaderboards.mjs). Visually distinct from regular
// trophies - holographic ring, medal-style icon, "BETA TESTER" label so
// no one confuses these with normal achievements.

const TIER_STYLE = {
  gold:   { ring: 'ring-yellow-400/70 shadow-[0_0_18px_rgba(250,204,21,0.45)]', label: 'text-yellow-300', medal: '🥇' },
  silver: { ring: 'ring-zinc-300/70  shadow-[0_0_14px_rgba(228,228,231,0.35)]', label: 'text-zinc-200',   medal: '🥈' },
  bronze: { ring: 'ring-amber-600/60 shadow-[0_0_12px_rgba(217,119,6,0.35)]',   label: 'text-amber-400',  medal: '🥉' },
};

function BetaTesterMedalCard({ medal }) {
  const meta = BETA_TESTER_MEDAL_META[medal.category];
  if (!meta) return null;
  const tier = betaTesterMedalTier(medal.rank);
  const style = TIER_STYLE[tier];
  const valueSuffix = medal.category === 'reaction_single' ? ' ms' : '';
  return (
    <div
      className={`relative rounded-xl bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-950 ring-2 ${style.ring} p-3`}
      title={`Beta Tester - ${meta.label} #${medal.rank}`}
    >
      <div className={`text-[9px] font-black uppercase tracking-[0.12em] ${style.label}`}>
        Beta Tester
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="text-2xl leading-none">{style.medal}</div>
        <div className="min-w-0">
          <div className="text-white text-xs font-black leading-tight">
            {meta.icon} {meta.label} <span className="text-zinc-500">#{medal.rank}</span>
          </div>
          <div className="text-zinc-500 text-[10px] mt-0.5 tabular-nums">
            {medal.value}{valueSuffix}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FOUNDERS CLUB CARD ──────────────────────────────────────────────────────
//
// Derived from profile.created_date - no stored field. Sits alongside beta
// tester medals in the "pinned" top section since it's the same family of
// permanent, un-regrindable awards.

function FoundersClubCard() {
  return (
    <div
      className="relative rounded-xl bg-gradient-to-br from-indigo-950 via-zinc-900 to-zinc-950 ring-2 ring-indigo-400/60 shadow-[0_0_14px_rgba(99,102,241,0.35)] p-3"
      title="Founders Club - joined before launch window closed"
    >
      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-indigo-300">
        Founders Club
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="text-2xl leading-none">🎖️</div>
        <div className="min-w-0">
          <div className="text-white text-xs font-black leading-tight">
            Day-One
          </div>
          <div className="text-zinc-500 text-[10px] mt-0.5">
            pre-v1.1 member
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── TROPHY CASE ─────────────────────────────────────────────────────────────

export default function TrophyCase({ earnedIds = [], profile }) {
  const total = ACHIEVEMENTS.length;
  const earned = earnedIds.length;
  const pct = Math.round((earned / total) * 100);
  const betaMedals = getBetaTesterMedals(profile);
  const isFounder = isFoundersClubMember(profile);
  const hasPinnedAwards = betaMedals.length > 0 || isFounder;

  return (
    <>
      {/* Pinned top section: one-time, un-regrindable awards */}
      {hasPinnedAwards && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-black uppercase tracking-[0.15em] text-yellow-400">
              Legacy
            </div>
            <div className="text-[10px] text-zinc-600">one-time awards</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {isFounder && <FoundersClubCard />}
            {betaMedals
              .slice()
              .sort((a, b) => a.rank - b.rank)
              .map((m, i) => (
                <BetaTesterMedalCard key={`${m.category}-${m.rank}-${i}`} medal={m} />
              ))}
          </div>
          <div className="h-px bg-zinc-800/60 my-4" />
        </div>
      )}

      {/* Progress summary */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-white">
            {earned} / {total} Unlocked
          </span>
          <span className="text-xs text-zinc-500">{pct}%</span>
        </div>
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-600 to-yellow-400 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Trophy grid */}
      <div className="grid grid-cols-2 gap-2">
        {ACHIEVEMENTS.map(ach => (
          <TrophyCard
            key={ach.id}
            achievement={ach}
            unlocked={earnedIds.includes(ach.id)}
          />
        ))}
      </div>
    </>
  );
}
