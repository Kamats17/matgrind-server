// v9 schedule expansion hydration contract tests. These are the ship-gate
// for the match-count expansion plan. Verifies the forward-only contract:
//   - createCareer (new careers) gets V1 schedule + scheduleVersion=1
//   - Legacy v7/v8 mid-season hydrate keeps V0 events untouched + stamps
//     scheduleVersion=0 in seasonMeta
//   - advanceToNextSeason on a legacy career produces V1 schedule + bumps
//     scheduleVersion to 1
//   - 4-level qualifyFrom pruning (Conference -> District -> Regional ->
//     State) works on V1 schedules
//   - Per-style Worlds-followup append routes correctly (regression for
//     dual-style men dropping Greco Worlds)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCareer,
  hydrateCareer,
  advanceToNextSeason,
  recordEventResult,
} from './careerState.js';
import { generateSeasonSchedule } from './careerSchedule.js';
import { isCareerDualMeetSnapshotResumable } from './dualMeetResume.js';

// --- helpers ----------------------------------------------------------------

function v8FreshCareerSeed() {
  // Build a synthetic v7 careeer object as if it was persisted before the
  // Depth Pass v1 ran. hydrateCareer should chain v7 -> v8 -> v9.
  const v0Events = generateSeasonSchedule({
    tier: 'hs',
    seasonYear: 1,
    year: 1,
    weightClass: 138,
    style: 'folkstyle',
    gender: 'male',
    rivals: [],
    scheduleVersion: 0,
  });
  return {
    id: 'legacy_v7_career',
    version: 7,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    wrestler: {
      name: 'Legacy Wrestler',
      tier: 'hs',
      year: 1,
      age: 14,
      weightClass: 138,
      state: 'PA',
      gender: 'male',
      stats: { str: 55, spd: 55, tec: 55, end: 55, grt: 55 },
      statPointsAvailable: 0,
      xp: 0,
      level: 1,
      skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
      unlockedCardIds: [],
      injuries: [],
      school: null,
    },
    schedule: { seasonYear: 1, events: v0Events, currentEventIdx: 3 },
    rivals: [],
    record: {
      seasonWins: 2, seasonLosses: 1,
      careerWins: 2, careerLosses: 1,
      pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [],
    },
    phase: 'in_season',
  };
}

function v8MidSeasonCareerSeed() {
  // A v8 career that already ran the v7->v8 migration (has seasonMeta with
  // Depth Pass v1 fields) but predates v9 (no scheduleVersion).
  const seed = v8FreshCareerSeed();
  seed.version = 8;
  seed.seasonMeta = {
    debuffEventCount: 1,
    pinsThisSeason: 2,
    giantSlayerWinsThisSeason: 1,
    badgeEligibleSeasonYear: 1,
    badgeEligibleFromVersion: 8,
    // NOTE: no scheduleVersion (would have been added at v9)
  };
  seed.prestigeBadges = [];
  return seed;
}

function v8OffseasonCareerSeed() {
  const seed = v8MidSeasonCareerSeed();
  seed.phase = 'offseason';
  // mark every event done so advanceToNextSeason will accept the offseason
  // phase as valid
  seed.schedule.events = seed.schedule.events.map((e, i) => ({
    ...e,
    status: i % 3 === 0 ? 'lost' : 'won',
    result: {
      p1Score: 5, p2Score: 3, winMethod: 'decision',
      placement: i % 3 === 0 ? 9 : 1, playedAt: Date.now(),
    },
  }));
  seed.schedule.currentEventIdx = seed.schedule.events.length;
  return seed;
}

// --- Test 1 -----------------------------------------------------------------

describe('v9 hydration contract - createCareer', () => {
  test('fresh v9 career gets V1 schedule on day 1', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, state: 'PA', gender: 'male' });
    assert.equal(c.version, 9, 'version stamped at 9');
    assert.equal(c.seasonMeta.scheduleVersion, 1, 'scheduleVersion stamped at 1');
    // Exact-count contract: HS V1 = 19 duals + 5 tournaments + 4 postseason = 28.
    // Catches future drift (a 6th in-season tournament or stray dual) that a
    // loose ">= 27" check would miss. Mirrors the exact-count tests in
    // describe('v9 schedule exact-count contracts') below.
    assert.equal(c.schedule.events.length, 28, `V1 HS schedule has exactly 28 events; got ${c.schedule.events.length}`);
    const stateEvent = c.schedule.events.find(e => e.stakes === 'state');
    assert.ok(stateEvent, 'V1 schedule includes a state-stakes event');
    assert.equal(stateEvent.bracketSize, 128, 'State Championship is a 128-bracket');
    // V1-only landmark events
    assert.ok(c.schedule.events.some(e => e.stakes === 'district'), 'V1 schedule includes a district-stakes event');
    assert.ok(c.schedule.events.some(e => e.name === 'Conference Showcase'), 'V1 schedule includes Conference Showcase');
  });
});

