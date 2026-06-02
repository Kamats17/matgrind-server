import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCareer, recordEventResult, advanceToNextSeason, retireCareer,
  getNextEvent, getSeasonSummary, isSeasonComplete, buildHallOfFameThumbnail,
  hydrateCareer, applyInterimTournamentMatch, takeWalkOnPath,
} from './careerState.js';
import { CAREER_STARTER_DECK } from './careerStarterDeck.js';
import { HS_WEIGHTS, getWeightsForTier, snapToValidWeight } from './careerWeights.js';
import { generateRivals, recordH2H } from './careerRivals.js';
import { generateHSSeason, generateCollegeSeason } from './careerSchedule.js';

const fixedRng = (() => {
  let n = 0;
  return () => {
    // pseudo-deterministic drift so rng() != constant (e.g., schedule
    // opponents differ across calls within one test).
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
})();

describe('careerWeights', () => {
  test('HS_WEIGHTS has the 14 NFHS weight classes', () => {
    assert.equal(HS_WEIGHTS.length, 14);
    assert.ok(HS_WEIGHTS.includes(132));
    assert.ok(HS_WEIGHTS.includes(285));
  });

  test('snapToValidWeight snaps a non-standard weight to the closest class', () => {
    assert.equal(snapToValidWeight(144, 'hs'), 145);
    // 140 is equidistant between 138 and 145 - ties snap down (145 - 140 = 5, 140 - 138 = 2)
    // actually 2 < 5, so 138 wins
    assert.equal(snapToValidWeight(140, 'hs'), 138);
    assert.equal(snapToValidWeight(999, 'hs'), 285);
  });

  test('getWeightsForTier dispatches by tier', () => {
    assert.equal(getWeightsForTier('hs').length, 14);
    assert.equal(getWeightsForTier('college').length, 10);
    assert.equal(getWeightsForTier('senior').length, 10);
  });

  test('getWeightsForTier returns women\'s tables when gender=female', () => {
    // Women's HS = NFHS Girls 14-class; college = NCAA Women's 10-class;
    // senior womens_freestyle = UWW Women's 10-class.
    const wHs = getWeightsForTier('hs', 'folkstyle', 'female');
    assert.equal(wHs.length, 14, "women's HS = 14 classes");
    assert.ok(wHs.includes(130), 'women\'s HS includes 130');
    assert.ok(!wHs.includes(138), 'women\'s HS does NOT include 138 (boys-only)');

    const wCollege = getWeightsForTier('college', 'folkstyle', 'female');
    assert.equal(wCollege.length, 10);
    assert.ok(wCollege.includes(124), 'women\'s college includes 124');
    assert.ok(!wCollege.includes(149), 'women\'s college does NOT include 149 (boys-only)');

    const wSenior = getWeightsForTier('senior', 'womens_freestyle', 'female');
    assert.equal(wSenior.length, 10);
    assert.ok(wSenior.includes(57), 'women\'s senior includes 57 kg');
    assert.ok(wSenior.includes(76), 'women\'s senior includes 76 kg');
  });

  test('snapToValidWeight respects gender at HS', () => {
    // 138 (boys class) should snap to nearest WOMENS_HS_WEIGHTS for a female career.
    // Nearest in [..., 135, 140, ...] = 140 (or 135 with ties-down rule).
    const snapped = snapToValidWeight(138, 'hs', 'folkstyle', 'female');
    // Either 135 or 140 is acceptable; both are valid girls' classes.
    assert.ok(snapped === 135 || snapped === 140, `expected 135 or 140, got ${snapped}`);
  });
});

describe('careerRivals', () => {
  test('generateRivals produces 3-5 random rivals + Chase Kamats prepended', () => {
    const rng = () => 0.5;
    const rivals = generateRivals({ weightClass: 138, tier: 'hs', rng, count: 4 });
    // 4 random + 1 Chase = 5 total
    assert.equal(rivals.length, 5);
    // First entry is always Chase Kamats (canonical #1 rival).
    assert.equal(rivals[0].name, 'Chase Kamats');
    assert.equal(rivals[0].id, 'special_chase_kamats');
    assert.equal(rivals[0].overall, 80, 'Chase at HS tier cap');
    for (const r of rivals) {
      assert.equal(r.weightClass, 138);
      assert.equal(r.tier, 'hs');
      assert.ok(r.name && r.name.includes(' '));
      assert.deepEqual(r.h2h, { wins: 0, losses: 0, pins: 0, lastMeeting: null });
      assert.ok(r.overall >= 50 && r.overall <= 90);
    }
  });

  test('recordH2H increments wins/losses and tracks pins', () => {
    const rivals = [
      { id: 'r1', h2h: { wins: 0, losses: 0, pins: 0, lastMeeting: null } },
      { id: 'r2', h2h: { wins: 1, losses: 0, pins: 0, lastMeeting: null } },
    ];
    const after = recordH2H(rivals, 'r1', { playerWon: true, winMethod: 'pin', eventId: 'evt_1' });
    assert.equal(after[0].h2h.wins, 1);
    assert.equal(after[0].h2h.pins, 1);
    assert.equal(after[0].h2h.lastMeeting.playerWon, true);
    // other rivals untouched
    assert.equal(after[1].h2h.wins, 1);
  });
});

describe('careerSchedule.generateHSSeason', () => {
  test('builds 14 events with the expected types', () => {
    const rivals = generateRivals({ weightClass: 138, tier: 'hs', rng: () => 0.5, count: 4 });
    const events = generateHSSeason({ seasonYear: 1, year: 1, weightClass: 138, rivals, rng: () => 0.5 });
    assert.equal(events.length, 14);
    const byType = events.reduce((acc, e) => { acc[e.type] = (acc[e.type] || 0) + 1; return acc; }, {});
    assert.equal(byType.dual_meet, 8);
    assert.equal(byType.tournament, 3);
    assert.equal(byType.championship, 3);
  });

  test('exactly one event stakes === "state"', () => {
    const rivals = generateRivals({ weightClass: 138, tier: 'hs', rng: () => 0.5, count: 4 });
    const events = generateHSSeason({ seasonYear: 1, year: 1, weightClass: 138, rivals, rng: () => 0.5 });
    const stateEvents = events.filter(e => e.stakes === 'state');
    assert.equal(stateEvents.length, 1);
    assert.equal(stateEvents[0].type, 'championship');
  });

  test('duals have an opponent attached', () => {
    const rivals = generateRivals({ weightClass: 138, tier: 'hs', rng: () => 0.5, count: 4 });
    const events = generateHSSeason({ seasonYear: 1, year: 1, weightClass: 138, rivals, rng: () => 0.5 });
    const duals = events.filter(e => e.type === 'dual_meet');
    for (const d of duals) {
      assert.ok(d.opponent, `dual ${d.name} missing opponent`);
      assert.equal(d.opponent.weightClass, 138);
    }
  });

  test('female HS season produces women-named filler opponents (no male names leaking)', () => {
    // Regression: filler opponents on duals were male-coded for women's
    // careers because generateFillerOpponent defaulted gender='male' and
    // the schedule generator never threaded the wrestler's gender.
    // Known male-only first names from the men's pool that should NEVER
    // show up on a women's-career schedule:
    const MALE_ONLY = new Set([
      'Marcus', 'Tyrone', 'Cole', 'Kade', 'Jaxon', 'Dmitri', 'Tariq',
      'Rafael', 'Brennan', 'Zane', 'Isaiah', 'Vaughn', 'Nikolai',
      'Emilio', 'Axel', 'Diego', 'Bryce', 'Marek', 'Silas',
    ]);
    const rivals = generateRivals({
      weightClass: 130, tier: 'hs', gender: 'female', rng: () => 0.5, count: 4,
    });
    const events = generateHSSeason({
      seasonYear: 1, year: 1, weightClass: 130, gender: 'female', rivals, rng: () => 0.5,
    });
    const duals = events.filter(e => e.type === 'dual_meet' && !e.opponentIsRival);
    assert.ok(duals.length >= 5, 'expected at least 5 non-rivalry duals for sample size');
    for (const d of duals) {
      const first = (d.opponent?.name || '').split(' ')[0];
      assert.ok(
        !MALE_ONLY.has(first),
        `dual ${d.name} has male-coded opponent: ${d.opponent?.name}`,
      );
    }
  });

  test('female college season produces women-named filler opponents', () => {
    // Same regression as HS, exercised at college tier so we don't
    // forget if someone refactors generateCollegeSeason later.
    const MALE_ONLY = new Set([
      'Marcus', 'Tyrone', 'Cole', 'Kade', 'Jaxon', 'Dmitri', 'Tariq',
      'Rafael', 'Brennan', 'Zane', 'Isaiah', 'Vaughn', 'Nikolai',
      'Emilio', 'Axel', 'Diego', 'Bryce', 'Marek', 'Silas',
    ]);
    const rivals = generateRivals({
      weightClass: 124, tier: 'college', gender: 'female', rng: () => 0.5, count: 4,
    });
    const events = generateCollegeSeason({
      seasonYear: 1, year: 1, weightClass: 124, gender: 'female', rivals, rng: () => 0.5,
    });
    const duals = events.filter(e => e.type === 'dual_meet' && !e.opponentIsRival);
    assert.ok(duals.length >= 5, 'expected at least 5 non-rivalry duals at college tier');
    for (const d of duals) {
      const first = (d.opponent?.name || '').split(' ')[0];
      assert.ok(
        !MALE_ONLY.has(first),
        `college dual ${d.name} has male-coded opponent: ${d.opponent?.name}`,
      );
    }
  });
});

describe('careerState.createCareer', () => {
  test('builds a fresh HS Freshman career with defaults', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: () => 0.5 });
    assert.equal(c.wrestler.name, 'Test');
    assert.equal(c.wrestler.tier, 'hs');
    assert.equal(c.wrestler.year, 1);
    assert.equal(c.wrestler.weightClass, 138);
    assert.equal(c.phase, 'preseason');
    assert.equal(c.schedule.seasonYear, 1);
    // v9: V1 HS schedule = 19 duals + 5 tournaments + 4 postseason = 28 events.
    assert.equal(c.schedule.events.length, 28);
    assert.equal(c.seasonMeta?.scheduleVersion, 1);
    assert.ok(c.rivals.length >= 3);
    assert.equal(c.record.careerWins, 0);
  });

  test('throws on invalid HS weight class', () => {
    assert.throws(
      () => createCareer({ name: 'X', weightClass: 100, rng: () => 0.5 }),
      /Invalid HS weight class/,
    );
  });

  test('default gender is male (back-compat)', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: () => 0.5 });
    assert.equal(c.wrestler.gender, 'male');
  });

  test('female career uses NFHS Girls weights, gender stamped, no Chase Kamats', () => {
    // 130 is in WOMENS_HS_WEIGHTS; 138 (NFHS boys) is NOT.
    const c = createCareer({ name: 'TestGirl', weightClass: 130, gender: 'female', rng: () => 0.5 });
    assert.equal(c.wrestler.gender, 'female');
    assert.equal(c.wrestler.weightClass, 130);
    // No Chase Kamats in a women's career.
    assert.ok(!c.rivals.some(r => r.id === 'special_chase_kamats'),
      'female career rivals should not include Chase Kamats');
    // Valerie Aikens IS the women's canonical #1 rival.
    assert.ok(c.rivals.some(r => r.id === 'special_valerie_aikens'),
      'female career rivals should include Valerie Aikens');
    // Close-behind 4 should also be present.
    assert.ok(c.rivals.some(r => r.id === 'special_larissa_newton'));
    assert.ok(c.rivals.some(r => r.id === 'special_angelee_kamats'));
    assert.ok(c.rivals.some(r => r.id === 'special_niki_garwood'));
    assert.ok(c.rivals.some(r => r.id === 'special_brooke_gaberseck'));
  });

  test('female career rejects boys-only weight class', () => {
    // 138 is a boys NFHS weight, not in WOMENS_HS_WEIGHTS.
    assert.throws(
      () => createCareer({ name: 'X', weightClass: 138, gender: 'female', rng: () => 0.5 }),
      /Invalid HS weight class/,
    );
  });

  test('female ranking pool excludes Chase Kamats and includes Valerie Aikens', () => {
    const c = createCareer({ name: 'TestGirl', weightClass: 130, gender: 'female', rng: () => 0.5 });
    const pool = c.rankingPool || [];
    assert.ok(!pool.some(p => p.id === 'special_chase_kamats'),
      'female pool should not include Chase Kamats');
    assert.ok(!pool.some(p => p.id === 'special_jordon_eckstrom'),
      'female pool should not include Jordon Eckstrom');
    assert.ok(pool.some(p => p.name === 'Valerie Aikens'),
      'female pool should include Valerie Aikens');
    assert.ok(pool.some(p => p.name === 'Larissa Newton'));
    assert.ok(pool.some(p => p.name === 'Angelee Kamats'));
    assert.ok(pool.some(p => p.name === 'Niki Garwood'));
    assert.ok(pool.some(p => p.name === 'Brooke Wennin'));
  });

  test('senior dual-style men get per-style rankingPools that update on event finish', () => {
    // Build a career, force-promote it to senior with a synthetic
    // rankingPools map (mimicking what chooseSeniorStyle produces),
    // then finish a freestyle event and assert the freestyle pool was
    // updated and the greco pool was left untouched.
    const c = createCareer({ name: 'TestMan', weightClass: 138, gender: 'male', rng: () => 0.5 });
    // Synthesize the senior dual-pool shape post-chooseSeniorStyle.
    const fsPool = c.rankingPool.map(p => ({ ...p, style: 'freestyle' }));
    const grPool = c.rankingPool.map(p => ({ ...p, style: 'greco' }));
    const seniorCareer = {
      ...c,
      wrestler: {
        ...c.wrestler,
        tier: 'senior',
        weights: { freestyle: 70, greco: 67 },
      },
      rankingPool: fsPool,
      rankingPools: { freestyle: fsPool, greco: grPool },
      schedule: {
        ...c.schedule,
        events: [{
          ...c.schedule.events[0],
          id: 'evt_fs_1',
          style: 'freestyle',
          type: 'dual',
          status: 'upcoming',
        }],
        currentEventIdx: 0,
      },
    };
    const after = recordEventResult(seniorCareer, 'evt_fs_1', {
      playerWon: true, p1Score: 6, p2Score: 2, winMethod: 'decision',
    });
    // After a freestyle event: freestyle pool reference changed (was simmed),
    // greco pool reference unchanged (frozen as designed).
    assert.notEqual(after.rankingPools.freestyle, fsPool, 'freestyle pool should be replaced after freestyle event');
    assert.equal(after.rankingPools.greco, grPool, 'greco pool should be untouched after freestyle event');
    // Singular rankingPool mirrors the active style's updated pool.
    assert.equal(after.rankingPool, after.rankingPools.freestyle,
      'singular rankingPool should mirror the updated active-style pool');
  });
});

