// ── Daily Challenges System ──────────────────────────────────────────────────
// Provides 3 daily challenges: 1 Career, 1 Dual Meet, 1 Online. Seeded by
// the current date so every player gets the same set per day. Progress is
// stored in localStorage.
//
// Match context:
//   checkAllDailyChallenges(matchState, { gameMode, dualEvent })
// where gameMode ∈ {'career','dual_cpu','dual_hotseat','network','vs_ai',...}
// and dualEvent ∈ {'bout','complete'} when reporting dual-related events.

// ─── Category: Career ────────────────────────────────────────────────────────
// Fire only when the match was played inside career mode (gameMode === 'career').
const CAREER_CHALLENGES = [
  {
    id: 'career_win_event',
    label: 'Win a Career event',
    icon: '🏅',
    xpReward: 50,
    check: (s, ctx) => ctx.gameMode === 'career' && s.winner === 'p1',
  },
  {
    id: 'career_pin_event',
    label: 'Pin an opponent in Career',
    icon: '📌',
    xpReward: 65,
    check: (s, ctx) => ctx.gameMode === 'career' && s.winner === 'p1' && s.winMethod === 'pin',
  },
  {
    id: 'career_major_plus',
    label: 'Win a Career match by 8+ points',
    icon: '🔥',
    xpReward: 55,
    check: (s, ctx) => ctx.gameMode === 'career' && s.winner === 'p1'
      && ((s.p1?.score || 0) - (s.p2?.score || 0)) >= 8,
  },
  {
    id: 'career_shutout',
    label: 'Shut out an opponent in Career',
    icon: '🚫',
    xpReward: 60,
    check: (s, ctx) => ctx.gameMode === 'career' && s.winner === 'p1' && (s.p2?.score || 0) === 0,
  },
  {
    id: 'career_3_takedowns',
    label: 'Score 3+ takedowns in a Career match',
    icon: '🤼',
    xpReward: 45,
    check: (s, ctx) => ctx.gameMode === 'career' && (s.p1?.takedownCount || 0) >= 3,
  },
  {
    id: 'career_tech_fall',
    label: 'Tech fall in Career',
    icon: '⚡',
    xpReward: 75,
    check: (s, ctx) => ctx.gameMode === 'career' && s.winner === 'p1' && s.winMethod === 'tech_fall',
  },
  {
    id: 'career_reversal',
    label: 'Score a reversal in Career',
    icon: '🔁',
    xpReward: 40,
    check: (s, ctx) => ctx.gameMode === 'career' && (s.p1?.reversalCount || 0) >= 1,
  },
  {
    id: 'career_finish_full',
    label: 'Finish a Career match to the whistle',
    icon: '🏁',
    xpReward: 30,
    check: (s, ctx) => ctx.gameMode === 'career',
  },
];

