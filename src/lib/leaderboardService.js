import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { db } from './firebase';

// ─── Leaderboard Service ──────────────────────────────────────────────────────

const leaderboardRef = collection(db, 'leaderboard_entries');

const CATEGORIES = [
  'wins', 'level', 'streak', 'pins', 'reaction_single', 'reaction_avg',
  // Phase 3 - Tournament leaderboards. All three rank "higher = better"
  // and use the same storage shape as `wins`/`pins` (direct numeric
  // values, no reaction-style negation).
  'tournament_points', 'tournament_wins', 'tournament_streak',
];

// Reaction time categories store NEGATED milliseconds so that faster times
// have a higher stored value and sort to the top with the shared 'desc' query.
// e.g. 200ms stored as -200. Higher value = faster = better rank.
const REACTION_CATEGORIES = new Set(['reaction_single', 'reaction_avg']);
// Minimum plausible reaction time. Below this is impossible for a human
// reacting to a visual cue (Olympic sprinters average ~150ms reacting to a
// gun, and that's elite-level). Anything faster has to come from prediction,
// a tool, or a timing race in the rendering pipeline. Stored as the negated
// floor: a value of -150 maps to "150ms" displayed; values higher than -150
// (e.g. -87 = "87ms") are rejected by the rules and clamped at write here.
const REACTION_FLOOR_NEGATED = -150;

/**
 * Upsert a leaderboard entry for a specific user + category.
 * Uses a deterministic doc ID so we don't create duplicates.
 */
export async function updateLeaderboardEntry(uid, username, category, value) {
  if (!uid || !category || !CATEGORIES.includes(category)) return;
  const docId = `${uid}_${category}`;
  const docRef = doc(db, 'leaderboard_entries', docId);

  // Anti-cheat clamp: reactions can never be claimed faster than 150ms.
  // Mirror of the firestore.rules floor - so a clamped write still passes.
  let writeValue = value;
  if (REACTION_CATEGORIES.has(category) && typeof writeValue === 'number') {
    if (writeValue > REACTION_FLOOR_NEGATED) writeValue = REACTION_FLOOR_NEGATED;
  }

  try {
    // Reaction categories: don't downgrade a legit personal best with a slower
    // time. But IF the stored "best" is itself a bogus sub-floor entry from
    // before this guard, allow the new (clamped) write to overwrite it - so
    // existing 87ms-style records get healed the next time the user runs the
    // drill instead of being permanently locked in.
    if (REACTION_CATEGORIES.has(category)) {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const existing = snap.data().value ?? -Infinity;
        const existingIsLegit = existing <= REACTION_FLOOR_NEGATED;
        if (existingIsLegit && existing >= writeValue) {
          return; // Legit existing is already as fast or faster - keep it
        }
      }
    }

    await setDoc(docRef, {
      uid,
      username: username || 'Unknown',
      category,
      value: writeValue || 0,
      updated_at: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn('[Leaderboard] Update error:', err);
  }
}

/**
 * Update all 4 leaderboard categories from a profile object.
 * Fire-and-forget - errors are logged but never thrown.
 */
export async function updateAllLeaderboards(uid, profile) {
  if (!uid || !profile) return;
  const username = profile.username || 'Unknown';
  try {
    await Promise.all([
      updateLeaderboardEntry(uid, username, 'wins', profile.wins || 0),
      updateLeaderboardEntry(uid, username, 'level', profile.level || 1),
      updateLeaderboardEntry(uid, username, 'streak', profile.streak_best || 0),
      updateLeaderboardEntry(uid, username, 'pins', profile.pins || 0),
    ]);
  } catch (err) {
    console.warn('[Leaderboard] Bulk update error:', err);
    // Don't throw - leaderboard updates are non-critical
  }
}

/**
 * Update all 3 tournament leaderboard categories from a profile object.
 * Fire-and-forget - errors are logged but never thrown.
 *
 * Reads cumulative values straight off the profile - the caller is
 * expected to have already incremented them before calling this.
 *
 *   profile.tournament_points       (cumulative lifetime points)
 *   profile.tournament_wins         (cumulative tournament match wins)
 *   profile.tournament_streak_best  (best ever consecutive tournament
 *                                    match-win streak)
 */
export async function updateTournamentLeaderboards(uid, profile) {
  if (!uid || !profile) return;
  const username = profile.username || 'Unknown';
  try {
    await Promise.all([
      updateLeaderboardEntry(uid, username, 'tournament_points', profile.tournament_points || 0),
      updateLeaderboardEntry(uid, username, 'tournament_wins',   profile.tournament_wins   || 0),
      updateLeaderboardEntry(uid, username, 'tournament_streak', profile.tournament_streak_best || 0),
    ]);
  } catch (err) {
    console.warn('[Leaderboard] Tournament update error:', err);
  }
}

/**
 * Get the top entries for a category, sorted by value descending.
 */
export async function getLeaderboard(category, maxResults = 25) {
  if (!CATEGORIES.includes(category)) return [];
  try {
    const q = query(
      leaderboardRef,
      where('category', '==', category),
      orderBy('value', 'desc'),
      limit(maxResults)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d, i) => ({ id: d.id, rank: i + 1, ...d.data() }));
  } catch (err) {
    console.warn('[Leaderboard] Get error:', err);
    return [];
  }
}

/**
 * Get a specific user's entry for a category (for "your rank" display).
 */
export async function getUserEntry(uid, category) {
  if (!uid || !category) return null;
  const docId = `${uid}_${category}`;
  const docRef = doc(db, 'leaderboard_entries', docId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (err) {
    return null;
  }
}

/**
 * Update reaction time leaderboard entries.
 * singleBest and avgBest are raw millisecond values (lower = better).
 * They are stored negated so the shared 'value desc' query ranks faster times first.
 */
export async function updateReactionLeaderboard(uid, username, singleBest, avgBest) {
  if (!uid) return;
  try {
    const updates = [];
    if (typeof singleBest === 'number' && singleBest > 0) {
      updates.push(updateLeaderboardEntry(uid, username, 'reaction_single', -singleBest));
    }
    if (typeof avgBest === 'number' && avgBest > 0) {
      updates.push(updateLeaderboardEntry(uid, username, 'reaction_avg', -avgBest));
    }
    await Promise.all(updates);
  } catch (err) {
    console.warn('[Leaderboard] Reaction update error:', err);
  }
}

// Helpers for the display layer to convert stored values back to readable ms.
export function storedToMs(storedValue) {
  return Math.abs(storedValue);
}
export function isReactionCategory(category) {
  return REACTION_CATEGORIES.has(category);
}

export { CATEGORIES };
