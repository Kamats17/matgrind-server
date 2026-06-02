// Profile XP, leveling, goals, and achievements

// Win methods that do NOT count as a legitimate defeat for award gating.
// Covers both the long-form token used by the engine and the short 'dq'
// alias surfaced elsewhere in the codebase (e.g. careerWeights.js). Use
// this set anywhere we need to reject forfeit / DQ "wins."
export const DQ_LIKE_WIN_METHODS = new Set(['forfeit', 'dq', 'disqualification']);

// ─── XP & LEVELING ───────────────────────────────────────────────────────────

// XP required to complete each level - gets harder as you progress
export function getXPForLevel(level) {
  if (level <= 5)  return 150;   // Rookie: fast early progression
  if (level <= 10) return 250;   // Contender: building consistency
  if (level <= 20) return 400;   // Varsity: competitive grind
  if (level <= 30) return 600;   // All-State: sustained excellence
  if (level <= 50) return 1000;  // All-American: serious commitment
  if (level <= 75) return 1500;  // World Team: elite grind
  return 2000;                   // World Champion / GOAT: marathon
}

export function getLevelFromXP(totalXP) {
  let level = 1;
  let remaining = totalXP;
  while (remaining >= getXPForLevel(level)) {
    remaining -= getXPForLevel(level);
    level++;
  }
  return level;
}

export function getXPProgress(totalXP) {
  let level = 1;
  let remaining = totalXP;
  while (remaining >= getXPForLevel(level)) {
    remaining -= getXPForLevel(level);
    level++;
  }
  return remaining; // XP within the current level
}

export function getXPToNextLevel(totalXP) {
  const level = getLevelFromXP(totalXP);
  return getXPForLevel(level);
}

export const LEVEL_TITLES = [
  { level: 1,   title: 'Rookie' },
  { level: 6,   title: 'Contender' },
  { level: 11,  title: 'Varsity' },
  { level: 21,  title: 'All-State' },
  { level: 31,  title: 'Division I' },
  { level: 41,  title: 'All-American' },
  { level: 51,  title: 'National Collegiate Champion' },
  { level: 61,  title: 'World Team' },
  { level: 76,  title: 'World Medalist' },
  { level: 91,  title: 'World Champion' },
  { level: 100, title: 'GOAT' },
  // Prestige tiers past 100 (added 2026-05-06). More tiers may slot in later.
  { level: 150, title: 'Hall of Fame' },
  { level: 250, title: 'Living Legend' },
];

export function getTitleForLevel(level) {
  let title = 'Rookie';
  for (const t of LEVEL_TITLES) {
    if (level >= t.level) title = t.title;
  }
  return title;
}

// ─── PER-STAT CAP ────────────────────────────────────────────────────────────
// The per-stat cap is what a single profile stat (str/spd/tec/end/grt) can be
// raised to via the Profile spend UI. It used to be a hardcoded 85, which made
// every level past the point the player maxed all five stats wasted (each new
// level still grants a stat point but there is nowhere legal to spend it).
//
// 2026-05-06 change: cap rises with profile level once the player passes the
// threshold. Rate is intentionally slower than 1:1 with stat-point grants -
// every 10 levels past 100 raises the per-stat cap by 1, so 5 stats x 1 raise
// per 10 levels = 5 spend slots per 10 levels vs. 10 stat points earned per
// 10 levels. Excess points accumulate until the next cap raise opens new
// slots, which extends meaningful progression. Cap saturates at the engine
// ceiling (99) at level 240; further levels are vanity / titles only.

export const BASE_STAT_CAP = 85;
export const ABS_STAT_CEILING = 99; // engine ceiling - never breach
export const STAT_CAP_LEVEL_THRESHOLD = 100;
export const STAT_CAP_LEVELS_PER_POINT = 10;

/**
 * Per-stat cap as a function of profile level.
 *   level <= 100  -> 85
 *   level == 110  -> 86
 *   level == 240  -> 99 (hard ceiling)
 *   level >= 240  -> 99 (clamped)
 *
 * Defensive against bad input: returns BASE_STAT_CAP for null / NaN / <= 0.
 */
export function getStatCap(level) {
  const lvl = Number(level);
  if (!Number.isFinite(lvl) || lvl < 1) return BASE_STAT_CAP;
  if (lvl <= STAT_CAP_LEVEL_THRESHOLD) return BASE_STAT_CAP;
  const extra = Math.floor((lvl - STAT_CAP_LEVEL_THRESHOLD) / STAT_CAP_LEVELS_PER_POINT);
  return Math.min(ABS_STAT_CEILING, BASE_STAT_CAP + extra);
}