// ─── Category: Dual Meet ─────────────────────────────────────────────────────
// Most challenges fire per bout (dualEvent === 'bout'). Dual-meet-wide ones
// fire on completion (dualEvent === 'complete') with dualResult in context.
const DUAL_CHALLENGES = [
  {
    id: 'dual_win_bout',
    label: 'Win a Dual Meet bout',
    icon: '🤼',
    xpReward: 40,
    check: (s, ctx) => ctx.dualEvent === 'bout' && s.winner === 'p1',
  },
  {
    id: 'dual_pin_bout',
    label: 'Pin an opponent in a Dual bout',
    icon: '📌',
    xpReward: 60,
    check: (s, ctx) => ctx.dualEvent === 'bout' && s.winner === 'p1' && s.winMethod === 'pin',
  },
  {
    id: 'dual_major_bout',
    label: 'Win a Dual bout by 8+ (major / TF)',
    icon: '🔥',
    xpReward: 55,
    check: (s, ctx) => ctx.dualEvent === 'bout' && s.winner === 'p1'
      && ((s.p1?.score || 0) - (s.p2?.score || 0)) >= 8,
  },
  {
    id: 'dual_2_bouts',
    label: 'Win 2+ bouts in a Dual Meet',
    icon: '🧮',
    xpReward: 50,
    check: (s, ctx) => ctx.dualEvent === 'complete' && (ctx.dualResult?.playerBoutWins || 0) >= 2,
  },
  {
    id: 'dual_win_meet',
    label: 'Win a Dual Meet',
    icon: '🏆',
    xpReward: 100,
    check: (s, ctx) => ctx.dualEvent === 'complete' && ctx.dualResult?.winner === 'player',
  },
  {
    id: 'dual_hero_wins',
    label: 'Win your hero bout in a Dual',
    icon: '🥇',
    xpReward: 45,
    check: (s, ctx) => ctx.dualEvent === 'bout' && ctx.isHeroBout && s.winner === 'p1',
  },
  {
    id: 'dual_complete',
    label: 'Finish a full Dual Meet card',
    icon: '📋',
    xpReward: 35,
    check: (s, ctx) => ctx.dualEvent === 'complete',
  },
  {
    id: 'dual_bonus_points',
    label: 'Earn 4+ team points in one bout',
    icon: '💯',
    xpReward: 50,
    check: (s, ctx) => ctx.dualEvent === 'bout' && (ctx.dualBoutTeamPoints?.player || 0) >= 4,
  },
];

// ─── Category: Online ────────────────────────────────────────────────────────
// Fire on gameMode === 'network' matches (LAN or online). Spectator matches
// are excluded because the player has no control.
const ONLINE_CHALLENGES = [
  {
    id: 'online_win',
    label: 'Win an Online match',
    icon: '🌐',
    xpReward: 55,
    check: (s, ctx) => ctx.gameMode === 'network' && !ctx.spectator && s.winner === 'p1',
  },
  {
    id: 'online_pin',
    label: 'Pin an opponent Online',
    icon: '📌',
    xpReward: 75,
    check: (s, ctx) => ctx.gameMode === 'network' && !ctx.spectator
      && s.winner === 'p1' && s.winMethod === 'pin',
  },
  {
    id: 'online_takedown',
    label: 'Score a takedown Online',
    icon: '🤼',
    xpReward: 30,
    check: (s, ctx) => ctx.gameMode === 'network' && !ctx.spectator && (s.p1?.takedownCount || 0) >= 1,
  },
  {
    id: 'online_finish_full',
    label: 'Finish an Online match',
    icon: '🏁',
    xpReward: 35,
    check: (s, ctx) => ctx.gameMode === 'network' && !ctx.spectator,
  },
  {
    id: 'online_tech_fall',
    label: 'Tech fall an opponent Online',
    icon: '⚡',
    xpReward: 90,
    check: (s, ctx) => ctx.gameMode === 'network' && !ctx.spectator
      && s.winner === 'p1' && s.winMethod === 'tech_fall',
  },
  {
    id: 'online_shutout',
    label: 'Shut out an opponent Online',
    icon: '🚫',
    xpReward: 70,
    check: (s, ctx) => ctx.gameMode === 'network' && !ctx.spectator
      && s.winner === 'p1' && (s.p2?.score || 0) === 0,
  },
  {
    id: 'online_near_fall',
    label: 'Get a near-fall Online',
    icon: '🎯',
    xpReward: 40,
    check: (s, ctx) => ctx.gameMode === 'network' && !ctx.spectator && (s.p1?.nearFallCount || 0) >= 1,
  },
  {
    id: 'online_comeback',
    label: 'Win Online after trailing',
    icon: '🔄',
    xpReward: 60,
    check: (s, ctx) => ctx.gameMode === 'network' && !ctx.spectator
      && s.winner === 'p1' && (s.p2?.score || 0) > 0,
  },
];

