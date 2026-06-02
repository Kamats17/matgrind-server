// Regression guard for the toast number on path-mechanic rounds.
// The failure mode this catches: someone reverts the JSX in
// WrestlingGame.jsx to render `+SKILL_TIERS.GOOD.bonus` instead of
// `+lastResult.p1SkillBonusApplied`. On a spam-reduced round the engine
// applies +3 or +0 power but the UI would still display "+6" - silent
// lying.
// Run with: node --test src/lib/pathTraceLabel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatPathTraceLabel } from './pathTraceLabel.js';

test('PERFECT full bonus renders Trace +10', () => {
  assert.equal(formatPathTraceLabel('PERFECT', 10), 'Trace +10');
});

test('GOOD full bonus (rounds 1-3) renders Trace +6', () => {
  assert.equal(formatPathTraceLabel('GOOD', 6), 'Trace +6');
});

test('GOOD half bonus (4th consecutive transition) renders Trace +3', () => {
  assert.equal(formatPathTraceLabel('GOOD', 3), 'Trace +3');
});

test('GOOD zero bonus (5th consecutive transition) renders Trace +0', () => {
  assert.equal(formatPathTraceLabel('GOOD', 0), 'Trace +0');
});

test('PERFECT half bonus renders Trace +5', () => {
  assert.equal(formatPathTraceLabel('PERFECT', 5), 'Trace +5');
});

test('MISS returns null (no toast)', () => {
  assert.equal(formatPathTraceLabel('MISS', 0), null);
});

test('Unknown tier returns null', () => {
  assert.equal(formatPathTraceLabel('foo', 6), null);
});

test('Non-numeric bonus rounds to 0', () => {
  assert.equal(formatPathTraceLabel('GOOD', undefined), 'Trace +0');
  assert.equal(formatPathTraceLabel('GOOD', NaN), 'Trace +0');
  assert.equal(formatPathTraceLabel('GOOD', null), 'Trace +0');
});

test('Fractional bonus is rounded', () => {
  assert.equal(formatPathTraceLabel('GOOD', 5.6), 'Trace +6');
  assert.equal(formatPathTraceLabel('GOOD', 5.4), 'Trace +5');
});