// ─── XP REWARDS ──────────────────────────────────────────────────────────────

// Difficulty XP multiplier: Easy 0.75x, Medium 1x, Hard 1.25x
const DIFFICULTY_XP_MULT = { easy: 0.75, medium: 1, hard: 1.25 };

// ─── First-win-of-day bonus ──────────────────────────────────────────────────
// Strong D1 retention lever: the first win of the calendar day (vs_ai /
// tournament only) awards a flat XP bonus on top of the normal rewards.
// Stored as a localStorage YYYY-MM-DD stamp. Only vs_ai and tournament modes
// qualify (we detect those via a non-null aiDifficulty); network + local_2p
// are excluded to prevent two-device farming.
const FIRST_WIN_DATE_KEY = 'matgrind_first_win_date';
export const FIRST_WIN_OF_DAY_BONUS_XP = 75;

function _todayStamp() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Returns true ONCE per calendar day, only for AI-mode wins. Stamps localStorage
 * on success so subsequent calls the same day return false. Silently no-ops in
 * non-browser environments.
 *
 * Call this exactly once per match-end - before computeXP / computeXPBreakdown -
 * and write the returned value to matchResult.firstWinOfDay.
 */
export function consumeFirstWinOfDayIfEligible(matchResult) {
  if (!matchResult || matchResult.result !== 'win') return false;
  // Only AI-difficulty matches (vs_ai, tournament) qualify. Network + local_2p
  // both leave aiDifficulty null.
  if (!matchResult.aiDifficulty) return false;
  if (typeof localStorage === 'undefined') return false;
  try {
    const today = _todayStamp();
    const last = localStorage.getItem(FIRST_WIN_DATE_KEY);
    if (last === today) return false;
    localStorage.setItem(FIRST_WIN_DATE_KEY, today);
    return true;
  } catch {
    return false;
  }
}

/** Read-only check (no stamp). Useful for UI previews. */
export function hasEarnedFirstWinToday() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(FIRST_WIN_DATE_KEY) === _todayStamp();
  } catch {
    return false;
  }
}

// Badge-unlock XP: each newly-earned achievement awards a flat bonus,
// scaled by AI difficulty (same curve as match XP). Non-AI modes
// (online, tournament) use 1x.
const BADGE_BASE_XP = 50;
export function computeBadgeBonusXP(newBadgeCount, aiDifficulty) {
  if (!newBadgeCount) return 0;
  const mult = aiDifficulty ? (DIFFICULTY_XP_MULT[aiDifficulty] || 1) : 1;
  return Math.round(newBadgeCount * BADGE_BASE_XP * mult);
}

export function computeXP(matchResult) {
  const { result, winMethod, playerScore, opponentScore, wasTrailing, takedowns, aiDifficulty, firstWinOfDay } = matchResult;
  let xp = 50; // base participation XP

  if (result === 'win')  xp += 100;
  if (result === 'draw') xp += 30;

  // Win method bonus
  if (winMethod === 'pin')       xp += 60;
  if (winMethod === 'tech_fall') xp += 40;

  // Performance bonuses
  const scoreDiff = Math.abs(playerScore - opponentScore);
  if (scoreDiff <= 3 && result !== 'draw') xp += 25;  // close match
  if (result === 'win' && wasTrailing)     xp += 15;  // comeback
  if (result === 'win' && opponentScore === 0) xp += 30; // shutout
  if (takedowns >= 3)                      xp += 20;  // takedown specialist

  // First-win-of-day bonus - applied before the difficulty multiplier so
  // harder settings compound the reward.
  if (firstWinOfDay) xp += FIRST_WIN_OF_DAY_BONUS_XP;

  // Apply difficulty multiplier for AI matches
  const mult = aiDifficulty ? (DIFFICULTY_XP_MULT[aiDifficulty] || 1) : 1;
  return Math.round(xp * mult);
}

