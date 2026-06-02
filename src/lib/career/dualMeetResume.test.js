// dualMeetResume.test.js - Verifies the five guards on
// `isCareerDualMeetSnapshotResumable`. Each test fails ONE guard and asserts
// the predicate returns false; one test passes all guards and asserts true.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isCareerDualMeetSnapshotResumable } from './dualMeetResume.js';

function snapshotShape({
  phase = 'between',
  careerEventId = 'evt_y1_w1_0',
  weights = [125, 133, 141, 149, 157, 165, 174, 184, 197, 285],
  heroWeightClass = 157,
} = {}) {
  return {
    phase,
    careerEventId,
    weights,
    heroWeightClass,
    bouts: weights.map((w) => ({ weight: w, result: null })),
    currentBoutIndex: 0,
    teamScore: { player: 0, opponent: 0 },
  };
}

function careerShape({
  phase = 'in_season',
  weightClass = 157,
  events = [{ id: 'evt_y1_w1_0', status: 'upcoming' }],
} = {}) {
  return {
    id: 'career_test',
    phase,
    wrestler: { weightClass },
    schedule: { events },
  };
}

describe('isCareerDualMeetSnapshotResumable', () => {
  test('all five guards passing -> resumable', () => {
    const career = careerShape();
    const snap = snapshotShape();
    assert.equal(isCareerDualMeetSnapshotResumable(career, snap), true);
  });

  test('drops snapshot if dual.phase === complete', () => {
    const career = careerShape();
    const snap = snapshotShape({ phase: 'complete' });
    assert.equal(isCareerDualMeetSnapshotResumable(career, snap), false);
  });

  test('drops snapshot if career.phase !== in_season', () => {
    const careerOff = careerShape({ phase: 'offseason' });
    const careerPre = careerShape({ phase: 'preseason' });
    const careerRetired = careerShape({ phase: 'retired' });
    const snap = snapshotShape();
    assert.equal(isCareerDualMeetSnapshotResumable(careerOff, snap), false);
    assert.equal(isCareerDualMeetSnapshotResumable(careerPre, snap), false);
    assert.equal(isCareerDualMeetSnapshotResumable(careerRetired, snap), false);
  });

  test('drops snapshot if careerEventId no longer maps to upcoming event', () => {
    // Event missing from schedule.
    const careerNoEvent = careerShape({ events: [{ id: 'evt_other', status: 'upcoming' }] });
    assert.equal(isCareerDualMeetSnapshotResumable(careerNoEvent, snapshotShape()), false);

    // Event present but already resolved (won / lost).
    const careerEventDone = careerShape({ events: [{ id: 'evt_y1_w1_0', status: 'won' }] });
    assert.equal(isCareerDualMeetSnapshotResumable(careerEventDone, snapshotShape()), false);
  });

  test('drops snapshot if dual.heroWeightClass not in dual.weights (corrupt)', () => {
    const career = careerShape({ weightClass: 999 });
    const snap = snapshotShape({ heroWeightClass: 999 }); // 999 not in weights array
    assert.equal(isCareerDualMeetSnapshotResumable(career, snap), false);
  });

  test('drops snapshot if dual.heroWeightClass !== career.wrestler.weightClass', () => {
    const career = careerShape({ weightClass: 165 });
    const snap = snapshotShape({ heroWeightClass: 157 }); // legal weight, but mismatch
    assert.equal(isCareerDualMeetSnapshotResumable(career, snap), false);
  });

  test('handles missing or malformed inputs without throwing', () => {
    assert.equal(isCareerDualMeetSnapshotResumable(null, null), false);
    assert.equal(isCareerDualMeetSnapshotResumable(careerShape(), null), false);
    assert.equal(isCareerDualMeetSnapshotResumable(null, snapshotShape()), false);
    assert.equal(isCareerDualMeetSnapshotResumable({}, {}), false);
  });
});