// --- Test 2 + 3 -------------------------------------------------------------

describe('v9 hydration contract - legacy in-flight preservation', () => {
  test('legacy v7 mid-season hydrate keeps V0 schedule untouched', () => {
    const seed = v8FreshCareerSeed(); // version: 7
    const beforeEventsJson = JSON.stringify(seed.schedule.events);
    const hydrated = hydrateCareer(seed);
    assert.equal(hydrated.version, 9, 'bumped to v9');
    assert.equal(hydrated.seasonMeta.scheduleVersion, 0, 'legacy gate stamps 0');
    assert.equal(JSON.stringify(hydrated.schedule.events), beforeEventsJson, 'events array byte-identical');
    assert.equal(hydrated.schedule.currentEventIdx, 3, 'currentEventIdx preserved');
    const stateEvent = hydrated.schedule.events.find(e => e.stakes === 'state');
    assert.equal(stateEvent.bracketSize, 64, 'state bracket is V0 (64), not V1 (128)');
    // v7->v8 migration should also have stamped seasonMeta scaffolding
    assert.ok(hydrated.seasonMeta.badgeEligibleSeasonYear, 'v7->v8 ran');
  });

  test('legacy v8 mid-season hydrate keeps V0 schedule untouched + preserves seasonMeta counters', () => {
    const seed = v8MidSeasonCareerSeed();
    const beforeEventsJson = JSON.stringify(seed.schedule.events);
    const hydrated = hydrateCareer(seed);
    assert.equal(hydrated.version, 9);
    assert.equal(hydrated.seasonMeta.scheduleVersion, 0);
    assert.equal(hydrated.seasonMeta.debuffEventCount, 1, 'debuffEventCount preserved');
    assert.equal(hydrated.seasonMeta.pinsThisSeason, 2, 'pinsThisSeason preserved');
    assert.equal(hydrated.seasonMeta.giantSlayerWinsThisSeason, 1, 'giantSlayerWinsThisSeason preserved');
    assert.equal(JSON.stringify(hydrated.schedule.events), beforeEventsJson);
  });
});

// --- Test 4 -----------------------------------------------------------------

describe('v9 hydration contract - advance to next season', () => {
  test('legacy v8 advance to next season produces V1 schedule + bumps scheduleVersion', () => {
    const seed = v8OffseasonCareerSeed();
    const hydrated = hydrateCareer(seed);
    assert.equal(hydrated.seasonMeta.scheduleVersion, 0);
    const advanced = advanceToNextSeason(hydrated);
    assert.equal(advanced.seasonMeta.scheduleVersion, 1, 'bumped to 1');
    assert.equal(advanced.schedule.events.length, 28, `V1 schedule produced; got ${advanced.schedule.events.length}`);
    const stateEvent = advanced.schedule.events.find(e => e.stakes === 'state');
    assert.equal(stateEvent.bracketSize, 128, 'State Championship is 128-bracket on advance');
  });
});

// --- Test 5 -----------------------------------------------------------------

describe('v9 hydration contract - idempotency', () => {
  test('re-hydrating an already-v9 career preserves scheduleVersion', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, state: 'PA', gender: 'male' });
    const hydrated = hydrateCareer(c);
    assert.equal(hydrated.version, 9);
    assert.equal(hydrated.seasonMeta.scheduleVersion, 1, 'fresh v9 stays at 1');

    const legacySeed = v8MidSeasonCareerSeed();
    const legacyHydrated = hydrateCareer(legacySeed);
    const reHydrated = hydrateCareer(legacyHydrated);
    assert.equal(reHydrated.seasonMeta.scheduleVersion, 0, 'legacy-derived v9 stays at 0');
  });
});

// --- Test 6 -----------------------------------------------------------------

