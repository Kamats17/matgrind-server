import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, documentId, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { toast } from '@/components/ui/use-toast';
import { CATEGORIES as LEADERBOARD_CATEGORIES } from './leaderboardService.js';
import { validateCareer } from '../../tools/bug-hunting/schemas/careerStateSchema.js';
import { validateDeckPersistence } from '../../tools/bug-hunting/schemas/deckPersistenceSchema.js';
import { getDefaultSinglet } from './wrestlerColors.js';

// ─── Wrestler Profiles ───────────────────────────────────────────────────────

const profilesRef = collection(db, 'profiles');

/**
 * Get profile for a specific user (by Firebase Auth UID).
 * Returns null if no profile exists yet.
 * @param {string} uid
 * @returns {Promise<any>}
 */
const DEFAULT_STATS = { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };

// Stage 4: read the server-authoritative online_progress/{uid} doc. Used as the
// fallback when a trusted match_settled push is missed (reconnect / late push).
// Client-readable, server-write-only (see firestore.rules). Returns the
// online counters, or null if none exist yet / on error.
export async function getOnlineProgress(uid) {
  if (!uid) return null;
  try {
    const snap = await getDoc(doc(db, 'online_progress', uid));
    return snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn('[firestoreService] getOnlineProgress failed:', err?.message);
    return null;
  }
}