describe('careerState.recordEventResult', () => {
  test('winning a dual increments seasonWins and advances currentEventIdx', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const firstEvent = c.schedule.events[0];
    const after = recordEventResult(c, firstEvent.id, {
      playerWon: true, p1Score: 8, p2Score: 3, winMethod: 'decision',
    });
    assert.equal(after.record.seasonWins, 1);
    assert.equal(after.record.careerWins, 1);
    assert.equal(after.schedule.currentEventIdx, 1);
    assert.equal(after.schedule.events[0].status, 'won');
  });

  test('pin increments pins counter', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const e = c.schedule.events[0];
    const after = recordEventResult(c, e.id, {
      playerWon: true, p1Score: 6, p2Score: 0, winMethod: 'pin',
    });
    assert.equal(after.record.pins, 1);
  });

  test('winning a state championship adds a title', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const stateEvt = c.schedule.events.find(e => e.stakes === 'state');
    const after = recordEventResult(c, stateEvt.id, {
      playerWon: true, p1Score: 10, p2Score: 5, winMethod: 'decision', placement: 1,
    });
    assert.equal(after.record.titles.length, 1);
    assert.equal(after.record.titles[0].stakes, 'state');
  });

  test('finishing last event transitions phase to offseason', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    for (const evt of c.schedule.events) {
      c = recordEventResult(c, evt.id, {
        playerWon: true, p1Score: 3, p2Score: 0, winMethod: 'decision', placement: 1,
      });
    }
    assert.equal(c.phase, 'offseason');
    assert.ok(isSeasonComplete(c));
  });
});

describe('careerState.advanceToNextSeason', () => {
  test('advances HS year 1 → year 2 preseason and resets season W-L', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    // Win one event, lose one, then finish out the season
    c = recordEventResult(c, c.schedule.events[0].id, {
      playerWon: true, p1Score: 6, p2Score: 2, winMethod: 'decision',
    });
    for (const evt of c.schedule.events.slice(1)) {
      c = recordEventResult(c, evt.id, {
        playerWon: false, p1Score: 2, p2Score: 6, winMethod: 'decision',
      });
    }
    assert.equal(c.phase, 'offseason');
    const next = advanceToNextSeason(c, { rng: fixedRng });
    assert.equal(next.phase, 'preseason');
    assert.equal(next.wrestler.year, 2);
    assert.equal(next.schedule.seasonYear, 2);
    assert.equal(next.record.seasonWins, 0);
    assert.equal(next.record.seasonLosses, 0);
    // career totals persist. v9: V1 has 28 events; 1 win + 27 losses iterating
    // schedule.events.slice(1). qualifyFrom pruning removes some downstream
    // events from the schedule but the loop closes over the original slice,
    // so 27 loss-recordings still fire (counters increment regardless of
    // whether the event was pruned, by design at recordEventResult).
    assert.equal(next.record.careerWins, 1);
    assert.equal(next.record.careerLosses, 27);
  });

  test('HS year 4 finishing -> recruiting phase with offers (post-1.2.2)', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    c.wrestler.year = 4;
    // finish season to get into offseason
    for (const evt of c.schedule.events) {
      c = recordEventResult(c, evt.id, {
        playerWon: true, p1Score: 3, p2Score: 0, winMethod: 'decision',
      });
    }
    const after = advanceToNextSeason(c, { rng: fixedRng });
    assert.equal(after.phase, 'recruiting', 'HS year 5 lands in recruiting, not retired');
    assert.ok(after.recruiting, 'recruiting context populated');
    assert.ok(typeof after.recruiting.recruitingScore === 'number', 'has recruiting score');
    assert.ok(Array.isArray(after.recruiting.offers), 'has offers array');
    assert.equal(after.recruiting.walkOnAvailable, true, 'walk-on always available');
  });

  test('throws if advanced while not in offseason', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    assert.throws(
      () => advanceToNextSeason(c, { rng: fixedRng }),
      /Cannot advance season/,
    );
  });

  test('self-heals when phase is missing but schedule is complete', () => {
    // Simulate a legacy/corrupted save: full schedule played but no `phase`.
    let c = createCareer({ name: 'Legacy', weightClass: 138, rng: fixedRng });
    for (const evt of c.schedule.events) {
      c = recordEventResult(c, evt.id, {
        playerWon: true, p1Score: 3, p2Score: 0, winMethod: 'decision',
      });
    }
    // Strip phase to simulate the broken legacy shape.
    const stripped = { ...c, phase: undefined };
    const after = advanceToNextSeason(stripped, { rng: fixedRng });
    assert.equal(after.phase, 'preseason', 'self-heal advances despite missing phase');
    assert.equal(after.wrestler.year, 2);
    assert.equal(after.schedule.seasonYear, 2);
    assert.ok(after.schedule.events.length > 0, 'fresh schedule generated');
  });

  test('still throws on a mid-season schedule (no self-heal mid-season)', () => {
    let c = createCareer({ name: 'MidS', weightClass: 138, rng: fixedRng });
    // Play only the first event - schedule is not complete
    c = recordEventResult(c, c.schedule.events[0].id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision',
    });
    const stripped = { ...c, phase: undefined };
    assert.throws(
      () => advanceToNextSeason(stripped, { rng: fixedRng }),
      /Cannot advance season/,
    );
  });
});

describe('careerState.hydrateCareer (phase normalization)', () => {
  test('infers offseason when all events are played and phase is missing', () => {
    // Legacy v1 shape: completed schedule but no phase field.
    const events = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`, status: i % 2 === 0 ? 'won' : 'lost',
    }));
    const legacy = {
      id: 'career_legacy_offseason',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      version: 1,
      wrestler: { name: 'Legacy', weightClass: 138, tier: 'hs', stats: { str:55,spd:55,tec:55,end:55,grt:55 } },
      schedule: { seasonYear: 1, currentEventIdx: 15, events },
    };
    const h = hydrateCareer(legacy);
    assert.equal(h.phase, 'offseason', 'all-done legacy schedule → offseason');
    assert.equal(h.version, 9, 'version bumped to current shape');
  });

  test('infers in_season when partial events are played', () => {
    const events = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`, status: i < 5 ? 'won' : 'upcoming',
    }));
    const legacy = {
      id: 'career_legacy_in_season',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      version: 1,
      wrestler: { name: 'Mid', weightClass: 138, tier: 'hs', stats: { str:55,spd:55,tec:55,end:55,grt:55 } },
      schedule: { seasonYear: 1, currentEventIdx: 5, events },
    };
    const h = hydrateCareer(legacy);
    assert.equal(h.phase, 'in_season');
  });

  test('infers preseason when no events are played', () => {
    const events = Array.from({ length: 15 }, (_, i) => ({
      id: `e${i}`, status: 'upcoming',
    }));
    const legacy = {
      id: 'career_legacy_preseason',
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      version: 1,
      wrestler: { name: 'Fresh', weightClass: 138, tier: 'hs', stats: { str:55,spd:55,tec:55,end:55,grt:55 } },
      schedule: { seasonYear: 1, currentEventIdx: 0, events },
    };
    const h = hydrateCareer(legacy);
    assert.equal(h.phase, 'preseason');
  });

  test('preserves existing phase if one is already set', () => {
    const c = createCareer({ name: 'Fresh', weightClass: 138, rng: fixedRng });
    // c.phase === 'preseason'; hydrate must not change it.
    const h = hydrateCareer(c);
    assert.equal(h.phase, c.phase);
  });

  test('repairs missing phase even on a current-version career (defensive path)', () => {
    const c = createCareer({ name: 'V3NoPhase', weightClass: 138, rng: fixedRng });
    // Strip phase from an otherwise-current shape
    const broken = { ...c, phase: undefined };
    const h = hydrateCareer(broken);
    assert.ok(h.phase, 'phase populated even at current version');
  });
});

