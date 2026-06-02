// Career Depth Pass v1 - Coach / Corner Advisor tests.
//
// Run: node --test src/lib/career/careerCoach.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  COACHES,
  coachForTier,
  coachForCareerTier,
  getCoachLine,
  computeScoutingBlurb,
} = await import('./careerCoach.js');

const {
  createCareer,
  takeWalkOnPath,
  confirmTierTransition,
  chooseSeniorStyle,
  enterSeniorStyleChoice,
} = await import('./careerState.js');

function fixedRng() {
  let n = 0;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

// ─── coachForTier ───────────────────────────────────────────────────────────

test('coachForTier(hs) returns Coach Petrov', () => {
  const c = coachForTier('hs');
  assert.ok(c);
  assert.equal(c.id, 'hs_coach_petrov');
  assert.equal(c.name, 'Coach Petrov');
});

test('coachForTier(college) returns the generic college coach', () => {
  const c = coachForTier('college');
  assert.ok(c);
  assert.equal(c.id, 'generic_college_coach');
});

test('coachForTier(senior) returns the generic senior coach', () => {
  const c = coachForTier('senior');
  assert.ok(c);
  assert.equal(c.id, 'generic_senior_coach');
});

test('coachForTier(unknown) returns null', () => {
  assert.equal(coachForTier(undefined), null);
  assert.equal(coachForTier(null), null);
  assert.equal(coachForTier('mythical_tier'), null);
});

// ─── getCoachLine ───────────────────────────────────────────────────────────

const PETROV_SITUATIONS = [
  'season_start',
  'season_end',
  'pre_match',
  'win',
  'loss',
  'pin_win',
  'pinned',
  'championship_win',
  'championship_loss',
];

for (const situation of PETROV_SITUATIONS) {
  test(`getCoachLine(hs_coach_petrov, ${situation}) returns a non-empty string`, () => {
    const line = getCoachLine('hs_coach_petrov', situation);
    assert.equal(typeof line, 'string');
    assert.ok(line.length > 0);
  });
}

test('Coach Petrov has at least 4 lines for the most-used situations', () => {
  for (const situation of ['pre_match', 'win', 'loss']) {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const line = getCoachLine('hs_coach_petrov', situation, () => Math.random());
      if (line) seen.add(line);
    }
    assert.ok(seen.size >= 4, `pool ${situation} has >= 4 lines (got ${seen.size})`);
  }
});

test('getCoachLine returns null for unknown coach', () => {
  assert.equal(getCoachLine('not_a_coach', 'pre_match'), null);
});

test('getCoachLine returns null for unknown situation', () => {
  assert.equal(getCoachLine('hs_coach_petrov', 'not_a_situation'), null);
});

test('getCoachLine returns null on missing inputs', () => {
  assert.equal(getCoachLine(null, 'pre_match'), null);
  assert.equal(getCoachLine('hs_coach_petrov', null), null);
});

// ─── computeScoutingBlurb ───────────────────────────────────────────────────

test('computeScoutingBlurb picks a line keyed to the opponent top stat (STR)', () => {
  const opponent = { stats: { str: 90, spd: 60, tec: 60, end: 60, grt: 60 } };
  const blurb = computeScoutingBlurb(opponent, () => 0); // pick first
  assert.equal(typeof blurb, 'string');
  assert.match(blurb, /Power-based|Heavy hands|muscle/i);
});

test('computeScoutingBlurb handles each top-stat tendency', () => {
  const cases = [
    ['spd', /shoot|Quick|feet/i],
    ['tec', /Chain|Slick|Technical/i],
    ['end', /P3|cardio|six minutes/i],
    ['grt', /quit|Bites|stays/i],
  ];
  for (const [topStat, pattern] of cases) {
    const stats = { str: 50, spd: 50, tec: 50, end: 50, grt: 50, [topStat]: 90 };
    const blurb = computeScoutingBlurb({ stats }, () => 0);
    assert.match(blurb, pattern, `top stat ${topStat} -> blurb tone`);
  }
});

test('computeScoutingBlurb returns null when stats are missing', () => {
  assert.equal(computeScoutingBlurb(null), null);
  assert.equal(computeScoutingBlurb({}), null);
  assert.equal(computeScoutingBlurb({ stats: 'junk' }), null);
});

test('COACHES export includes the named coaches', () => {
  assert.ok(COACHES.hs_coach_petrov);
  assert.ok(COACHES.generic_college_coach);
  assert.ok(COACHES.generic_senior_coach);
});

// ─── coachForCareerTier ─────────────────────────────────────────────────────

test('coachForCareerTier with a tier string mirrors coachForTier', () => {
  assert.equal(coachForCareerTier('hs').id, 'hs_coach_petrov');
  assert.equal(coachForCareerTier('college').id, 'generic_college_coach');
  assert.equal(coachForCareerTier('senior').id, 'generic_senior_coach');
});

