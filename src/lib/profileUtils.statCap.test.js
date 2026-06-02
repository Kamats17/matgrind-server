import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getStatCap,
  BASE_STAT_CAP,
  ABS_STAT_CEILING,
  STAT_CAP_LEVEL_THRESHOLD,
  STAT_CAP_LEVELS_PER_POINT,
  getTitleForLevel,
} from './profileUtils.js';

// ─── getStatCap ────────────────────────────────────────────────────────────

test('getStatCap: base value at level 1', () => {
  assert.equal(getStatCap(1), BASE_STAT_CAP);
});

test('getStatCap: still base at threshold (level 100)', () => {
  assert.equal(getStatCap(STAT_CAP_LEVEL_THRESHOLD), BASE_STAT_CAP);
});

test('getStatCap: still base for partial-stride past threshold', () => {
  // Rate is STAT_CAP_LEVELS_PER_POINT levels per +1 cap. Anything before
  // a full stride past the threshold must still return the base cap.
  assert.equal(getStatCap(STAT_CAP_LEVEL_THRESHOLD + 1), BASE_STAT_CAP);
  assert.equal(getStatCap(STAT_CAP_LEVEL_THRESHOLD + STAT_CAP_LEVELS_PER_POINT - 1), BASE_STAT_CAP);
});

test('getStatCap: +1 at level threshold + STAT_CAP_LEVELS_PER_POINT', () => {
  assert.equal(getStatCap(STAT_CAP_LEVEL_THRESHOLD + STAT_CAP_LEVELS_PER_POINT), BASE_STAT_CAP + 1);
});

test('getStatCap: +1 per STAT_CAP_LEVELS_PER_POINT levels', () => {
  for (let i = 1; i <= 14; i++) {
    const lvl = STAT_CAP_LEVEL_THRESHOLD + i * STAT_CAP_LEVELS_PER_POINT;
    assert.equal(getStatCap(lvl), BASE_STAT_CAP + i, `level ${lvl} should give cap ${BASE_STAT_CAP + i}`);
  }
});

test('getStatCap: clamps at ABS_STAT_CEILING', () => {
  // (ABS_STAT_CEILING - BASE_STAT_CAP) raises needed = 14 raises.
  // Saturation level = THRESHOLD + 14 * LEVELS_PER_POINT.
  const saturationLevel = STAT_CAP_LEVEL_THRESHOLD
    + (ABS_STAT_CEILING - BASE_STAT_CAP) * STAT_CAP_LEVELS_PER_POINT;
  assert.equal(getStatCap(saturationLevel), ABS_STAT_CEILING);
  assert.equal(getStatCap(saturationLevel + 1), ABS_STAT_CEILING);
  assert.equal(getStatCap(saturationLevel + 100), ABS_STAT_CEILING);
  assert.equal(getStatCap(99999), ABS_STAT_CEILING);
});

test('getStatCap: defensive on bad input', () => {
  assert.equal(getStatCap(0), BASE_STAT_CAP);
  assert.equal(getStatCap(-5), BASE_STAT_CAP);
  assert.equal(getStatCap(null), BASE_STAT_CAP);
  assert.equal(getStatCap(undefined), BASE_STAT_CAP);
  assert.equal(getStatCap(NaN), BASE_STAT_CAP);
  assert.equal(getStatCap('not a number'), BASE_STAT_CAP);
});

// ─── getTitleForLevel: prestige titles past 100 ───────────────────────────

test('getTitleForLevel: GOAT at exactly 100', () => {
  assert.equal(getTitleForLevel(100), 'GOAT');
});

test('getTitleForLevel: still GOAT just past 100', () => {
  assert.equal(getTitleForLevel(149), 'GOAT');
});

test('getTitleForLevel: Hall of Fame at 150', () => {
  assert.equal(getTitleForLevel(150), 'Hall of Fame');
});

test('getTitleForLevel: still Hall of Fame at 249', () => {
  assert.equal(getTitleForLevel(249), 'Hall of Fame');
});

test('getTitleForLevel: Living Legend at 250', () => {
  assert.equal(getTitleForLevel(250), 'Living Legend');
});

test('getTitleForLevel: Living Legend holds for absurd levels', () => {
  assert.equal(getTitleForLevel(9999), 'Living Legend');
  assert.equal(getTitleForLevel(1_000_000), 'Living Legend');
});
