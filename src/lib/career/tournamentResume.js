// Tournament Snapshot Resume Predicate
//
// Decides whether a persisted tournament snapshot (from localStorage or
// Firestore) should be resumed for the given career.
//
// A snapshot is resumable only when:
//   1. It exists and is not already complete or player-eliminated.
//   2. The career's phase is 'in_season'. A live tournament cannot exist
//      during preseason / offseason / recruiting / tier_transition / etc.
//      A career repaired back to preseason while a snapshot lingered would
//      otherwise resume into TournamentBracket and crash on stale bracket
//      data (regression: Mason 2026-05-04, anonymous web user 2026-05-05).
//   3. The snapshot's careerEventId still maps to an 'upcoming' event in
//      the schedule (an event that was pruned or already resolved means
//      the snapshot is orphaned).
//
// Returning false means the caller should clear the snapshot. Returning true
// means the snapshot can be applied with `setTournamentState(snap)` and the
// app can navigate to the tournament screen.

/**
 * @param {object|null|undefined} career   hydrated career
 * @param {object|null|undefined} snapshot tournament snapshot from loadCareerTournament
 * @returns {boolean} true if the snapshot should be resumed; false if it should be cleared
 */
export function isTournamentSnapshotResumable(career, snapshot) {
  if (!snapshot) return false;
  if (snapshot.phase === 'complete') return false;
  if (snapshot.playerEliminated) return false;
  // Phase guard: a live tournament can only exist during 'in_season'.
  if (career?.phase !== 'in_season') return false;
  // Event must still exist as 'upcoming' in the schedule.
  const events = career?.schedule?.events || [];
  return events.some(
    e => e?.id === snapshot.careerEventId && e?.status === 'upcoming'
  );
}
