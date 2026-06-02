// ─── Career Dual Meet - Resume Detection ────────────────────────────────────
// Mirrors `tournamentResume.js` for career-mode dual meets. Determines
// whether a persisted dual snapshot can safely be picked back up at app
// load, or whether it should be dropped because the player's career has
// moved past the event (or never had it).
//
// Five guards. Drop the snapshot if any fail:
//   1. snapshot exists and `dual.phase !== 'complete'`
//   2. `career.phase === 'in_season'`
//   3. `dual.careerEventId` still maps to an `upcoming` event in
//      `career.schedule.events` (catches "user advanced the season then
//      reopened the app" and "snapshot from a different career slot")
//   4. `dual.heroWeightClass` exists in `dual.weights` (corrupt snapshot)
//   5. `dual.heroWeightClass` matches the event's expected weight (catches
//      debug/manual weight edits between save and resume). v9: the expected
//      weight is the EVENT's weightClass (per-style for senior duals),
//      falling back to wrestler.weights[style] then wrestler.weightClass
//      for legacy snapshots that pre-date the per-style stamp.

/**
 * @param {object|null} career
 * @param {object|null} dual
 * @returns {boolean} true if the snapshot can be resumed
 */
export function isCareerDualMeetSnapshotResumable(career, dual) {
  if (!dual || typeof dual !== 'object') return false;
  if (dual.phase === 'complete') return false;
  if (!career || typeof career !== 'object') return false;
  if (career.phase !== 'in_season') return false;

  if (!dual.careerEventId) return false;
  if (!Array.isArray(career.schedule?.events)) return false;
  const evt = career.schedule.events.find(e => e?.id === dual.careerEventId);
  if (!evt) return false;
  if (evt.status !== 'upcoming') return false;

  if (!Array.isArray(dual.weights) || dual.weights.length === 0) return false;
  if (!dual.weights.includes(dual.heroWeightClass)) return false;
  // v9: expected weight = event's per-style weightClass first. Per-style
  // wrestler.weights[style] second. wrestler.weightClass last (legacy).
  // A snapshot whose heroWeightClass matches ANY of these is resumable.
  const eventStyle = evt.style || career.wrestler?.style;
  const perStyleWeight = (eventStyle && career.wrestler?.weights
                          && Number.isFinite(career.wrestler.weights[eventStyle]))
    ? career.wrestler.weights[eventStyle]
    : null;
  const expected = [
    evt.weightClass,
    perStyleWeight,
    career.wrestler?.weightClass,
  ].filter(w => Number.isFinite(w));
  if (expected.length > 0 && !expected.includes(dual.heroWeightClass)) return false;

  return true;
}