describe('v9 hydration contract - v7 -> v8 -> v9 chain', () => {
  test('legacy v7 (pre-Depth Pass v1) chains through both migrations', () => {
    const seed = v8FreshCareerSeed(); // version 7
    assert.equal(seed.seasonMeta, undefined, 'v7 has no seasonMeta');
    const hydrated = hydrateCareer(seed);
    assert.equal(hydrated.version, 9);
    assert.ok(hydrated.seasonMeta, 'seasonMeta installed by v7->v8 step');
    assert.equal(hydrated.seasonMeta.scheduleVersion, 0, 'scheduleVersion installed by v8->v9 step');
    assert.ok(Number.isFinite(hydrated.seasonMeta.badgeEligibleSeasonYear), 'badgeEligibleSeasonYear installed');
    assert.equal(JSON.stringify(hydrated.schedule.events), JSON.stringify(seed.schedule.events), 'V0 events preserved');
  });
});

// --- Test 7 -----------------------------------------------------------------

// --- Test 8: exact-count contracts for College + Senior V1 -----------------

describe('v9 schedule exact-count contracts', () => {
  test('HS V1 schedule = 28 events (19 duals + 5 in-season tournaments + 4 postseason)', () => {
    const events = generateSeasonSchedule({
      tier: 'hs', seasonYear: 1, year: 1, weightClass: 138,
      style: 'folkstyle', gender: 'male', rivals: [], scheduleVersion: 1,
    });
    assert.equal(events.length, 28, 'HS V1 = 28 events');
    const byType = events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {});
    assert.equal(byType.dual_meet, 19, '19 duals');
    assert.equal(byType.tournament, 5, '5 in-season tournaments');
    assert.equal(byType.championship, 4, '4-level postseason (Conf + District + Regional + State)');
    // Postseason brackets: 16 / 32 / 64 / 128.
    const conf = events.find(e => e.stakes === 'conference' && e.type === 'championship');
    const district = events.find(e => e.stakes === 'district');
    const regional = events.find(e => e.stakes === 'regional');
    const state = events.find(e => e.stakes === 'state');
    assert.equal(conf?.bracketSize, 16, 'Conference Championships = 16-bracket');
    assert.equal(district?.bracketSize, 32, 'District Qualifier = 32-bracket');
    assert.equal(regional?.bracketSize, 64, 'Regional Tournament = 64-bracket');
    assert.equal(state?.bracketSize, 128, 'State Championship = 128-bracket');
  });

  test('College V1 schedule = 28 events (20 duals + 6 invitationals + Conf + NCAA)', () => {
    const events = generateSeasonSchedule({
      tier: 'college', seasonYear: 1, year: 1, weightClass: 157,
      gender: 'male', rivals: [], scheduleVersion: 1,
    });
    assert.equal(events.length, 28, 'College V1 = 28 events');
    const byType = events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {});
    assert.equal(byType.dual_meet, 20, '20 duals');
    assert.equal(byType.invitational, 6, '6 invitationals');
    assert.equal(byType.championship, 2, 'Conference + NCAA');
    const ncaa = events.find(e => e.stakes === 'ncaa');
    assert.equal(ncaa.bracketSize, 128, 'NCAA = 128-bracket');
  });

  test('Senior men V1 schedule = 18 base events (Worlds appended only on Trials win)', () => {
    const events = generateSeasonSchedule({
      tier: 'senior', seasonYear: 1, year: 1, weightClass: 74,
      style: 'freestyle', gender: 'male', rivals: [], scheduleVersion: 1,
    });
    assert.equal(events.length, 18, 'Senior men V1 base = 18 events');
    const trialsCount = events.filter(e =>
      e.stakes === 'world_trials' || e.stakes === 'olympic_trials').length;
    assert.equal(trialsCount, 2, 'Freestyle + Greco trials');
    const trial = events.find(e => e.stakes === 'world_trials' || e.stakes === 'olympic_trials');
    assert.equal(trial.bracketSize, 32, 'V1 Trials bumped 16 -> 32');
  });

  test('Senior women V1 schedule = 7 base events', () => {
    const events = generateSeasonSchedule({
      tier: 'senior', seasonYear: 1, year: 1, weightClass: 57,
      style: 'womens_freestyle', gender: 'female', rivals: [], scheduleVersion: 1,
    });
    assert.equal(events.length, 7, 'Senior women V1 base = 7 events');
  });
});

// --- Test 9: senior per-style weight stamping (Greco != Freestyle) ---------