export async function getProfile(uid) {
  const docRef = doc(db, 'profiles', uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  // Backfill stats for profiles created before the stat system
  if (!data.stats) {
    data.stats = { ...DEFAULT_STATS };
    data.stat_points_available = 0;
  }
  if (data.stat_points_available === undefined) {
    data.stat_points_available = 0;
  }
  // Backfill base_stats for profiles created before respec system
  if (!data.base_stats) {
    data.base_stats = { ...DEFAULT_STATS };
  }
  if (data.respecs_used === undefined) {
    data.respecs_used = 0;
  }
  // Backfill appearance for profiles created before visual customization
  if (!data.appearance) {
    data.appearance = null;
  }
  // New singlet system: if the profile has an `appearance` object but no
  // nested `singlet` sub-object yet, derive a default one from the legacy
  // `primaryColor` (and pre-fill text fields from team/username/weight).
  // This is read-only backfill; the next saveProfile that touches the
  // singlet will persist the new fields.
  if (data.appearance && typeof data.appearance === 'object' && !data.appearance.singlet) {
    data.appearance = {
      ...data.appearance,
      singlet: getDefaultSinglet(data),
    };
  }
  // v1.2.0 additions - all default-safe for older profiles.
  if (data.team === undefined) {
    data.team = '';
  }
  if (data.profile_visibility === undefined) {
    data.profile_visibility = 'public';
  }
  if (!Array.isArray(data.friend_requests_in)) {
    data.friend_requests_in = [];
  }
  if (!Array.isArray(data.friend_requests_out)) {
    data.friend_requests_out = [];
  }
  // Phase 3 - Deck Builder. Legacy profiles have no deck state; default
  // to empty so existing users fall through to the full-pool hand draw.
  if (!Array.isArray(data.decks)) {
    data.decks = [];
  }
  if (data.activeDeckId === undefined) {
    data.activeDeckId = null;
  }
  // Phase 3 - Tournament Leaderboard. Cumulative lifetime counters that
  // feed the three tournament_* leaderboard categories. Current streak is
  // a transient counter and does NOT rank - only tournament_streak_best
  // is pushed to the leaderboard.
  if (!Number.isFinite(data.tournament_points)) {
    data.tournament_points = 0;
  }
  if (!Number.isFinite(data.tournament_wins)) {
    data.tournament_wins = 0;
  }
  if (!Number.isFinite(data.tournament_streak_best)) {
    data.tournament_streak_best = 0;
  }
  if (!Number.isFinite(data.tournament_streak_cur)) {
    data.tournament_streak_cur = 0;
  }
  // Self-heal the prefix-search index: if this profile has a username but
  // no `username_lc` (older profiles created before the search field was
  // introduced), write the lowercase mirror back asynchronously. Every
  // active user backfills themselves on their next app open. Fire-and-
  // forget - failure is silent and getProfile's contract is unaffected.
  if (typeof data.username === 'string' && !data.username_lc) {
    const lc = data.username.trim().toLowerCase();
    if (lc) {
      data.username_lc = lc; // surface in-memory for the current caller
      updateDoc(docRef, { username_lc: lc }).catch(() => { /* not fatal */ });
    }
  }
  return /** @type {any} */ ({ id: snap.id, ...data });
}

/**
 * Persist a user's deck collection + active deck selection. Thin wrapper
 * over saveProfile so the caller doesn't need to know the profile shape.
 *
 * Also mirrors to localStorage so the DecksScreen and match init can
 * render immediately on reload before Firestore hydrates. Key is scoped
 * by uid so multiple device-local accounts don't cross-contaminate.
 */
export async function saveDecks(uid, decks, activeDeckId) {
  const safeDecks = Array.isArray(decks) ? decks : [];
  const safeActive = activeDeckId ?? null;
  // Schema validation barrier: a malformed deck (e.g. a non-string card id
  // injected by buggy migration code) should fail loudly here rather than
  // round-trip through Firestore and corrupt the next read.
  const validation = validateDeckPersistence({ decks: safeDecks, activeDeckId: safeActive });
  if (!validation.ok) {
    throw Object.assign(new Error('DeckPersistenceInvalid'), {
      code: 'DECKS_INVALID',
      errors: validation.errors,
    });
  }
  try {
    const key = `matgrind.decks.${uid}`;
    localStorage.setItem(key, JSON.stringify({ decks: safeDecks, activeDeckId: safeActive }));
  } catch {
    // Quota/availability failure is non-fatal - Firestore is the source
    // of truth. Swallow so save still attempts the network write.
  }
  return saveProfile(uid, { decks: safeDecks, activeDeckId: safeActive });
}

/**
 * Read deck state out of localStorage. Used on boot for offline/pre-auth
 * rendering; Firestore backfill supersedes whenever it lands.
 */
export function loadLocalDecks(uid) {
  try {
    const raw = localStorage.getItem(`matgrind.decks.${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.decks)) return null;
    // Schema barrier on read: corrupt or forward-incompatible payloads fall
    // through to null so the boot path falls back to Firestore as the source
    // of truth (saveDecks writes both Firestore and localStorage in tandem).
    const candidate = { decks: parsed.decks, activeDeckId: parsed.activeDeckId ?? null };
    const validation = validateDeckPersistence(candidate);
    if (!validation.ok) {
      console.warn('[loadLocalDecks] schema validation failed, ignoring cache', validation.errors);
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Create or update a profile for a user.
 * Uses the Firebase Auth UID as the document ID (1 profile per user).
 */
export async function saveProfile(uid, data) {
  try {
    const docRef = doc(db, 'profiles', uid);
    const snap = await getDoc(docRef);
    // Mirror username -> username_lc (lowercase) on every write that touches
    // the username so the prefix-search index stays in sync. Backfills older
    // profiles on their next save without a separate migration script.
    const withSearchIndex = { ...data };
    if (typeof data.username === 'string') {
      withSearchIndex.username_lc = data.username.trim().toLowerCase();
    } else if (snap.exists() && !snap.data()?.username_lc && typeof snap.data()?.username === 'string') {
      withSearchIndex.username_lc = snap.data().username.trim().toLowerCase();
    }
    if (snap.exists()) {
      await updateDoc(docRef, { ...withSearchIndex, updated_date: serverTimestamp() });
      const updated = await getDoc(docRef);
      return { id: updated.id, ...updated.data() };
    } else {
      const newData = { ...withSearchIndex, created_date: serverTimestamp(), updated_date: serverTimestamp() };
      const { setDoc } = await import('firebase/firestore');
      await setDoc(docRef, newData);
      return { id: uid, ...newData };
    }
  } catch (err) {
    toast({ title: 'Save failed', description: 'Could not save profile. Check your connection.', variant: 'destructive' });
    throw err;
  }
}

/**
 * Delete every piece of user data from Firestore.
 * Covers: profile, all match history, and all leaderboard entries.
 *
 * This is the Firestore half of account deletion. The Auth user itself
 * must be deleted separately via AuthContext.deleteAccount - Firebase
 * keeps Auth + Firestore as distinct systems.
 *
 * Apple Guideline 5.1.1(v) requires real deletion, not a soft delete,
 * or the submission gets rejected. Leaving leaderboard entries in place
 * after a delete is a data-leak bug we've previously shipped.
 */
export async function deleteProfile(uid) {
  // Matches (can be dozens - paginate safely via single getDocs for now;
  // switch to a batched cursor when any user exceeds ~500 matches).
  const matchesQ = query(collection(db, 'matches'), where('uid', '==', uid));
  const matchSnaps = await getDocs(matchesQ);
  await Promise.all(matchSnaps.docs.map(d => deleteDoc(d.ref)));

  // Leaderboard entries (one per category - doc IDs are deterministic:
  // `<uid>_<category>`). Delete every category unconditionally; missing
  // docs are a no-op server-side. Imported from leaderboardService so a
  // new category added there is auto-covered here (no second list to
  // keep in sync - required by Apple Guideline 5.1.1(v)).
  await Promise.all(
    LEADERBOARD_CATEGORIES.map(cat =>
      deleteDoc(doc(db, 'leaderboard_entries', `${uid}_${cat}`)).catch(() => {})
    )
  );

  // Profile doc itself (1 per user, doc ID = uid).
  await deleteDoc(doc(db, 'profiles', uid));
}

// ─── Career Mode ─────────────────────────────────────────────────────────────
// Careers are stored in a subcollection under the profile
// (`profiles/{uid}/careers/{careerId}`) rather than embedded on the profile
// doc. Rationale: a full 12-season career can exceed Firestore's 1MB doc
// limit once rivals/history accumulate, and Hall of Fame queries should be
// cheap without loading every active career's full schedule.
//
// The active career pointer lives on the parent profile as `activeCareerId`
// so `getProfile` → `getActiveCareer` is a two-doc lookup on app boot.

const CAREER_LOCAL_KEY = (uid) => `matgrind.career.${uid}`;

// Firestore rejects `undefined` field values with a hard error. Career objects
// pick up new fields over time (state, prestige, opponentMeetings, tempBuffs,
// rankPoolId on bracket entries, etc.) and any branch that returns `undefined`
// for one of them blows up archive/save. Strip `undefined` recursively before
// writing - null is fine for Firestore, undefined is not.
function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

/**
 * Load the user's active career, if any. Returns null when there's no
 * active career pointer on the profile. Falls back to localStorage for
 * offline/pre-auth resume so the dashboard can render instantly on reload.
 */
export async function getActiveCareer(uid) {
  if (!uid) return null;
  try {
    const profileSnap = await getDoc(doc(db, 'profiles', uid));
    if (!profileSnap.exists()) return null;
    const activeCareerId = profileSnap.data()?.activeCareerId;
    if (!activeCareerId) return null;
    const careerSnap = await getDoc(doc(db, 'profiles', uid, 'careers', activeCareerId));
    if (!careerSnap.exists()) return null;
    return /** @type {any} */ ({ id: careerSnap.id, ...careerSnap.data() });
  } catch {
    // Network failure → try local cache.
    return loadLocalCareer(uid);
  }
}

/**
 * Persist a career. Also mirrors to localStorage so the dashboard renders
 * offline. `career.id` is the subcollection doc id; updating a retired
 * career is not supported (archive it instead).
 * @param {string} uid
 * @param {any} career
 * @param {{ preferSlotId?: string }} [opts]
 */
export async function saveCareer(uid, career, { preferSlotId } = {}) {
  if (!uid || !career?.id) throw new Error('saveCareer: uid and career.id required');
  // Schema gate (write side). Mirrors the read-side guard in hydrateCareer:
  // refuse to persist career state that fails validation so a bug elsewhere
  // can't quietly corrupt the cloud copy. Throws a typed error so callers'
  // existing async catches surface it instead of pretending success.
  const validation = validateCareer(career);
  if (!validation.ok) {
    console.error('[saveCareer] refusing to persist invalid career', validation.errors);
    throw Object.assign(new Error('CareerStateInvalid'), {
      code: 'CAREER_INVALID',
      errors: validation.errors,
    });
  }
  // `_hydratedFromLegacy` is a transient UI hint set by hydrateCareer on first
  // migration - it triggers the one-shot "Phase B unlocked" toast. It must
  // NOT persist: if we wrote it, every subsequent reload would read the flag
  // back (hydrateCareer short-circuits on already-current version), and the
  // toast would fire forever. Strip before write.
  // _needsResave is set by hydrateCareer self-heals (e.g. women's
  // ranking pool gender-wiring repair). Strip before write so it doesn't
  // round-trip and confuse the next load.
  const { _hydratedFromLegacy, _needsResave: _resaveFlag, ...rest } = career;
  void _resaveFlag;
  const toWrite = stripUndefined({ ...rest, updatedAt: Date.now() });
  // Local mirror first - non-fatal if it fails.
  try {
    localStorage.setItem(CAREER_LOCAL_KEY(uid), JSON.stringify(toWrite));
  } catch { /* quota */ }
  try {
    const { setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'profiles', uid, 'careers', career.id), toWrite);
    // Update activeCareerId pointer on profile. setDoc+merge survives the
    // case where the profile doc doesn't exist yet (updateDoc would throw).
    // Slot assignment priority:
    //   1. Slot already owns this careerId (existing career, just update lastPlayedAt).
    //   2. preferSlotId from caller (the slot the user tapped to start a new career).
    //   3. First empty slot.
    //   4. Slot 0 (overwrite - shouldn't happen via UI since picker hides full state).
    const slots = await getCareerSlots(uid);
    let slotIdx = slots.findIndex(s => s.careerId === career.id);
    if (slotIdx === -1 && preferSlotId) {
      const preferIdx = slots.findIndex(s => s.slotId === preferSlotId);
      if (preferIdx !== -1) slotIdx = preferIdx;
    }
    if (slotIdx === -1) slotIdx = slots.findIndex(s => !s.careerId);
    if (slotIdx === -1) slotIdx = 0;
    const updatedSlots = slots.map((s, i) => i === slotIdx
      ? { slotId: s.slotId, careerId: career.id, lastPlayedAt: Date.now() }
      : s
    );
    await setDoc(doc(db, 'profiles', uid), {
      activeCareerId: career.id,
      careerSlots: updatedSlots,
      updated_date: serverTimestamp(),
    }, { merge: true });
    return toWrite;
  } catch (err) {
    // Network / permission failure: localStorage mirror is authoritative
    // until the next successful sync. No user-facing toast - the optimistic
    // local save has already happened and the dashboard stays usable.
    console.warn('[career] cloud save failed:', err?.message);
    throw err;
  }
}

export function loadLocalCareer(uid) {
  try {
    const raw = localStorage.getItem(CAREER_LOCAL_KEY(uid));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearLocalCareer(uid) {
  try { localStorage.removeItem(CAREER_LOCAL_KEY(uid)); } catch { /* noop */ }
}

// ─── Career Slots (Multi-Career) ───────────────────────────────────────────
// Profile gains a `careerSlots` array of up to 3 entries. Each entry points
// to a `profiles/{uid}/careers/{careerId}` doc. The active slot is the slot
// whose careerId matches profile.activeCareerId. Existing single-career
// users get migrated automatically on first read: we synthesize a slot1
// pointing at their current activeCareerId.

export const MAX_CAREER_SLOTS = 3;

/**
 * Read the user's career slots, migrating from the legacy single-career
 * shape if needed. Returns an array of length MAX_CAREER_SLOTS where each
 * entry is `{ slotId, careerId, lastPlayedAt }` - careerId may be null
 * for empty slots.
 */
export async function getCareerSlots(uid) {
  if (!uid) return defaultSlots();
  try {
    const profileSnap = await getDoc(doc(db, 'profiles', uid));
    if (!profileSnap.exists()) return defaultSlots();
    const data = profileSnap.data() || {};
    const slots = Array.isArray(data.careerSlots) ? data.careerSlots : null;
    if (slots && slots.length > 0) return normalizeSlots(slots);
    // Legacy migration: pre-multi-slot users have only `activeCareerId`.
    if (data.activeCareerId) {
      return [
        { slotId: 'slot1', careerId: data.activeCareerId, lastPlayedAt: Date.now() },
        { slotId: 'slot2', careerId: null, lastPlayedAt: null },
        { slotId: 'slot3', careerId: null, lastPlayedAt: null },
      ];
    }
    return defaultSlots();
  } catch {
    return defaultSlots();
  }
}

function defaultSlots() {
  return [
    { slotId: 'slot1', careerId: null, lastPlayedAt: null },
    { slotId: 'slot2', careerId: null, lastPlayedAt: null },
    { slotId: 'slot3', careerId: null, lastPlayedAt: null },
  ];
}

function normalizeSlots(slots) {
  const out = defaultSlots();
  for (let i = 0; i < Math.min(slots.length, MAX_CAREER_SLOTS); i++) {
    const s = slots[i] || {};
    out[i] = {
      slotId: s.slotId || `slot${i + 1}`,
      careerId: s.careerId || null,
      lastPlayedAt: s.lastPlayedAt || null,
    };
  }
  return out;
}

/**
 * Load the career object for a specific slot. Returns null if the slot is
 * empty or the doc is missing. Used by the slot picker to render summaries
 * and to switch active careers.
 */
export async function getCareerForSlot(uid, slot) {
  if (!uid || !slot?.careerId) return null;
  try {
    const snap = await getDoc(doc(db, 'profiles', uid, 'careers', slot.careerId));
    if (!snap.exists()) return null;
    return /** @type {any} */ ({ id: snap.id, ...snap.data() });
  } catch {
    return null;
  }
}

/**
 * Persist the slot list and update activeCareerId to point at the chosen
 * slot's career. Pass `careerId` of the slot you want active.
 */
export async function setActiveSlot(uid, slots, activeCareerId) {
  if (!uid) return;
  try {
    const { setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'profiles', uid), stripUndefined({
      careerSlots: slots,
      activeCareerId: activeCareerId || null,
      updated_date: serverTimestamp(),
    }), { merge: true });
  } catch (err) {
    console.warn('[career] setActiveSlot failed:', err?.message);
  }
}

/**
 * Free a slot - clears its careerId pointer (career doc is preserved in
 * the subcollection in case you want to add a "restore" feature later).
 * If the freed slot was active, activeCareerId is also cleared.
 */
export async function clearSlot(uid, slotId) {
  if (!uid || !slotId) return;
  const slots = await getCareerSlots(uid);
  const target = slots.find(s => s.slotId === slotId);
  if (!target) return;
  const wasActive = !!target.careerId;
  const cleared = slots.map(s =>
    s.slotId === slotId
      ? { slotId: s.slotId, careerId: null, lastPlayedAt: null }
      : s
  );
  // Pick the next-most-recent filled slot to be active if the freed slot was.
  let nextActive = null;
  if (wasActive) {
    const candidates = cleared.filter(s => !!s.careerId).sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0));
    nextActive = candidates[0]?.careerId || null;
  } else {
    // Preserve current active.
    try {
      const profileSnap = await getDoc(doc(db, 'profiles', uid));
      nextActive = profileSnap.exists() ? (profileSnap.data()?.activeCareerId || null) : null;
    } catch { /* offline */ }
  }
  await setActiveSlot(uid, cleared, nextActive);
}

/**
 * Permanently delete a career: removes the Firestore career doc, frees any
 * slot that pointed at it, wipes the tournament resume snapshot, and clears
 * the localStorage mirror if it was the active career. The Hall of Fame
 * thumbnail (if previously archived) is preserved by design.
 */
export async function deleteCareer(uid, careerId) {
  if (!uid || !careerId) return;
  // Step 1: free any slot pointer (also auto-promotes another slot to active
  // if the deleted career was the active one).
  try {
    const slots = await getCareerSlots(uid);
    const owning = slots.find(s => s.careerId === careerId);
    if (owning) await clearSlot(uid, owning.slotId);
  } catch (err) {
    console.warn('[deleteCareer] clearSlot failed:', err?.message);
  }
  // Step 2: wipe tournament snapshot (best-effort).
  clearCareerTournament(uid, careerId);
  // Step 3: wipe localStorage mirror if it matches this career.
  try {
    const mirror = loadLocalCareer(uid);
    if (mirror?.id === careerId) clearLocalCareer(uid);
  } catch { /* noop */ }
  // Step 4: delete the career doc itself.
  try {
    await deleteDoc(doc(db, 'profiles', uid, 'careers', careerId));
  } catch (err) {
    console.warn('[deleteCareer] career doc delete failed:', err?.message);
    throw err;
  }
}

/**
 * Scan the careers subcollection for docs that are NOT pointed at by any
 * slot. These are orphaned careers - either retired ones whose slot was
 * cleared, or careers from before multi-slot support landed and which got
 * stranded by the old destructive "Start New Career" flow.
 */
export async function getOrphanedCareers(uid) {
  if (!uid) return [];
  try {
    const slots = await getCareerSlots(uid);
    const slottedIds = new Set(slots.map(s => s.careerId).filter(Boolean));
    const careersRef = collection(db, 'profiles', uid, 'careers');
    const allDocs = await getDocs(careersRef);
    return allDocs.docs
      .map(d => /** @type {any} */ ({ id: d.id, ...d.data() }))
      .filter(c => !slottedIds.has(c.id))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (err) {
    console.warn('[career] getOrphanedCareers failed:', err?.message);
    return [];
  }
}

/**
 * Re-attach an orphaned career to a slot. The slot must currently be empty
 * (we don't overwrite a filled slot - the picker hides the restore link
 * when all 3 are full). Sets the restored career as active.
 */
export async function restoreCareerToSlot(uid, careerId, slotId) {
  if (!uid || !careerId || !slotId) return null;
  const slots = await getCareerSlots(uid);
  const target = slots.find(s => s.slotId === slotId);
  if (!target || target.careerId) return null;
  const updated = slots.map(s =>
    s.slotId === slotId
      ? { slotId: s.slotId, careerId, lastPlayedAt: Date.now() }
      : s
  );
  await setActiveSlot(uid, updated, careerId);
  return updated;
}

// ─── Career Tournament Snapshots (Resume) ──────────────────────────────────
// Persists in-progress career tournaments so a force-close mid-bracket
// returns the player to where they were instead of restarting the whole
// tournament. Save-scum guard: the entire tournament state (including
// per-match RNG seeds) is frozen at bracket creation, so retrying a match
// after a force-close gives you the same matchup, same hand, same opponent.

const TOURNAMENT_LOCAL_KEY = (uid, careerId) =>
  `matgrind.career.${uid}.tournament.${careerId}`;

const TOURNAMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Save a tournament snapshot keyed by career id. Mirrors to localStorage
 * for offline + fast resume. Cloud write is best-effort.
 */
export async function saveCareerTournament(uid, careerId, snapshot) {
  if (!uid || !careerId || !snapshot) return;
  const payload = stripUndefined({ ...snapshot, savedAt: Date.now() });
  try {
    localStorage.setItem(TOURNAMENT_LOCAL_KEY(uid, careerId), JSON.stringify(payload));
  } catch { /* quota */ }
  try {
    const { setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'profiles', uid, 'careers', careerId, 'private', 'tournament'), payload);
  } catch (err) {
    console.warn('[career] tournament save failed:', err?.message);
  }
}

/**
 * Load any in-progress tournament snapshot for the given career. Returns
 * null when there isn't one or when the snapshot has expired (>30 days).
 *
 * 2026-05-01: hardened to discard malformed snapshots that would otherwise
 * route the user onto the tournament/bracket screen with empty state and
 * leave them stuck on a loading screen. A snapshot must have a non-empty
 * bracket array, a numeric matchIdx, and a string careerEventId to be
 * considered resumable. Anything missing those fields is cleared from
 * both local mirror and cloud and treated as "no snapshot".
 */
export async function loadCareerTournament(uid, careerId) {
  if (!uid || !careerId) return null;
  let snapshot = null;
  try {
    const raw = localStorage.getItem(TOURNAMENT_LOCAL_KEY(uid, careerId));
    if (raw) snapshot = JSON.parse(raw);
  } catch { /* corrupt */ }
  if (!snapshot) {
    try {
      const snap = await getDoc(doc(db, 'profiles', uid, 'careers', careerId, 'private', 'tournament'));
      if (snap.exists()) snapshot = snap.data();
    } catch { /* offline */ }
  }
  if (!snapshot) return null;
  if (Date.now() - (snapshot.savedAt || 0) > TOURNAMENT_TTL_MS) {
    // Stale - clear and skip.
    clearCareerTournament(uid, careerId);
    return null;
  }
  // Structural validation. A snapshot that lacks a real bracket can't be
  // meaningfully resumed - the TournamentBracket component would render
  // with empty state and the user would see a permanent loading screen.
  // Treat as if no snapshot existed, and proactively clear so the next
  // load doesn't hit the same trap.
  const looksValid = !!snapshot
    && Array.isArray(snapshot.bracket)
    && snapshot.bracket.length > 0
    && typeof snapshot.matchIdx === 'number'
    && typeof snapshot.careerEventId === 'string';
  if (!looksValid) {
    console.warn('[career] discarding malformed tournament snapshot', {
      careerId,
      keys: Object.keys(snapshot),
    });
    clearCareerTournament(uid, careerId);
    return null;
  }
  return snapshot;
}

export function clearCareerTournament(uid, careerId) {
  if (!uid || !careerId) return;
  try { localStorage.removeItem(TOURNAMENT_LOCAL_KEY(uid, careerId)); } catch { /* noop */ }
  // Cloud delete is best-effort; we don't await it.
  (async () => {
    try {
      const { deleteDoc: _del } = await import('firebase/firestore');
      await _del(doc(db, 'profiles', uid, 'careers', careerId, 'private', 'tournament'));
    } catch { /* offline */ }
  })();
}

/**
 * Archive a retired career: keeps the full career doc in place but adds a
 * thumbnail to `profile.careerHallOfFame[]` and clears `activeCareerId` so
 * the dashboard entry-point starts fresh next visit.
 */
export async function archiveCareer(uid, career, thumbnail) {
  if (!uid || !career?.id) throw new Error('archiveCareer: uid and career.id required');
  // Schema gate: archive also writes the full career doc, so mirror saveCareer's
  // guard. Refuse to flush corruption into the permanent retired snapshot.
  const validation = validateCareer(career);
  if (!validation.ok) {
    console.error('[archiveCareer] refusing to persist invalid career', validation.errors);
    throw Object.assign(new Error('CareerStateInvalid'), {
      code: 'CAREER_INVALID',
      errors: validation.errors,
    });
  }
  try {
    // Ensure the retired career is saved before archiving (in case caller
    // didn't persist the retired state).
    const { setDoc, arrayUnion } = await import('firebase/firestore');
    await setDoc(doc(db, 'profiles', uid, 'careers', career.id), stripUndefined({
      ...career,
      archivedAt: Date.now(),
    }));
    await updateDoc(doc(db, 'profiles', uid), {
      activeCareerId: null,
      careerHallOfFame: arrayUnion(stripUndefined(thumbnail)),
      updated_date: serverTimestamp(),
    });
    clearLocalCareer(uid);
  } catch (err) {
    toast({ title: 'Archive failed', description: 'Could not archive career. Try again.', variant: 'destructive' });
    throw err;
  }
}

/**
 * Load the user's Hall of Fame thumbnails. Thin wrapper so callers don't
 * need to know the field name. Returns [] when none exist.
 */
export async function getHallOfFame(uid) {
  if (!uid) return [];
  try {
    const profileSnap = await getDoc(doc(db, 'profiles', uid));
    if (!profileSnap.exists()) return [];
    const hof = profileSnap.data()?.careerHallOfFame;
    return Array.isArray(hof) ? hof : [];
  } catch {
    return [];
  }
}


/**
 * Reset a wrestler's stats to base_stats and refund all spent points.
 * Limited: 3 respecs per wrestler lifetime.
 */
export async function respecStats(uid) {
  const docRef = doc(db, 'profiles', uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error('Profile not found');
  const data = snap.data();

  const MAX_RESPECS = 3;
  const used = data.respecs_used || 0;
  if (used >= MAX_RESPECS) throw new Error('No respecs remaining');

  const baseStats = data.base_stats || { ...DEFAULT_STATS };
  const level = data.level || 1;
  const pointsToRefund = level - 1; // 1 point per level gained

  await updateDoc(docRef, {
    stats: { ...baseStats },
    stat_points_available: pointsToRefund,
    respecs_used: used + 1,
    updated_date: serverTimestamp(),
  });

  const updated = await getDoc(docRef);
  return { id: updated.id, ...updated.data() };
}

/**
 * Batch-fetch profiles for a list of UIDs. Used by the Friends leaderboard.
 *
 * Firestore's `in` operator caps at 10 values per query, so we chunk and
 * fire the chunks in parallel. Missing UIDs are silently skipped.
 */
export async function getProfilesByUids(uids) {
  if (!Array.isArray(uids) || uids.length === 0) return [];
  const unique = Array.from(new Set(uids.filter(Boolean)));
  const CHUNK = 10;
  const chunks = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    chunks.push(unique.slice(i, i + CHUNK));
  }
  const snaps = await Promise.all(
    chunks.map(c => getDocs(query(profilesRef, where(documentId(), 'in', c))))
  );
  const out = [];
  for (const snap of snaps) {
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
  }
  return out;
}

/**
 * Prefix-search profiles by username. Trims, lowercases the prefix and runs a
 * Firestore range query against the `username_lc` field (must be set on save).
 * Falls back to a simple exact-match against `username` if `username_lc` is
 * absent on older profiles - a one-time backfill on next save will populate
 * it for them. Excludes the requesting user so they don't self-match.
 *
 * @param {string} prefix - what the user typed; min 2 chars or returns []
 * @param {string} excludeUid - viewer's own uid, filtered out of results
 * @param {number} [max] - cap on results (default 20)
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function searchUsersByUsername(prefix, excludeUid, max = 20) {
  const term = String(prefix || '').trim().toLowerCase();
  if (term.length < 2) return [];
  // Firestore prefix-search idiom: the half-open range [term, term+SENTINEL)
  // matches values starting with `term`. SENTINEL = U+F8FF (PUA, sorts above
  // any normal username char). Defined inline so editors don't strip it.
  const end = term + '';

  // Helper: reject the requesting user + privacy-locked profiles.
  const acceptable = (id, data) => {
    if (id === excludeUid) return false;
    if (data?.profile_visibility === 'friends_only') return false;
    return true;
  };

  // Pass 1 - indexed prefix scan via username_lc. Fast, cheap, exact.
  const out = [];
  const seen = new Set();
  try {
    const snap = await getDocs(query(
      profilesRef,
      where('username_lc', '>=', term),
      where('username_lc', '<', end),
      orderBy('username_lc'),
      limit(max),
    ));
    snap.forEach(d => {
      if (seen.has(d.id)) return;
      const data = d.data();
      if (!acceptable(d.id, data)) return;
      seen.add(d.id);
      out.push({ id: d.id, ...data });
    });
  } catch (err) {
    // Surfaces in dev when the username_lc index hasn't been built yet.
    // Fall through - the substring pass below still returns useful results.
    console.warn('[searchUsersByUsername] indexed query failed:', err?.message);
  }

  // Pass 2 - fuzzy substring fallback. Triggers when the indexed pass is
  // sparse (most users still lack `username_lc`, or the user typed a non-
  // prefix substring like "oey" -> "Joey"). Pulls a bounded recent window
  // and filters client-side. Cost: at most one ~50-doc read per search,
  // and only when the prefix pass didn't already return enough hits.
  if (out.length < 5) {
    try {
      const snap = await getDocs(query(
        profilesRef,
        orderBy('updated_date', 'desc'),
        limit(50),
      ));
      snap.forEach(d => {
        if (out.length >= max) return;
        if (seen.has(d.id)) return;
        const data = d.data();
        if (!acceptable(d.id, data)) return;
        const name = typeof data?.username === 'string' ? data.username.toLowerCase() : '';
        if (!name.includes(term)) return;
        seen.add(d.id);
        out.push({ id: d.id, ...data });
      });
    } catch (err) {
      console.warn('[searchUsersByUsername] fallback scan failed:', err?.message);
    }
  }

  return out.slice(0, max);
}

// ─── Match History ───────────────────────────────────────────────────────────

/**
 * Save a match result for a user.
 */
export async function createMatch(uid, matchData) {
  try {
    const docRef = await addDoc(collection(db, 'matches'), {
      uid,
      ...matchData,
      created_date: serverTimestamp(),
    });
    return { id: docRef.id, uid, ...matchData };
  } catch (err) {
    toast({ title: 'Match not saved', description: 'Could not save match result.', variant: 'destructive' });
    throw err;
  }
}

/**
 * Get recent match history for a user, ordered by most recent first.
 */
export async function getMatchHistory(uid, maxResults = 30) {
  const q = query(
    collection(db, 'matches'),
    where('uid', '==', uid),
    orderBy('created_date', 'desc'),
    limit(maxResults),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Delete a single match record.
 */
export async function deleteMatch(matchId) {
  await deleteDoc(doc(db, 'matches', matchId));
}
