import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTournamentSnapshotResumable } from './tournamentResume.js';

// Minimal career fixture builder. Only the fields the predicate reads.
function makeCareer({ phase = 'in_season', events = [] } = {}) {
  return {
    phase,
    schedule: { events },
  };
}

function makeSnapshot(overrides = {}) {
  return {
    careerEventId: 'event_state_tourney',
    phase: 'r1',
    playerEliminated: false,
    ...overrides,
  };
}

const upcomingTournamentEvent = {
  id: 'event_state_tourney',
  type: 'tournament',
  status: 'upcoming',
};

test('returns false when snapshot is null/undefined', () => {
  assert.equal(isTournamentSnapshotResumable(makeCareer(), null), false);
  assert.equal(isTournamentSnapshotResumable(makeCareer(), undefined), false);
});

test('returns false when snapshot.phase is complete', () => {
  const career = makeCareer({ events: [upcomingTournamentEvent] });
  const snap = makeSnapshot({ phase: 'complete' });
  assert.equal(isTournamentSnapshotResumable(career, snap), false);
});

test('returns false when snapshot.playerEliminated is true', () => {
  const career = makeCareer({ events: [upcomingTournamentEvent] });
  const snap = makeSnapshot({ playerEliminated: true });
  assert.equal(isTournamentSnapshotResumable(career, snap), false);
});

test('returns false when event is no longer upcoming (orphaned)', () => {
  const career = makeCareer({
    events: [{ ...upcomingTournamentEvent, status: 'completed' }],
  });
  const snap = makeSnapshot();
  assert.equal(isTournamentSnapshotResumable(career, snap), false);
});

test('returns false when event is not in the schedule at all', () => {
  const career = makeCareer({ events: [] });
  const snap = makeSnapshot();
  assert.equal(isTournamentSnapshotResumable(career, snap), false);
});

test('returns true when phase=in_season and event is upcoming', () => {
  const career = makeCareer({ phase: 'in_season', events: [upcomingTournamentEvent] });
  const snap = makeSnapshot();
  assert.equal(isTournamentSnapshotResumable(career, snap), true);
});

// REGRESSION (Mason 2026-05-04 + anonymous web user 2026-05-05):
// Career repair reset phase to 'preseason' but left the tournament snapshot
// in localStorage/Firestore. The orphan check returned true (event still
// upcoming) so the snapshot loaded into TournamentBracket and crashed on
// `nextMatch.opponent.name`. The predicate must reject any snapshot when
// the career phase is anything other than 'in_season'.
test('REGRESSION: returns false when phase=preseason even if event is upcoming', () => {
  const career = makeCareer({ phase: 'preseason', events: [upcomingTournamentEvent] });
  const snap = makeSnapshot();
  assert.equal(isTournamentSnapshotResumable(career, snap), false,
    'preseason career must not resume a tournament snapshot');
});

test('REGRESSION: returns false when phase=offseason even if event is upcoming', () => {
  const career = makeCareer({ phase: 'offseason', events: [upcomingTournamentEvent] });
  const snap = makeSnapshot();
  assert.equal(isTournamentSnapshotResumable(career, snap), false);
});

test('REGRESSION: returns false when phase=recruiting even if event is upcoming', () => {
  const career = makeCareer({ phase: 'recruiting', events: [upcomingTournamentEvent] });
  const snap = makeSnapshot();
  assert.equal(isTournamentSnapshotResumable(career, snap), false);
});

test('REGRESSION: returns false when phase=tier_transition even if event is upcoming', () => {
  const career = makeCareer({ phase: 'tier_transition', events: [upcomingTournamentEvent] });
  const snap = makeSnapshot();
  assert.equal(isTournamentSnapshotResumable(career, snap), false);
});

test('REGRESSION: returns false when phase=retired even if event is upcoming', () => {
  const career = makeCareer({ phase: 'retired', events: [upcomingTournamentEvent] });
  const snap = makeSnapshot();
  assert.equal(isTournamentSnapshotResumable(career, snap), false);
});