// Returns a breakdown of XP bonuses for the result modal display
export function computeXPBreakdown(matchResult) {
  const { result, winMethod, playerScore, opponentScore, wasTrailing, takedowns, aiDifficulty, firstWinOfDay } = matchResult;
  const items = [];

  items.push({ label: 'Participation', xp: 50 });
  if (result === 'win')  items.push({ label: 'Win', xp: 100 });
  if (result === 'draw') items.push({ label: 'Draw', xp: 30 });
  if (winMethod === 'pin')       items.push({ label: 'Pin bonus', xp: 60 });
  if (winMethod === 'tech_fall') items.push({ label: 'Tech fall bonus', xp: 40 });

  const scoreDiff = Math.abs(playerScore - opponentScore);
  if (scoreDiff <= 3 && result !== 'draw') items.push({ label: 'Close match', xp: 25 });
  if (result === 'win' && wasTrailing)     items.push({ label: 'Comeback!', xp: 15 });
  if (result === 'win' && opponentScore === 0) items.push({ label: 'Shutout!', xp: 30 });
  if (takedowns >= 3) items.push({ label: 'Takedown specialist', xp: 20 });

  // First win of the day - surfaced as its own row so the user sees the bonus.
  if (firstWinOfDay) items.push({ label: 'First win of the day! 🌅', xp: FIRST_WIN_OF_DAY_BONUS_XP });

  // Show difficulty multiplier in breakdown
  const mult = aiDifficulty ? (DIFFICULTY_XP_MULT[aiDifficulty] || 1) : 1;
  if (mult !== 1) {
    const baseTotal = items.reduce((sum, i) => sum + i.xp, 0);
    const diff = Math.round(baseTotal * mult) - baseTotal;
    const label = mult > 1 ? 'Hard difficulty bonus' : 'Easy difficulty';
    items.push({ label, xp: diff });
  }

  return items;
}

// ─── GOALS ───────────────────────────────────────────────────────────────────

export const DAILY_GOAL_POOL = [
  { id: 'win_1',       label: 'Win 1 match',              category: 'wins',      target: 1,  xpReward: 75  },
  { id: 'win_3',       label: 'Win 3 matches',            category: 'wins',      target: 3,  xpReward: 150 },
  { id: 'takedown_5',  label: 'Land 5 takedowns total',   category: 'takedowns', target: 5,  xpReward: 100 },
  { id: 'takedown_10', label: 'Land 10 takedowns total',  category: 'takedowns', target: 10, xpReward: 175 },
  { id: 'pin',         label: 'Win by pin',               category: 'pin_win',   target: 1,  xpReward: 125 },
  { id: 'tech_fall',   label: 'Win by tech fall',         category: 'tech_win',  target: 1,  xpReward: 100 },
  { id: 'score_10',    label: 'Score 10+ points in a match', category: 'high_score', target: 10, xpReward: 100 },
  { id: 'no_reversal', label: 'Win without giving up a reversal', category: 'no_reversal_win', target: 1, xpReward: 125 },
  { id: 'play_3',      label: 'Complete 3 matches',       category: 'played',    target: 3,  xpReward: 60  },
];

// Always-included 4th daily goal. Encourages online play with a meaningful
// XP reward. Not part of the random shuffle - appended verbatim each day.
export const ALWAYS_ONLINE_DAILY_GOAL = {
  id: 'online_3_daily', label: 'Play 3 online matches', category: 'online_played', target: 3, xpReward: 500,
};

export const WEEKLY_GOAL_POOL = [
  { id: 'w_win_10',    label: 'Win 10 matches this week', category: 'wins',      target: 10, xpReward: 500 },
  { id: 'w_pin_5',     label: 'Pin 5 opponents',          category: 'pin_win',   target: 5,  xpReward: 600 },
  { id: 'w_streak_5',  label: 'Win 5 in a row',           category: 'win_streak',target: 5,  xpReward: 750 },
  { id: 'w_takedown_30', label: '30 total takedowns',     category: 'takedowns', target: 30, xpReward: 500 },
  { id: 'w_all_methods', label: 'Win by pin AND decision AND tech fall', category: 'all_methods', target: 3, xpReward: 800 },
];

// Generate 4 daily goals (3 random + 1 always-on online goal). Seeded by
// today's date so everyone sees the same random three.
export function getDailyGoals() {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const expiresAt = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
  const shuffled = [...DAILY_GOAL_POOL].sort((a, b) => {
    // Deterministic shuffle based on date seed
    const hashA = ((seed ^ a.id.charCodeAt(0) * 17) % 100);
    const hashB = ((seed ^ b.id.charCodeAt(0) * 17) % 100);
    return hashA - hashB;
  });
  const random = shuffled.slice(0, 3).map(g => ({
    ...g, current: 0, completed: false, type: 'daily', expiresAt,
  }));
  const online = {
    ...ALWAYS_ONLINE_DAILY_GOAL, current: 0, completed: false, type: 'daily', expiresAt,
  };
  return [...random, online];
}

export function getWeeklyGoals() {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const seed = monday.getFullYear() * 10000 + (monday.getMonth() + 1) * 100 + monday.getDate();
  const shuffled = [...WEEKLY_GOAL_POOL].sort((a, b) => {
    const hashA = ((seed ^ a.id.charCodeAt(0) * 13) % 100);
    const hashB = ((seed ^ b.id.charCodeAt(0) * 13) % 100);
    return hashA - hashB;
  });
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return shuffled.slice(0, 2).map(g => ({
    ...g,
    current: 0,
    completed: false,
    type: 'weekly',
    expiresAt: nextMonday.toISOString(),
  }));
}

