// Guest-mode progression storage.
// Mirrors the Firestore profile shape well enough that the UI and
// saveMatchResult can treat guest storage as a drop-in alternative,
// and so `migrateGuestToAccount` can fold a guest run into a fresh
// Firestore profile on sign-in/sign-up without re-seeding or data loss.

const PROFILE_KEY = 'matgrind_guest_profile';
const HISTORY_KEY = 'matgrind_guest_history';
const HISTORY_MAX = 30;

function safeParse(raw, fallback) {
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function loadGuestProfile() {
  try { return safeParse(localStorage.getItem(PROFILE_KEY), null); }
  catch { return null; }
}

export function saveGuestProfile(profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }
  catch { /* quota / disabled storage - silently drop */ }
}

export function loadGuestHistory() {
  try { return safeParse(localStorage.getItem(HISTORY_KEY), []) || []; }
  catch { return []; }
}

export function appendGuestMatch(matchData) {
  try {
    const history = loadGuestHistory();
    const entry = {
      ...matchData,
      // Mimic Firestore fields the Profile UI consumes so the same render
      // path works for guest + auth'd history.
      id: `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      created_at: new Date().toISOString(),
    };
    const updated = [entry, ...history].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch { /* ignore */ }
}

export function clearGuestData() {
  try {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(HISTORY_KEY);
  } catch { /* ignore */ }
}

function parseAchIds(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

/**
 * Merge guest progression into a Firestore profile. Invariants:
 *  - Counters (wins, losses, …) SUM - they represent distinct matches.
 *  - XP and level take the MAX - the guest either pre-progressed
 *    (so we honor it) or the account is ahead (so we don't double-credit).
 *  - Stats: if the remote looks default (sum == 300, the 5×60 starter),
 *    adopt the guest's allocation. Otherwise the account owner's
 *    allocation wins - we don't overwrite intentional respecs.
 *  - Achievements union - can't un-earn.
 *  - Streak best/current: MAX (streak_current is approximate; we'd
 *    rather over-reward than reset a live streak).
 */
export function mergeGuestIntoRemote(remoteProfile, guestProfile) {
  if (!guestProfile) return remoteProfile || null;
  if (!remoteProfile) return { ...guestProfile }; // fresh account - seed with guest

  const remoteAch = parseAchIds(remoteProfile.achievements_json);
  const guestAch  = parseAchIds(guestProfile.achievements_json);
  const mergedAch = Array.from(new Set([...remoteAch, ...guestAch]));

  const defaultStats = { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
  const remoteStatSum = Object.values(remoteProfile.stats || defaultStats)
    .reduce((a, b) => a + (b || 0), 0);
  const mergedStats = remoteStatSum > 300
    ? remoteProfile.stats
    : (guestProfile.stats || remoteProfile.stats || defaultStats);

  const unionFriends = (() => {
    const a = Array.isArray(remoteProfile.practice_friends) ? remoteProfile.practice_friends : [];
    const b = Array.isArray(guestProfile.practice_friends)  ? guestProfile.practice_friends  : [];
    return Array.from(new Set([...a, ...b]));
  })();

  return {
    ...remoteProfile,
    wins:          (remoteProfile.wins          || 0) + (guestProfile.wins          || 0),
    losses:        (remoteProfile.losses        || 0) + (guestProfile.losses        || 0),
    draws:         (remoteProfile.draws         || 0) + (guestProfile.draws         || 0),
    pins:          (remoteProfile.pins          || 0) + (guestProfile.pins          || 0),
    tech_falls:    (remoteProfile.tech_falls    || 0) + (guestProfile.tech_falls    || 0),
    total_points:  (remoteProfile.total_points  || 0) + (guestProfile.total_points  || 0),
    total_matches: (remoteProfile.total_matches || 0) + (guestProfile.total_matches || 0),
    xp:    Math.max(remoteProfile.xp    || 0, guestProfile.xp    || 0),
    level: Math.max(remoteProfile.level || 1, guestProfile.level || 1),
    stats: mergedStats,
    stat_points_available: Math.max(
      remoteProfile.stat_points_available || 0,
      guestProfile.stat_points_available  || 0,
    ),
    achievements_json: JSON.stringify(mergedAch),
    streak_current: Math.max(remoteProfile.streak_current || 0, guestProfile.streak_current || 0),
    streak_best:    Math.max(remoteProfile.streak_best    || 0, guestProfile.streak_best    || 0),
    online_wins:         (remoteProfile.online_wins         || 0) + (guestProfile.online_wins         || 0),
    tournaments_entered: (remoteProfile.tournaments_entered || 0) + (guestProfile.tournaments_entered || 0),
    tournaments_won:     (remoteProfile.tournaments_won     || 0) + (guestProfile.tournaments_won     || 0),
    practice_friends: unionFriends,
  };
}

/**
 * One-shot migration: fold guest localStorage progression into the
 * account's Firestore profile + match history. Safe to call redundantly:
 * if guest storage is empty it's a no-op. On success the guest keys are
 * cleared so we never migrate twice. On failure we keep the data so the
 * next sign-in can retry.
 *
 * @param {string} uid
 * @param {{ getProfile: Function, saveProfile: Function, createMatch: Function }} service
 * @returns {Promise<boolean>} true if any migration happened
 */
export async function migrateGuestToAccount(uid, { getProfile, saveProfile, createMatch }) {
  const guestProfile = loadGuestProfile();
  const guestHistory = loadGuestHistory();
  if (!guestProfile && guestHistory.length === 0) return false;

  try {
    const remote = await getProfile(uid);
    const merged = mergeGuestIntoRemote(remote, guestProfile);
    if (merged) await saveProfile(uid, merged);

    // Best-effort match history copy - we don't want a single failed
    // write to abandon an otherwise-good merge.
    for (const m of guestHistory) {
      const { id: _id, created_at: _ct, ...rest } = m;
      try { await createMatch(uid, rest); }
      catch (e) { console.warn('[migrateGuest] match copy failed:', e?.message); }
    }

    clearGuestData();
    console.log('[migrateGuest] ok', { uid, matchesCopied: guestHistory.length });
    return true;
  } catch (e) {
    console.warn('[migrateGuest] failed - keeping guest data for retry:', e?.message);
    return false;
  }
}
