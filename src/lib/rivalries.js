// src/lib/rivalries.js
//
// Per-opponent head-to-head tracker. Backs the "You're now 4-2 vs. this
// player" rivalry chip shown on the match-end modal (and eventually in
// pre-match lobby screens).
//
// Storage shape (localStorage key `matgrind_rivalries`):
//
//   {
//     [opponentId]: {
//       wins:   number,    // matches the local player won vs. this opponent
//       losses: number,    // matches the local player lost vs. this opponent
//       name:   string,    // display name at last record (keeps UI readable)
//       lastPlayedAt: number,  // Date.now() on last record call
//     }
//   }
//
// We only record against stable opponent IDs - random matchmaking names
// aren't unique and the server doesn't currently relay a stable UID for
// those rooms. Concrete buckets:
//
//   - vs_ai  → `ai:${difficulty}` (easy / medium / hard)
//   - network (practice-friends with a UID) → `user:${uid}`
//
// Everything else (local 2p, tournament AI cycles, random matchmaking) is
// skipped on purpose - bucketing them would either conflate different
// opponents or leak anonymous players into a long-lived "rivals" list.
//
// Capped at MAX_OPPONENTS (200) to keep the localStorage value small; the
// oldest-played entry is evicted first when the cap is exceeded. No-op and
// safe under SSR (localStorage guarded).

const STORAGE_KEY = 'matgrind_rivalries';
const MAX_OPPONENTS = 200;

function _storageAvailable() {
  return typeof localStorage !== 'undefined';
}

function readStore() {
  if (!_storageAvailable()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(obj) {
  if (!_storageAvailable()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* quota exceeded - rivalries are cosmetic, drop the write silently */
  }
}

/**
 * Read the full rivalry map. Returns `{}` on any failure.
 */
export function getRivalries() {
  return readStore();
}

/**
 * Read a single rivalry record, or `null` if the opponent has no history.
 *
 * @param {string|null|undefined} opponentId
 * @returns {{wins:number,losses:number,name:string,lastPlayedAt:number}|null}
 */
export function getRivalry(opponentId) {
  if (!opponentId) return null;
  const all = readStore();
  const entry = all[opponentId];
  if (!entry) return null;
  return {
    wins: entry.wins | 0,
    losses: entry.losses | 0,
    name: typeof entry.name === 'string' ? entry.name : opponentId,
    lastPlayedAt: entry.lastPlayedAt || 0,
  };
}

/**
 * Record a match result against a given opponent. Returns the updated
 * record (so callers can surface the new tally without a second read).
 *
 * `didWin === true`  → increments wins
 * `didWin === false` → increments losses
 * any other value    → record is updated (lastPlayedAt, name) but W/L
 *                      counters are untouched (treat as draw).
 *
 * @param {string} opponentId
 * @param {string} opponentName
 * @param {boolean|null} didWin
 * @returns {{wins:number,losses:number,name:string,lastPlayedAt:number}|null}
 */
export function recordRivalry(opponentId, opponentName, didWin) {
  if (!opponentId) return null;
  const all = readStore();
  const existing = all[opponentId] || { wins: 0, losses: 0, name: opponentName || opponentId, lastPlayedAt: 0 };
  const next = {
    wins: (existing.wins | 0) + (didWin === true ? 1 : 0),
    losses: (existing.losses | 0) + (didWin === false ? 1 : 0),
    name: (typeof opponentName === 'string' && opponentName.trim()) ? opponentName : existing.name,
    lastPlayedAt: Date.now(),
  };
  all[opponentId] = next;

  // Cap size - evict the oldest-played entries when we overflow. The cap is
  // small enough that this is O(n log n) on an already-tiny map (n ≤ 201).
  const keys = Object.keys(all);
  if (keys.length > MAX_OPPONENTS) {
    keys.sort((a, b) => (all[a].lastPlayedAt || 0) - (all[b].lastPlayedAt || 0));
    const trim = keys.length - MAX_OPPONENTS;
    for (let i = 0; i < trim; i++) delete all[keys[i]];
  }
  writeStore(all);
  return next;
}

/**
 * Derive the stable opponent id for the current match context, or `null`
 * if the opponent can't be stably identified (random matchmaking with no
 * UID, local 2p, etc.). Callers should skip recording on null.
 *
 * @param {{gameMode?:string|null, aiDifficulty?:string|null, practiceOpponentUid?:string|null}} [ctx]
 * @returns {string|null}
 */
export function buildOpponentId(ctx = {}) {
  const { gameMode, aiDifficulty, practiceOpponentUid } = ctx;
  if (gameMode === 'vs_ai') {
    if (!aiDifficulty) return null;
    return `ai:${aiDifficulty}`;
  }
  if (gameMode === 'network' && practiceOpponentUid) {
    return `user:${practiceOpponentUid}`;
  }
  return null;
}

/**
 * Human-readable label for an opponent id. Used when the stored display
 * name is missing or we want a canonical label regardless of rename.
 *
 * @param {string|null|undefined} opponentId
 * @param {string|null|undefined} fallbackName
 * @returns {string}
 */
export function formatOpponentLabel(opponentId, fallbackName) {
  if (opponentId && opponentId.startsWith('ai:')) {
    const diff = opponentId.slice(3);
    if (diff.length === 0) return 'AI Opponent';
    return `${diff[0].toUpperCase()}${diff.slice(1)} AI`;
  }
  if (typeof fallbackName === 'string' && fallbackName.trim()) return fallbackName.trim();
  return 'Opponent';
}