// Update goal progress after a match
export function updateGoalProgress(goals, matchResult) {
  const { result, winMethod, playerScore, opponentScore, takedowns, winStreak, winMethods } = matchResult;
  return goals.map(goal => {
    if (goal.completed) return goal;
    let increment = 0;
    // goal.category holds the semantic type ('wins', 'takedowns', etc.)
    // goal.type holds the group identifier ('daily' or 'weekly') for loadGoals filtering
    switch (goal.category) {
      case 'wins':          if (result === 'win') increment = 1; break;
      case 'played':        increment = 1; break;
      case 'online_played': if (matchResult.isOnline) increment = 1; break;
      case 'takedowns':     increment = takedowns || 0; break;
      case 'pin_win':       if (result === 'win' && winMethod === 'pin') increment = 1; break;
      case 'tech_win':      if (result === 'win' && winMethod === 'tech_fall') increment = 1; break;
      case 'high_score':    if (playerScore >= goal.target) increment = goal.target; break;
      case 'no_reversal_win': if (result === 'win' && (matchResult.opponentReversals || 0) === 0) increment = 1; break;
      case 'win_streak':    if (result === 'win') increment = 1; break;
      case 'all_methods':   increment = winMethods ? new Set(Object.values(winMethods)).size : 0; break;
      default: break;
    }
    const newCurrent = Math.min(goal.target, goal.current + increment);
    return { ...goal, current: newCurrent, completed: newCurrent >= goal.target };
  });
}

// Load goals from stored JSON, refreshing if expired
export function loadGoals(storedJson) {
  const now = new Date();
  let parsed = [];
  try { parsed = JSON.parse(storedJson || '[]'); } catch { parsed = []; }

  const daily = parsed.filter(g => g.type === 'daily' && new Date(g.expiresAt) > now);
  const weekly = parsed.filter(g => g.type === 'weekly' && new Date(g.expiresAt) > now);

  // Preserve today's progress when migrating users from the legacy 3-goal
  // shape to the new 4-goal shape: if they have the old 3 random goals
  // stored, append the always-on online goal instead of wiping their
  // progress. Anything else (0/1/2 goals, malformed) regenerates fresh.
  let freshDaily;
  if (daily.length === 4) {
    freshDaily = daily;
  } else if (daily.length === 3) {
    freshDaily = [
      ...daily,
      { ...ALWAYS_ONLINE_DAILY_GOAL, current: 0, completed: false, type: 'daily', expiresAt: daily[0].expiresAt },
    ];
  } else {
    freshDaily = getDailyGoals();
  }
  const freshWeekly = weekly.length === 2 ? weekly : getWeeklyGoals();

  return [...freshDaily, ...freshWeekly];
}

// ─── FEATURED DAILY GOAL ─────────────────────────────────────────────────────
//
// A single rotating objective surfaced prominently on the Main Menu and the
// Training Hub. Deliberately separate from `goals_json` (the 3-daily + 2-weekly
// system) so it can live in its own UI slot with its own visual treatment.
// Rewards are smaller (25-75 XP) because it's always visible and meant to
// feel like a light daily streak, not a grind target.

export const FEATURED_DAILY_GOAL_POOL = [
  { id: 'f_win_1',        label: 'Win any match today',         type: 'wins',          target: 1, xpReward: 40 },
  { id: 'f_takedown_3',   label: 'Land 3 takedowns today',      type: 'takedowns',     target: 3, xpReward: 35 },
  { id: 'f_play_2',       label: 'Complete 2 matches today',    type: 'played',        target: 2, xpReward: 25 },
  { id: 'f_score_8',      label: 'Score 8+ in a match today',   type: 'high_score',    target: 8, xpReward: 40 },
  { id: 'f_escape_2',     label: 'Escape twice today',          type: 'escapes',       target: 2, xpReward: 30 },
  { id: 'f_near_fall_1',  label: 'Score a near-fall today',     type: 'near_falls',    target: 1, xpReward: 50 },
  { id: 'f_pin',          label: 'Win by pin today',            type: 'pin_win',       target: 1, xpReward: 75 },
  { id: 'f_tech',         label: 'Win by tech fall today',      type: 'tech_win',      target: 1, xpReward: 60 },
  { id: 'f_shutout',      label: 'Win a shutout today',         type: 'shutout_win',   target: 1, xpReward: 65 },
  { id: 'f_takedown_5',   label: 'Land 5 takedowns today',      type: 'takedowns',     target: 5, xpReward: 55 },
];

