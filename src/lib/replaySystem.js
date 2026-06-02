// ─── Match Replay System ───────────────────────────────────────────────────
// Records match events (round picks, period choices, pin picks) so matches
// can be replayed step-by-step after completion.

import { validateReplay } from '../../tools/bug-hunting/schemas/replaySchema.js';

const STORAGE_KEY = 'matgrind_replays';
const MAX_REPLAYS = 10;

/**
 * Create an empty replay recording.
 * Call once when a match starts.
 */
export function createReplay(matchConfig) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    config: {
      p1Name: matchConfig.p1Name,
      p2Name: matchConfig.p2Name,
      style: matchConfig.style,
      difficulty: matchConfig.difficulty,
      gameMode: matchConfig.gameMode,
      p1Stats: matchConfig.p1Stats || null,
      p2Stats: matchConfig.p2Stats || null,
      initiative: matchConfig.initiative || null, // who had first initiative - needed for deterministic replay
    },
    events: [],
    result: null,
  };
}

/**
 * Record a round resolution event.
 */
export function recordRound(replay, p1CardId, p2CardId) {
  if (!replay) return;
  replay.events.push({ type: 'round', p1CardId, p2CardId });
}

/**
 * Record a period choice event.
 */
export function recordPeriodChoice(replay, chooser, choice) {
  if (!replay) return;
  replay.events.push({ type: 'period_choice', chooser, choice });
}

/**
 * Record a pin pick event (offense or defense).
 */
export function recordPinPick(replay, stage, offenseCardId, defenseCardId) {
  if (!replay) return;
  replay.events.push({ type: 'pin', stage, offenseCardId, defenseCardId });
}

/**
 * Finalize the replay with the match result.
 */
export function finalizeReplay(replay, state) {
  if (!replay) return null;
  replay.result = {
    winner: state.winner,
    winMethod: state.winMethod,
    p1Score: state.p1.score,
    p2Score: state.p2.score,
  };
  // Store the actual match log so replays display accurately
  // (re-simulation via Math.random() can diverge from the original)
  replay.matchLog = state.log || [];
  return replay;
}

/**
 * Save a completed replay to localStorage.
 * Keeps only the most recent MAX_REPLAYS.
 */
export function saveReplay(replay) {
  if (!replay?.result) return;
  // Schema barrier: a malformed replay (e.g. recordRound called with a
  // non-string cardId) shouldn't poison localStorage. Warn + skip rather
  // than throw - losing one replay is fine, crashing the post-match flow
  // is not.
  const validation = validateReplay(replay);
  if (!validation.ok) {
    console.warn('[saveReplay] schema validation failed, dropping replay', validation.errors);
    return;
  }
  try {
    const existing = loadReplays();
    existing.unshift(replay);
    const trimmed = existing.slice(0, MAX_REPLAYS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* storage full - silently fail */ }
}

/**
 * Load all saved replays from localStorage.
 */
export function loadReplays() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter out individual bad entries rather than nuking the whole list.
    // A single corrupt replay (e.g. a partial write from a force-quit)
    // should not deny the user access to the rest of their match history.
    const valid = [];
    let dropped = 0;
    for (const entry of parsed) {
      const v = validateReplay(entry);
      if (v.ok) valid.push(entry);
      else dropped++;
    }
    if (dropped > 0) {
      console.warn(`[loadReplays] dropped ${dropped} corrupt replay(s)`);
    }
    return valid;
  } catch {
    return [];
  }
}

/**
 * Delete a specific replay by ID.
 */
export function deleteReplay(replayId) {
  const replays = loadReplays().filter(r => r.id !== replayId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(replays));
}

/**
 * Clear all replays.
 */
export function clearAllReplays() {
  localStorage.removeItem(STORAGE_KEY);
}