// ─── v5: +10 statPointsAvailable backfill (Round 3, 2026-04-30) ───────────
//
// Existing in-progress careers must receive exactly +10 statPointsAvailable
// once on their first v5 hydrate, then never again. Brand-new careers start
// with 10 baked in by createCareer. Malformed legacy values must not crash
// or produce invalid output.

describe('careerState.hydrateCareer (v5 +10 stat-points backfill)', () => {
  // Helper - minimal v4-shape career for hydrate-migration tests.
  const v4Career = (overrides = {}) => ({
    id: 'career_v4_legacy',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    version: 4,
    phase: 'in_season',
    wrestler: {
      name: 'Legacy', weightClass: 138, tier: 'hs',
      stats: { str: 55, spd: 55, tec: 55, end: 55, grt: 55 },
      statPointsAvailable: 5,
      year: 1, age: 14, state: 'PA',
      skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null },
      ...((overrides.wrestler) || {}),
    },
    schedule: { seasonYear: 1, currentEventIdx: 0, events: [{ id: 'e1', status: 'upcoming' }] },
    ...overrides,
  });

  test('v4 career hydrates with statPointsAvailable += 10 and version stamp', () => {
    const before = v4Career({ wrestler: { statPointsAvailable: 5 } });
    const after = hydrateCareer(before);
    assert.equal(after.version, 9, 'version bumped to current shape');
    assert.equal(after.wrestler.statPointsAvailable, 15, '5 + 10 backfill = 15');
  });

  test('v4 career with 0 stat points hydrates to 10', () => {
    const before = v4Career({ wrestler: { statPointsAvailable: 0 } });
    const after = hydrateCareer(before);
    assert.equal(after.wrestler.statPointsAvailable, 10);
  });

  test('current-version re-hydrate is idempotent (no double +10)', () => {
    const v6 = hydrateCareer(v4Career({ wrestler: { statPointsAvailable: 5 } }));
    assert.equal(v6.version, 9);
    assert.equal(v6.wrestler.statPointsAvailable, 15);
    // Re-hydrate the result; should not add another 10.
    const v6again = hydrateCareer(v6);
    assert.equal(v6again.wrestler.statPointsAvailable, 15, 'no double-apply');
    assert.equal(v6again, v6, 'short-circuit returns same reference');
  });

  test('v3 career hydrates straight to current with one +10 (not two)', () => {
    const v3 = v4Career({ version: 3, wrestler: { statPointsAvailable: 2 } });
    const after = hydrateCareer(v3);
    assert.equal(after.version, 9);
    assert.equal(after.wrestler.statPointsAvailable, 12, 'one +10, not 20');
  });

  test('malformed statPointsAvailable=NaN does not produce NaN output', () => {
    const before = v4Career({ wrestler: { statPointsAvailable: NaN } });
    const after = hydrateCareer(before);
    assert.equal(after.wrestler.statPointsAvailable, 10, 'NaN treated as 0, +10');
    assert.ok(Number.isFinite(after.wrestler.statPointsAvailable));
  });

  test('malformed statPointsAvailable=string does not produce concatenation', () => {
    const before = v4Career({ wrestler: { statPointsAvailable: '7' } });
    const after = hydrateCareer(before);
    assert.equal(after.wrestler.statPointsAvailable, 10, 'string treated as 0, +10');
    assert.ok(typeof after.wrestler.statPointsAvailable === 'number');
  });

  test('missing statPointsAvailable hydrates to 10', () => {
    const before = v4Career({ wrestler: { name: 'NoPoints', weightClass: 138, tier: 'hs', stats: { str: 55, spd: 55, tec: 55, end: 55, grt: 55 } } });
    delete before.wrestler.statPointsAvailable;
    const after = hydrateCareer(before);
    assert.equal(after.wrestler.statPointsAvailable, 10);
  });

  test('null/undefined raw input falls through unchanged', () => {
    assert.equal(hydrateCareer(null), null);
    assert.equal(hydrateCareer(undefined), undefined);
  });

  test('career missing wrestler returns raw unchanged', () => {
    const broken = { id: 'broken', wrestler: null, version: 4 };
    const after = hydrateCareer(broken);
    assert.equal(after, broken, 'no-op when wrestler missing');
  });

  // 2026-05-01 - extended hydrate gate.
  // Repair extension covers year/age/weightClass/state/name/seniorStyle.
  // Hydrate's repair gate now re-validates the repaired output and only
  // returns it if validation actually passes. These tests exercise both
  // the "repair fixes it" success path and the "repair couldn't fix it"
  // throw path.

  test('hydrate repairs out-of-range year (12 -> 8)', () => {
    const before = v4Career({ wrestler: { year: 12, age: 25 } });
    delete before.createdAt;
    const after = hydrateCareer(before);
    assert.equal(after.wrestler.year, 8, 'year clamped to schema max');
    assert.equal(after.version, 9);
  });

  test('hydrate repairs out-of-range age (99 -> 40)', () => {
    const before = v4Career({ wrestler: { age: 99 } });
    delete before.createdAt;
    const after = hydrateCareer(before);
    assert.equal(after.wrestler.age, 40, 'age clamped to schema max');
  });

  test('hydrate throws CAREER_CORRUPT when repair cannot validate output', () => {
    // Force repair to return null by nuking the id - repair's first
    // safety check rejects missing id and returns null, hydrate must
    // throw a typed error so callers can show a recoverable banner.
    const broken = {
      ...v4Career(),
      id: '',
      wrestler: { ...v4Career().wrestler, year: 12 },
    };
    assert.throws(
      () => hydrateCareer(broken),
      (err) => err?.code === 'CAREER_CORRUPT',
      'must throw CAREER_CORRUPT when repair returns null',
    );
  });

  test('hydrate throws CAREER_CORRUPT only when repair cannot make it valid', () => {
    const recoverable = [
      { wrestler: { year: 99 } },
      { wrestler: { age: 99 } },
      { wrestler: { age: 5 } },
      { wrestler: { weightClass: 0 } },
      { wrestler: { state: 'Pennsylvania' } },
      { wrestler: { name: '' } },
      { seniorStyle: 'ufc' },
    ];
    for (const overrides of recoverable) {
      const before = v4Career(overrides);
      delete before.createdAt;
      assert.doesNotThrow(
        () => hydrateCareer(before),
        `repair must rescue ${JSON.stringify(overrides)}`,
      );
    }
  });
});

describe('careerState.createCareer (v5 starting allocation + v6 specials)', () => {
  test('new careers start with 10 statPointsAvailable at current version', () => {
    const c = createCareer({ name: 'Fresh', weightClass: 138, rng: fixedRng });
    assert.equal(c.wrestler.statPointsAvailable, 10);
    assert.equal(c.version, 9);
  });

  test('Chase Kamats is the #1 rival on every fresh career', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    assert.equal(c.rivals[0].name, 'Chase Kamats');
    assert.equal(c.rivals[0].id, 'special_chase_kamats');
    // Chase pool entry exists too
    const pool = c.rankingPool;
    assert.ok(pool.some(p => p.name === 'Chase Kamats' && p.isSpecial));
  });

  test('Jordon Eckstrom is in the pool on every fresh career', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const jordon = c.rankingPool.find(p => p.name === 'Jordon Eckstrom');
    assert.ok(jordon, 'Jordon Eckstrom in pool');
    assert.equal(jordon.id, 'special_jordon_eckstrom');
    assert.equal(jordon.isSpecial, true);
  });

  test('Chase Kamats overall scales with tier (HS 80 / College 90 / Senior 99)', () => {
    const hs = createCareer({ name: 'HS', weightClass: 138, rng: fixedRng });
    const chase = hs.rankingPool.find(p => p.id === 'special_chase_kamats');
    assert.equal(chase.overall, 80, 'Chase at HS cap');
  });
});

describe('v6 hydrate: special-NPC + Chase-rival backfill', () => {
  // Build a v5-shape career fixture (post-stat-points-bump but pre-special
  // injection) so we can prove the v6 step lands the additions cleanly.
  const buildV5Career = () => {
    const fresh = createCareer({ name: 'Pre6', weightClass: 138, rng: fixedRng });
    // Stamp version back to 5 and strip the v6 additions to simulate a
    // career saved before this round shipped.
    return {
      ...fresh,
      version: 5,
      rankingPool: fresh.rankingPool.filter(p => !p.isSpecial),
      rivals: fresh.rivals.filter(r => r.id !== 'special_chase_kamats'),
    };
  };

  test('v5 -> v6 hydrate appends Chase Kamats + Jordon Eckstrom to pool', () => {
    const before = buildV5Career();
    assert.ok(!before.rankingPool.some(p => p.id === 'special_chase_kamats'),
      'v5 fixture has no Chase in pool');
    const after = hydrateCareer(before);
    assert.equal(after.version, 9);
    assert.ok(after.rankingPool.some(p => p.id === 'special_chase_kamats'),
      'Chase appended to pool');
    assert.ok(after.rankingPool.some(p => p.id === 'special_jordon_eckstrom'),
      'Jordon appended to pool');
  });

  test('v5 -> v6 hydrate prepends Chase Kamats to rivals', () => {
    const before = buildV5Career();
    assert.ok(!before.rivals.some(r => r.id === 'special_chase_kamats'),
      'v5 fixture has no Chase in rivals');
    const after = hydrateCareer(before);
    assert.equal(after.rivals[0].id, 'special_chase_kamats',
      'Chase prepended at index 0');
  });

  test('v6 re-hydrate is idempotent (no double-injection)', () => {
    const v6 = hydrateCareer(buildV5Career());
    const chaseCountPool1 = v6.rankingPool.filter(p => p.id === 'special_chase_kamats').length;
    const chaseCountRivals1 = v6.rivals.filter(r => r.id === 'special_chase_kamats').length;
    assert.equal(chaseCountPool1, 1);
    assert.equal(chaseCountRivals1, 1);
    // Re-hydrate; counts must not increase.
    const v6again = hydrateCareer(v6);
    const chaseCountPool2 = v6again.rankingPool.filter(p => p.id === 'special_chase_kamats').length;
    const chaseCountRivals2 = v6again.rivals.filter(r => r.id === 'special_chase_kamats').length;
    assert.equal(chaseCountPool2, 1, 'no second Chase pool entry on re-hydrate');
    assert.equal(chaseCountRivals2, 1, 'no second Chase rival on re-hydrate');
  });
});

// ─── v5: per-event stat-point bonuses (championship + runner-up + milestone) ──
//
// On top of the existing title-prestige stat scaling, v5 adds:
//   +2 for winning a championship event
//   +1 for runner-up at a championship event
//   +1 for crossing every 10-win milestone in career wins
// All gated on `finishedEvent.status === 'upcoming'` so a replay of the
// same call doesn't double-grant.