// Today's ISO date string (local), used as both seed and expiry key.
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Deterministic pick from the pool for today. Everyone sees the same goal
// on a given day so it feels like a shared daily - cheap community signal.
export function getFeaturedDailyGoal() {
  const key = todayKey();
  // Hash the date string to an index. Simple djb2-ish hash.
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) & 0xffffffff;
  const idx = Math.abs(h) % FEATURED_DAILY_GOAL_POOL.length;
  const base = FEATURED_DAILY_GOAL_POOL[idx];
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    ...base,
    current: 0,
    completed: false,
    claimed: false,
    dateKey: key,
    expiresAt: tomorrow.toISOString(),
  };
}

// Load the featured goal from a profile object, refreshing if the stored
// goal is for a different day or missing entirely. Never returns null -
// callers can always render something.
export function loadFeaturedDailyGoal(profile) {
  const stored = profile?.daily_goal;
  const key = todayKey();
  if (stored && stored.dateKey === key && typeof stored.id === 'string') {
    // Still today's goal. Rehydrate from pool in case static fields changed.
    const base = FEATURED_DAILY_GOAL_POOL.find(g => g.id === stored.id);
    if (base) {
      return {
        ...base,
        current: Math.min(base.target, Math.max(0, stored.current | 0)),
        completed: !!stored.completed,
        claimed: !!stored.claimed,
        dateKey: stored.dateKey,
        expiresAt: stored.expiresAt,
      };
    }
  }
  return getFeaturedDailyGoal();
}

// Apply one match's progress to the single featured goal. Returns an
// updated goal (never null when `goal` is non-null). Supports a few match
// types not covered by the regular daily pool - escapes, near-falls,
// shutout wins - since the featured pool leans on them to stay varied.
export function updateFeaturedDailyGoalProgress(goal, matchResult) {
  if (!goal) return null;
  if (goal.completed) return goal;
  const {
    result, winMethod, playerScore, opponentScore,
    takedowns, escapes, nearFalls,
  } = matchResult || {};
  let increment = 0;
  switch (goal.type) {
    case 'wins':        if (result === 'win') increment = 1; break;
    case 'played':      increment = 1; break;
    case 'takedowns':   increment = takedowns || 0; break;
    case 'escapes':     increment = escapes || 0; break;
    case 'near_falls':  increment = nearFalls || 0; break;
    case 'pin_win':     if (result === 'win' && winMethod === 'pin') increment = 1; break;
    case 'tech_win':    if (result === 'win' && winMethod === 'tech_fall') increment = 1; break;
    case 'high_score':  if ((playerScore || 0) >= goal.target) increment = goal.target; break;
    case 'shutout_win': if (result === 'win' && (opponentScore || 0) === 0) increment = 1; break;
    default: break;
  }
  const current = Math.min(goal.target, (goal.current || 0) + increment);
  return { ...goal, current, completed: current >= goal.target };
}

// ─── BETA TESTER MEDALS ───────────────────────────────────────────────────────
//
// One-time awards for players who placed on the pre-launch leaderboard
// before the v1.0 reset (see scripts/launch-reset-leaderboards.mjs).
// Stored on profile docs as:
//
//   beta_tester_medals: [
//     { category: 'wins' | 'pins' | 'reaction_single',
//       rank: 1-8,
//       value: number (raw - reaction stored as positive ms here, not negated),
//       snapshot_at: ISO string },
//     ...
//   ]
//
// Kept as a distinct concept from ACHIEVEMENTS because they're permanent,
// non-grindable, and earned against the pre-v1.0 leaderboard state - not a
// generic "do X" unlock. Rendered in TrophyCase as a pinned top section.

export const BETA_TESTER_MEDAL_META = {
  wins:            { label: 'Wins',   icon: '🏆', tint: 'emerald' },
  pins:            { label: 'Pins',   icon: '📌', tint: 'red'     },
  reaction_single: { label: 'Reflex', icon: '⚡', tint: 'yellow'  },
};

// Visual tier for a given rank - scoped to these beta tester medals only.
// #1 = gold, #2-3 = silver, #4-8 = bronze.
export function betaTesterMedalTier(rank) {
  if (rank === 1) return 'gold';
  if (rank <= 3)  return 'silver';
  return 'bronze';
}

