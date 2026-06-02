// Regression suite for the PATH trace feedback contract.
//
// Bug: after a successful trace (PERFECT/GOOD tier) the engine sometimes
// fails to stamp `lastResult.p1Mechanic` / `p1SkillTier` /
// `p1SkillBonusApplied`, so the UI chip never renders. `tagSkill` is the
// closure that writes those fields, and it lives inside resolveRound. The
// contract is: every reachable resolveRound exit must surface mechanic and
// tier on lastResult.
//
// Scope: resolveRound only. Pin-stage resolvers and other helper functions
// do NOT receive skill data and are out of scope by design.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createInitialMatchState, resolveRound } from './wrestlingEngine.js';
import { POSITIONS } from './wrestlingCards.js';
import { makeRng } from './seededRng.js';

// PERFECT trace from p1. Bonus 10 matches SKILL_TIERS.PERFECT.bonus.
const PERFECT_TRACE = { tier: 'PERFECT', bonus: 10, rngRange: 4 };
// MISS from p2 keeps the opponent from accidentally satisfying the gate.
const MISS_SKILL    = { tier: 'MISS',    bonus: 0,  rngRange: 3 };

// spiral_ride is a `category: 'transition'` (PATH mechanic) card available
// in all three styles, played from POSITIONS.TOP. Pair with stand_up which
// is a bottom escape card available in all three styles.
const TRANSITION_CARD = 'spiral_ride';
const OPPONENT_CARD   = 'stand_up';

function topBottomState(style = 'folkstyle', overrides = {}) {
  const s = createInitialMatchState('Trace P1', 'Other P2', style, null, null, 'medium', 'p1');
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  return { ...s, ...overrides };
}

function assertMechanicSurvives(s2, where) {
  assert.equal(
    s2.lastResult?.p1Mechanic, 'path',
    `[${where}] lastResult.p1Mechanic should be 'path' but was ${s2.lastResult?.p1Mechanic}`,
  );
  assert.equal(
    s2.lastResult?.p1SkillTier, 'PERFECT',
    `[${where}] lastResult.p1SkillTier should be 'PERFECT' but was ${s2.lastResult?.p1SkillTier}`,
  );
  assert.ok(
    Number.isFinite(s2.lastResult?.p1SkillBonusApplied),
    `[${where}] lastResult.p1SkillBonusApplied should be a finite number but was ${s2.lastResult?.p1SkillBonusApplied}`,
  );
}

// ─── Core: normal control exit ──────────────────────────────────────────────

test('PERFECT trace stamps mechanic/tier on the normal control exit', () => {
  const s1 = topBottomState();
  const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, PERFECT_TRACE, MISS_SKILL, makeRng(0xC0FFEE));
  assertMechanicSurvives(s2, 'normal-folkstyle');
});

test('PERFECT trace stamps mechanic/tier across all three styles', () => {
  for (const style of ['folkstyle', 'freestyle', 'greco']) {
    const s1 = topBottomState(style);
    const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, PERFECT_TRACE, MISS_SKILL, makeRng(0xABCDEF));
    assertMechanicSurvives(s2, `style=${style}`);
  }
});

// ─── Sweep many seeds to catch boundary / passivity / stalling overlays ────

test('PERFECT trace mechanic/tier survives every seed (sweep)', () => {
  // 50 seeds is enough to hit at least one boundary reset (~8% per call) and
  // exercise the random-variance branches inside resolveRound. If any seed
  // drops mechanic/tier, this fails with the seed in the message.
  for (let seed = 1; seed <= 50; seed += 1) {
    const s1 = topBottomState();
    const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, PERFECT_TRACE, MISS_SKILL, makeRng(seed));
    assertMechanicSurvives(s2, `seed=${seed} type=${s2.lastResult?.type}`);
  }
});

// ─── End-of-period exit ─────────────────────────────────────────────────────

test('PERFECT trace mechanic/tier survives an end-of-period exit', () => {
  // Force clock low enough that resolveRound's post-action subtraction
  // (10-18s) ticks it to <= 0. checkEndConditions will then trigger period
  // rollover and replace s.lastResult before tagSkill stamps fields on top.
  const s1 = topBottomState('folkstyle', { clock: 5 });
  const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, PERFECT_TRACE, MISS_SKILL, makeRng(42));
  assertMechanicSurvives(s2, 'period-end');
});

test('PERFECT trace mechanic/tier survives the freestyle period rollover', () => {
  const s1 = topBottomState('freestyle', { clock: 5 });
  const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, PERFECT_TRACE, MISS_SKILL, makeRng(7));
  assertMechanicSurvives(s2, 'freestyle-period-end');
});

// ─── Decision / draw exit on final period ──────────────────────────────────

test('PERFECT trace mechanic/tier survives a decision exit on the final period', () => {
  // Folkstyle final period, clock about to expire, p1 leading -> decision.
  const s1 = topBottomState('folkstyle', { clock: 5, period: 3 });
  s1.p1 = { ...s1.p1, score: 5 };
  s1.p2 = { ...s1.p2, score: 2 };
  const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, PERFECT_TRACE, MISS_SKILL, makeRng(11));
  assertMechanicSurvives(s2, 'decision');
});

// ─── Overtime sudden-victory exit ──────────────────────────────────────────

test('PERFECT trace mechanic/tier survives the overtime sudden-victory exit', () => {
  // Phase 'overtime' + a scoring result triggers the line 889 return path
  // which lives inside resolveRound but wraps in tagSkill. Spiral ride
  // resolves to 'control' which is not in the overtime scoringTypes list,
  // so most seeds will fall through to the normal line 899 return. That's
  // still valuable coverage: assert tagSkill ran regardless.
  const s1 = topBottomState('folkstyle', { phase: 'overtime', clock: 30 });
  const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, PERFECT_TRACE, MISS_SKILL, makeRng(13));
  assertMechanicSurvives(s2, 'overtime');
});

// ─── GOOD tier also gets stamped (not just PERFECT) ────────────────────────

test('GOOD trace mechanic/tier survives the normal exit', () => {
  const GOOD_TRACE = { tier: 'GOOD', bonus: 6, rngRange: 2 };
  const s1 = topBottomState();
  const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, GOOD_TRACE, MISS_SKILL, makeRng(99));
  assert.equal(s2.lastResult?.p1Mechanic, 'path');
  assert.equal(s2.lastResult?.p1SkillTier, 'GOOD');
  assert.ok(Number.isFinite(s2.lastResult?.p1SkillBonusApplied));
});

// ─── Bonus reflects spam-factor reduction, not raw tier ────────────────────

test('p1SkillBonusApplied tracks the actual applied bonus (spam-aware)', () => {
  // 5th consecutive transition zeroes the bonus. Pre-load the counter so
  // this round trips the penalty rung.
  const s1 = topBottomState('folkstyle', {
    consecutiveTransitions: { p1: 4, p2: 0 },
  });
  const s2 = resolveRound(s1, TRANSITION_CARD, OPPONENT_CARD, PERFECT_TRACE, MISS_SKILL, makeRng(2026));
  assert.equal(s2.lastResult?.p1Mechanic, 'path');
  assert.equal(s2.lastResult?.p1SkillTier, 'PERFECT');
  // Spam ladder zeroes the bonus. The bonusApplied field must still be a
  // number (NOT undefined, NOT NaN) so the UI's formatPathTraceLabel
  // produces a valid string and renders the chip.
  assert.ok(Number.isFinite(s2.lastResult?.p1SkillBonusApplied));
});
