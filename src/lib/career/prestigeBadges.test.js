// Career Depth Pass v1 (Step 5) - Forward-only prestige badge tests.
//
// Run: node --test src/lib/career/prestigeBadges.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { PRESTIGE_BADGES, detectNewPrestigeBadges } = await import('./careerTrophies.js');

function makeCareer(overrides = {}) {
  return {
    schedule: { seasonYear: 1 },
    wrestler: { tier: 'hs' },
    record: {
      seasonWins: 0,
      seasonLosses: 0,
      pins: 0,
      titles: [],
    },
    seasonMeta: {
      debuffEventCount: 0,
      pinsThisSeason: 0,
      giantSlayerWinsThisSeason: 0,
      badgeEligibleSeasonYear: 1,
    },
    prestigeBadges: [],
    ...overrides,
  };
}

// ─── Detector contracts ─────────────────────────────────────────────────────

test('PRESTIGE_BADGES exposes the four canonical badges', () => {
  assert.ok(PRESTIGE_BADGES.undefeated_season);
  assert.ok(PRESTIGE_BADGES.pin_king);
  assert.ok(PRESTIGE_BADGES.giant_slayer);
  assert.ok(PRESTIGE_BADGES.iron_will);
});

// ─── undefeated_season ──────────────────────────────────────────────────────

test('undefeated unlocks at 14-0 with state title', () => {
  const career = makeCareer({
    record: {
      seasonWins: 14,
      seasonLosses: 0,
      pins: 5,
      titles: [{ season: 1, type: 'state' }],
    },
  });
  assert.equal(PRESTIGE_BADGES.undefeated_season.detect(career), true);
});

test('undefeated locked with one loss', () => {
  const career = makeCareer({
    record: {
      seasonWins: 13,
      seasonLosses: 1,
      pins: 5,
      titles: [{ season: 1, type: 'state' }],
    },
  });
  assert.equal(PRESTIGE_BADGES.undefeated_season.detect(career), false);
});

test('undefeated locked with 0 matches', () => {
  const career = makeCareer();
  assert.equal(PRESTIGE_BADGES.undefeated_season.detect(career), false);
});

test('undefeated locked without title this season', () => {
  const career = makeCareer({
    record: { seasonWins: 14, seasonLosses: 0, pins: 5, titles: [] },
  });
  assert.equal(PRESTIGE_BADGES.undefeated_season.detect(career), false);
});

// ─── pin_king ───────────────────────────────────────────────────────────────

test('pin_king unlocks at 10 season pins', () => {
  const career = makeCareer({ seasonMeta: { pinsThisSeason: 10 } });
  assert.equal(PRESTIGE_BADGES.pin_king.detect(career), true);
});

test('pin_king locked at 9 season pins', () => {
  const career = makeCareer({ seasonMeta: { pinsThisSeason: 9 } });
  assert.equal(PRESTIGE_BADGES.pin_king.detect(career), false);
});

// ─── giant_slayer ───────────────────────────────────────────────────────────

test('giant_slayer unlocks at >= 1 top-3 win', () => {
  const career = makeCareer({ seasonMeta: { giantSlayerWinsThisSeason: 1 } });
  assert.equal(PRESTIGE_BADGES.giant_slayer.detect(career), true);
});

test('giant_slayer locked at 0', () => {
  const career = makeCareer({ seasonMeta: { giantSlayerWinsThisSeason: 0 } });
  assert.equal(PRESTIGE_BADGES.giant_slayer.detect(career), false);
});

// ─── iron_will ──────────────────────────────────────────────────────────────

test('iron_will unlocks at zero debuffs with matches played', () => {
  const career = makeCareer({
    record: { seasonWins: 10, seasonLosses: 2, pins: 0, titles: [] },
    seasonMeta: { debuffEventCount: 0, pinsThisSeason: 0, giantSlayerWinsThisSeason: 0 },
  });
  assert.equal(PRESTIGE_BADGES.iron_will.detect(career), true);
});

test('iron_will locked when any debuff was taken', () => {
  const career = makeCareer({
    record: { seasonWins: 10, seasonLosses: 2, pins: 0, titles: [] },
    seasonMeta: { debuffEventCount: 1 },
  });
  assert.equal(PRESTIGE_BADGES.iron_will.detect(career), false);
});

test('iron_will locked at zero matches', () => {
  const career = makeCareer({
    seasonMeta: { debuffEventCount: 0 },
  });
  assert.equal(PRESTIGE_BADGES.iron_will.detect(career), false);
});

// ─── detectNewPrestigeBadges ────────────────────────────────────────────────

test('detectNewPrestigeBadges returns descriptor objects with metadata', () => {
  const career = makeCareer({
    record: {
      seasonWins: 14,
      seasonLosses: 0,
      pins: 0,
      titles: [{ season: 1, type: 'state' }],
    },
    seasonMeta: { debuffEventCount: 0, pinsThisSeason: 0, giantSlayerWinsThisSeason: 0 },
  });
  const earned = detectNewPrestigeBadges(career);
  assert.ok(earned.length > 0);
  for (const badge of earned) {
    assert.ok(badge.id);
    assert.ok(badge.name);
    assert.ok(badge.icon);
    assert.ok(badge.description);
    assert.equal(badge.seasonYear, 1);
    assert.equal(badge.tier, 'hs');
    assert.ok(badge.earnedAt > 0);
  }
});

test('detectNewPrestigeBadges skips already-earned badges', () => {
  const career = makeCareer({
    record: {
      seasonWins: 14,
      seasonLosses: 0,
      pins: 0,
      titles: [{ season: 1, type: 'state' }],
    },
    seasonMeta: { debuffEventCount: 0 },
    prestigeBadges: [
      { id: 'undefeated_season', seasonYear: 1, tier: 'hs', earnedAt: 1 },
      { id: 'iron_will', seasonYear: 1, tier: 'hs', earnedAt: 1 },
    ],
  });
  const earned = detectNewPrestigeBadges(career);
  for (const b of earned) {
    assert.notEqual(b.id, 'undefeated_season');
    assert.notEqual(b.id, 'iron_will');
  }
});

test('detectNewPrestigeBadges returns [] for empty career', () => {
  assert.deepEqual(detectNewPrestigeBadges(null), []);
  assert.deepEqual(detectNewPrestigeBadges(undefined), []);
});
