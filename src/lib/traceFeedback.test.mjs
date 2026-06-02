// Render-gate contract for the trace-chip helper. If this regresses, the
// match HUD will silently stop showing trace feedback on successful traces.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldRenderTraceChip } from './traceFeedback.js';

test('returns false when lastResult is null/undefined', () => {
  assert.equal(shouldRenderTraceChip(null, 'p1'), false);
  assert.equal(shouldRenderTraceChip(undefined, 'p1'), false);
});

test('returns false for an invalid side argument', () => {
  const lr = { p1Mechanic: 'path', p1SkillTier: 'PERFECT' };
  assert.equal(shouldRenderTraceChip(lr, 'p3'), false);
  assert.equal(shouldRenderTraceChip(lr, ''), false);
  assert.equal(shouldRenderTraceChip(lr, null), false);
});

test('returns true for path mechanic + PERFECT tier on the named side', () => {
  const lr = { p1Mechanic: 'path', p1SkillTier: 'PERFECT', p1SkillBonusApplied: 10 };
  assert.equal(shouldRenderTraceChip(lr, 'p1'), true);
});

test('returns true for path mechanic + GOOD tier on the named side', () => {
  const lr = { p2Mechanic: 'path', p2SkillTier: 'GOOD', p2SkillBonusApplied: 6 };
  assert.equal(shouldRenderTraceChip(lr, 'p2'), true);
});

test('returns false for path mechanic but MISS tier (no chip on missed trace)', () => {
  const lr = { p1Mechanic: 'path', p1SkillTier: 'MISS', p1SkillBonusApplied: 0 };
  assert.equal(shouldRenderTraceChip(lr, 'p1'), false);
});

test('returns false when mechanic is not path even with PERFECT tier', () => {
  // A PERFECT charge or reaction belongs in the legacy "Perfect +4" chip,
  // not the trace chip. This guards against accidentally double-rendering.
  const lr = { p1Mechanic: 'charge', p1SkillTier: 'PERFECT' };
  assert.equal(shouldRenderTraceChip(lr, 'p1'), false);
});

test('returns false when the requested side has no mechanic stamped', () => {
  // p2 traced PERFECT; ask about p1. The answer is "no chip for p1".
  const lr = { p2Mechanic: 'path', p2SkillTier: 'PERFECT', p1SkillTier: 'MISS' };
  assert.equal(shouldRenderTraceChip(lr, 'p1'), false);
});

test('returns true for the trace side even when the opponent has nothing stamped', () => {
  // The render gate is per-side; the opponent's tier should not affect it.
  // This was the bug: an OR-coupled outer gate that hid a real trace
  // because the opponent's tier was MISS / undefined.
  const lr = { p1Mechanic: 'path', p1SkillTier: 'PERFECT', p1SkillBonusApplied: 10 };
  assert.equal(shouldRenderTraceChip(lr, 'p1'), true);
  assert.equal(shouldRenderTraceChip(lr, 'p2'), false);
});

test('returns false when tier is something exotic (defensive default)', () => {
  // If a future engine change introduces a new tier name, the gate stays
  // conservative - do not render until tests are added for the new tier.
  const lr = { p1Mechanic: 'path', p1SkillTier: 'ELITE' };
  assert.equal(shouldRenderTraceChip(lr, 'p1'), false);
});