// Safe read for `beta_tester_medals` - profile field may be missing, null,
// or malformed. Falls back to the legacy `launch_medals` field name so a
// profile fetched between the migration landing and running doesn't
// silently lose its medal display.
export function getBetaTesterMedals(profile) {
  const raw = profile?.beta_tester_medals ?? profile?.launch_medals;
  if (!Array.isArray(raw)) return [];
  return raw.filter(m => m && typeof m.category === 'string' && typeof m.rank === 'number');
}

// ─── FOUNDERS CLUB ────────────────────────────────────────────────────────────
//
// One-time, permanent recognition for players whose account existed before
// the cutoff below. Derived from `profile.created_date` (Firestore
// Timestamp) or `profile.created_at` (guest ISO string) - no stored field,
// no seeding step. The cutoff is fixed at v1.1.0 and will not move in
// future releases, so once a player is in they stay in, and no one who
// signs up after the window can earn it.

export const FOUNDERS_CLUB_CUTOFF_ISO = '2026-04-23T00:00:00Z';

export function isFoundersClubMember(profile) {
  if (!profile) return false;
  const raw = profile.created_date ?? profile.created_at;
  if (!raw) return false;
  let ts;
  if (typeof raw === 'string') {
    ts = Date.parse(raw);
  } else if (typeof raw?.toDate === 'function') {
    ts = raw.toDate().getTime();
  } else if (typeof raw?.seconds === 'number') {
    ts = raw.seconds * 1000;
  } else if (raw instanceof Date) {
    ts = raw.getTime();
  } else {
    return false;
  }
  if (!Number.isFinite(ts)) return false;
  return ts < Date.parse(FOUNDERS_CLUB_CUTOFF_ISO);
}

// ─── ACHIEVEMENTS ─────────────────────────────────────────────────────────────

export const ACHIEVEMENTS = [
  // First-time unlocks
  { id: 'first_win',      name: 'First Blood',       icon: '🩸', desc: 'Win your first match' },
  { id: 'first_pin',      name: 'Executioner',       icon: '📌', desc: 'Win by pin' },
  { id: 'first_tf',       name: 'Dominant',          icon: '⚡', desc: 'Win by tech fall' },
  // Performance
  { id: 'takedown_5',     name: 'Shotmaker',         icon: '🎯', desc: 'Land 5 takedowns in one match' },
  { id: 'shutout',        name: 'Lockdown',          icon: '🔒', desc: 'Win without opponent scoring' },
  { id: 'comeback',       name: 'Never Say Die',     icon: '💪', desc: 'Win after being down 6+ points' },
  { id: 'perfect_period', name: 'Flawless Period',   icon: '✨', desc: 'Score 8+ points in a single period' },
  // Milestones
  { id: 'win_10',         name: 'Consistent',        icon: '📈', desc: 'Win 10 total matches' },
  { id: 'win_50',         name: 'Veteran',           icon: '🏆', desc: 'Win 50 total matches' },
  { id: 'win_100',        name: 'Legend',            icon: '👑', desc: 'Win 100 total matches' },
  { id: 'pin_10',         name: 'Pin Artist',        icon: '🎨', desc: 'Land 10 career pins' },
  // Level milestones
  { id: 'level_5',        name: 'Varsity',           icon: '🎖️',  desc: 'Reach Level 5' },
  { id: 'level_10',       name: 'Experienced',       icon: '🥈', desc: 'Reach Level 10' },
  { id: 'level_25',       name: 'Elite',             icon: '🥇', desc: 'Reach Level 25' },
  { id: 'level_50',       name: 'All-American',      icon: '🏅', desc: 'Reach Level 50' },
  { id: 'level_100',      name: 'GOAT',              icon: '🐐', desc: 'Reach Level 100' },
  // Style
  { id: 'ride_time_3',    name: 'Ride Time King',    icon: '⏱️',  desc: 'Earn 3 riding time bonuses in one match' },
  { id: 'streak_5',       name: 'Hot Streak',        icon: '🔥', desc: 'Win 5 matches in a row' },
  // Online / competition (Build 8)
  { id: 'practice_3_friends',  name: 'Training Partner',    icon: '🤝', desc: 'Practice with 3 different teammates online' },
  { id: 'tournament_3',        name: 'Bracket Regular',     icon: '🎟️', desc: 'Enter 3 tournaments' },
  { id: 'tournament_champion', name: 'Tournament Champion', icon: '👑', desc: 'Win a full tournament bracket' },
  { id: 'online_wins_5',       name: 'Road Warrior',        icon: '🌐', desc: 'Win 5 online matches' },
  // Featured-wrestler partnership (Elijah Joles, 2026)
  { id: 'beat_elijah',        name: 'Wrestled Through', icon: '🛡️', desc: 'Defeat Elijah Joles' },
  { id: 'beat_elijah_legend', name: 'EJ Slayer',        icon: '👑', desc: 'Beat Elijah at max boss tier' },
];

