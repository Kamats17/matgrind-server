// src/lib/gameCenter.js
//
// Thin wrapper around the custom @matgrind/capacitor-game-center plugin.
// Pattern: same as src/lib/haptics.js and src/lib/notificationService.js -
//  - every call is guarded on Capacitor.isNativePlatform()
//  - every call catches and logs; never throws into the caller
//  - fire-and-forget semantics (caller does not await)
//
// On web, every function is a no-op that resolves cleanly.

import { Capacitor } from '@capacitor/core';
import { MatgrindGameCenter } from '@matgrind/capacitor-game-center';

const LOG = '[GameCenter]';

/** Canonical leaderboard IDs. MUST match App Store Connect exactly. */
export const LEADERBOARDS = {
  WINS:            'com.matgrind.leaderboard.wins',
  LEVEL:           'com.matgrind.leaderboard.level',
  STREAK:          'com.matgrind.leaderboard.streak',
  PINS:            'com.matgrind.leaderboard.pins',
  TOURNAMENT_WINS: 'com.matgrind.leaderboard.tournament_wins',
  ONLINE_WINS:     'com.matgrind.leaderboard.online_wins',
};

/** Canonical achievement IDs. MUST match App Store Connect exactly. */
export const ACHIEVEMENTS = {
  FIRST_WIN:            'com.matgrind.achievement.first_win',
  FIRST_PIN:            'com.matgrind.achievement.first_pin',
  FIRST_TF:             'com.matgrind.achievement.first_tf',
  TAKEDOWN_5:           'com.matgrind.achievement.takedown_5',
  SHUTOUT:              'com.matgrind.achievement.shutout',
  COMEBACK:             'com.matgrind.achievement.comeback',
  WIN_25:               'com.matgrind.achievement.win_25',
  WIN_50:               'com.matgrind.achievement.win_50',
  WIN_100:              'com.matgrind.achievement.win_100',
  PIN_10:               'com.matgrind.achievement.pin_10',
  LEVEL_5:              'com.matgrind.achievement.level_5',
  LEVEL_10:             'com.matgrind.achievement.level_10',
  LEVEL_25:             'com.matgrind.achievement.level_25',
  LEVEL_50:             'com.matgrind.achievement.level_50',
  LEVEL_100:            'com.matgrind.achievement.level_100',
  RIDE_TIME_3:          'com.matgrind.achievement.ride_time_3',
  STREAK_5:             'com.matgrind.achievement.streak_5',
  // Build 8 additions
  PRACTICE_3_FRIENDS:   'com.matgrind.achievement.practice_3_friends',
  TOURNAMENT_3:         'com.matgrind.achievement.tournament_3',
  TOURNAMENT_CHAMPION:  'com.matgrind.achievement.tournament_champion',
  ONLINE_WINS_5:        'com.matgrind.achievement.online_wins_5',
};

/**
 * Map from the app's internal achievement IDs (src/lib/profileUtils.js
 * checkAchievements()) to the Game Center IDs above.
 *
 * The internal IDs come from profileUtils.js:250-279. We map, we don't
 * recompute. Any internal ID not in this map is simply skipped (no error).
 */
export const INTERNAL_TO_GC_ACHIEVEMENT = {
  first_win:      ACHIEVEMENTS.FIRST_WIN,
  first_pin:      ACHIEVEMENTS.FIRST_PIN,
  first_tech_fall: ACHIEVEMENTS.FIRST_TF,
  first_tf:       ACHIEVEMENTS.FIRST_TF,
  takedown_5:     ACHIEVEMENTS.TAKEDOWN_5,
  shutout:        ACHIEVEMENTS.SHUTOUT,
  comeback:       ACHIEVEMENTS.COMEBACK,
  win_25:         ACHIEVEMENTS.WIN_25,
  win_50:         ACHIEVEMENTS.WIN_50,
  win_100:        ACHIEVEMENTS.WIN_100,
  pin_10:         ACHIEVEMENTS.PIN_10,
  level_5:        ACHIEVEMENTS.LEVEL_5,
  level_10:       ACHIEVEMENTS.LEVEL_10,
  level_25:       ACHIEVEMENTS.LEVEL_25,
  level_50:       ACHIEVEMENTS.LEVEL_50,
  level_100:      ACHIEVEMENTS.LEVEL_100,
  ride_time_3:    ACHIEVEMENTS.RIDE_TIME_3,
  streak_5:       ACHIEVEMENTS.STREAK_5,
  // Build 8 additions
  practice_3_friends:  ACHIEVEMENTS.PRACTICE_3_FRIENDS,
  tournament_3:        ACHIEVEMENTS.TOURNAMENT_3,
  tournament_champion: ACHIEVEMENTS.TOURNAMENT_CHAMPION,
  online_wins_5:       ACHIEVEMENTS.ONLINE_WINS_5,
};

// ── state ───────────────────────────────────────────────────────────────

let _isAuthenticated = false;
let _authAttempted = false;
let _lastAuthError = null;

const isNative = () => {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
};

/** Sync getter for UI conditionals (e.g. only show the GC button if authed). */
export function gcIsAuthenticated() {
  return _isAuthenticated;
}

/** Was authenticate() called at least once? Useful for "we tried, user dismissed" UI states. */
export function gcAuthAttempted() {
  return _authAttempted;
}

/**
 * Last error string from gcAuthenticate(), if any. Lets the UI distinguish
 * "user cancelled" from a real Apple-side configuration error like
 * "Game Center is not enabled for this app". null when authed or never tried.
 */
export function gcLastAuthError() {
  return _lastAuthError;
}

// ── core ops ────────────────────────────────────────────────────────────