describe('v9 senior per-style weight stamping', () => {
  test('Greco dual events carry wrestler.weights.greco kg, not wrestler.weightClass (freestyle)', () => {
    const weights = { freestyle: 74, greco: 77 };
    const events = generateSeasonSchedule({
      tier: 'senior', seasonYear: 1, year: 1,
      weightClass: 74, // display weight = freestyle
      style: 'freestyle', gender: 'male', rivals: [],
      scheduleVersion: 1,
      weights,
    });
    const grecoDual = events.find(e => e.type === 'dual_meet' && e.style === 'greco');
    assert.ok(grecoDual, 'V1 men senior has a Greco dual');
    assert.equal(grecoDual.weightClass, 77, 'Greco dual stamps 77kg (greco), not 74kg (freestyle)');
    const grecoTourney = events.find(e => e.type === 'tournament' && e.style === 'greco');
    assert.ok(grecoTourney, 'V1 men senior has a Greco tournament');
    assert.equal(grecoTourney.weightClass, 77, 'Greco tournament also stamps 77kg');
    const freestyleDual = events.find(e => e.type === 'dual_meet' && e.style === 'freestyle');
    assert.equal(freestyleDual.weightClass, 74, 'Freestyle dual stamps 74kg');
  });

  test('without weights map, senior events fall back to weightClass arg (legacy)', () => {
    const events = generateSeasonSchedule({
      tier: 'senior', seasonYear: 1, year: 1, weightClass: 74,
      style: 'freestyle', gender: 'male', rivals: [], scheduleVersion: 1,
      // no `weights` arg
    });
    const greco = events.find(e => e.style === 'greco');
    assert.equal(greco.weightClass, 74, 'fallback to 74 when weights absent');
  });
});

describe('v9 senior per-style weight - filler opponent', () => {
  test('Greco senior dual opponent.weightClass matches event.weightClass (77kg, not 74kg)', () => {
    const events = generateSeasonSchedule({
      tier: 'senior', seasonYear: 1, year: 1,
      weightClass: 74, style: 'freestyle', gender: 'male', rivals: [],
      scheduleVersion: 1,
      weights: { freestyle: 74, greco: 77 },
    });
    const grecoDual = events.find(e => e.type === 'dual_meet' && e.style === 'greco');
    assert.ok(grecoDual, 'V1 senior men has a Greco dual');
    assert.equal(grecoDual.weightClass, 77, 'event weight is greco kg');
    assert.equal(grecoDual.opponent?.weightClass, 77, 'opponent weight matches event weight (not freestyle 74)');
    assert.equal(grecoDual.opponent?.style, 'greco', 'opponent style is greco');
  });
});

describe('v9 Worlds-followup per-style weight', () => {
  test('Greco Trials win appends Greco Worlds at wrestler.weights.greco (77kg), not freestyle (74kg)', () => {
    // Build a senior man with full per-style weights, in_season, with a
    // Greco Trials event sitting in the schedule.
    const career = {
      id: 'c1', version: 9,
      phase: 'in_season',
      wrestler: {
        name: 'Senior Test', tier: 'senior', year: 5, age: 22,
        weightClass: 74, state: 'PA', gender: 'male',
        style: 'freestyle',
        weights: { freestyle: 74, greco: 77 },
        stats: { str: 80, spd: 80, tec: 80, end: 80, grt: 80 },
        statPointsAvailable: 0, xp: 0, level: 1,
        skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
        unlockedCardIds: [], injuries: [], school: null,
      },
      schedule: {
        seasonYear: 1,
        events: [{
          id: 'evt_y1_w23_17',
          seasonYear: 1, year: 5, week: 23,
          type: 'championship',
          name: 'Greco World Team Trials',
          weightClass: 77,
          style: 'greco',
          status: 'upcoming',
          result: null,
          bracketSize: 32,
          stakes: 'world_trials',
          bestOf: 3,
          seededRivalIds: [],
        }],
        currentEventIdx: 0,
      },
      rivals: [],
      record: {
        seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
        pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [],
      },
      rankingPool: [],
      rankings: { conference: 1, section: 1, state: 1, asOfEventIdx: 0 },
      seasonMeta: {
        debuffEventCount: 0, pinsThisSeason: 0, giantSlayerWinsThisSeason: 0,
        badgeEligibleSeasonYear: 1, badgeEligibleFromVersion: 9,
        scheduleVersion: 1,
      },
    };
    const after = recordEventResult(career, 'evt_y1_w23_17', {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision', placement: 1,
    });
    const worlds = after.schedule.events.find(e => e.stakes === 'world_championship');
    assert.ok(worlds, 'Worlds appended after Trials win');
    assert.equal(worlds.style, 'greco', 'Worlds style = greco');
    assert.equal(worlds.weightClass, 77, 'Worlds weight = greco kg (77), not freestyle (74)');
    assert.equal(worlds.bracketSize, 128, 'V1 Worlds = 128 bracket');
  });
});