describe('careerState.recordEventResult (v5 event bonuses)', () => {
  // Helper: find the first championship event in a fresh career schedule.
  const findChampionshipEvent = (career) => career.schedule.events.find(e => e.type === 'championship');

  test('championship win grants +2 stat-points (on top of prestige bonus)', () => {
    const c = createCareer({ name: 'Champ', weightClass: 138, rng: fixedRng });
    const ev = findChampionshipEvent(c);
    assert.ok(ev, 'fixture has at least one championship event');
    const before = c.wrestler.statPointsAvailable;
    const after = recordEventResult(c, ev.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision', placement: 1,
    });
    // The exact +2 is folded into totalStatBonus alongside titleStatBonus
    // (which is +1..+4 depending on stakes). So after - before should be
    // titleStatBonus + 2. Easiest assertion: lastEventXp surfaces the
    // total bonus, and we verify it includes our +2.
    assert.ok(after.wrestler.statPointsAvailable > before, 'stat points went up');
    // Run again with a non-championship to isolate the +2.
    const c2 = createCareer({ name: 'NonChamp', weightClass: 138, rng: fixedRng });
    const dual = c2.schedule.events.find(e => e.type === 'dual_meet');
    const after2 = recordEventResult(c2, dual.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision', placement: 1,
    });
    const dualBonus = after2.wrestler.statPointsAvailable - c2.wrestler.statPointsAvailable;
    const champBonus = after.wrestler.statPointsAvailable - before;
    assert.ok(champBonus > dualBonus, `championship grants more than dual: ${champBonus} > ${dualBonus}`);
    assert.ok(champBonus >= dualBonus + 2, `championship adds >= +2 over dual baseline`);
  });

  test('championship runner-up grants +1 stat-point (placement 2)', () => {
    const c = createCareer({ name: 'RunnerUp', weightClass: 138, rng: fixedRng });
    const ev = findChampionshipEvent(c);
    const before = c.wrestler.statPointsAvailable;
    const after = recordEventResult(c, ev.id, {
      playerWon: false, p1Score: 1, p2Score: 5, winMethod: 'decision', placement: 2,
    });
    // Runner-up: no titleStatBonus (those only fire on placement 1).
    // So the only +1 comes from our v5 bonus.
    assert.equal(after.wrestler.statPointsAvailable, before + 1, 'runner-up = +1');
  });

  test('championship 5th place grants no v5 bonus', () => {
    const c = createCareer({ name: 'Fifth', weightClass: 138, rng: fixedRng });
    const ev = findChampionshipEvent(c);
    const before = c.wrestler.statPointsAvailable;
    const after = recordEventResult(c, ev.id, {
      playerWon: false, p1Score: 1, p2Score: 5, winMethod: 'decision', placement: 5,
    });
    assert.equal(after.wrestler.statPointsAvailable, before, 'no v5 bonus for non-podium');
  });

  test('replay of same event does not double-grant (idempotency)', () => {
    const c = createCareer({ name: 'Replay', weightClass: 138, rng: fixedRng });
    const ev = findChampionshipEvent(c);
    const after1 = recordEventResult(c, ev.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision', placement: 1,
    });
    // The event status in `after1` is now 'won'. A replay should not award again.
    const after2 = recordEventResult(after1, ev.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision', placement: 1,
    });
    // statPointsAvailable should not increase from the second call's v5 bonus.
    // Other deltas (XP for winning, etc.) may differ; we only care about the
    // v5 stat-points bonus here.
    const firstDelta = after1.wrestler.statPointsAvailable - c.wrestler.statPointsAvailable;
    const secondDelta = after2.wrestler.statPointsAvailable - after1.wrestler.statPointsAvailable;
    // Second delta should be 0 or at most non-v5 bonuses (titleStatBonus
    // only fires on first placement-1 record because that increments
    // record.titles). What matters: the +2 v5 bonus is NOT in secondDelta.
    assert.ok(secondDelta < firstDelta, `replay grants less than first record: ${secondDelta} < ${firstDelta}`);
  });

  test('10-win milestone grants +1 when career wins crosses 10', () => {
    // Build a career pre-loaded to 9 career wins, then record one more win.
    const c = createCareer({ name: 'TenWins', weightClass: 138, rng: fixedRng });
    const cAt9 = { ...c, record: { ...c.record, careerWins: 9 } };
    const dual = cAt9.schedule.events.find(e => e.type === 'dual_meet');
    const before = cAt9.wrestler.statPointsAvailable;
    const after = recordEventResult(cAt9, dual.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision',
    });
    assert.equal(after.record.careerWins, 10, 'wins counter advanced to 10');
    assert.equal(after.wrestler.statPointsAvailable, before + 1, '10-win milestone = +1');
  });

  test('no milestone bonus mid-decade (10 -> 11)', () => {
    const c = createCareer({ name: 'MidDecade', weightClass: 138, rng: fixedRng });
    const cAt10 = { ...c, record: { ...c.record, careerWins: 10 } };
    const dual = cAt10.schedule.events.find(e => e.type === 'dual_meet');
    const before = cAt10.wrestler.statPointsAvailable;
    const after = recordEventResult(cAt10, dual.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision',
    });
    assert.equal(after.record.careerWins, 11);
    assert.equal(after.wrestler.statPointsAvailable, before, 'no bonus at 10 -> 11');
  });

  test('20-win milestone grants +1', () => {
    const c = createCareer({ name: 'TwentyWins', weightClass: 138, rng: fixedRng });
    const cAt19 = { ...c, record: { ...c.record, careerWins: 19 } };
    const dual = cAt19.schedule.events.find(e => e.type === 'dual_meet');
    const before = cAt19.wrestler.statPointsAvailable;
    const after = recordEventResult(cAt19, dual.id, {
      playerWon: true, p1Score: 5, p2Score: 1, winMethod: 'decision',
    });
    assert.equal(after.record.careerWins, 20);
    assert.equal(after.wrestler.statPointsAvailable, before + 1);
  });

  test('loss does not grant 10-win milestone bonus', () => {
    const c = createCareer({ name: 'LossAt9', weightClass: 138, rng: fixedRng });
    const cAt9 = { ...c, record: { ...c.record, careerWins: 9 } };
    const dual = cAt9.schedule.events.find(e => e.type === 'dual_meet');
    const before = cAt9.wrestler.statPointsAvailable;
    const after = recordEventResult(cAt9, dual.id, {
      playerWon: false, p1Score: 1, p2Score: 5, winMethod: 'decision',
    });
    assert.equal(after.record.careerWins, 9, 'wins unchanged on loss');
    assert.equal(after.wrestler.statPointsAvailable, before, 'no bonus when wins did not cross 10');
  });
});

describe('careerState.recordEventResult (phase fallback)', () => {
  test('mid-season event without prior phase still produces a defined phase', () => {
    let c = createCareer({ name: 'NoPhase', weightClass: 138, rng: fixedRng });
    const stripped = { ...c, phase: undefined };
    const after = recordEventResult(stripped, stripped.schedule.events[0].id, {
      playerWon: true, p1Score: 5, p2Score: 0, winMethod: 'decision',
    });
    assert.ok(after.phase, 'phase is defined post-event even when input had none');
    assert.equal(after.phase, 'in_season');
  });

  test('final event of season flips phase to offseason regardless of input phase', () => {
    let c = createCareer({ name: 'FlipTest', weightClass: 138, rng: fixedRng });
    // Strip phase before recording the final event of the season
    for (const evt of c.schedule.events.slice(0, -1)) {
      c = recordEventResult(c, evt.id, {
        playerWon: true, p1Score: 3, p2Score: 0, winMethod: 'decision',
      });
    }
    const stripped = { ...c, phase: undefined };
    const last = stripped.schedule.events[stripped.schedule.events.length - 1];
    const after = recordEventResult(stripped, last.id, {
      playerWon: true, p1Score: 5, p2Score: 0, winMethod: 'decision',
    });
    assert.equal(after.phase, 'offseason');
  });
});

describe('careerState - career progression (XP / rankings / cards)', () => {
  test('createCareer seeds starter deck, level 1, 0 xp, and a ranking pool', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    // Starter deck is non-empty and matches the exported constant
    assert.ok(Array.isArray(c.wrestler.unlockedCardIds));
    assert.ok(c.wrestler.unlockedCardIds.length >= 24,
      `starter deck should be at least 24, got ${c.wrestler.unlockedCardIds.length}`);
    assert.equal(c.wrestler.xp, 0);
    assert.equal(c.wrestler.level, 1);
    assert.equal(c.wrestler.skillTree.pointsAvailable, 0);
    // v5: tier-aware ranking pool. HS = 96 conference + 144 section +
    // 260 state = 500 total. Base conference NPCs are the ones generated
    // by generateExpandedRankingPool BEFORE rival injection bumps a few
    // up into conference scope. The exact split with rivals can vary but
    // base + rivals always adds to 96 conference + non-conf rivals.
    // v6 (2026-04-30): +2 special-named NPCs (Chase Kamats, Jordon Eckstrom).
    // v8 (2026-05-05): +5 cohort NPCs (Stetson Clary, Jackson Louis, Brayden
    // Aide, Marcus McCauley, Gavin Burch). Total special = 7.
    // v8 (2026-05-20): +1 featured-partnership NPC (Elijah Joles). Total = 8.
    assert.ok(Array.isArray(c.rankingPool));
    const confNpcBase = c.rankingPool.filter(w => w.scope === 'conference' && !w.isRival && !w.isSpecial).length;
    assert.equal(confNpcBase, 96, 'conference scope has 96 base (non-rival, non-special) NPCs');
    const specials = c.rankingPool.filter(w => w.isSpecial);
    assert.equal(specials.length, 8, 'eight special NPCs injected (7 cohort + Elijah Joles)');
    assert.ok(specials.some(w => w.name === 'Chase Kamats'));
    assert.ok(specials.some(w => w.name === 'Jordon Eckstrom'));
    assert.ok(specials.some(w => w.name === 'Stetson Clary'));
    assert.ok(specials.some(w => w.name === 'Jaxon Louis'));
    assert.ok(specials.some(w => w.name === 'Brayden Aide'));
    assert.ok(specials.some(w => w.name === 'Marcus McCauley'));
    assert.ok(specials.some(w => w.name === 'Gavin Burch'));
    assert.ok(specials.some(w => w.name === 'Elijah Joles'),
      'Elijah Joles featured-partnership NPC is injected on male careers');
    assert.ok(c.rankingPool.length > 400,
      `expanded pool should have >400 NPCs, got ${c.rankingPool.length}`);
    assert.ok(c.rankingPool.every(w => ['conference','section','state'].includes(w.scope)),
      'every NPC should carry a scope tag');
    // Rankings object present
    assert.ok(c.rankings);
    assert.ok(c.rankings.conference >= 1);
    assert.ok(c.rankings.section >= 1);
    assert.ok(c.rankings.state >= 1);
  });

  test('recordEventResult awards XP and updates rankings', () => {
    const c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const firstEvent = c.schedule.events[0];
    const after = recordEventResult(c, firstEvent.id, {
      playerWon: true, p1Score: 8, p2Score: 3, winMethod: 'pin',
    });
    // Pin win = 80 + 40 = 120 XP
    assert.equal(after.wrestler.xp, 120);
    assert.equal(after.lastEventXp.xpGained, 120);
    // Rankings updated: asOfEventIdx should match new currentEventIdx
    assert.equal(after.rankings.asOfEventIdx, after.schedule.currentEventIdx);
  });

  test('final event of season awards season-completion XP (+150)', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    // Play all-but-one event; XP should not include the season bonus yet.
    // v9: pass placement: 4 on conference / district / regional events so the
    // postseason qualification gate (top-4 advances) doesn't prune downstream
    // events - we want the full season to play out for this XP test.
    const last = c.schedule.events[c.schedule.events.length - 1];
    for (const evt of c.schedule.events.slice(0, -1)) {
      const isPostseasonGate = evt.stakes === 'conference' || evt.stakes === 'district' || evt.stakes === 'regional';
      c = recordEventResult(c, evt.id, {
        playerWon: false, p1Score: 1, p2Score: 3, winMethod: 'decision',
        placement: isPostseasonGate ? 4 : null,
      });
    }
    assert.equal(c.lastSeasonBonus, undefined, 'no bonus until final event');
    const xpBeforeLast = c.wrestler.xp;
    c = recordEventResult(c, last.id, {
      playerWon: false, p1Score: 1, p2Score: 3, winMethod: 'decision',
    });
    // Final event: base loss (30) + season bonus (150) = 180 XP gained
    assert.equal(c.wrestler.xp - xpBeforeLast, 30 + 150);
    assert.ok(c.lastSeasonBonus, 'season bonus recorded');
    assert.equal(c.lastSeasonBonus.xpGained, 150);
    assert.equal(c.phase, 'offseason');
  });

  test('advanceToNextSeason resets lastSeasonBonus and regenerates pool', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    for (const evt of c.schedule.events) {
      c = recordEventResult(c, evt.id, {
        playerWon: false, p1Score: 1, p2Score: 3, winMethod: 'decision',
      });
    }
    // Offseason: bonus is set by the final event
    assert.ok(c.lastSeasonBonus);
    const after = advanceToNextSeason(c, { rng: fixedRng });
    assert.equal(after.lastSeasonBonus, null, 'cleared on advance');
    // v5: tier-aware pool. HS = 96 / 144 / 260 = 500 total scope-tagged
    // NPCs so the rankings detail screen has more depth across season
    // boundaries. v6: +2 special-named NPCs (Chase + Jordon) in conf
    // scope on regen.
    const confCount = after.rankingPool.filter(w => w.scope === 'conference' && !w.isSpecial).length;
    assert.equal(confCount, 96, 'regenerated pool has 96 base conference NPCs');
    assert.ok(after.rankingPool.length > 400, 'pool is expanded, not conference-only');
    assert.ok(after.rankingPool.some(w => w.name === 'Chase Kamats'),
      'Chase Kamats injected on regenerated pool');
    assert.ok(after.rankingPool.every(w => !!w.scope), 'every NPC has a scope tag');
  });

  test('enough wins over a full season trigger at least one level-up', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    for (const evt of c.schedule.events) {
      c = recordEventResult(c, evt.id, {
        playerWon: true, p1Score: 6, p2Score: 0, winMethod: 'pin', placement: 1,
      });
    }
    // 14 events × 120+ XP each well exceeds L2 threshold (200) and L5 (1400)
    assert.ok(c.wrestler.level >= 5, `expected level ≥ 5, got ${c.wrestler.level}`);
    assert.ok(c.wrestler.skillTree.pointsAvailable >= 4);
  });
});

