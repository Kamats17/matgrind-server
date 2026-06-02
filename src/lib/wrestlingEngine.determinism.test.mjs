import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialMatchState,
  resolveRound,
  resolvePinStage1,
  resolvePinStage2,
  resolvePinStage3,
  applyPeriodChoice,
} from './wrestlingEngine.js';
import { makeRng } from './seededRng.js';

// Two fresh RNGs seeded identically must produce identical engine output.
// This is what the server relies on: it issues one seed per resolution
// event, both clients rebuild a PRNG from that seed, and both reach the
// same state. If this test regresses, online matches will desync again.

function simpleState() {
  return createInitialMatchState('A', 'B', 'folkstyle', null, null, 'medium', 'p1');
}

test('resolveRound is deterministic under a seeded RNG', () => {
  const s1 = simpleState();
  const s2 = simpleState();
  const seed = 0xDEADBEEF;

  // Use a pair of realistic opening cards from each side. Exact ids don't
  // matter as long as both sides produce a valid round - the assertion is
  // on determinism, not on outcome specifics.
  const a = resolveRound(s1, 'double_leg', 'sprawl', null, null, makeRng(seed));
  const b = resolveRound(s2, 'double_leg', 'sprawl', null, null, makeRng(seed));

  assert.deepEqual(a, b, 'same seed must produce identical state');
});

test('resolveRound diverges under different seeds (sanity)', () => {
  const s1 = simpleState();
  const s2 = simpleState();

  // Different seeds: the RNG outputs are different, so at least one field
  // of the resulting state must differ. Not an assertion about which field -
  // just that determinism is actually load-bearing.
  const a = resolveRound(s1, 'double_leg', 'sprawl', null, null, makeRng(1));
  const b = resolveRound(s2, 'double_leg', 'sprawl', null, null, makeRng(2));

  // deepEqual would throw on difference; use try/catch to assert divergence.
  let diverged = false;
  try { assert.deepEqual(a, b); } catch { diverged = true; }
  assert.ok(diverged, 'different seeds should produce different state (they never should match)');
});

test('resolvePinStageN is deterministic under a seeded RNG', () => {
  // Build a state that's in pin_attempt phase. Easiest path: hand-craft the
  // minimum fields resolvePinStage1 reads, mirroring what the engine would
  // produce after a grand_amplitude → pin_attempt_trigger path.
  const base = simpleState();
  const pinState = {
    ...base,
    phase: 'pin_attempt',
    pinAttempt: {
      attacker: 'p1',
      pinChance: 0.22,
      stage: 1,
      burnedDefCards: [],
    },
  };

  const seed = 42;
  const a = resolvePinStage1(pinState, 'pin_lock_position', 'pin_hip_switch', makeRng(seed));
  const b = resolvePinStage1(pinState, 'pin_lock_position', 'pin_hip_switch', makeRng(seed));
  assert.deepEqual(a, b, 'pin stage 1: same seed → same result');

  // Stage-3 has an extra rng() call (fullyEscaped check) - make sure it's
  // also deterministic.
  const pin3State = { ...pinState, pinAttempt: { ...pinState.pinAttempt, stage: 3, burnedDefCards: ['pin_hip_switch', 'pin_fight_hands'] } };
  const c = resolvePinStage3(pin3State, 'pin_finish', 'pin_roll_through', makeRng(seed));
  const d = resolvePinStage3(pin3State, 'pin_finish', 'pin_roll_through', makeRng(seed));
  assert.deepEqual(c, d, 'pin stage 3: same seed → same result');
});

// ── Guard regression tests (audit repair #1, #2) ─────────────────────────
// resolvePinStageN previously guarded only on `phase !== 'pin_attempt'`,
// which crashes on the rare desynced shape phase='pin_attempt' + pinAttempt=null.
// The repair adds `|| !state.pinAttempt` to all three resolvers.

test('resolvePinStage1 returns input state when pinAttempt is null even if phase says pin_attempt', () => {
  const broken = { ...simpleState(), phase: 'pin_attempt', pinAttempt: null };
  const out = resolvePinStage1(broken, 'pin_lock_position', 'pin_hip_switch', makeRng(1));
  assert.equal(out, broken, 'must short-circuit, not crash on null pinAttempt');
});

test('resolvePinStage2 returns input state when pinAttempt is null even if phase says pin_attempt', () => {
  const broken = { ...simpleState(), phase: 'pin_attempt', pinAttempt: null };
  const out = resolvePinStage2(broken, 'pin_power_drive', 'pin_roll_through', makeRng(1));
  assert.equal(out, broken);
});

test('resolvePinStage3 returns input state when pinAttempt is null even if phase says pin_attempt', () => {
  const broken = { ...simpleState(), phase: 'pin_attempt', pinAttempt: null };
  const out = resolvePinStage3(broken, 'pin_finish', 'pin_roll_through', makeRng(1));
  assert.equal(out, broken);
});

// applyPeriodChoice previously trusted any caller; the repair guards on
// phase, periodChoicePending, and pendingChoiceFor so a stale or replayed
// period_choice_made frame can't mutate an active match.

function periodBreakState() {
  // Build a state in the period-break phase with p1 as the chooser.
  const base = simpleState();
  return {
    ...base,
    phase: 'period_break',
    period: 2,
    periodChoicePending: true,
    pendingChoiceFor: 'p1',
  };
}

test('applyPeriodChoice returns input state when phase is not period_break', () => {
  const playing = { ...periodBreakState(), phase: 'playing' };
  const out = applyPeriodChoice(playing, 'p1', 'top');
  assert.equal(out, playing);
});

test('applyPeriodChoice returns input state when periodChoicePending is false', () => {
  const notPending = { ...periodBreakState(), periodChoicePending: false };
  const out = applyPeriodChoice(notPending, 'p1', 'top');
  assert.equal(out, notPending);
});

test('applyPeriodChoice returns input state when chooser does not match pendingChoiceFor', () => {
  const wrongChooser = periodBreakState(); // pendingChoiceFor='p1'
  const out = applyPeriodChoice(wrongChooser, 'p2', 'top');
  assert.equal(out, wrongChooser);
});

test('applyPeriodChoice still routes defer correctly with full guard set in place', () => {
  // p1 defers in period 2 → state should reflect the deferred choice
  // (periodChoicePending=true, pendingChoiceFor switched to p2).
  const s = periodBreakState();
  const out = applyPeriodChoice(s, 'p1', 'defer');
  assert.notEqual(out, s, 'defer should produce a new state, not no-op');
  assert.equal(out.periodChoicePending, true);
  assert.equal(out.pendingChoiceFor, 'p2');
});

test('applyPeriodChoice applies a top choice from the correct chooser', () => {
  // Sanity: when all guards pass, the function still does what it always did.
  const s = periodBreakState();
  const out = applyPeriodChoice(s, 'p1', 'top');
  assert.equal(out.phase, 'playing', 'choice resolves the period break');
  assert.equal(out.periodChoicePending, false);
  assert.equal(out.pendingChoiceFor, null);
});
