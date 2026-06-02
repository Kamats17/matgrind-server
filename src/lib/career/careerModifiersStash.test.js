// Pure-module tests for the tagged career-match modifier stash. The
// {careerId, eventId} tag is the load-bearing fix for ref leakage in
// WrestlingGame.jsx: readModifiers must return null whenever the stashed
// tag does not match the active career/event, so a forgotten clear cannot
// contaminate a different career or event.
//
// Run: node --test src/lib/career/careerModifiersStash.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stashModifiers, readModifiers, clearModifiers } from './careerModifiersStash.js';

const sampleMods = { stats: { str: 60 }, staminaMultiplier: 1.2, consumedBuffSourceIds: ['buff_a'] };

test('stashModifiers writes a fresh tagged stash', () => {
  const stash = stashModifiers(null, 'c1', 'e1', sampleMods);
  assert.deepEqual(stash, { careerId: 'c1', eventId: 'e1', mods: sampleMods });
});

test('stashModifiers overwrites the previous stash', () => {
  const first = stashModifiers(null, 'c1', 'e1', sampleMods);
  const second = stashModifiers(first, 'c2', 'e2', { ...sampleMods, staminaMultiplier: 0.9 });
  assert.equal(second.careerId, 'c2');
  assert.equal(second.eventId, 'e2');
  assert.equal(second.mods.staminaMultiplier, 0.9);
});

test('stashModifiers refuses to write with a missing careerId', () => {
  const prev = stashModifiers(null, 'c1', 'e1', sampleMods);
  const next = stashModifiers(prev, null, 'e2', sampleMods);
  assert.equal(next, prev);
});

test('stashModifiers refuses to write with a missing eventId', () => {
  const prev = stashModifiers(null, 'c1', 'e1', sampleMods);
  const next = stashModifiers(prev, 'c2', null, sampleMods);
  assert.equal(next, prev);
});

test('readModifiers returns null for an empty stash', () => {
  assert.equal(readModifiers(null, 'c1', 'e1'), null);
});

test('readModifiers returns mods when tag matches', () => {
  const stash = stashModifiers(null, 'c1', 'e1', sampleMods);
  assert.equal(readModifiers(stash, 'c1', 'e1'), sampleMods);
});

test('readModifiers returns null on careerId mismatch (slot-switch leak guard)', () => {
  const stash = stashModifiers(null, 'c1', 'e1', sampleMods);
  assert.equal(readModifiers(stash, 'c2', 'e1'), null);
});

test('readModifiers returns null on eventId mismatch (cross-event leak guard)', () => {
  const stash = stashModifiers(null, 'c1', 'e1', sampleMods);
  assert.equal(readModifiers(stash, 'c1', 'e2'), null);
});

test('clearModifiers returns null', () => {
  assert.equal(clearModifiers(), null);
});