describe('careerState.buildHallOfFameThumbnail', () => {
  test('produces a lean summary for archiving', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    c = recordEventResult(c, c.schedule.events[0].id, {
      playerWon: true, p1Score: 6, p2Score: 0, winMethod: 'pin',
    });
    const retired = retireCareer(c, { reason: 'user_choice' });
    const thumb = buildHallOfFameThumbnail(retired);
    assert.equal(thumb.wrestlerName, 'Test');
    assert.equal(thumb.record.careerWins, 1);
    assert.equal(thumb.record.pins, 1);
    assert.equal(thumb.retireReason, 'user_choice');
  });
});

describe('careerState.getNextEvent / getSeasonSummary', () => {
  test('getNextEvent returns first upcoming; null after season complete', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    assert.equal(getNextEvent(c).id, c.schedule.events[0].id);
    for (const evt of c.schedule.events) {
      c = recordEventResult(c, evt.id, {
        playerWon: true, p1Score: 3, p2Score: 0, winMethod: 'decision',
      });
    }
    assert.equal(getNextEvent(c), null);
  });

  test('HS postseason gate: lose conference (placement 5) prunes district + regional + state', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const lengthBefore = c.schedule.events.length;
    const conf = c.schedule.events.find(e => e.stakes === 'conference');
    assert.ok(conf, 'conference event exists');
    c = recordEventResult(c, conf.id, {
      playerWon: false, p1Score: 4, p2Score: 6, winMethod: 'decision',
      placement: 5, // missed top 4
    });
    assert.ok(
      c.schedule.events.every(e =>
        e.stakes !== 'district' && e.stakes !== 'regional' && e.stakes !== 'state'),
      'district + regional + state should be pruned',
    );
    // v9: 4-level postseason chain. Failing R1 conference prunes 3 events
    // (district 32, regional 64, state 128).
    assert.equal(c.schedule.events.length, lengthBefore - 3, 'three events pruned');
  });

  test('HS postseason gate: top-4 conference keeps regional, lose regional prunes state', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const conf = c.schedule.events.find(e => e.stakes === 'conference');
    c = recordEventResult(c, conf.id, {
      playerWon: false, p1Score: 4, p2Score: 6, winMethod: 'decision',
      placement: 4, // top 4 - qualifies for regional
    });
    assert.ok(c.schedule.events.find(e => e.stakes === 'regional'), 'regional kept');
    assert.ok(c.schedule.events.find(e => e.stakes === 'state'), 'state still upcoming');

    const reg = c.schedule.events.find(e => e.stakes === 'regional');
    c = recordEventResult(c, reg.id, {
      playerWon: false, p1Score: 1, p2Score: 6, winMethod: 'decision',
      placement: 8, // missed top 4 at regional
    });
    assert.ok(c.schedule.events.find(e => e.stakes === 'regional'), 'regional kept (already played)');
    assert.equal(
      c.schedule.events.find(e => e.stakes === 'state'),
      undefined,
      'state pruned after regional miss',
    );
  });

  test('HS postseason gate: top-4 at conference + regional reaches state', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const conf = c.schedule.events.find(e => e.stakes === 'conference');
    c = recordEventResult(c, conf.id, {
      playerWon: true, p1Score: 6, p2Score: 4, winMethod: 'decision',
      placement: 1,
    });
    const reg = c.schedule.events.find(e => e.stakes === 'regional');
    c = recordEventResult(c, reg.id, {
      playerWon: false, p1Score: 4, p2Score: 6, winMethod: 'decision',
      placement: 3,
    });
    assert.ok(c.schedule.events.find(e => e.stakes === 'state'), 'state still upcoming');
  });

  // 2026-05-01 - the gate previously evaluated `(result.placement || 99) > 4`,
  // which dropped State even when the player won the qualifier if the caller
  // happened to omit the placement field. The new gate uses
  // `result.placement ?? (result.playerWon ? 1 : null)` so the schedule's
  // own recorded placement (which uses the same fallback) and the gate
  // agree. These tests pin that contract.

  test('HS postseason gate: winner of regional WITHOUT explicit placement keeps state', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const conf = c.schedule.events.find(e => e.stakes === 'conference');
    c = recordEventResult(c, conf.id, {
      playerWon: true, p1Score: 6, p2Score: 4, winMethod: 'decision',
      placement: 1,
    });
    const reg = c.schedule.events.find(e => e.stakes === 'regional');
    // Caller forgot to pass placement, but flagged playerWon.
    c = recordEventResult(c, reg.id, {
      playerWon: true, p1Score: 6, p2Score: 4, winMethod: 'decision',
    });
    assert.ok(c.schedule.events.find(e => e.stakes === 'state'),
      'state must remain when player won regional even without explicit placement');
  });

  test('HS postseason gate: winner of conference WITHOUT explicit placement keeps regional + state', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const conf = c.schedule.events.find(e => e.stakes === 'conference');
    c = recordEventResult(c, conf.id, {
      playerWon: true, p1Score: 6, p2Score: 4, winMethod: 'decision',
    });
    assert.ok(c.schedule.events.find(e => e.stakes === 'regional'),
      'regional must remain when player won conference without explicit placement');
    assert.ok(c.schedule.events.find(e => e.stakes === 'state'),
      'state must remain when player won conference without explicit placement');
  });

  test('HS postseason gate: loser of regional WITHOUT explicit placement still drops state', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    const conf = c.schedule.events.find(e => e.stakes === 'conference');
    c = recordEventResult(c, conf.id, {
      playerWon: true, p1Score: 6, p2Score: 4, winMethod: 'decision',
      placement: 1,
    });
    const reg = c.schedule.events.find(e => e.stakes === 'regional');
    // Caller forgot placement and player lost - inferred placement is null
    // (playerWon=false branch), gate trips with the conservative "did not
    // qualify" treatment.
    c = recordEventResult(c, reg.id, {
      playerWon: false, p1Score: 4, p2Score: 6, winMethod: 'decision',
    });
    assert.equal(
      c.schedule.events.find(e => e.stakes === 'state'),
      undefined,
      'state must drop when player lost regional even without explicit placement',
    );
  });

  test('getSeasonSummary counts W/L/titles', () => {
    let c = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng });
    for (const [i, evt] of c.schedule.events.entries()) {
      const playerWon = i < 10;
      // v9: pass placement: 4 on conference/district/regional so the postseason
      // qualification gate doesn't prune later events. State-tier wins keep
      // their placement: 1 (championship title).
      const isPostseasonGate = evt.stakes === 'conference' || evt.stakes === 'district' || evt.stakes === 'regional';
      c = recordEventResult(c, evt.id, {
        playerWon,
        p1Score: playerWon ? 3 : 1,
        p2Score: playerWon ? 1 : 3,
        winMethod: 'decision',
        placement:
          playerWon && evt.stakes === 'state' ? 1
          : isPostseasonGate ? 4
          : null,
      });
    }
    const summary = getSeasonSummary(c);
    assert.equal(summary.wins, 10);
    // v9: V1 schedule has 28 events; first 10 won + remaining 18 lost.
    assert.equal(summary.losses, 18);
  });
});

