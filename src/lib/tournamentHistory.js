// ─── Tournament History ─────────────────────────────────────────────────
// Per-device tournament history. The Firestore leaderboard is separate and
// writes through leaderboardService + firestoreService; this file stays
// local-first so the TournamentHistory screen works offline.

const STORAGE_KEY = 'matgrind_tournament_history';
const MAX_HISTORY = 20;

/**
 * Save a completed tournament result.
 *
 * Consumers (WrestlingGame.jsx) should compute `placement` via
 * tournamentScoring.computePlacement so the value is bracket-aware - the
 * old inline `1/3/5` ladder lost every 2nd-place and every R16/R32 finish.
 *
 * `pointsEarned` should come from tournamentScoring.computeTournamentPoints
 * so the local history row matches what was added to the cloud-backed
 * profile.tournament_points counter.
 *
 * @param {Object} result {
 *   playerName, placement, rounds, wins, losses, style, difficulty,
 *   bracketSize, format, pointsEarned?, timestamp?
 * }
 */
export function saveTournamentResult(result) {
  try {
    const history = loadTournamentHistory();
    history.unshift({
      ...result,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: result.timestamp || Date.now(),
      pointsEarned: typeof result.pointsEarned === 'number' ? result.pointsEarned : 0,
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch { /* storage full */ }
}

/**
 * Load all tournament history.
 */
export function loadTournamentHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Derive the longest consecutive run of `placement === 1` across saved
 * history. The previous implementation walked newest-first and never
 * produced correct values on a streak spanning older entries; this
 * version walks oldest-first.
 */
function computeBestChampionshipStreak(history) {
  // history is stored newest-first (unshift). Reverse for chronological walk.
  const chron = [...history].reverse();
  let best = 0;
  let current = 0;
  for (const t of chron) {
    if (t && t.placement === 1) {
      current++;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

/**
 * Summary stats for the TournamentHistory screen.
 *
 * When a `profile` object is provided (signed-in user), the displayed
 * "Best Streak" and "Points" figures prefer the Firestore-backed profile
 * fields (maintained by WrestlingGame's save path + leaderboardService).
 * Falls back to localStorage-derived values otherwise.
 *
 * @param {object} [profile] optional profile with tournament_* fields
 */
export function getTournamentStats(profile = null) {
  const history = loadTournamentHistory();
  if (!history.length && !profile) return null;

  const wins = history.filter(t => t.placement === 1).length;
  const total = history.length;

  // Prefer profile-sourced streak when available - the localStorage
  // derivation is capped at MAX_HISTORY and won't reflect streaks that
  // extend beyond that window.
  const localBestStreak = computeBestChampionshipStreak(history);
  const bestStreak = Number.isFinite(profile?.tournament_streak_best)
    ? profile.tournament_streak_best
    : localBestStreak;

  const localPoints = history.reduce((sum, t) => sum + (t.pointsEarned || 0), 0);
  const points = Number.isFinite(profile?.tournament_points)
    ? profile.tournament_points
    : localPoints;

  const cloudWins = Number.isFinite(profile?.tournament_wins)
    ? profile.tournament_wins
    : null;

  return {
    total,
    wins,
    winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
    bestStreak,
    points,
    totalMatchWins: cloudWins ?? history.reduce((sum, t) => sum + (t.wins || 0), 0),
    totalMatchLosses: history.reduce((sum, t) => sum + (t.losses || 0), 0),
  };
}
