import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeTempBuffs,
  applyCareerMatchModifiers,
  tickConsumedTempBuffs,
} from './careerMatchModifiers.js';

// ─── sanitizeTempBuffs ──────────────────────────────────────────────────────

test('sanitizeTempBuffs returns [] for non-array input', () => {
  assert.deepEqual(sanitizeTempBuffs(undefined), []);
  assert.deepEqual(sanitizeTempBuffs(null), []);
  assert.deepEqual(sanitizeTempBuffs('junk'), []);
  assert.deepEqual(sanitizeTempBuffs(42), []);
  assert.deepEqual(sanitizeTempBuffs({}), []);
});

test('sanitizeTempBuffs drops non-object entries', () => {
  const out = sanitizeTempBuffs([null, undefined, 'string', 42, true]);
  assert.deepEqual(out, []);
});

test('sanitizeTempBuffs drops entries with missing or unknown type', () => {
  const out = sanitizeTempBuffs([
    {},
    { type: null },
    { type: 'junk_kind' },
    { type: 'stat_boost_all', amount: -2, duration: 1 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'stat_boost_all');
});

test('sanitizeTempBuffs clamps duration to [1, 10] and rounds', () => {
  const out = sanitizeTempBuffs([
    { type: 'stamina_restore', amount: 0.1, duration: 'abc' }, // non-numeric -> 1
    { type: 'stamina_restore', amount: 0.1, duration: 0 },     // below min -> 1
    { type: 'stamina_restore', amount: 0.1, duration: 25 },    // above max -> 10
    { type: 'stamina_restore', amount: 0.1, duration: 3.7 },   // rounds -> 4
  ]);
  assert.equal(out[0].duration, 1);
  assert.equal(out[1].duration, 1);
  assert.equal(out[2].duration, 10);
  assert.equal(out[3].duration, 4);
});

test('sanitizeTempBuffs backfills missing sourceId deterministically', () => {
  const out = sanitizeTempBuffs([
    { type: 'stat_boost_all', amount: -2, duration: 1, label: 'Tweaked back' },
    { type: 'stamina_restore', amount: 0.1, duration: 1 },
  ]);
  assert.equal(out[0].sourceId, 'legacy_0_stat_boost_all_tweaked_back');
  assert.equal(out[1].sourceId, 'legacy_1_stamina_restore_stamina_restore');
});

test('sanitizeTempBuffs preserves an existing sourceId', () => {
  const out = sanitizeTempBuffs([
    { type: 'stat_boost_all', amount: -2, duration: 1, sourceId: 'heavy_lift_risk' },
  ]);
  assert.equal(out[0].sourceId, 'heavy_lift_risk');
});

test('sanitizeTempBuffs forces debuff to explicit boolean', () => {
  const out = sanitizeTempBuffs([
    { type: 'stat_boost_all', amount: -2, duration: 1 },                 // missing
    { type: 'stat_boost_all', amount: -2, duration: 1, debuff: true },   // explicit true
    { type: 'stat_boost_all', amount: -2, duration: 1, debuff: 'yes' },  // truthy non-bool -> false (explicit)
  ]);
  assert.equal(out[0].debuff, false);
  assert.equal(out[1].debuff, true);
  assert.equal(out[2].debuff, false);
});

// ─── applyCareerMatchModifiers ──────────────────────────────────────────────

const baseWrestler = {
  stats: { str: 70, spd: 70, tec: 70, end: 70, grt: 70 },
  tempBuffs: [],
};

test('applyCareerMatchModifiers returns identity modifiers for empty buffs', () => {
  const r = applyCareerMatchModifiers(baseWrestler);
  assert.deepEqual(r.stats, baseWrestler.stats);
  assert.equal(r.staminaMultiplier, 1.0);
  assert.equal(r.scoutCardCount, 0);
  assert.deepEqual(r.banners, []);
  assert.deepEqual(r.consumedBuffSourceIds, []);
});

test('applyCareerMatchModifiers handles a wrestler with no stats safely', () => {
  const r = applyCareerMatchModifiers({});
  assert.deepEqual(r.stats, { str: 0, spd: 0, tec: 0, end: 0, grt: 0 });
});

test('applyCareerMatchModifiers applies stat_boost_all -2 to all stats clamped', () => {
  const r = applyCareerMatchModifiers({
    stats: { str: 70, spd: 1, tec: 70, end: 70, grt: 70 },
    tempBuffs: [{ sourceId: 'x', type: 'stat_boost_all', amount: -2, duration: 1 }],
  });
  assert.equal(r.stats.str, 68);
  assert.equal(r.stats.spd, 0);       // clamped to 0
  assert.equal(r.stats.tec, 68);
  assert.equal(r.consumedBuffSourceIds.length, 1);
});

test('applyCareerMatchModifiers stamina_restore +0.10 -> multiplier 1.10', () => {
  const r = applyCareerMatchModifiers({
    stats: baseWrestler.stats,
    tempBuffs: [{ sourceId: 'x', type: 'stamina_restore', amount: 0.10, duration: 1 }],
  });
  assert.equal(Math.round(r.staminaMultiplier * 100) / 100, 1.10);
});

test('applyCareerMatchModifiers stacks debuffs with clamps', () => {
  const r = applyCareerMatchModifiers({
    stats: baseWrestler.stats,
    tempBuffs: [
      { sourceId: 'a', type: 'stat_boost_all', amount: -2, duration: 1 },
      { sourceId: 'b', type: 'stat_boost_all', amount: -1, duration: 1 },
      { sourceId: 'c', type: 'stamina_restore', amount: -0.5, duration: 1 },
    ],
  });
  assert.equal(r.stats.str, 67); // 70 - 2 - 1
  assert.equal(r.staminaMultiplier, 0.5); // 1.0 * 0.5
  assert.deepEqual(r.consumedBuffSourceIds, ['a', 'b', 'c']);
});

test('applyCareerMatchModifiers clamps absurd stamina stack to safe range', () => {
  const r = applyCareerMatchModifiers({
    stats: baseWrestler.stats,
    tempBuffs: [
      { sourceId: 'a', type: 'stamina_restore', amount: -0.9, duration: 1 },
      { sourceId: 'b', type: 'stamina_restore', amount: -0.9, duration: 1 },
    ],
  });
  // raw multiplier 0.1 * 0.1 = 0.01; clamp floor is 0.3
  assert.equal(r.staminaMultiplier, 0.3);
});

test('applyCareerMatchModifiers stat_boost with staminaCost reduces multiplier', () => {
  const r = applyCareerMatchModifiers({
    stats: baseWrestler.stats,
    tempBuffs: [{
      sourceId: 'warmup',
      type: 'stat_boost',
      stat: 'spd',
      amount: 1,
      staminaCost: 0.02,
      duration: 1,
    }],
  });
  assert.equal(r.stats.spd, 71);
  assert.equal(Math.round(r.staminaMultiplier * 100) / 100, 0.98);
});

test('applyCareerMatchModifiers stat_boost_top2 boosts highest 2 stats', () => {
  const r = applyCareerMatchModifiers({
    stats: { str: 70, spd: 60, tec: 80, end: 75, grt: 65 },
    tempBuffs: [{ sourceId: 'x', type: 'stat_boost_top2', amount: 1, duration: 1 }],
  });
  assert.equal(r.stats.tec, 81); // top
  assert.equal(r.stats.end, 76); // 2nd
  assert.equal(r.stats.str, 70); // unchanged
});

test('applyCareerMatchModifiers scout_cards aggregates count', () => {
  const r = applyCareerMatchModifiers({
    stats: baseWrestler.stats,
    tempBuffs: [
      { sourceId: 'a', type: 'scout_cards', count: 2, duration: 1 },
      { sourceId: 'b', type: 'scout_cards', count: 1, duration: 1 },
    ],
  });
  assert.equal(r.scoutCardCount, 3);
});

test('applyCareerMatchModifiers ignores unknown buff types without crashing', () => {
  const r = applyCareerMatchModifiers({
    stats: baseWrestler.stats,
    tempBuffs: [
      { sourceId: 'a', type: 'unknown_kind', duration: 1 },
      { sourceId: 'b', type: 'stat_boost_all', amount: -1, duration: 1 },
    ],
  });
  assert.equal(r.stats.str, 69);
  // only the known buff is consumed
  assert.deepEqual(r.consumedBuffSourceIds, ['b']);
});

// ─── tickConsumedTempBuffs ──────────────────────────────────────────────────

test('tickConsumedTempBuffs returns empty consumedBuffs when wrestler has no buffs', () => {
  const out = tickConsumedTempBuffs({ tempBuffs: [] }, ['x']);
  assert.deepEqual(out.wrestler.tempBuffs, []);
  assert.deepEqual(out.consumedBuffs, []);
});

test('tickConsumedTempBuffs removes buffs matching consumed sourceIds', () => {
  const wrestler = {
    tempBuffs: [
      { sourceId: 'a', type: 'stamina_restore', amount: 0.1, duration: 1 },
      { sourceId: 'b', type: 'stat_boost_all', amount: -1, duration: 2 },
    ],
  };
  const out = tickConsumedTempBuffs(wrestler, ['a']);
  assert.equal(out.wrestler.tempBuffs.length, 1);
  assert.equal(out.wrestler.tempBuffs[0].sourceId, 'b');
  assert.equal(out.wrestler.tempBuffs[0].duration, 1); // ticked from 2 -> 1
  assert.equal(out.consumedBuffs.length, 1);
  assert.equal(out.consumedBuffs[0].sourceId, 'a');
});

test('tickConsumedTempBuffs decrements survivors and drops duration-0', () => {
  const wrestler = {
    tempBuffs: [
      { sourceId: 'a', type: 'stat_boost', stat: 'str', amount: 1, duration: 1 },
      { sourceId: 'b', type: 'stat_boost', stat: 'spd', amount: 1, duration: 3 },
    ],
  };
  const out = tickConsumedTempBuffs(wrestler, []);
  // 'a' decrements to 0 -> dropped (counted as consumed)
  assert.equal(out.wrestler.tempBuffs.length, 1);
  assert.equal(out.wrestler.tempBuffs[0].sourceId, 'b');
  assert.equal(out.wrestler.tempBuffs[0].duration, 2);
  assert.equal(out.consumedBuffs.length, 1);
  assert.equal(out.consumedBuffs[0].sourceId, 'a');
});

test('tickConsumedTempBuffs returns debuff flag intact on consumed buffs for downstream counting', () => {
  const wrestler = {
    tempBuffs: [
      { sourceId: 'a', type: 'stat_boost_all', amount: -2, duration: 1, debuff: true },
      { sourceId: 'b', type: 'stamina_restore', amount: 0.1, duration: 1, debuff: false },
    ],
  };
  const out = tickConsumedTempBuffs(wrestler, ['a', 'b']);
  assert.equal(out.consumedBuffs.length, 2);
  const debuffCount = out.consumedBuffs.filter(b => b.debuff).length;
  assert.equal(debuffCount, 1);
});

test('tickConsumedTempBuffs drops malformed buff entries silently', () => {
  const wrestler = {
    tempBuffs: [
      null,
      'junk',
      { sourceId: 'a', type: 'stamina_restore', amount: 0.1, duration: 2 },
    ],
  };
  const out = tickConsumedTempBuffs(wrestler, []);
  assert.equal(out.wrestler.tempBuffs.length, 1);
  assert.equal(out.wrestler.tempBuffs[0].sourceId, 'a');
  assert.equal(out.wrestler.tempBuffs[0].duration, 1);
});

// ─── Contract bits relied on by WrestlingGame ref wiring ────────────────────

test('applyCareerMatchModifiers with no buffs returns empty consumedBuffSourceIds', () => {
  // The WrestlingGame layer reads consumedBuffSourceIds from the stash and
  // passes it through to recordEventResult. An empty array means "I am the
  // consumer; tick durations but consume nothing by sourceId."
  const wrestler = { stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 }, tempBuffs: [] };
  const out = applyCareerMatchModifiers(wrestler);
  assert.deepEqual(out.consumedBuffSourceIds, []);
  assert.equal(out.staminaMultiplier, 1.0);
  assert.deepEqual(out.banners, []);
});

test('applyCareerMatchModifiers on a wrestler with no tempBuffs field is safe', () => {
  // Hydration may produce a wrestler without tempBuffs; the modifier helper
  // must not throw and must return the neutral shape.
  const wrestler = { stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 } };
  const out = applyCareerMatchModifiers(wrestler);
  assert.deepEqual(out.consumedBuffSourceIds, []);
  assert.equal(out.staminaMultiplier, 1.0);
});