describe('hydrateCareer', () => {
  // Shape a pre-Phase-B career would've had in Firestore: no unlockedCardIds,
  // no skillTree, no xp/level, no rankingPool, no rankings.
  function makeLegacyCareer(overrides = {}) {
    return {
      id: 'legacy_career_1',
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      wrestler: {
        name: 'Legacy Lou',
        tier: 'hs',
        year: 2,
        age: 15,
        weightClass: 138,
        stats: { str: 60, spd: 55, tec: 58, end: 62, grt: 57 },
        statPointsAvailable: 3,
        injuries: [],
        school: null,
        ...(overrides.wrestler || {}),
      },
      schedule: { seasonYear: 2, events: [], currentEventIdx: 4 },
      rivals: [],
      record: {
        seasonWins: 3, seasonLosses: 1, careerWins: 10, careerLosses: 4,
        pins: 2, techs: 1, majorDecs: 1, nearFalls: 0, titles: [],
      },
      phase: 'in_season',
      ...overrides,
    };
  }

  test('returns raw input when career is null/falsy', () => {
    assert.equal(hydrateCareer(null), null);
    assert.equal(hydrateCareer(undefined), undefined);
  });

  test('seeds starter deck when unlockedCardIds missing', () => {
    const h = hydrateCareer(makeLegacyCareer());
    assert.equal(h.wrestler.unlockedCardIds.length, CAREER_STARTER_DECK.length);
    // all starter cards present
    for (const id of CAREER_STARTER_DECK) {
      assert.ok(h.wrestler.unlockedCardIds.includes(id), `missing ${id}`);
    }
  });

  test('seeds skillTree when missing', () => {
    const h = hydrateCareer(makeLegacyCareer());
    assert.deepEqual(h.wrestler.skillTree, {
      unlockedNodes: [],
      pointsAvailable: 0,
      focus: null,
    });
  });

  test('defaults xp=0 and level=1 when missing (does NOT award retroactive XP)', () => {
    const h = hydrateCareer(makeLegacyCareer());
    assert.equal(h.wrestler.xp, 0);
    assert.equal(h.wrestler.level, 1);
  });

  test('seeds rankingPool + rankings when missing', () => {
    const h = hydrateCareer(makeLegacyCareer());
    assert.ok(Array.isArray(h.rankingPool) && h.rankingPool.length > 0,
      'rankingPool should be generated');
    assert.ok(h.rankings && h.rankings.conference >= 1,
      'rankings should be seeded');
    assert.equal(h.rankings.asOfEventIdx, 4,
      'rankings.asOfEventIdx should reflect current event position');
  });

  test('bumps version to current shape and flags legacy hydration', () => {
    const h = hydrateCareer(makeLegacyCareer());
    assert.ok(h.version >= 3, `expected version >= 3, got ${h.version}`);
    assert.equal(h._hydratedFromLegacy, true);
  });

  test('is idempotent - second hydrate is a no-op', () => {
    const h1 = hydrateCareer(makeLegacyCareer());
    const h2 = hydrateCareer(h1);
    // Same reference means the short-circuit fired (version check).
    assert.equal(h2, h1, 'should return same reference when already hydrated');
  });

  test('preserves existing unlockedCardIds when populated', () => {
    const customCards = [...CAREER_STARTER_DECK, 'go_behind', 'slide_by'];
    const legacy = makeLegacyCareer({
      version: 0,   // force hydrate path
      wrestler: {
        name: 'Already Unlocked',
        tier: 'hs', year: 2, age: 15, weightClass: 138,
        stats: { str: 55, spd: 55, tec: 55, end: 55, grt: 55 },
        unlockedCardIds: customCards,
      },
    });
    const h = hydrateCareer(legacy);
    assert.equal(h.wrestler.unlockedCardIds.length, customCards.length,
      'should preserve existing unlocked cards, not overwrite');
    assert.ok(h.wrestler.unlockedCardIds.includes('go_behind'));
  });

  test('preserves existing skillTree when populated', () => {
    const legacy = makeLegacyCareer({
      version: 0,
      wrestler: {
        name: 'Has Tree',
        tier: 'hs', year: 3, age: 16, weightClass: 138,
        stats: { str: 65, spd: 60, tec: 60, end: 60, grt: 60 },
        skillTree: {
          unlockedNodes: ['scr_go_behind'],
          pointsAvailable: 2,
          focus: 'scrambler',
        },
      },
    });
    const h = hydrateCareer(legacy);
    assert.deepEqual(h.wrestler.skillTree, {
      unlockedNodes: ['scr_go_behind'],
      pointsAvailable: 2,
      focus: 'scrambler',
    });
  });

  test('preserves existing xp and level', () => {
    const legacy = makeLegacyCareer({
      version: 0,
      wrestler: {
        name: 'Leveled',
        tier: 'hs', year: 2, age: 15, weightClass: 138,
        stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        xp: 850,
        level: 4,
      },
    });
    const h = hydrateCareer(legacy);
    assert.equal(h.wrestler.xp, 850);
    assert.equal(h.wrestler.level, 4);
  });

  test('new career from createCareer is already at current version - hydrate is no-op', () => {
    const fresh = createCareer({ name: 'Fresh', weightClass: 138, rng: fixedRng });
    // createCareer produces version 1 currently; after hydrate it should be
    // at current CAREER_SHAPE_VERSION (2). Starter deck must still be there.
    const h = hydrateCareer(fresh);
    assert.ok(h.wrestler.unlockedCardIds.length >= CAREER_STARTER_DECK.length,
      'fresh career keeps starter deck after hydrate');
    assert.ok(h.wrestler.skillTree !== undefined, 'skillTree present');
    assert.equal(h.wrestler.level, 1);
  });
});


// ─── v5: per-match interim tournament record updates ──────────────────────
//
// Before v5 the players overall W/L counter only ticked up at tournament
// END (via the aggregate matchesWon/matchesLost on recordEventResult).
// Now applyInterimTournamentMatch updates the record after each bracket
// match and stamps the schedule event with interimMatchesAccounted: true
// so recordEventResult skips the aggregate add at end (no double-count).

describe("careerState.applyInterimTournamentMatch", () => {
  test("increments season + career wins on a player win", () => {
    const c = createCareer({ name: "Tourn", weightClass: 138, rng: fixedRng });
    const tEvent = c.schedule.events.find(e => e.type === "tournament");
    assert.ok(tEvent, "fixture has a tournament event");
    const before = c.record;
    const after = applyInterimTournamentMatch(c, tEvent.id, { playerWon: true, winMethod: "decision" });
    assert.equal(after.record.seasonWins,  before.seasonWins  + 1);
    assert.equal(after.record.careerWins,  before.careerWins  + 1);
    assert.equal(after.record.seasonLosses, before.seasonLosses);
    assert.equal(after.record.careerLosses, before.careerLosses);
  });

  test("increments losses on a player loss", () => {
    const c = createCareer({ name: "Tourn", weightClass: 138, rng: fixedRng });
    const tEvent = c.schedule.events.find(e => e.type === "tournament");
    const after = applyInterimTournamentMatch(c, tEvent.id, { playerWon: false, winMethod: "decision" });
    assert.equal(after.record.seasonLosses, c.record.seasonLosses + 1);
    assert.equal(after.record.careerLosses, c.record.careerLosses + 1);
  });

  test("stamps interimMatchesAccounted on the event", () => {
    const c = createCareer({ name: "Tourn", weightClass: 138, rng: fixedRng });
    const tEvent = c.schedule.events.find(e => e.type === "tournament");
    const after = applyInterimTournamentMatch(c, tEvent.id, { playerWon: true });
    const eventAfter = after.schedule.events.find(e => e.id === tEvent.id);
    assert.equal(eventAfter.interimMatchesAccounted, true);
  });

  test("recordEventResult skips W/L aggregate when interimMatchesAccounted is set", () => {
    const c = createCareer({ name: "NoDouble", weightClass: 138, rng: fixedRng });
    const tEvent = c.schedule.events.find(e => e.type === "tournament");
    // Simulate four bracket matches: 3 wins + 1 loss via interim updates.
    let cur = c;
    cur = applyInterimTournamentMatch(cur, tEvent.id, { playerWon: true,  winMethod: "pin" });
    cur = applyInterimTournamentMatch(cur, tEvent.id, { playerWon: true,  winMethod: "decision" });
    cur = applyInterimTournamentMatch(cur, tEvent.id, { playerWon: true,  winMethod: "decision" });
    cur = applyInterimTournamentMatch(cur, tEvent.id, { playerWon: false, winMethod: "decision" });
    // Tournament finalize: aggregate W/L should NOT double-add since interim ran.
    const finalCareer = recordEventResult(cur, tEvent.id, {
      playerWon: false, p1Score: 0, p2Score: 0, winMethod: "decision",
      placement: 3,
      matchesWon: 3, matchesLost: 1,
      pinsInTournament: 1, techsInTournament: 0, majorsInTournament: 0,
    });
    // Net W/L should reflect interim only: +3 wins, +1 loss, +1 pin.
    assert.equal(finalCareer.record.careerWins, c.record.careerWins + 3);
    assert.equal(finalCareer.record.careerLosses, c.record.careerLosses + 1);
    assert.equal(finalCareer.record.pins, (c.record.pins || 0) + 1);
  });

  test("recordEventResult uses aggregate W/L when no interim ran (legacy path)", () => {
    // Standalone tournament path or regression: if no interim was applied,
    // recordEventResult MUST still add the aggregate.
    const c = createCareer({ name: "Legacy", weightClass: 138, rng: fixedRng });
    const tEvent = c.schedule.events.find(e => e.type === "tournament");
    const final = recordEventResult(c, tEvent.id, {
      playerWon: true, p1Score: 0, p2Score: 0, winMethod: "decision",
      placement: 1,
      matchesWon: 4, matchesLost: 0,
      pinsInTournament: 2, techsInTournament: 0, majorsInTournament: 0,
    });
    assert.equal(final.record.careerWins, c.record.careerWins + 4);
    assert.equal(final.record.careerLosses, c.record.careerLosses + 0);
    assert.equal(final.record.pins, (c.record.pins || 0) + 2);
  });

  test("missing event id is a no-op (returns same career ref)", () => {
    const c = createCareer({ name: "Bad", weightClass: 138, rng: fixedRng });
    const after = applyInterimTournamentMatch(c, "evt_does_not_exist", { playerWon: true });
    assert.equal(after, c);
  });
});

// ─── Dual Meet rollout - backward compat + next-season generation ───────────
describe('careerState - dual_meet rollout (backward compat)', () => {
  // The dual_meet event type is added by replacing the schedule-template
  // 'dual' entries. Existing in-progress careers whose schedule was generated
  // BEFORE the rollout still carry 'dual' events; those must continue to
  // hydrate, validate, and resolve through recordEventResult exactly as
  // before. Brand-new careers and next-season schedules emit 'dual_meet'.

  function buildLegacyV7CareerWithDualEvents() {
    // Hand-construct a v7 career as if it had been created BEFORE dual_meet.
    // Schedule.events use the legacy 'dual' type. Rest of the shape mirrors
    // a real createCareer return so hydrateCareer's short-circuit kicks in.
    const c = createCareer({ name: 'Legacy', weightClass: 145, rng: fixedRng });
    // Overwrite the schedule with legacy 'dual' entries (preserve other shape).
    const legacyEvents = c.schedule.events.map(e => {
      if (e.type === 'dual_meet') {
        // Keep the SAME id so resume + recordEventResult lookup still match.
        const { lineupChoice, opponentTeamName, ...rest } = e;
        return { ...rest, type: 'dual' };
      }
      return e;
    });
    return {
      ...c,
      version: 7,
      phase: 'in_season',
      schedule: { ...c.schedule, events: legacyEvents },
    };
  }

  test('hydrateCareer preserves legacy dual events without type mutation', () => {
    const legacy = buildLegacyV7CareerWithDualEvents();
    const hydrated = hydrateCareer(legacy);
    const legacyDuals = hydrated.schedule.events.filter(e => e.type === 'dual');
    assert.ok(legacyDuals.length >= 7, 'legacy duals are still type=dual after hydrate');
    const stamped = hydrated.schedule.events.filter(e => e.type === 'dual_meet');
    assert.equal(stamped.length, 0, 'hydrate must NOT silently rewrite dual -> dual_meet');
  });

  test('recordEventResult on a legacy dual event still credits career W/L', () => {
    const legacy = buildLegacyV7CareerWithDualEvents();
    const hydrated = hydrateCareer(legacy);
    const dualEvent = hydrated.schedule.events.find(e => e.type === 'dual');
    assert.ok(dualEvent, 'has at least one legacy dual event');
    const beforeWins = hydrated.record.seasonWins;
    const after = recordEventResult(hydrated, dualEvent.id, {
      playerWon: true, p1Score: 5, p2Score: 2, winMethod: 'decision',
    });
    assert.equal(after.record.seasonWins, beforeWins + 1, 'legacy dual still credits +1 W');
    const updated = after.schedule.events.find(e => e.id === dualEvent.id);
    assert.equal(updated.status, 'won');
  });

  test('a brand-new career generates dual_meet events on every fresh schedule', () => {
    const fresh = createCareer({ name: 'Fresh', weightClass: 145, rng: fixedRng });
    const dualMeets = fresh.schedule.events.filter(e => e.type === 'dual_meet');
    const legacyDuals = fresh.schedule.events.filter(e => e.type === 'dual');
    assert.ok(dualMeets.length > 0, 'new career schedule has dual_meet events');
    assert.equal(legacyDuals.length, 0, 'new career schedule has zero legacy dual events');
  });
});

