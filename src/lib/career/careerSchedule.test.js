// Career schedule generator tests. Verifies that brand-new schedules emit
// the new 'dual_meet' event type at HS and college tiers (both genders) and
// that the senior schedule contains zero dual_meet events. Also verifies the
// rivalry-dual slot still seeds a rival into event.opponent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateHSSeason,
  generateCollegeSeason,
  generateSeniorSeason,
  generateSeasonSchedule,
} from './careerSchedule.js';

const fixedRng = (() => {
  let n = 1;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
})();

function stubRivals(weightClass = 138) {
  return [
    { id: 'rival_1', name: 'Marcus Delacroix', school: 'Iowa City High', weightClass, tier: 'hs', style: 'folkstyle', stats: { str: 70, spd: 70, tec: 70, end: 70, grt: 70 }, overall: 70 },
    { id: 'rival_2', name: 'Tyrone Petrov', school: 'Stillwater Prep', weightClass, tier: 'hs', style: 'folkstyle', stats: { str: 68, spd: 68, tec: 68, end: 68, grt: 68 }, overall: 68 },
  ];
}

describe('careerSchedule - dual_meet generation', () => {
  test('HS schedule generates 8 dual_meet events (men) with stable IDs', () => {
    const events = generateHSSeason({
      seasonYear: 1,
      year: 1,
      weightClass: 145,
      gender: 'male',
      rivals: stubRivals(145),
      rng: fixedRng,
    });
    const dualMeets = events.filter(e => e.type === 'dual_meet');
    assert.equal(dualMeets.length, 8, 'HS template has 8 dual_meet slots');
    const legacyDuals = events.filter(e => e.type === 'dual');
    assert.equal(legacyDuals.length, 0, 'no legacy dual events in fresh HS schedule');
    for (const e of dualMeets) {
      assert.ok(e.id, `dual_meet event ${e.name} has stable id`);
      assert.equal(e.weightClass, 145);
      assert.equal(e.style, 'folkstyle');
      assert.ok(e.opponent, 'hero-bout opponent baked in for rivalry/H2H tracking');
      assert.equal(e.lineupChoice, null, 'lineupChoice starts null');
      assert.ok(typeof e.opponentTeamName === 'string' && e.opponentTeamName.length > 0,
        'opponentTeamName populated by schedule generator');
    }
  });

  test('HS schedule generates 8 dual_meet events for women too', () => {
    const events = generateHSSeason({
      seasonYear: 1,
      year: 1,
      weightClass: 130,
      gender: 'female',
      rivals: stubRivals(130),
      rng: fixedRng,
    });
    const dualMeets = events.filter(e => e.type === 'dual_meet');
    assert.equal(dualMeets.length, 8);
    for (const e of dualMeets) {
      assert.equal(e.weightClass, 130);
    }
  });

  test('college schedule generates 11 dual_meet events (men)', () => {
    const events = generateCollegeSeason({
      seasonYear: 1,
      year: 1,
      weightClass: 157,
      gender: 'male',
      rivals: stubRivals(157),
      rng: fixedRng,
    });
    const dualMeets = events.filter(e => e.type === 'dual_meet');
    assert.equal(dualMeets.length, 11);
    const legacy = events.filter(e => e.type === 'dual');
    assert.equal(legacy.length, 0);
    for (const e of dualMeets) {
      assert.equal(e.style, 'folkstyle');
      assert.ok(e.opponentTeamName);
    }
  });

  test('college schedule generates 11 dual_meet events for women (style=womens_freestyle)', () => {
    const events = generateCollegeSeason({
      seasonYear: 1,
      year: 1,
      weightClass: 131,
      gender: 'female',
      rivals: stubRivals(131),
      rng: fixedRng,
    });
    const dualMeets = events.filter(e => e.type === 'dual_meet');
    assert.equal(dualMeets.length, 11);
    for (const e of dualMeets) {
      assert.equal(e.style, 'womens_freestyle');
    }
  });

  test('senior schedule contains zero dual_meet events for both genders', () => {
    const menEvents = generateSeniorSeason({
      seasonYear: 1, year: 5, weightClass: 74, gender: 'male', rng: fixedRng,
    });
    const womenEvents = generateSeniorSeason({
      seasonYear: 1, year: 5, weightClass: 62, gender: 'female', rng: fixedRng,
    });
    assert.equal(menEvents.filter(e => e.type === 'dual_meet').length, 0);
    assert.equal(womenEvents.filter(e => e.type === 'dual_meet').length, 0);
  });

  test('Rivalry Dual slot seeds a rival into event.opponent (HS)', () => {
    const rivals = stubRivals(145);
    const events = generateHSSeason({
      seasonYear: 1, year: 1, weightClass: 145, gender: 'male', rivals, rng: fixedRng,
    });
    const rivalry = events.find(e => e.name === 'Rivalry Dual');
    assert.ok(rivalry, 'rivalry slot exists');
    assert.equal(rivalry.type, 'dual_meet');
    assert.equal(rivalry.opponentIsRival, true);
    assert.ok(rivals.some(r => r.id === rivalry.opponent.id),
      "rivalry dual's opponent is one of the rivals");
  });

  test('Rivalry Dual slot seeds a rival into event.opponent (college)', () => {
    const rivals = stubRivals(157);
    const events = generateCollegeSeason({
      seasonYear: 1, year: 1, weightClass: 157, gender: 'male', rivals, rng: fixedRng,
    });
    const rivalry = events.find(e => e.name === 'Rivalry Dual');
    assert.ok(rivalry);
    assert.equal(rivalry.type, 'dual_meet');
    assert.equal(rivalry.opponentIsRival, true);
    assert.ok(rivals.some(r => r.id === rivalry.opponent.id));
  });

  test('generateSeasonSchedule dispatches by tier and threads gender', () => {
    const hs = generateSeasonSchedule({ tier: 'hs', seasonYear: 1, year: 1, weightClass: 145, gender: 'male', rivals: stubRivals(145), rng: fixedRng });
    const college = generateSeasonSchedule({ tier: 'college', seasonYear: 1, year: 1, weightClass: 157, gender: 'male', rivals: stubRivals(157), rng: fixedRng });
    const senior = generateSeasonSchedule({ tier: 'senior', seasonYear: 1, year: 5, weightClass: 74, style: 'freestyle', gender: 'male', rivals: [], rng: fixedRng });
    assert.ok(hs.some(e => e.type === 'dual_meet'), 'HS dispatch produces dual_meet');
    assert.ok(college.some(e => e.type === 'dual_meet'), 'college dispatch produces dual_meet');
    assert.ok(senior.every(e => e.type !== 'dual_meet'), 'senior dispatch produces no dual_meet');
  });
});
