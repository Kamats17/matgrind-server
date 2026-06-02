/**
 * Mid-match persistence - saves game state to localStorage so matches
 * survive tab close, app switch, and accidental navigation.
 */

const STORAGE_KEY = 'pinned_match_state';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Persistence schema version. Bumped when the saved-match shape changes
// in a way that older saves can't be safely resumed under newer code.
// Saves with v < PERSISTENCE_VERSION are silently discarded on load.
//
// History:
//   1 - implicit (no `v` field) - initial shape, also covers the era where
//       career tournaments stamped p1.name with the bracket[0] NPC name
//       instead of the actual player. Discarding these on load is the
//       cleanest way to heal those bad in-flight matches without an
//       error-prone NPC-last-name guard that false-positives on real
//       player names like "Tom Edwards" or "Maria Garcia".
//   2 - current (Apr 2026). Added on top of the bracket[playerSeed] fix
//       in WrestlingGame.handleTournamentStartMatch.
const PERSISTENCE_VERSION = 2;

/**
 * Save current match state to localStorage.
 * Skips if match is already finished.
 *
 * Also skips `pin_attempt` phase: that phase is a timer-driven minigame
 * where the in-progress picks (`pinOffenseChoice`, `pinDefenseChoice`) and
 * shuffled PinActionPad card positions live in React memory only. Persisting
 * mid-pin-attempt would restore a partial state that can't be completed -
 * users got permanently trapped on the pin modal every time they re-opened
 * the app. The engine re-emits pin_attempt deterministically from the
 * `playing`/`overtime` state that preceded it, so skipping the save here
 * just means a re-entry rewinds to the last stable round boundary.
 */
export function saveMatchToStorage(matchState, p1Hand, p2Hand, gameMode, humanPlayer = 'p1') {
  if (!matchState) return;
  if (matchState.phase === 'finished') return;
  if (matchState.phase === 'pin_attempt') return;
  try {
    const data = {
      matchState,
      p1Hand,
      p2Hand,
      gameMode,
      humanPlayer,
      timestamp: Date.now(),
      v: PERSISTENCE_VERSION,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('[matchPersistence] Failed to save:', err);
  }
}

/**
 * Load saved match state from localStorage.
 * Returns null if no save exists or save is older than 24 hours.
 *
 * Also discards any save whose phase is `pin_attempt`: this cleans up stale
 * saves written by older app versions before saveMatchToStorage started
 * skipping that phase, so users who were trapped on the pin modal get
 * unstuck on next load.
 */
export function loadMatchFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);
    if (!data.matchState || !data.timestamp) return null;

    // Expire stale saves
    if (Date.now() - data.timestamp > MAX_AGE_MS) {
      clearMatchFromStorage();
      return null;
    }

    // Discard stale pin_attempt saves written by previous app versions -
    // they can't be completed reliably (see saveMatchToStorage note).
    if (data.matchState.phase === 'pin_attempt') {
      clearMatchFromStorage();
      return null;
    }

    // Schema-version guard: saves written before PERSISTENCE_VERSION = 2
    // (which corresponds to the era when career tournaments stamped p1.name
    // with the bracket[0] NPC instead of the actual player) get silently
    // discarded. One-time pain for any user with an in-flight match across
    // the update boundary; zero false positives on real player names with
    // common surnames going forward.
    if ((data.v || 0) < PERSISTENCE_VERSION) {
      clearMatchFromStorage();
      return null;
    }

    // 2026-05-01 - Structural integrity guard. The match UI assumes
    // matchState has p1, p2, phase, and wrestlingStyle. Without those,
    // restore would set a half-state that the render path can't render,
    // leaving the user on the "Loading match..." fallback. createInitialMatchState
    // always sets all four; if a save is missing any of them, the save was
    // either truncated (browser quota race) or written by a buggy code
    // path. Treat as unrecoverable and clear so the next load is clean.
    const ms = data.matchState;
    const looksValid = ms
      && typeof ms.phase === 'string'
      && typeof ms.wrestlingStyle === 'string'
      && ms.p1 && typeof ms.p1 === 'object'
      && ms.p2 && typeof ms.p2 === 'object';
    if (!looksValid) {
      console.warn('[matchPersistence] discarding malformed save', {
        keys: Object.keys(ms || {}),
        phase: ms?.phase,
      });
      clearMatchFromStorage();
      return null;
    }

    return data;
  } catch (err) {
    console.warn('[matchPersistence] Failed to load:', err);
    clearMatchFromStorage();
    return null;
  }
}

/**
 * Clear saved match state.
 */
export function clearMatchFromStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    // Ignore - localStorage might not be available
  }
}