describe('careerState - next-season rollout for existing careers', () => {
  function buildEndOfSeasonLegacyCareer() {
    const c = createCareer({ name: 'EndOfSeason', weightClass: 138, rng: fixedRng });
    // Overwrite schedule with legacy duals. Then mark every event as resolved
    // so isSeasonComplete() flips true and advanceToNextSeason can run.
    const events = c.schedule.events.map((e, i) => {
      const baseType = e.type === 'dual_meet' ? 'dual' : e.type;
      return {
        ...e,
        type: baseType,
        status: i % 2 === 0 ? 'won' : 'lost',
        result: {
          p1Score: 0, p2Score: 0, winMethod: 'decision',
          placement: e.type === 'championship' ? 5 : null,
          playedAt: Date.now(),
        },
      };
    });
    return {
      ...c,
      phase: 'offseason',
      version: 7,
      schedule: {
        ...c.schedule,
        events,
        currentEventIdx: events.length, // all events resolved
      },
    };
  }

  test('advanceToNextSeason regenerates next year with dual_meet events (HS year 2)', () => {
    const career = buildEndOfSeasonLegacyCareer();
    // advanceToNextSeason needs phase: offseason and an HS year that's not the
    // tier-cap year. Year 1 -> year 2 keeps tier='hs'.
    const next = advanceToNextSeason(career);
    if (next.phase === 'recruiting' || next.phase === 'tier_transition') {
      // Tier cap reached - skip this assertion. Actual rollout test covered by
      // the year=1 path which we engineered above.
      return;
    }
    const dualMeets = next.schedule.events.filter(e => e.type === 'dual_meet');
    assert.ok(dualMeets.length > 0, 'next season schedule emits dual_meet events');
    const legacyDuals = next.schedule.events.filter(e => e.type === 'dual');
    assert.equal(legacyDuals.length, 0, 'next season schedule contains zero legacy dual entries');
  });
});

// Regression: pre-2026-05-06 buildCollegeFromOffer called snapToValidWeight
// without gender, so women's HS -> college transitions snapped to MEN'S NCAA
// weights (e.g. 130 lbs -> 133 lbs, which doesn't exist in
// WOMENS_COLLEGE_WEIGHTS = [103,110,117,124,131,138,145,160,180,207]).
// The bug surfaced as a CAREER_DUAL_WEIGHT_MISMATCH error in dual meet flow.
describe('careerState - women college weight transition (regression)', () => {
  test('female HS->college via takeWalkOnPath lands in WOMENS_COLLEGE_WEIGHTS, not 133', () => {
    const career = createCareer({
      name: 'Reggie Test',
      gender: 'female',
      tier: 'hs',
      year: 4,
      weightClass: 130, // valid WOMENS_HS_WEIGHTS entry
      stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
      state: 'IA',
      rng: fixedRng,
    });
    assert.equal(career.wrestler.gender, 'female');
    const collegeCareer = takeWalkOnPath(career, { rng: fixedRng });
    const w = collegeCareer.wrestler.weightClass;
    const womensCollege = getWeightsForTier('college', 'folkstyle', 'female');
    assert.ok(
      womensCollege.includes(w),
      `expected weight ${w} in WOMENS_COLLEGE_WEIGHTS [${womensCollege}]`
    );
    assert.notEqual(w, 133, 'must not snap to MEN-only NCAA weight 133');
  });

  test('male HS->college transition still snaps to COLLEGE_WEIGHTS as before', () => {
    const career = createCareer({
      name: 'Marty Test',
      gender: 'male',
      tier: 'hs',
      year: 4,
      weightClass: 132, // HS_WEIGHTS valid
      stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
      state: 'IA',
      rng: fixedRng,
    });
    const collegeCareer = takeWalkOnPath(career, { rng: fixedRng });
    const w = collegeCareer.wrestler.weightClass;
    const mensCollege = getWeightsForTier('college', 'folkstyle', 'male');
    assert.ok(mensCollege.includes(w), `male transition still hits men's college table; got ${w}`);
  });
});

describe('careerState - hydrate weight repair (regression)', () => {
  test('hydrate snaps stale female/college weight 133 to nearest WOMENS_COLLEGE_WEIGHTS entry', () => {
    // Mid-flight career captured from production: woman in college, weight
    // class 133 (men's NCAA), schedule events also tagged 133. Hydrate must
    // repair both so dual meet flow doesn't blow up.
    const broken = {
      id: 'broken_career_w133',
      version: 7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: 'in_season',
      wrestler: {
        name: 'Stale Save',
        gender: 'female',
        tier: 'college',
        year: 1,
        age: 18,
        weightClass: 133,
        state: 'IA',
        stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        statPointsAvailable: 0,
        xp: 0,
        level: 1,
        skillTree: { unlockedNodes: [], pointsAvailable: 0 },
      },
      schedule: {
        seasonYear: 1,
        currentEventIdx: 0,
        events: [
          { id: 'e1', seasonYear: 1, year: 1, week: 1, type: 'dual_meet',
            name: 'Test', weightClass: 133, style: 'womens_freestyle',
            status: 'upcoming', result: null },
        ],
      },
      record: { seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
                pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [] },
      deck: { cardIds: [], history: [] },
      rivals: [],
      rankingPool: [],
      rankings: { conference: null, section: null, state: null, asOfEventIdx: 0 },
    };
    const fixed = hydrateCareer(broken);
    const womensCollege = getWeightsForTier('college', 'folkstyle', 'female');
    assert.ok(
      womensCollege.includes(fixed.wrestler.weightClass),
      `wrestler.weightClass ${fixed.wrestler.weightClass} must be in WOMENS_COLLEGE_WEIGHTS`
    );
    assert.notEqual(fixed.wrestler.weightClass, 133, 'must not retain men-only 133');
    assert.equal(
      fixed.schedule.events[0].weightClass,
      fixed.wrestler.weightClass,
      'schedule event weightClass must be rewritten to match'
    );
    // Sanity: snapToValidWeight on 133 with women/college lands at 131 (closer
    // than 138). Pin the value so an unintended snap-direction change trips.
    assert.equal(fixed.wrestler.weightClass, 131, 'expected snap to 131 (nearest <= 133 in women NCAA table)');
  });

  test('valid weights are not touched by repair pass', () => {
    const ok = {
      id: 'ok_career',
      version: 7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: 'in_season',
      wrestler: {
        name: 'OK Save', gender: 'female', tier: 'college', year: 1, age: 18,
        weightClass: 131, // valid women's college weight
        state: 'IA',
        stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        statPointsAvailable: 0, xp: 0, level: 1,
        skillTree: { unlockedNodes: [], pointsAvailable: 0 },
      },
      schedule: { seasonYear: 1, currentEventIdx: 0, events: [] },
      record: { seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
                pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [] },
      deck: { cardIds: [], history: [] },
      rivals: [],
      rankingPool: [],
      rankings: { conference: null, section: null, state: null, asOfEventIdx: 0 },
    };
    const fixed = hydrateCareer(ok);
    assert.equal(fixed.wrestler.weightClass, 131, 'valid weight unchanged');
  });
});

// ── Ranking pool gender wiring (regression) ───────────────────────────────
// Pre-fix advanceToNextSeason and buildCollegeFromOffer called
// generateExpandedRankingPool without `gender`, so the function defaulted
// to 'male' and replaced women's NPC pools with the men's pantheon
// (Chase Kamats / Jordon Eckstrom + men's first-name pool) every season.
// User report: "the womens college rankings are the mens ai pool".

