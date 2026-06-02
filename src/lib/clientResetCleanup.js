// 2026-05-01 - Transient match-state localStorage cleanup helper.
//
// Wipes the set of localStorage keys that hold in-flight match state
// (across all users on the device). Used in two places:
//   1. One-time boot cleanup, gated by a fixed flag, to unstick any user
//      who had stale match-state across the deploy boundary.
//   2. Server-triggered reset via profile.forceClientResetAt, so the
//      operator can unstick a specific user without involving them.
//
// Career-data and profile/auth keys are intentionally left alone:
// - matgrind.career.{uid} (active career mirror) - cloud auto-overwrites
//   on next read, so stale local mirror is harmless and we avoid losing
//   any unsynced offline writes.
// - firebase:authUser:* - auth state must persist across reloads.
// - Settings keys (sound, colorblind, daily-goals) - not part of the
//   match-state stuck-loop pattern.
//
// The cleanup is bounded and idempotent. Calling it multiple times is
// safe; missing keys are a no-op.

/**
 * Run the cleanup against a localStorage-like object. Exported so tests
 * can pass a stub instead of mutating the real `window.localStorage`.
 * @param {Storage} [storage]
 * @returns {{ keysCleared: string[] }}
 */
export function runTransientStateCleanup(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return { keysCleared: [] };
  const cleared = [];

  const tryRemove = (key) => {
    try {
      if (storage.getItem(key) !== null) {
        storage.removeItem(key);
        cleared.push(key);
      }
    } catch { /* localStorage quirk - skip */ }
  };

  // Match-in-flight state. Highest-confidence stale-state suspect.
  tryRemove('pinned_match_state');

  // Walk all keys and remove any that match transient-state patterns.
  // Storage doesn't expose a stable iterator, so collect keys first then
  // delete - deleting during iteration shifts indices.
  /** @type {string[]} */
  const allKeys = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k) allKeys.push(k);
    }
  } catch { /* skip */ }

  for (const k of allKeys) {
    // Dual-meet local state. Same kind of in-flight match cache.
    if (k.startsWith('matgrind.dual.')) {
      tryRemove(k);
      continue;
    }
    // Per-career tournament caches, scoped per-uid + per-careerId. The
    // resume hook reads these on every career load and an orphan
    // snapshot can re-trigger the lockout. Wipe across every user on
    // this device so we don't leave any user's cache stale.
    if (/^matgrind\.career\..*\.tournament\./.test(k)) {
      tryRemove(k);
      continue;
    }
  }

  return { keysCleared: cleared };
}

/**
 * One-time boot cleanup, gated by a fixed flag. Runs the wipe on first
 * call after the flag landed; subsequent calls are no-ops.
 *
 * The flag value is the timestamp of the cleanup, useful for telemetry.
 *
 * @param {Storage} [storage]
 * @returns {{ ranNow: boolean, keysCleared: string[] }}
 */
export const ONE_TIME_CLEANUP_FLAG = 'matgrind.cleanup.2026-05-01-v1';

export function runOneTimeBootCleanup(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return { ranNow: false, keysCleared: [] };
  try {
    if (storage.getItem(ONE_TIME_CLEANUP_FLAG)) {
      return { ranNow: false, keysCleared: [] };
    }
  } catch { return { ranNow: false, keysCleared: [] }; }

  const { keysCleared } = runTransientStateCleanup(storage);

  try { storage.setItem(ONE_TIME_CLEANUP_FLAG, String(Date.now())); }
  catch { /* quota - flag won't stick, cleanup will re-fire next load. acceptable. */ }

  return { ranNow: true, keysCleared };
}

/**
 * Server-triggered reset. Runs the wipe iff the server's stored
 * timestamp is newer than the device's last-applied reset timestamp.
 * The per-uid local key prevents repeated cleanups on the same device
 * for the same server reset.
 *
 * @param {{ uid: string, serverTs: number }} args
 * @param {Storage} [storage]
 * @returns {{ ranNow: boolean, keysCleared: string[] }}
 */
export function runServerTriggeredReset({ uid, serverTs }, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage || !uid) return { ranNow: false, keysCleared: [] };
  const serverTsNum = Number(serverTs) || 0;
  if (serverTsNum <= 0) return { ranNow: false, keysCleared: [] };

  const localKey = `matgrind.lastClientReset.${uid}`;
  let localTs = 0;
  try { localTs = Number(storage.getItem(localKey)) || 0; }
  catch { /* skip */ }

  if (serverTsNum <= localTs) {
    return { ranNow: false, keysCleared: [] };
  }

  const { keysCleared } = runTransientStateCleanup(storage);
  try { storage.setItem(localKey, String(serverTsNum)); }
  catch { /* quota - reset will re-fire next load if not stamped. acceptable. */ }

  return { ranNow: true, keysCleared };
}
