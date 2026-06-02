// Regression tests for filler-opponent name de-duplication.
//
// Bug: generateFillerOpponent called generateEventNames with no `used` and no
// `reserved` set, so filler opponents in one season could duplicate each other
// or reproduce a rival / special-NPC name. The fix threads both Sets through
// without disturbing the season rng stream.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { generateFillerOpponent } from './careerRivals.js';
import { generateHSSeason, generateCollegeSeason } from './careerSchedule.js';
import { MENS_FIRST_NAMES, MENS_LAST_NAMES } from '../namePools.js';

// Seedable PRNG so a name draw is reproducible across two calls.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// With rng() === 0 every generateEventNames draw picks index 0, so the first
// (un-deduped) candidate is always firsts[0] + lasts[0].
const ZERO_RNG_NAME = `${MENS_FIRST_NAMES[0]} ${MENS_LAST_NAMES[0]}`;

const FILLER_ARGS = { weightClass: 138, tier: 'hs', style: 'folkstyle', gender: 'male' };

function stubRivals(weightClass, names) {
  return names.map((name, i) => ({
    id: `rival_${i}`,
    name,
    school: 'Test Prep',
    weightClass,
    tier: 'hs',
    style: 'folkstyle',
    stats: { str: 70, spd: 70, tec: 70, end: 70, grt: 70 },
    overall: 70,
  }));
}

describe('generateFillerOpponent - name de-duplication', () => {
  test('A: honors `used` - never returns a name already taken', () => {
    // Same seed -> same rng stream -> the un-deduped candidate is identical.
    const first = generateFillerOpponent({ ...FILLER_ARGS, rng: makeRng(12345) }).name;
    const second = generateFillerOpponent({
      ...FILLER_ARGS, rng: makeRng(12345), used: new Set([first]),
    }).name;
    assert.notEqual(second, first,
      '`used` name leaked through - generateFillerOpponent ignored the dedup set');
  });

  test('A2: honors `reserved` - never returns a reserved name', () => {
    const first = generateFillerOpponent({ ...FILLER_ARGS, rng: makeRng(777) }).name;
    const second = generateFillerOpponent({
      ...FILLER_ARGS, rng: makeRng(777), reserved: new Set([first]),
    }).name;
    assert.notEqual(second, first, '`reserved` name leaked through');
  });

  test('B: no collision -> fix changes nothing (opponent identical)', () => {
    const plain = generateFillerOpponent({ ...FILLER_ARGS, rng: makeRng(42) });
    // Pre-seed used/reserved with names that are NOT the produced one.
    const guarded = generateFillerOpponent({
      ...FILLER_ARGS, rng: makeRng(42),
      used: new Set(['Zzz Notaname']), reserved: new Set(['Qqq Notaname']),
    });
    assert.equal(guarded.name, plain.name, 'name shifted despite no collision');
    assert.deepEqual(guarded.stats, plain.stats, 'stats shifted - season rng disturbed');
    assert.equal(guarded.school, plain.school, 'school shifted - season rng disturbed');
  });
});

describe('season builders - filler opponents are de-collided', () => {
  // rng=()=>0 forces every filler to draw the same candidate name, so a season
  // without dedup produces all-duplicate fillers. The fix must de-collide them.
  for (const [label, build] of [
    ['HS', (rivals) => generateHSSeason({
      seasonYear: 1, year: 1, weightClass: 145, gender: 'male', rivals, rng: () => 0,
    })],
    ['college', (rivals) => generateCollegeSeason({
      seasonYear: 1, year: 1, weightClass: 157, gender: 'male', rivals, rng: () => 0,
    })],
  ]) {
    test(`C: ${label} season has no duplicate or rival-named filler opponents`, () => {
      // One rival is deliberately named the zero-rng candidate, so a season
      // without `reserved` threading would hand a filler that exact rival name.
      const rivals = stubRivals(145, [ZERO_RNG_NAME, 'Marcus Delacroix']);
      const events = build(rivals);
      const fillerNames = events
        .filter(e => (e.type === 'dual_meet' || e.type === 'dual')
          && !e.opponentIsRival && e.opponent)
        .map(e => e.opponent.name);
      assert.ok(fillerNames.length >= 2, 'sanity: season has multiple filler duals');

      const unique = new Set(fillerNames);
      assert.equal(unique.size, fillerNames.length,
        `duplicate filler names in ${label} season: ${fillerNames.join(', ')}`);

      const rivalNames = new Set(rivals.map(r => r.name));
      for (const n of fillerNames) {
        assert.ok(!rivalNames.has(n), `filler reused a rival name: ${n}`);
      }
    });
  }
});
