// Mandatory hydration tests for Career Depth Pass v1 (CAREER_SHAPE_VERSION 8).
// Gate for shipping: every fixture must hydrate cleanly without crashing and
// without inventing badge eligibility for legacy mid-season careers.
//
// Run: node --test src/lib/career/careerHydrationV8.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createCareer, hydrateCareer, advanceToNextSeason } = await import('./careerState.js');

// Deterministic RNG used by createCareer's rivals/pool generation. Tests
// don't care about the exact pool contents, only the v8 backfill shape.
function fixedRng() {
  let n = 0;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

// 1. Fresh v1 career: createCareer output already at version 8 with day-one
//    badge eligibility this season.
test('hydrate(createCareer output) is at v8, immediately badge-eligible', () => {
  const c = createCareer({ name: 'Fresh', weightClass: 138, rng: fixedRng() });
  const h = hydrateCareer(c);
  assert.equal(h.version, 9);
  assert.deepEqual(h.prestigeBadges, []);
  assert.equal(h.seasonMeta.debuffEventCount, 0);
  assert.equal(h.seasonMeta.pinsThisSeason, 0);
  assert.equal(h.seasonMeta.giantSlayerWinsThisSeason, 0);
  // Fresh careers are eligible THIS season (seasonYear 1).
  assert.equal(h.seasonMeta.badgeEligibleSeasonYear, h.schedule.seasonYear);
  assert.equal(h.seasonMeta.badgeEligibleSeasonYear, 1);
  assert.equal(h.seasonMeta.badgeEligibleFromVersion, 9);
  assert.deepEqual(h.wrestler.tempBuffs, []);
  // Step 3 wires coachForTier; fresh HS career gets Coach Petrov.
  assert.equal(h.coach?.id, 'hs_coach_petrov');
  assert.equal(h.coach?.name, 'Coach Petrov');
});

// 2. Legacy v7 career with no v1 fields: backfills safely, eligibility starts
//    NEXT season (forward-only rule).
test('hydrate(legacy v7) backfills v8 fields with forward-only eligibility', () => {
  const legacyV7 = {
    id: 'legacy-1',
    version: 7,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    phase: 'in_season',
    wrestler: {
      name: 'Legacy', tier: 'hs', year: 2, age: 15,
      weightClass: 138, state: 'PA',
      stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
      statPointsAvailable: 0, xp: 0, level: 1,
      skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
      gender: 'male',
    },
    schedule: { seasonYear: 2, events: [], currentEventIdx: 0 },
    rivals: [],
    record: {
      seasonWins: 5, seasonLosses: 2, careerWins: 12, careerLosses: 4,
      pins: 3, techs: 1, majorDecs: 2, nearFalls: 1, titles: [],
    },
  };
  const h = hydrateCareer(legacyV7);
  assert.equal(h.version, 9);
  assert.deepEqual(h.prestigeBadges, []);
  assert.equal(h.seasonMeta.debuffEventCount, 0);
  assert.equal(h.seasonMeta.pinsThisSeason, 0);
  assert.equal(h.seasonMeta.giantSlayerWinsThisSeason, 0);
  // Forward-only: legacy careers start badge eligibility NEXT season.
  assert.equal(h.seasonMeta.badgeEligibleSeasonYear, h.schedule.seasonYear + 1);
  assert.equal(h.seasonMeta.badgeEligibleSeasonYear, 3);
  assert.equal(h.seasonMeta.badgeEligibleFromVersion, 9);
  // Legacy HS career: coach backfilled by hydrate via coachForTier('hs').
  assert.equal(h.coach?.id, 'hs_coach_petrov');
  // No retroactive badges granted from existing record values.
  assert.equal(h.prestigeBadges.length, 0);
});

// 3. Legacy v7 career with malformed tempBuffs: sanitize drops bad entries,
//    keeps the valid ones, backfills sourceId.
test('hydrate(legacy with malformed tempBuffs) sanitizes without crashing', () => {
  const legacyV7 = {
    id: 'legacy-malformed',
    version: 7,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    phase: 'in_season',
    wrestler: {
      name: 'Patchy', tier: 'hs', year: 1, age: 14,
      weightClass: 138, state: 'PA',
      stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
      statPointsAvailable: 0, xp: 0, level: 1,
      skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
      gender: 'male',
      tempBuffs: [
        null,
        'string-junk',
        42,
        { type: 'junk_kind', amount: 999, duration: 1 },
        { type: 'stat_boost_all', amount: -2, duration: 'abc', label: 'Old debuff' }, // missing sourceId, bad duration
        { sourceId: 'preserved', type: 'stamina_restore', amount: 0.1, duration: 1 },
      ],
    },
    schedule: { seasonYear: 1, events: [], currentEventIdx: 0 },
    rivals: [],
    record: {
      seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
      pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [],
    },
  };
  let h;
  assert.doesNotThrow(() => { h = hydrateCareer(legacyV7); });
  assert.equal(h.version, 9);
  const buffs = h.wrestler.tempBuffs;
  assert.equal(buffs.length, 2, 'only the 2 sane entries survive');
  // The stat_boost_all entry has a backfilled sourceId and clamped duration.
  const debuffEntry = buffs.find(b => b.type === 'stat_boost_all');
  assert.ok(debuffEntry, 'stat_boost_all preserved');
  assert.ok(debuffEntry.sourceId.startsWith('legacy_'), 'sourceId backfilled for legacy entry');
  assert.equal(debuffEntry.duration, 1, 'bad duration coerced to 1');
  // The preserved-sourceId entry keeps its id intact.
  const positive = buffs.find(b => b.type === 'stamina_restore');
  assert.equal(positive.sourceId, 'preserved');
});

// 4. Legacy v7 mid-season hydrate: cannot earn badges this season; first
//    eligible season is currentSeasonYear + 1.
test('hydrate(legacy mid-season) defers badge eligibility to next season', () => {
  const midSeason = {
    id: 'legacy-mid',
    version: 7,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    phase: 'in_season',
    wrestler: {
      name: 'MidSeason', tier: 'hs', year: 3, age: 16,
      weightClass: 138, state: 'PA',
      stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
      statPointsAvailable: 0, xp: 0, level: 1,
      skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
      gender: 'male',
    },
    schedule: {
      seasonYear: 3,
      currentEventIdx: 6,
      events: [
        { id: 'e0', status: 'won' },
        { id: 'e1', status: 'won' },
        { id: 'e2', status: 'lost' },
        { id: 'e3', status: 'won' },
        { id: 'e4', status: 'won' },
        { id: 'e5', status: 'won' },
        { id: 'e6', status: 'upcoming' },
      ],
    },
    rivals: [],
    record: {
      seasonWins: 5, seasonLosses: 1, careerWins: 15, careerLosses: 3,
      pins: 4, techs: 2, majorDecs: 1, nearFalls: 2, titles: [],
    },
  };
  const h = hydrateCareer(midSeason);
  assert.equal(h.version, 9);
  assert.equal(h.schedule.seasonYear, 3);
  // Cannot earn badges in season 3 (mid-season at hydrate); first eligible season is 4.
  assert.equal(h.seasonMeta.badgeEligibleSeasonYear, 4);
  assert.deepEqual(h.prestigeBadges, []);
});

// 5. Legacy v7 college-tier career with no coach field hydrates with the
//    college coach (hydration backfill uses coachForTier(hydratedWrestler.tier)).
test('hydrate(legacy v7 at college tier, no coach) assigns generic college coach', () => {
  const legacyCollege = {
    id: 'legacy-college',
    version: 7,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    phase: 'in_season',
    wrestler: {
      name: 'Vet', tier: 'college', year: 2, age: 19,
      weightClass: 141, state: 'IA',
      stats: { str: 65, spd: 65, tec: 65, end: 65, grt: 65 },
      statPointsAvailable: 0, xp: 0, level: 1,
      skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
      gender: 'male', style: 'folkstyle',
    },
    schedule: { seasonYear: 2, events: [], currentEventIdx: 0 },
    rivals: [],
    record: {
      seasonWins: 3, seasonLosses: 1, careerWins: 18, careerLosses: 6,
      pins: 4, techs: 1, majorDecs: 2, nearFalls: 2, titles: [],
    },
  };
  const h = hydrateCareer(legacyCollege);
  assert.equal(h.coach?.id, 'generic_college_coach');
});

// 6. Legacy career with a TRUTHY but wrong coach (HS Petrov stuck on a
//    college career) is healed on next-season advance. Hydration preserves
//    truthy coaches (no unilateral overwrite of valid saves), so the heal
//    fires on the next advanceToNextSeason - this is the load-bearing test
//    for the unconditional `coach: coachForCareerTier(career)` rebind.
test('legacy career with stale HS coach on college tier heals on advanceToNextSeason', () => {
  const stale = {
    id: 'legacy-stale-coach',
    version: 7,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    phase: 'offseason',
    wrestler: {
      name: 'Stale', tier: 'college', year: 2, age: 19,
      weightClass: 141, state: 'IA',
      stats: { str: 65, spd: 65, tec: 65, end: 65, grt: 65 },
      statPointsAvailable: 0, xp: 0, level: 1,
      skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
      gender: 'male', style: 'folkstyle',
    },
    schedule: {
      seasonYear: 2,
      currentEventIdx: 3,
      events: [
        { id: 'e0', status: 'won' },
        { id: 'e1', status: 'won' },
        { id: 'e2', status: 'lost' },
      ],
    },
    rivals: [],
    record: {
      seasonWins: 2, seasonLosses: 1, careerWins: 10, careerLosses: 4,
      pins: 1, techs: 0, majorDecs: 1, nearFalls: 0, titles: [],
    },
    // Stale: HS Petrov clinging to a college wrestler.
    coach: { id: 'hs_coach_petrov', name: 'Coach Petrov', tier: 'hs' },
  };
  const h = hydrateCareer(stale);
  // Hydration preserves the truthy (but wrong) coach.
  assert.equal(h.coach?.id, 'hs_coach_petrov',
    'hydration preserves truthy coach (does not unilaterally overwrite)');

  // Advance the season - this is where the heal fires.
  const advanced = advanceToNextSeason(h, { rng: fixedRng() });
  assert.equal(advanced.wrestler.tier, 'college');
  assert.equal(advanced.coach?.id, 'generic_college_coach',
    'advanceToNextSeason rebinds coach from current tier');
});

// 7. Re-hydrate is idempotent: hydrating a v8 career returns the same shape
//    without bumping eligibility or overwriting counters.
test('hydrate is idempotent for already-v8 careers', () => {
  const c = createCareer({ name: 'Idem', weightClass: 138, rng: fixedRng() });
  const c2 = { ...c, seasonMeta: { ...c.seasonMeta, debuffEventCount: 3, pinsThisSeason: 7 } };
  const h = hydrateCareer(c2);
  assert.equal(h.seasonMeta.debuffEventCount, 3, 'debuff counter preserved');
  assert.equal(h.seasonMeta.pinsThisSeason, 7, 'pin counter preserved');
  assert.equal(h.seasonMeta.badgeEligibleSeasonYear, c.seasonMeta.badgeEligibleSeasonYear);
});
