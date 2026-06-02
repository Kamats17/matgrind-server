import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  xpForLevel,
  computeCareerLevel,
  xpForEventResult,
  seasonCompletionXp,
  applyXpToWrestler,
  MAX_CAREER_LEVEL,
  XP_CONSTANTS,
} from './careerLeveling.js';

describe('careerLeveling - curve', () => {
  test('level 1 requires 0 xp', () => {
    assert.equal(xpForLevel(1), 0);
  });

  test('xpForLevel is strictly monotonic', () => {
    let prev = -1;
    for (let lvl = 1; lvl <= 100; lvl++) {
      const cur = xpForLevel(lvl);
      assert.ok(cur > prev, `level ${lvl} xp (${cur}) should exceed ${prev}`);
      prev = cur;
    }
  });

  test('known curve anchors match design doc', () => {
    // Triangular: 100 * N * (N+1) / 2 - 100
    assert.equal(xpForLevel(2), 200);   // 100 * 3 - 100
    assert.equal(xpForLevel(5), 1400);  // 100 * 15 - 100
    assert.equal(xpForLevel(10), 5400); // 100 * 55 - 100
  });
});

describe('careerLeveling - computeCareerLevel', () => {
  test('0 xp → level 1, 0 into, full next', () => {
    const res = computeCareerLevel(0);
    assert.equal(res.level, 1);
    assert.equal(res.xpIntoLevel, 0);
    assert.ok(res.xpForNext > 0);
  });

  test('negative / null xp → level 1', () => {
    assert.equal(computeCareerLevel(-100).level, 1);
    assert.equal(computeCareerLevel(null).level, 1);
  });

  test('exact threshold crosses level', () => {
    const threshold = xpForLevel(5);
    assert.equal(computeCareerLevel(threshold).level, 5);
    assert.equal(computeCareerLevel(threshold - 1).level, 4);
  });

  test('no longer caps at MAX_CAREER_LEVEL (cap removed 2026-05-06)', () => {
    // Past the old cap of 99, computeCareerLevel must keep climbing.
    const xpAtLevel150 = xpForLevel(150);
    assert.equal(computeCareerLevel(xpAtLevel150).level, 150);
    assert.ok(150 > MAX_CAREER_LEVEL, 'precondition: 150 is past the legacy cap');
  });

  test('absurd XP resolves to a finite, sensible level (no infinite loop, no NaN)', () => {
    // 1 billion XP. Triangular curve: level ~ sqrt(2 * xp / coeff).
    const result = computeCareerLevel(1_000_000_000);
    assert.ok(Number.isFinite(result.level), 'level must be finite');
    assert.ok(result.level > 1000, `expected level > 1000 for 1B XP, got ${result.level}`);
    assert.ok(result.level < 100000, `expected level < 100000 for 1B XP, got ${result.level}`);
    assert.ok(Number.isFinite(result.xpIntoLevel));
    assert.ok(Number.isFinite(result.xpForNext));
  });
});

describe('careerLeveling - xpForEventResult', () => {
  test('dual win grants 80 base', () => {
    assert.equal(xpForEventResult({ playerWon: true, winMethod: 'decision' }), 80);
  });

  test('dual loss grants 30 base', () => {
    assert.equal(xpForEventResult({ playerWon: false }), 30);
  });

  test('pin win stacks the pin bonus on top of base', () => {
    assert.equal(xpForEventResult({ playerWon: true, winMethod: 'pin' }), 120);
  });

  test('tech and major bonuses are additive', () => {
    assert.equal(xpForEventResult({ playerWon: true, winMethod: 'tech' }), 105);
    assert.equal(xpForEventResult({ playerWon: true, winMethod: 'major' }), 95);
  });

  test('loss does not get win-method bonus even if method set', () => {
    // (defensive - callers shouldn't do this but we shouldn't reward it)
    assert.equal(xpForEventResult({ playerWon: false, winMethod: 'pin' }), 30);
  });

  test('tournament placement adds placement xp on top of final match', () => {
    // won the final → base 80, 1st placement 200 → 280
    const xp = xpForEventResult(
      { playerWon: true, winMethod: 'decision', placement: 1 },
      'tournament'
    );
    assert.equal(xp, 80 + 200);
  });

  test('championship win adds title bonus', () => {
    // championship title: 80 win + 200 placement + 300 title = 580
    const xp = xpForEventResult(
      { playerWon: true, winMethod: 'decision', placement: 1 },
      'championship'
    );
    assert.equal(xp, 80 + 200 + 300);
  });

  test('placement outside top-4 still grants participation xp', () => {
    const xp = xpForEventResult({ playerWon: false, placement: 7 }, 'tournament');
    assert.equal(xp, 30 + XP_CONSTANTS.PLACEMENT_PARTICIPATION_XP);
  });

  test('season completion is a flat constant', () => {
    assert.equal(seasonCompletionXp(), 150);
  });
});

describe('careerLeveling - applyXpToWrestler', () => {
  const baseWrestler = {
    xp: 0,
    level: 1,
    skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
  };

  test('below-threshold xp keeps level and grants no point', () => {
    const out = applyXpToWrestler(baseWrestler, 100);
    assert.equal(out.wrestler.xp, 100);
    assert.equal(out.wrestler.level, 1);
    assert.equal(out.leveledUp, false);
    assert.equal(out.skillPointsGained, 0);
    assert.equal(out.wrestler.skillTree.pointsAvailable, 0);
  });

  test('crossing L2 grants 1 skill point', () => {
    const out = applyXpToWrestler(baseWrestler, 200);
    assert.equal(out.wrestler.level, 2);
    assert.equal(out.leveledUp, true);
    assert.equal(out.skillPointsGained, 1);
    assert.equal(out.wrestler.skillTree.pointsAvailable, 1);
  });

  test('multi-level jump grants one point per level', () => {
    // Enough to jump to L5 from 0
    const out = applyXpToWrestler(baseWrestler, xpForLevel(5));
    assert.equal(out.wrestler.level, 5);
    assert.equal(out.skillPointsGained, 4);
    assert.equal(out.wrestler.skillTree.pointsAvailable, 4);
  });

  test('does not mutate input wrestler', () => {
    const before = JSON.parse(JSON.stringify(baseWrestler));
    applyXpToWrestler(baseWrestler, 5000);
    assert.deepEqual(baseWrestler, before);
  });

  test('preserves unrelated wrestler fields', () => {
    const w = {
      ...baseWrestler,
      name: 'Test',
      stats: { str: 70 },
    };
    const out = applyXpToWrestler(w, 300);
    assert.equal(out.wrestler.name, 'Test');
    assert.deepEqual(out.wrestler.stats, { str: 70 });
  });

  test('handles missing skillTree defensively', () => {
    const w = { xp: 0, level: 1 };
    const out = applyXpToWrestler(w, 250);
    assert.equal(out.wrestler.skillTree.pointsAvailable, 1);
  });

  test('negative xp is clamped to zero gain', () => {
    const w = { ...baseWrestler, xp: 100, level: 1 };
    const out = applyXpToWrestler(w, -1000);
    // We don't subtract from existing xp below zero, but neither do we
    // level down. Negative-gain just clamps the gain, not the total.
    assert.ok(out.wrestler.xp >= 0);
    assert.ok(out.wrestler.level >= 1);
  });
});