/**
 * Kick off Game Center authentication. iOS will either sign the user in
 * silently (already signed into Game Center system-wide), show a banner,
 * or show a full sign-in sheet - GameKit chooses. Fire-and-forget.
 */
export async function gcAuthenticate() {
  if (!isNative()) return false;
  _authAttempted = true;
  try {
    const res = await MatgrindGameCenter.authenticate();
    _isAuthenticated = !!(res && res.authenticated);
    if (_isAuthenticated) {
      _lastAuthError = null;
      console.log(LOG, 'authenticated as', res.alias || res.playerID || '(unknown)');
    } else {
      // Surface the real iOS error (e.g. "Game Center is not enabled for
      // this app", "The requested operation could not be completed
      // because the app is not recognized by Game Center") so UI code
      // can show the actual reason instead of a generic message.
      _lastAuthError = res?.error || 'Unknown Game Center error';
      console.log(LOG, 'not authenticated:', _lastAuthError,
        res?.errorDomain ? `(${res.errorDomain}#${res.errorCode})` : '');
    }
    return _isAuthenticated;
  } catch (e) {
    _lastAuthError = e?.message || String(e);
    console.warn(LOG, 'authenticate() failed:', _lastAuthError);
    _isAuthenticated = false;
    return false;
  }
}

/** Submit a single score to a specific leaderboard. */
export async function gcSubmitScore(leaderboardId, score) {
  if (!isNative()) return false;
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  try {
    const res = await MatgrindGameCenter.submitScore({
      leaderboardId,
      score: Math.max(0, Math.floor(score)),
    });
    if (res?.submitted) console.log(LOG, 'score submitted', leaderboardId, '→', score);
    return !!res?.submitted;
  } catch (e) {
    console.warn(LOG, 'submitScore failed:', leaderboardId, e?.message || e);
    return false;
  }
}

/** Unlock / report an achievement by ID. percentComplete defaults to 100. */
export async function gcUnlockAchievement(achievementId, percentComplete = 100) {
  if (!isNative()) return false;
  try {
    const res = await MatgrindGameCenter.reportAchievement({
      achievementId,
      percentComplete: Math.max(0, Math.min(100, percentComplete)),
      showsCompletionBanner: true,
    });
    if (res?.reported) console.log(LOG, 'achievement unlocked', achievementId);
    return !!res?.reported;
  } catch (e) {
    console.warn(LOG, 'reportAchievement failed:', achievementId, e?.message || e);
    return false;
  }
}

/**
 * Show the native Game Center leaderboards sheet. Pass
 * { leaderboardId } to focus on a specific board.
 */
export async function gcShowLeaderboards(options = undefined) {
  if (!isNative()) return;
  try { await MatgrindGameCenter.showLeaderboards(options); }
  catch (e) { console.warn(LOG, 'showLeaderboards failed:', e?.message || e); }
}

/** Show the native Game Center achievements sheet. */
export async function gcShowAchievements() {
  if (!isNative()) return;
  try { await MatgrindGameCenter.showAchievements(); }
  catch (e) { console.warn(LOG, 'showAchievements failed:', e?.message || e); }
}

// ── high-level helpers used by the match-end hook ───────────────────────

/**
 * Submit the mixed-mode leaderboard scores from a profile.
 * Best-effort; ignores failures so a single network blip doesn't
 * disrupt the rest. ONLINE_WINS is NOT submitted here - it is now
 * server-authoritative (online_progress) and submitted separately via
 * gcSubmitOnlineWins() from the trusted match_settled receipt.
 */
export async function gcSubmitMatchScores(profile) {
  if (!isNative() || !profile) return;

  const wins            = Number(profile.wins ?? profile.career_wins ?? profile.total_wins ?? 0);
  const level           = Number(profile.level ?? 1);
  const bestStreak      = Number(profile.streak_best ?? profile.best_streak ?? profile.max_streak ?? 0);
  const totalPins       = Number(profile.pins ?? profile.total_pins ?? profile.career_pins ?? 0);
  const tournamentWins  = Number(profile.tournaments_won ?? 0);

  await Promise.allSettled([
    gcSubmitScore(LEADERBOARDS.WINS,            wins),
    gcSubmitScore(LEADERBOARDS.LEVEL,           level),
    gcSubmitScore(LEADERBOARDS.STREAK,          bestStreak),
    gcSubmitScore(LEADERBOARDS.PINS,            totalPins),
    gcSubmitScore(LEADERBOARDS.TOURNAMENT_WINS, tournamentWins),
  ]);
}

/**
 * Submit the ONLINE_WINS leaderboard from the SERVER-AUTHORITATIVE online win
 * count - a match_settled receipt's onlineProgress.wins, or a getOnlineProgress()
 * fallback read - NOT the local profile, which no longer tracks online wins.
 *
 * Residual debt: Game Center submission is still ultimately client-spoofable (any
 * client can call the native API with any number). This removes the forgeable
 * profile.online_wins source; truly trusting the GC submission would need a
 * server-side Game Center bridge, which is out of scope for this pass.
 */
export async function gcSubmitOnlineWins(onlineWins) {
  if (!isNative()) return;
  await gcSubmitScore(LEADERBOARDS.ONLINE_WINS, Number(onlineWins) || 0);
}

/**
 * Given the internal achievement IDs newly earned this match, unlock
 * the mapped Game Center achievements. Unknown IDs are silently skipped.
 */
export async function gcUnlockEarnedAchievements(internalIds) {
  if (!isNative() || !Array.isArray(internalIds) || internalIds.length === 0) return;
  const gcIds = internalIds
    .map((id) => INTERNAL_TO_GC_ACHIEVEMENT[id])
    .filter(Boolean);
  if (gcIds.length === 0) return;
  await Promise.allSettled(gcIds.map((id) => gcUnlockAchievement(id, 100)));
}
