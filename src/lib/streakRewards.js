/**
 * Streak Rewards - track consecutive daily play and award XP bonuses.
 *
 * Storage key: matgrind_streak
 * Format: { lastPlayDate: 'YYYY-MM-DD', currentStreak: number }
 */

const STORAGE_KEY = 'matgrind_streak';

const STREAK_BONUSES = [
  { days: 3,  multiplier: 0.25, label: '3-Day Streak',  icon: '🔥' },
  { days: 7,  multiplier: 0.50, label: '7-Day Streak',  icon: '🔥🔥' },
  { days: 14, multiplier: 0.75, label: '14-Day Streak', icon: '🔥🔥🔥' },
  { days: 30, multiplier: 1.00, label: '30-Day Streak', icon: '💎' },
];

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Get current streak data from localStorage.
 */
export function getStreakData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lastPlayDate: null, currentStreak: 0 };
    return JSON.parse(raw);
  } catch {
    return { lastPlayDate: null, currentStreak: 0 };
  }
}

/**
 * Record a play for today. Call after each completed match.
 * Returns the updated streak data.
 */
export function recordDailyPlay() {
  const today = getToday();
  const yesterday = getYesterday();
  const data = getStreakData();

  if (data.lastPlayDate === today) {
    // Already played today - streak unchanged
    return data;
  }

  let newStreak;
  if (data.lastPlayDate === yesterday) {
    // Consecutive day - extend streak
    newStreak = data.currentStreak + 1;
  } else {
    // Streak broken (or first play) - start fresh
    newStreak = 1;
  }

  const updated = { lastPlayDate: today, currentStreak: newStreak };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch { /* storage full */ }

  return updated;
}

/**
 * Get the active streak bonus (highest tier the player qualifies for).
 * Returns { multiplier, label, icon, days } or null if no bonus.
 */
export function getActiveBonus(streakDays) {
  let best = null;
  for (const tier of STREAK_BONUSES) {
    if (streakDays >= tier.days) {
      best = tier;
    }
  }
  return best;
}

/**
 * Calculate bonus XP from streak.
 * @param {number} baseXP - XP earned from the match
 * @param {number} streakDays - current streak count
 * @returns {{ bonusXP: number, bonus: object|null }}
 */
export function calculateStreakBonus(baseXP, streakDays) {
  const bonus = getActiveBonus(streakDays);
  if (!bonus) return { bonusXP: 0, bonus: null };
  return {
    bonusXP: Math.round(baseXP * bonus.multiplier),
    bonus,
  };
}

/**
 * Get the next streak milestone.
 */
export function getNextMilestone(streakDays) {
  for (const tier of STREAK_BONUSES) {
    if (streakDays < tier.days) {
      return { ...tier, daysRemaining: tier.days - streakDays };
    }
  }
  return null; // Already at max tier
}

export { STREAK_BONUSES };