// Check which new achievements were earned by this match
//
// matchResult carries the per-match data. Build 8 added optional fields:
//   - isOnline (boolean): true when the match was played on the online WebSocket server
//   - tournamentEntered (boolean): true when this match was the first round of a new tournament run
//   - tournamentWon (boolean): true when this match won the tournament final
//   - practiceOpponentUid (string, optional): UID of the online friend in practice mode
//
// profile may carry matching counters (all optional; default 0):
//   - online_wins (number)
//   - tournaments_entered (number)
//   - tournaments_won (number)
//   - practice_friends (array of UIDs already trained with)
export function checkAchievements(existingIds, matchResult, profile) {
  const {
    result, winMethod, playerScore, opponentScore, wasTrailing, takedowns, rideTimeBonuses,
    isOnline, tournamentEntered, tournamentWon, practiceOpponentUid,
    maxPeriodPoints,
  } = matchResult;
  const wins = (profile?.wins || 0) + (result === 'win' ? 1 : 0);
  const pins = (profile?.pins || 0) + (result === 'win' && winMethod === 'pin' ? 1 : 0);
  const xp = (profile?.xp || 0);
  const level = getLevelFromXP(xp + computeXP(matchResult));
  const streak = matchResult.winStreak || 0;

  // Build 8 derived counters. Treat matchResult as a delta - the match being
  // scored hasn't persisted yet, so we preview the post-save totals.
  const onlineWinsAfter = (profile?.online_wins || 0) + (isOnline && result === 'win' ? 1 : 0);
  const tournamentsEnteredAfter = (profile?.tournaments_entered || 0) + (tournamentEntered ? 1 : 0);
  const practiceFriendsAfter = (() => {
    const existing = Array.isArray(profile?.practice_friends) ? profile.practice_friends : [];
    if (!practiceOpponentUid || existing.includes(practiceOpponentUid)) return existing.length;
    return existing.length + 1;
  })();

  const earned = [];
  const has = (id) => existingIds.includes(id) || earned.includes(id);

  if (!has('first_win')      && result === 'win')                                        earned.push('first_win');
  if (!has('first_pin')      && result === 'win' && winMethod === 'pin')                 earned.push('first_pin');
  if (!has('first_tf')       && result === 'win' && winMethod === 'tech_fall')           earned.push('first_tf');
  if (!has('takedown_5')     && (takedowns || 0) >= 5)                                  earned.push('takedown_5');
  if (!has('shutout')        && result === 'win' && opponentScore === 0)                 earned.push('shutout');
  // Comeback: won after being down 6+ at any point. The previous formula
  // (opponentScore - playerScore + opponentScore) >= 6 was nonsensical -
  // final scores can't reveal the max deficit during the match. Now uses
  // matchResult.maxDeficit, tracked live during play.
  if (!has('comeback') && wasTrailing && result === 'win' && (matchResult.maxDeficit || 0) >= 6) earned.push('comeback');
  if (!has('win_10')         && wins >= 10)                                              earned.push('win_10');
  if (!has('win_50')         && wins >= 50)                                              earned.push('win_50');
  if (!has('win_100')        && wins >= 100)                                             earned.push('win_100');
  if (!has('pin_10')         && pins >= 10)                                              earned.push('pin_10');
  if (!has('level_5')        && level >= 5)                                              earned.push('level_5');
  if (!has('level_10')       && level >= 10)                                             earned.push('level_10');
  if (!has('level_25')       && level >= 25)                                             earned.push('level_25');
  if (!has('level_50')       && level >= 50)                                             earned.push('level_50');
  if (!has('level_100')      && level >= 100)                                            earned.push('level_100');
  if (!has('ride_time_3')    && (rideTimeBonuses || 0) >= 3)                            earned.push('ride_time_3');
  if (!has('perfect_period') && (maxPeriodPoints || 0) >= 8)                            earned.push('perfect_period');
  if (!has('streak_5')       && streak >= 5)                                             earned.push('streak_5');
  // Build 8 additions
  if (!has('online_wins_5')       && onlineWinsAfter >= 5)         earned.push('online_wins_5');
  if (!has('tournament_3')        && tournamentsEnteredAfter >= 3) earned.push('tournament_3');
  if (!has('tournament_champion') && tournamentWon)                earned.push('tournament_champion');
  if (!has('practice_3_friends')  && practiceFriendsAfter >= 3)    earned.push('practice_3_friends');

  // ── Featured-partnership: Elijah Joles ──────────────────────────────────
  // Reads matchResult.opponentNpcId (stable NPC identity threaded through
  // match state via state[opponentSide].npcId; survives the createWrestler
  // p1/p2 side-id overwrite). Forfeit / disqualification "wins" don't count.
  const elijahOk = !DQ_LIKE_WIN_METHODS.has(matchResult.winMethod);
  if (!has('beat_elijah') && result === 'win'
      && matchResult.opponentNpcId === 'special_elijah_joles' && elijahOk) {
    earned.push('beat_elijah');
  }
  if (!has('beat_elijah_legend') && result === 'win'
      && matchResult.opponentNpcId === 'special_elijah_joles'
      && (matchResult.elijahBossWinsAfter || 0) >= 4 && elijahOk) {
    earned.push('beat_elijah_legend');
  }

  return earned; // array of newly earned achievement IDs
}

