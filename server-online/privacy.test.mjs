// Privacy / state-serialization tests. The CI test below asserts that
// EVERY field returned by createInitialMatchState + a few resolveRound
// invocations is classified in PUBLIC_STATE_FIELDS or PRIVATE_STATE_FIELDS.
// If the engine adds a new field and forgets to update privacy.mjs,
// this test fires.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  serializeStateForRecipient,
  findUnclassifiedFields,
  redactCrashDump,
  PUBLIC_STATE_FIELDS,
} from './privacy.mjs';
import {
  createInitialMatchState,
  resolveRound,
} from '../src/lib/wrestlingEngine.js';
import { makeRng } from '../src/lib/seededRng.js';

test('serializeStateForRecipient: copies only public fields', () => {
  const state = {
    phase: 'playing',
    period: 1,
    p1: { score: 0 },
    p2: { score: 0 },
    pendingPicks: { p1: 'single_leg', p2: null },   // hostile — not public
    skillResults: { p1: null, p2: null },           // hostile — not public
    secret_internal_field: 'leak me',
  };
  const out = serializeStateForRecipient(state, 'spectator');
  assert.equal('phase' in out, true);
  assert.equal('p1' in out, true);
  assert.equal('pendingPicks' in out, false, 'must not leak pendingPicks');
  assert.equal('skillResults' in out, false, 'must not leak skillResults');
  assert.equal('secret_internal_field' in out, false, 'must strip unknown fields');
});

test('serializeStateForRecipient: rejects bad input', () => {
  assert.throws(() => serializeStateForRecipient(null, 'p1'));
  assert.throws(() => serializeStateForRecipient({}, 'eavesdropper'));
});

test('CI: every field returned by createInitialMatchState is classified', () => {
  const styles = ['folkstyle', 'freestyle', 'greco', 'womens_freestyle'];
  for (const style of styles) {
    const state = createInitialMatchState('A', 'B', style, null, null, 'medium', 'p1');
    const unclassified = findUnclassifiedFields(state);
    assert.deepEqual(
      unclassified,
      [],
      `Style ${style} produced unclassified fields: ${unclassified.join(', ')}. ` +
      `Add them to PUBLIC_STATE_FIELDS or PRIVATE_STATE_FIELDS in server-online/privacy.mjs.`,
    );
  }
});

test('CI: every field after resolveRound is classified', () => {
  let state = createInitialMatchState('A', 'B', 'folkstyle', null, null, 'medium', 'p1');
  // Run a few rounds with various card combos to surface any
  // round-specific state additions.
  const combos = [
    ['single_leg', 'sprawl'],
    ['double_leg', 'level_change'],
    ['stall', 'stall'],
    ['ankle_pick', 'sprawl'],
  ];
  for (let i = 0; i < combos.length; i++) {
    const [p1c, p2c] = combos[i];
    state = resolveRound(state, p1c, p2c, null, null, makeRng(i + 1));
    if (state.phase !== 'playing' && state.phase !== 'overtime') break;
    const unclassified = findUnclassifiedFields(state);
    assert.deepEqual(
      unclassified,
      [],
      `Round ${i} (${p1c} vs ${p2c}) produced unclassified fields: ${unclassified.join(', ')}`,
    );
  }
});

test('serializeStateForRecipient idempotent on already-clean state', () => {
  const clean = {};
  for (const f of PUBLIC_STATE_FIELDS) clean[f] = `value-${f}`;
  const out = serializeStateForRecipient(clean, 'p1');
  for (const f of PUBLIC_STATE_FIELDS) assert.equal(out[f], `value-${f}`);
});

test('redactCrashDump strips hands, preGeneratedChallenges, challenges', () => {
  const dump = {
    error: 'boom',
    matchState: { phase: 'playing', p1: {}, secret: 'leak' },
    hands: { p1: ['single_leg'], p2: ['sprawl'] },
    preGeneratedChallenges: { p1: { single_leg: { params: 'leak' } } },
    challenges: { p1: { events: [{ payload: { x: 1 } }] } },
    inputs: { p1Card: 'single_leg', p2Card: 'sprawl' },
  };
  const out = redactCrashDump(dump);
  assert.equal('hands' in out, false);
  assert.equal('preGeneratedChallenges' in out, false);
  assert.equal('challenges' in out, false);
  assert.equal('inputs' in out, true, 'card-id inputs are debug-useful, kept');
  assert.equal('secret' in out.matchState, false, 'matchState passed through scrub');
});