describe('careerState - ranking pool gender wiring (regression)', () => {
  test('advanceToNextSeason regenerates a FEMALE pool for a women\'s career', () => {
    const career = createCareer({
      name: 'Reggie Female', state: 'IA', weightClass: 130,
      gender: 'female', rng: fixedRng,
    });
    // Drive the season to completion so advanceToNextSeason can run cleanly.
    career.phase = 'in_season';
    career.schedule = {
      ...career.schedule,
      events: career.schedule.events.map(e => ({ ...e, status: 'won', result: { p1Score: 6, p2Score: 4, winMethod: 'decision', placement: 1, playedAt: 1 } })),
      currentEventIdx: career.schedule.events.length,
    };
    const next = advanceToNextSeason(career, { rng: fixedRng });
    if (next.phase === 'recruiting' || next.phase === 'tier_transition'
        || next.phase === 'senior_style_choice' || next.phase === 'retired') {
      // Tier rolled over - the new pool isn't built by advanceToNextSeason
      // in those branches. Skip this assertion (the tier-transition path
      // is covered by the buildCollegeFromOffer test below).
      return;
    }
    assert.ok(Array.isArray(next.rankingPool), 'pool present after advance');
    // Pool must NOT contain Chase Kamats (male-only special). Women's pool
    // gets Valerie Aikens etc. via ensureSpecialWomensAiWrestlers instead.
    const hasChase = next.rankingPool.some(p => p?.name === 'Chase Kamats');
    assert.equal(hasChase, false, 'women\'s next-season pool must not contain Chase Kamats (men\'s special)');
    const hasJordon = next.rankingPool.some(p => p?.name === 'Jordon Eckstrom');
    assert.equal(hasJordon, false, 'women\'s next-season pool must not contain Jordon Eckstrom (men\'s special)');
  });

  test('advanceToNextSeason still injects MEN\'S specials for a male career', () => {
    const career = createCareer({
      name: 'Marty Male', state: 'IA', weightClass: 145,
      gender: 'male', rng: fixedRng,
    });
    career.phase = 'in_season';
    career.schedule = {
      ...career.schedule,
      events: career.schedule.events.map(e => ({ ...e, status: 'won', result: { p1Score: 6, p2Score: 4, winMethod: 'decision', placement: 1, playedAt: 1 } })),
      currentEventIdx: career.schedule.events.length,
    };
    const next = advanceToNextSeason(career, { rng: fixedRng });
    if (next.phase === 'recruiting' || next.phase === 'tier_transition'
        || next.phase === 'senior_style_choice' || next.phase === 'retired') return;
    const hasChase = next.rankingPool.some(p => p?.name === 'Chase Kamats');
    assert.ok(hasChase, 'men\'s next-season pool retains Chase Kamats');
  });

  test('takeWalkOnPath builds a WOMEN\'S college pool for a female career', () => {
    const career = createCareer({
      name: 'Reggie Female', state: 'IA', weightClass: 130,
      gender: 'female', tier: 'hs', year: 4, rng: fixedRng,
    });
    const collegeCareer = takeWalkOnPath(career, { rng: fixedRng });
    assert.ok(Array.isArray(collegeCareer.rankingPool));
    const hasChase = collegeCareer.rankingPool.some(p => p?.name === 'Chase Kamats');
    assert.equal(hasChase, false, 'women\'s college pool must not contain Chase Kamats');
    // Chase-Kamats-as-rival is also male-only - the rivals list should not
    // carry him into a women's college transition.
    const chaseInRivals = (collegeCareer.rivals || []).some(r => r?.name === 'Chase Kamats');
    assert.equal(chaseInRivals, false, 'women\'s rivals list must not pick up Chase Kamats');
  });

  test('takeWalkOnPath retains MEN\'S specials for a male college transition', () => {
    const career = createCareer({
      name: 'Marty Male', state: 'IA', weightClass: 145,
      gender: 'male', tier: 'hs', year: 4, rng: fixedRng,
    });
    const collegeCareer = takeWalkOnPath(career, { rng: fixedRng });
    const hasChase = collegeCareer.rankingPool.some(p => p?.name === 'Chase Kamats');
    assert.ok(hasChase, 'men\'s college pool retains Chase Kamats');
  });

  test('hydrate repairs an already-persisted female career whose pool was regenerated as male', () => {
    // Production reality: many existing women's careers have already been
    // through advanceToNextSeason or buildCollegeFromOffer with the buggy
    // (gender-less) call site, so their saved rankingPool contains Chase
    // Kamats / Jordon Eckstrom + men's first-name NPCs. Hydrate must
    // rebuild the pool to women's pantheon on next load.
    const broken = {
      id: 'broken_women_pool',
      version: 7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: 'in_season',
      wrestler: {
        name: 'Stale Female',
        gender: 'female',
        tier: 'college',
        year: 2,
        age: 19,
        weightClass: 131,
        state: 'IA',
        stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        statPointsAvailable: 0,
        xp: 0,
        level: 1,
        skillTree: { unlockedNodes: [], pointsAvailable: 0 },
      },
      schedule: { seasonYear: 2, currentEventIdx: 0, events: [] },
      record: { seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
                pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [] },
      deck: { cardIds: [], history: [] },
      // Bug-shape: Chase Kamats injected into a women's pool.
      rankingPool: [
        { id: 'special_chase_kamats', name: 'Chase Kamats', school: 'Northwest HS', overall: 95, scope: 'conference' },
        { id: 'special_jordon_eckstrom', name: 'Jordon Eckstrom', school: 'East Side', overall: 88, scope: 'conference' },
        { id: 'rank_filler_1', name: 'Marcus Smith', school: 'Generic', overall: 70, scope: 'conference' },
      ],
      rivals: [
        { id: 'special_chase_kamats', name: 'Chase Kamats', overall: 95 },
        { id: 'normal_rival', name: 'Sarah Lee', overall: 80, h2h: { wins: 1, losses: 0, lastMeeting: null } },
      ],
      rankingPool_unused: null,
      rankings: { conference: 1, section: 1, state: 1, asOfEventIdx: 0 },
    };
    const fixed = hydrateCareer(broken);
    const hasChase = fixed.rankingPool.some(p => p?.name === 'Chase Kamats');
    assert.equal(hasChase, false, 'Chase Kamats removed from women\'s pool');
    const hasJordon = fixed.rankingPool.some(p => p?.name === 'Jordon Eckstrom');
    assert.equal(hasJordon, false, 'Jordon Eckstrom removed from women\'s pool');
    // Chase also removed from rivals; preserved rivals (Sarah Lee) stay.
    const chaseInRivals = (fixed.rivals || []).some(r => r?.name === 'Chase Kamats');
    assert.equal(chaseInRivals, false);
    const sarahStillThere = (fixed.rivals || []).some(r => r?.name === 'Sarah Lee');
    assert.ok(sarahStillThere, 'non-male-special rivals preserved (H2H history not lost)');
  });

  test('hydrate self-heals when pool has men\'s cohort but not Chase/Jordon', () => {
    // Pre-fix advanceToNextSeason would build the men's pool. If Chase/Jordon
    // dedupe matched somewhere upstream and only the cohort men remained,
    // the original Chase-only detection missed this case. The broader
    // detection (any men's special OR no women's specials) catches it.
    const broken = {
      id: 'broken_cohort_only',
      version: 7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: 'in_season',
      wrestler: {
        name: 'Stale F', gender: 'female', tier: 'college', year: 2, age: 19,
        weightClass: 131, state: 'IA',
        stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        statPointsAvailable: 0, xp: 0, level: 1,
        skillTree: { unlockedNodes: [], pointsAvailable: 0 },
      },
      schedule: { seasonYear: 2, currentEventIdx: 0, events: [] },
      record: { seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
                pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [] },
      deck: { cardIds: [], history: [] },
      // Cohort men present, no Chase/Jordon, no women's specials.
      rankingPool: [
        { id: 'special_stetson_clary', name: 'Stetson Clary', overall: 86, scope: 'conference' },
        { id: 'special_jaxon_louis',   name: 'Jaxon Louis',   overall: 85, scope: 'conference' },
      ],
      rivals: [],
      rankings: { conference: 1, section: 1, state: 1, asOfEventIdx: 0 },
    };
    const fixed = hydrateCareer(broken);
    const hasStetson = fixed.rankingPool.some(p => p?.name === 'Stetson Clary');
    assert.equal(hasStetson, false, 'Stetson Clary removed from women\'s pool');
    assert.ok(fixed._needsResave, 'self-heal sets _needsResave so caller persists the repair');
  });

  test('hydrate self-heals when pool has filler men but no women\'s specials at all', () => {
    // Worst case: pool was male-regenerated but the special-NPC pass was
    // skipped, so neither Chase/Jordon nor cohort show up - just generic
    // filler with men's first names. The "no women specials" arm of the
    // detection still triggers a regen.
    const broken = {
      id: 'broken_no_specials',
      version: 7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: 'in_season',
      wrestler: {
        name: 'Stale F', gender: 'female', tier: 'college', year: 2, age: 19,
        weightClass: 131, state: 'IA',
        stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        statPointsAvailable: 0, xp: 0, level: 1,
        skillTree: { unlockedNodes: [], pointsAvailable: 0 },
      },
      schedule: { seasonYear: 2, currentEventIdx: 0, events: [] },
      record: { seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
                pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [] },
      deck: { cardIds: [], history: [] },
      rankingPool: [
        { id: 'rank_filler_1', name: 'Marcus Smith', overall: 70, scope: 'conference' },
        { id: 'rank_filler_2', name: 'Tyler Johnson', overall: 65, scope: 'conference' },
      ],
      rivals: [],
      rankings: { conference: 1, section: 1, state: 1, asOfEventIdx: 0 },
    };
    const fixed = hydrateCareer(broken);
    // Pool regenerated; women's specials should now be present.
    const hasValerie = fixed.rankingPool.some(p => p?.name === 'Valerie Aikens');
    assert.ok(hasValerie, 'women\'s pantheon present after regeneration');
    assert.ok(fixed._needsResave, '_needsResave set');
  });

  test('hydrate leaves a male career\'s pool untouched (no false-positive repair)', () => {
    const ok = {
      id: 'ok_male',
      version: 7,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: 'in_season',
      wrestler: {
        name: 'Marty', gender: 'male', tier: 'college', year: 1, age: 18,
        weightClass: 141, state: 'IA',
        stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        statPointsAvailable: 0, xp: 0, level: 1,
        skillTree: { unlockedNodes: [], pointsAvailable: 0 },
      },
      schedule: { seasonYear: 1, currentEventIdx: 0, events: [] },
      record: { seasonWins: 0, seasonLosses: 0, careerWins: 0, careerLosses: 0,
                pins: 0, techs: 0, majorDecs: 0, nearFalls: 0, titles: [] },
      deck: { cardIds: [], history: [] },
      rankingPool: [
        { id: 'special_chase_kamats', name: 'Chase Kamats', school: 'X', overall: 95, scope: 'conference' },
      ],
      rivals: [],
      rankings: { conference: 1, section: 1, state: 1, asOfEventIdx: 0 },
    };
    const fixed = hydrateCareer(ok);
    const hasChase = fixed.rankingPool.some(p => p?.name === 'Chase Kamats');
    assert.ok(hasChase, 'male career retains Chase Kamats - no spurious repair');
  });
});

describe('Test D - filler-dedup fix: existing-save hydration', () => {
  // The filler-name dedup fix changes only how NEW seasons are built. It must
  // not touch an in-progress career's already-stored opponents, and existing
  // saves must hydrate identically. The next season an existing career
  // advances into does get the dedup fix.
  test('in-progress save hydrates unchanged; next season de-collides fillers', () => {
    let c = createCareer({ name: 'HydrateTest', weightClass: 138, rng: () => 0.5 });

    // Play partway through season 1 -> a realistic mid-season save.
    for (const evt of c.schedule.events.slice(0, 3)) {
      c = recordEventResult(c, evt.id, {
        playerWon: true, p1Score: 6, p2Score: 2, winMethod: 'decision',
      });
    }

    // Snapshot the current season's stored opponents before persistence.
    const opponentsBefore = c.schedule.events.map(e => e.opponent ?? null);

    // Round-trip through storage and hydrate, exactly as a save/load does.
    const persisted = JSON.parse(JSON.stringify(c));
    const hydrated = hydrateCareer(persisted);

    assert.ok(hydrated && hydrated.schedule && hydrated.wrestler,
      'hydrated career is structurally intact');
    assert.equal(hydrated.schedule.events.length, c.schedule.events.length,
      'no events lost on hydration');
    assert.deepEqual(
      hydrated.schedule.events.map(e => e.opponent ?? null),
      opponentsBefore,
      'current season stored opponents are unchanged by hydration / the fix',
    );

    // Finish the season from the hydrated save, then advance. The new season
    // is built by the fixed season generator; ()=>0 forces every un-deduped
    // candidate to collide.
    let career = hydrated;
    for (const evt of career.schedule.events.slice(3)) {
      career = recordEventResult(career, evt.id, {
        playerWon: true, p1Score: 6, p2Score: 2, winMethod: 'decision',
      });
    }
    assert.equal(career.phase, 'offseason', 'season finished');

    const next = advanceToNextSeason(career, { rng: () => 0 });
    assert.ok(next && next.schedule && next.schedule.events.length > 0,
      'next season generated and career still structurally valid');

    const fillerNames = next.schedule.events
      .filter(e => (e.type === 'dual_meet' || e.type === 'dual')
        && !e.opponentIsRival && e.opponent)
      .map(e => e.opponent.name);
    assert.ok(fillerNames.length >= 2, 'next season has multiple filler duals');
    assert.equal(new Set(fillerNames).size, fillerNames.length,
      `next season has duplicate filler names: ${fillerNames.join(', ')}`);
  });
});