// ─── Personal Bests ─────────────────────────────────────────────────────
//
// Track the player's single-match records. Fresh PBs are surfaced as
// chips on the match-end modal ("NEW PERSONAL BEST!") - they create a
// new celebration event almost every session, especially early in a
// player's career when prior records are often null and the first match
// establishes the baseline.
//
// Tracked keys (all optional on profile.personal_bests; missing = no
// prior record, which we deliberately DO NOT treat as a broken PB):
//   - most_takedowns    : highest takedowns in a single match
//   - biggest_margin    : largest winning score margin
//   - highest_match_xp  : most XP earned in a single match (total after bonuses)
//
// The streak PB (streak_best) already lives on the profile and is
// already surfaced via WinStreakBanner's "NEW BEST!" chip - we don't
// re-record it here to avoid two sources of truth.
//
// Guardrails:
//   - Only records from the human player's perspective (caller decides
//     whether the player is identifiable - we skip local 2p upstream).
//   - `previous` null → NOT a broken PB. The first match establishes the
//     baseline silently; the SECOND match that beats it is the first PB
//     surfaced to the user. This avoids the cheesy "NEW BEST!" on the
//     very first match the player ever plays.

const PB_DEFINITIONS = [
  {
    key: 'most_takedowns',
    label: 'Most Takedowns',
    icon: '🤼',
    higherIsBetter: true,
    extract: (m) => Number.isFinite(m?.takedowns) ? m.takedowns : 0,
  },
  {
    key: 'biggest_margin',
    label: 'Biggest Win Margin',
    icon: '🏆',
    higherIsBetter: true,
    // Only count on actual wins - otherwise a 0-pt loss would count as margin 0.
    extract: (m) => {
      if (m?.result !== 'win') return 0;
      const margin = (m.playerScore | 0) - (m.opponentScore | 0);
      return margin > 0 ? margin : 0;
    },
  },
  {
    key: 'highest_match_xp',
    label: 'Most XP in a Match',
    icon: '⭐',
    higherIsBetter: true,
    extract: (_m, ctx) => (Number.isFinite(ctx?.totalXP) ? ctx.totalXP : 0),
  },
];

/**
 * Check which personal bests were broken this match.
 *
 * @param {object} matchResult    - the matchResultData object WrestlingGame builds
 * @param {object|null} profile   - prior profile (may have `personal_bests`)
 * @param {object} [ctx]          - side channel for values not on matchResult (e.g. totalXP)
 * @returns {{ newBests: Array<{key:string,label:string,icon:string,value:number,previous:number|null}>, personalBests: object }}
 *
 * `personalBests` is the merged object safe to persist to profile.personal_bests.
 * When nothing changed it's equal to the previous value (or `{}` if none).
 */
export function checkPersonalBests(matchResult, profile, ctx = {}) {
  const previous = (profile && profile.personal_bests && typeof profile.personal_bests === 'object')
    ? profile.personal_bests
    : {};
  const merged = { ...previous };
  const newBests = [];

  for (const def of PB_DEFINITIONS) {
    const current = def.extract(matchResult, ctx);
    if (!Number.isFinite(current) || current <= 0) continue;

    const prev = Object.prototype.hasOwnProperty.call(previous, def.key) ? previous[def.key] : null;
    const prevValid = Number.isFinite(prev);

    // First-ever record: establish the baseline silently. We DO persist
    // it so the next match can compare - but we don't surface a chip.
    if (!prevValid) {
      merged[def.key] = current;
      continue;
    }

    const beats = def.higherIsBetter ? current > prev : current < prev;
    if (beats) {
      merged[def.key] = current;
      newBests.push({
        key: def.key,
        label: def.label,
        icon: def.icon,
        value: current,
        previous: prev,
      });
    }
  }

  return { newBests, personalBests: merged };
}