test('coachForCareerTier with a career resolves via career.wrestler.tier', () => {
  const career = { wrestler: { tier: 'college' } };
  assert.equal(coachForCareerTier(career).id, 'generic_college_coach');
});

test('coachForCareerTier with null / missing tier returns null', () => {
  assert.equal(coachForCareerTier(null), null);
  assert.equal(coachForCareerTier({}), null);
  assert.equal(coachForCareerTier({ wrestler: {} }), null);
});

// ─── tier-transition coach rebind ───────────────────────────────────────────

test('takeWalkOnPath assigns the generic college coach (HS Petrov out)', () => {
  const career = createCareer({
    name: 'Trans Test', gender: 'male', tier: 'hs', year: 4,
    weightClass: 132, stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
    state: 'IA', rng: fixedRng(),
  });
  assert.equal(career.coach?.id, 'hs_coach_petrov');
  const collegeCareer = takeWalkOnPath(career, { rng: fixedRng() });
  assert.equal(collegeCareer.wrestler.tier, 'college');
  assert.equal(collegeCareer.coach?.id, 'generic_college_coach');
});

test('chooseSeniorStyle assigns the generic senior coach', () => {
  // Synthesize a college career at year 4 - chooseSeniorStyle requires a
  // seniorChoice payload from enterSeniorStyleChoice.
  const career = createCareer({
    name: 'Senior Test', gender: 'male', tier: 'hs', year: 4,
    weightClass: 132, stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
    state: 'IA', rng: fixedRng(),
  });
  const college = takeWalkOnPath(career, { rng: fixedRng() });
  // Force the college career to year=4 and confirm the transition so
  // wrestler.tier === 'college' is the binding state.
  const collegeY4 = {
    ...college,
    wrestler: { ...college.wrestler, year: 4 },
    phase: 'offseason',
  };
  const seniorChoice = enterSeniorStyleChoice(collegeY4, { rng: fixedRng() });
  const seniorCareer = chooseSeniorStyle(seniorChoice, 'freestyle', { rng: fixedRng() });
  assert.equal(seniorCareer.wrestler.tier, 'senior');
  assert.equal(seniorCareer.coach?.id, 'generic_senior_coach');
});

test('confirmTierTransition (main branch) rebinds coach from current tier', () => {
  // Synthesize a college career still carrying a stale HS coach AND a
  // populated tierTransition payload (the main-return branch).
  const career = {
    id: 'c1',
    version: 8,
    phase: 'tier_transition',
    wrestler: { name: 'Stale Coach', tier: 'college', year: 1, age: 19,
                weightClass: 141, gender: 'male', style: 'folkstyle',
                state: 'IA', stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
                statPointsAvailable: 0, xp: 0, level: 1, tempBuffs: [],
                unlockedCardIds: [],
                skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null } },
    schedule: { seasonYear: 1, events: [], currentEventIdx: 0 },
    rivals: [],
    rankings: { conference: 0, section: 0, state: 0, asOfEventIdx: 0 },
    record: { wins: 0, losses: 0, seasonWins: 0, seasonLosses: 0 },
    coach: { id: 'hs_coach_petrov', name: 'Coach Petrov', tier: 'hs' },
    tierTransition: { fromTier: 'hs', toTier: 'college', schoolName: 'Test U' },
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const next = confirmTierTransition(career, { rng: fixedRng() });
  assert.equal(next.coach?.id, 'generic_college_coach');
  assert.equal(next.tierTransition, null);
  assert.equal(next.phase, 'preseason');
});

test('confirmTierTransition (early-return branch) also rebinds coach', () => {
  // Same fixture but tierTransition is null - hits the `if (!career.tierTransition)`
  // early return. Coach must still rebind so a legacy save with a stale
  // tier/coach pair self-heals when this reducer runs.
  const career = {
    id: 'c2',
    version: 8,
    phase: 'tier_transition',
    wrestler: { name: 'Stale Coach', tier: 'college', year: 1, age: 19,
                weightClass: 141, gender: 'male', style: 'folkstyle',
                state: 'IA', stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
                statPointsAvailable: 0, xp: 0, level: 1, tempBuffs: [],
                unlockedCardIds: [],
                skillTree: { unlockedNodes: [], pointsAvailable: 0, focus: null } },
    schedule: { seasonYear: 1, events: [], currentEventIdx: 0 },
    rivals: [],
    rankings: { conference: 0, section: 0, state: 0, asOfEventIdx: 0 },
    record: { wins: 0, losses: 0, seasonWins: 0, seasonLosses: 0 },
    coach: { id: 'hs_coach_petrov', name: 'Coach Petrov', tier: 'hs' },
    tierTransition: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  const next = confirmTierTransition(career, { rng: fixedRng() });
  assert.equal(next.coach?.id, 'generic_college_coach');
  assert.equal(next.phase, 'preseason');
});