const ALL_CHALLENGES = [...CAREER_CHALLENGES, ...DUAL_CHALLENGES, ...ONLINE_CHALLENGES];

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function storageKey(dateStr) {
  return `matgrind_daily_${dateStr}`;
}

// Simple seeded pseudo-random using date string
function seededIndex(seed, max, offset) {
  // Spread seed bits to avoid clustering on sequential dates
  const n = ((seed * 2654435761) >>> 0) + offset * 7919;
  return ((n ^ (n >>> 16)) >>> 0) % max;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns 3 challenges for the given date: 1 Career, 1 Dual, 1 Online.
 * Uses date-based seeding so every player gets the same challenges per day.
 */
export function getDailyChallenges(dateString) {
  const dateStr = dateString || getTodayString();
  const seed = parseInt(dateStr.split('-').join(''), 10);

  const careerIdx = seededIndex(seed, CAREER_CHALLENGES.length, 0);
  const dualIdx = seededIndex(seed, DUAL_CHALLENGES.length, 1);
  const onlineIdx = seededIndex(seed, ONLINE_CHALLENGES.length, 2);

  return [
    { ...CAREER_CHALLENGES[careerIdx], category: 'career' },
    { ...DUAL_CHALLENGES[dualIdx], category: 'dual' },
    { ...ONLINE_CHALLENGES[onlineIdx], category: 'online' },
  ];
}

/**
 * Returns today's progress from localStorage.
 */
export function getDailyProgress(dateString) {
  const dateStr = dateString || getTodayString();
  try {
    const raw = localStorage.getItem(storageKey(dateStr));
    if (raw) {
      const data = JSON.parse(raw);
      return { completed: data.completed || [], date: dateStr };
    }
  } catch (_e) { /* ignore */ }
  return { completed: [], date: dateStr };
}

/**
 * Marks a challenge as completed in localStorage.
 */
export function markChallengeComplete(challengeId, dateString) {
  const dateStr = dateString || getTodayString();
  const progress = getDailyProgress(dateStr);
  if (!progress.completed.includes(challengeId)) {
    progress.completed.push(challengeId);
    try {
      localStorage.setItem(storageKey(dateStr), JSON.stringify(progress));
    } catch (_e) { /* ignore - storage full */ }
  }
}

/**
 * Checks whether a single challenge is satisfied by the match state.
 */
export function checkChallengeCompletion(challengeId, matchState, context = {}) {
  const challenge = ALL_CHALLENGES.find(c => c.id === challengeId);
  if (!challenge) return false;
  try {
    return challenge.check(matchState, context);
  } catch (_e) {
    return false;
  }
}

/**
 * Checks all of today's uncompleted challenges against the match state +
 * mode context. Returns an array of newly-completed challenge objects.
 *
 * Second arg accepts either a legacy dateString OR a context object:
 *   checkAllDailyChallenges(state)                             // legacy
 *   checkAllDailyChallenges(state, '2026-04-24')               // legacy
 *   checkAllDailyChallenges(state, { gameMode, dualEvent, ... })
 *   checkAllDailyChallenges(state, { gameMode, ... }, dateStr)
 */
export function checkAllDailyChallenges(matchState, contextOrDate, dateString) {
  let context = {};
  let dateStr;
  if (typeof contextOrDate === 'string') {
    dateStr = contextOrDate;
  } else if (contextOrDate && typeof contextOrDate === 'object') {
    context = contextOrDate;
    dateStr = dateString;
  }
  if (!dateStr) dateStr = getTodayString();

  const challenges = getDailyChallenges(dateStr);
  const progress = getDailyProgress(dateStr);
  const newlyCompleted = [];

  for (const challenge of challenges) {
    if (progress.completed.includes(challenge.id)) continue;
    try {
      if (challenge.check(matchState, context)) {
        markChallengeComplete(challenge.id, dateStr);
        newlyCompleted.push(challenge);
      }
    } catch (_e) { /* ignore check errors */ }
  }

  return newlyCompleted;
}