// --- Test 10: dual snapshot resume accepts per-style weight ----------------

describe('v9 dual snapshot resume - per-style weight gate', () => {
  test('resume accepts Greco dual snapshot whose heroWeightClass != wrestler.weightClass', () => {
    const career = {
      phase: 'in_season',
      wrestler: {
        tier: 'senior', style: 'freestyle', gender: 'male',
        weightClass: 74, // freestyle display weight
        weights: { freestyle: 74, greco: 77 },
      },
      schedule: {
        events: [{
          id: 'evt_y1_w6_5',
          type: 'dual_meet',
          style: 'greco',
          weightClass: 77, // per-style stamped at schedule time
          status: 'upcoming',
        }],
      },
    };
    const dual = {
      phase: 'in_progress',
      careerEventId: 'evt_y1_w6_5',
      heroWeightClass: 77, // Greco kg
      weights: [55, 60, 63, 67, 72, 77, 82, 87, 97, 130],
    };
    assert.equal(isCareerDualMeetSnapshotResumable(career, dual), true,
      'Greco snapshot at 77kg resumable against senior man with freestyle.weightClass=74');
  });

  test('resume rejects when heroWeightClass matches neither event nor any per-style weight', () => {
    const career = {
      phase: 'in_season',
      wrestler: {
        tier: 'senior', style: 'freestyle', gender: 'male',
        weightClass: 74, weights: { freestyle: 74, greco: 77 },
      },
      schedule: { events: [{
        id: 'evt_x', type: 'dual_meet', style: 'greco',
        weightClass: 77, status: 'upcoming',
      }] },
    };
    const dual = {
      phase: 'in_progress', careerEventId: 'evt_x',
      heroWeightClass: 999, // bogus
      weights: [55, 60, 63, 67, 72, 77, 82, 87, 97, 130, 999],
    };
    assert.equal(isCareerDualMeetSnapshotResumable(career, dual), false);
  });
});

describe('v9 qualifyFrom 4-level chain pruning', () => {
  test('R1 conference loss prunes district + regional + state on V1 schedule', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, state: 'PA', gender: 'male' });
    const confChamp = c.schedule.events.find(e => e.stakes === 'conference');
    assert.ok(confChamp, 'V1 schedule has a conference event');
    // simulate R1 conference loss
    const after = recordEventResult(c, confChamp.id, {
      playerWon: false, p1Score: 1, p2Score: 5, winMethod: 'decision', placement: 9,
    });
    const remaining = after.schedule.events.filter(e =>
      ['district', 'regional', 'state'].includes(e.stakes));
    assert.equal(remaining.length, 0, 'district + regional + state pruned');
  });

  test('district win + R1 regional loss prunes state only', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, state: 'PA', gender: 'male' });
    const confChamp = c.schedule.events.find(e => e.stakes === 'conference');
    let career = recordEventResult(c, confChamp.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision', placement: 1,
    });
    const districtEvent = career.schedule.events.find(e => e.stakes === 'district');
    assert.ok(districtEvent, 'district still present after conference top-1');
    career = recordEventResult(career, districtEvent.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision', placement: 1,
    });
    const regionalEvent = career.schedule.events.find(e => e.stakes === 'regional');
    assert.ok(regionalEvent, 'regional still present after district top-1');
    career = recordEventResult(career, regionalEvent.id, {
      playerWon: false, p1Score: 1, p2Score: 5, winMethod: 'decision', placement: 9,
    });
    assert.equal(career.schedule.events.filter(e => e.stakes === 'state').length, 0,
      'state pruned after R1 regional loss');
    // district + regional + state in pre-prune events list - district + regional
    // remain because the player ran them, state is gone.
    assert.equal(career.schedule.events.filter(e => e.stakes === 'district').length, 1,
      'district event still present (played)');
    assert.equal(career.schedule.events.filter(e => e.stakes === 'regional').length, 1,
      'regional event still present (played)');
  });
});
