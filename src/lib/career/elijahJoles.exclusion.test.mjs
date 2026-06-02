// Regression coverage for the Elijah Joles featured-wrestler partnership.
//
// Three concerns:
//   1. computeBossOverall produces the values published in the plan
//      (sqrt curve: 1->75, 5->79, 10->81, 25->84, 50->89, 100->94, 145->99 cap;
//      escalation +12 cap unchanged).
//   2. Male careers GET Elijah in their special-NPC pool + their schedule
//      seeding. Women's careers DO NOT (id and name).
//   3. checkAchievements awards beat_elijah on legitimate wins, NOT on
//      forfeit / 'dq' / 'disqualification', NOT against non-Elijah opponents;
//      awards beat_elijah_legend on the 4th boss win (elijahBossWinsAfter >= 4).
//   4. hydrateCareer purges Elijah from a contaminated female career.
//   5. buildSeededBracket forced-seed entries carry both rankPoolId and npcId
//      so tournament matches get AI personality + badge attribution.
//   6. buildElijahBossOpponent.overall equals computeBossOverall(level, wins)
//      across the curve (no clamp-induced average drift at the top end).
//
// Tests are intentionally isolated in their own file so future failures
// point cleanly at the partnership feature.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ELIJAH_JOLES_ID,
  computeBossOverall,
  buildElijahJolesNpc,
  buildElijahBossOpponent,
  PARTNERSHIP_ACTIVE,
} from './elijahJoles.js';
import {
  buildSpecialAiWrestlers,
  ensureSpecialWomensAiWrestlers,
} from './careerRankings.js';
import { buildSeededBracket } from './careerBrackets.js';
import {
  generateHSSeason,
  generateCollegeSeason,
  generateSeniorSeason,
} from './careerSchedule.js';
import { hydrateCareer, createCareer } from './careerState.js';
import { checkAchievements, DQ_LIKE_WIN_METHODS } from '../profileUtils.js';

// ─── Sanity: partnership flag is on so the rest of the assertions are meaningful

test('PARTNERSHIP_ACTIVE is true', () => {
  assert.equal(PARTNERSHIP_ACTIVE, true);
});

// ─── computeBossOverall

test('computeBossOverall: level 1, 0 wins → floor at 75', () => {
  // base = 75 + floor(sqrt(0) * 2) = 75
  assert.equal(computeBossOverall(1, 0), 75);
});

test('computeBossOverall: level 5, 0 wins → 79', () => {
  // base = 75 + floor(sqrt(4) * 2) = 75 + 4 = 79
  assert.equal(computeBossOverall(5, 0), 79);
});

test('computeBossOverall: level 10, 0 wins → 81', () => {
  // base = 75 + floor(sqrt(9) * 2) = 75 + 6 = 81
  assert.equal(computeBossOverall(10, 0), 81);
});

test('computeBossOverall: level 25, 0 wins → 84', () => {
  // base = 75 + floor(sqrt(24) * 2) = 75 + floor(9.79) = 75 + 9 = 84
  assert.equal(computeBossOverall(25, 0), 84);
});

test('computeBossOverall: level 50, 0 wins → 89 (no longer pinned at 99)', () => {
  // base = 75 + floor(sqrt(49) * 2) = 75 + 14 = 89
  assert.equal(computeBossOverall(50, 0), 89);
});

test('computeBossOverall: level 100, 0 wins → 94', () => {
  // base = 75 + floor(sqrt(99) * 2) = 75 + floor(19.9) = 75 + 19 = 94
  assert.equal(computeBossOverall(100, 0), 94);
});

test('computeBossOverall: level 145, 0 wins → 99 (cap reached via base alone)', () => {
  // base = 75 + floor(sqrt(144) * 2) = 75 + 24 = 99
  assert.equal(computeBossOverall(145, 0), 99);
});

test('computeBossOverall: high level (lv 500) caps at 99', () => {
  assert.equal(computeBossOverall(500, 0), 99);
});

test('computeBossOverall: level 1, 4 wins → 87 (expert tier via escalation)', () => {
  // base 75 + min(12, 12) = 87
  assert.equal(computeBossOverall(1, 4), 87);
});

test('computeBossOverall: level 50, 4 wins → caps at 99', () => {
  // base 89 + 12 = 101 → cap 99
  assert.equal(computeBossOverall(50, 4), 99);
});

test('computeBossOverall: escalation bonus capped at +12 (level 25, 99 wins → 96)', () => {
  // base 84 + min(12, 99*3) = 84 + 12 = 96
  assert.equal(computeBossOverall(25, 99), 96);
});

// ─── Male career: Elijah present in the special-NPC builder

test('buildSpecialAiWrestlers (male HS, 165 lb) includes Elijah', () => {
  const pool = buildSpecialAiWrestlers({ weightClass: 165, tier: 'hs', scope: 'state' });
  assert.ok(
    pool.some((w) => w.id === ELIJAH_JOLES_ID || w.name === 'Elijah Joles'),
    'expected Elijah in male HS special pool',
  );
});

test('buildSpecialAiWrestlers includes Elijah at every tier (hs / college / senior)', () => {
  for (const tier of ['hs', 'college', 'senior']) {
    const pool = buildSpecialAiWrestlers({ weightClass: 165, tier, scope: 'state' });
    assert.ok(
      pool.some((w) => w.id === ELIJAH_JOLES_ID),
      `Elijah must appear at tier=${tier}`,
    );
  }
});

// ─── Women's career: Elijah ABSENT from the women's-only injection path
//
// buildSpecialWomensAiWrestlers itself is not exported, but the only call site
// that injects women's specials into a pool is ensureSpecialWomensAiWrestlers.
// Passing an empty starting pool exposes the full set of women's specials, and
// none of them must be Elijah.

test('ensureSpecialWomensAiWrestlers does NOT include Elijah (id)', () => {
  const pool = ensureSpecialWomensAiWrestlers([], { weightClass: 138, tier: 'hs', scope: 'state' });
  assert.ok(
    pool.length > 0,
    'women\'s pool must be populated; an empty pool would mask the exclusion check',
  );
  assert.ok(
    !pool.some((w) => w.id === ELIJAH_JOLES_ID),
    'Elijah id must not appear in women\'s special pool',
  );
});

test('ensureSpecialWomensAiWrestlers does NOT include Elijah (name)', () => {
  const pool = ensureSpecialWomensAiWrestlers([], { weightClass: 138, tier: 'hs', scope: 'state' });
  assert.ok(
    pool.length > 0,
    'women\'s pool must be populated; an empty pool would mask the exclusion check',
  );
  assert.ok(
    !pool.some((w) => w.name === 'Elijah Joles'),
    'Elijah name must not appear in women\'s special pool',
  );
});

// ─── Schedule seeding: male path seeds Elijah on the two designated brackets

test('generateHSSeason (male): Holiday Open seeds Elijah', () => {
  const season = generateHSSeason({
    seasonYear: 2026, year: 2026, weightClass: 165, gender: 'male', rivals: [],
  });
  const holiday = season.find((e) => e.name === 'Holiday Open');
  assert.ok(holiday, 'Holiday Open event must exist in HS season');
  assert.ok(
    Array.isArray(holiday.seededRivalIds) && holiday.seededRivalIds.includes(ELIJAH_JOLES_ID),
    'Holiday Open must seed Elijah for male HS careers',
  );
});

test('generateHSSeason (male): Mid-Season Classic seeds Elijah', () => {
  const season = generateHSSeason({
    seasonYear: 2026, year: 2026, weightClass: 165, gender: 'male', rivals: [],
  });
  const msc = season.find((e) => e.name === 'Mid-Season Classic');
  assert.ok(msc, 'Mid-Season Classic event must exist');
  assert.ok(
    Array.isArray(msc.seededRivalIds) && msc.seededRivalIds.includes(ELIJAH_JOLES_ID),
    'Mid-Season Classic must seed Elijah for male HS careers',
  );
});

// ─── Schedule seeding: female path NEVER seeds Elijah

test('generateHSSeason (female): ZERO events seed Elijah', () => {
  const season = generateHSSeason({
    seasonYear: 2026, year: 2026, weightClass: 138, gender: 'female', rivals: [],
  });
  const leak = season.filter(
    (e) => Array.isArray(e.seededRivalIds) && e.seededRivalIds.includes(ELIJAH_JOLES_ID),
  );
  assert.equal(leak.length, 0, 'no female HS event may seed Elijah');
});

test('generateCollegeSeason (female): ZERO events seed Elijah', () => {
  const season = generateCollegeSeason({
    seasonYear: 2026, year: 2026, weightClass: 138, gender: 'female', rivals: [],
  });
  const leak = season.filter(
    (e) => Array.isArray(e.seededRivalIds) && e.seededRivalIds.includes(ELIJAH_JOLES_ID),
  );
  assert.equal(leak.length, 0, 'no female college event may seed Elijah');
});

test('generateSeniorSeason (female): ZERO events seed Elijah', () => {
  const season = generateSeniorSeason({
    seasonYear: 2026, year: 2026, weightClass: 62, gender: 'female', style: 'womens_freestyle', rivals: [],
  });
  const leak = season.filter(
    (e) => Array.isArray(e.seededRivalIds) && e.seededRivalIds.includes(ELIJAH_JOLES_ID),
  );
  assert.equal(leak.length, 0, 'no female senior event may seed Elijah');
});

// ─── Schedule seeding: male senior freestyle events seed Elijah; greco events do not

test('generateSeniorSeason (male): freestyle events include Elijah, greco events do not', () => {
  const season = generateSeniorSeason({
    seasonYear: 2026, year: 2026, weightClass: 74, gender: 'male', style: 'freestyle', rivals: [],
  });
  const freestyleSeeded = season.filter(
    (e) => e.style === 'freestyle'
        && Array.isArray(e.seededRivalIds)
        && e.seededRivalIds.includes(ELIJAH_JOLES_ID),
  );
  const grecoSeeded = season.filter(
    (e) => e.style === 'greco'
        && Array.isArray(e.seededRivalIds)
        && e.seededRivalIds.includes(ELIJAH_JOLES_ID),
  );
  assert.ok(freestyleSeeded.length >= 1, 'at least one male freestyle senior event must seed Elijah');
  assert.equal(grecoSeeded.length, 0, 'no male greco senior event may seed Elijah');
});

// ─── buildSeededBracket honors forcedSeedIds

test('buildSeededBracket forces Elijah into the bracket even when overall would omit him', () => {
  const elijah = buildElijahJolesNpc({
    weightClass: 165, tier: 'hs', style: 'freestyle', scope: 'state',
  });
  const career = {
    wrestler: {
      name: 'Test Player',
      stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
    },
    rankingPool: [
      elijah,
      // 20 stronger filler NPCs to push Elijah out of the natural top-16
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `filler_${i}`,
        name: `Strong Filler${i} Surname${i}`,
        overall: 99,
        stats: { str: 99, spd: 99, tec: 99, end: 99, grt: 99 },
        weightClass: 165,
        scope: 'state',
        tier: 'hs',
        wins: 0, losses: 0,
      })),
    ],
  };
  const { bracket } = buildSeededBracket(career, 16, 'regular', 'folkstyle', [ELIJAH_JOLES_ID]);
  // Structured walk (no JSON.stringify substring): assert exactly one entry
  // for Elijah and that BOTH identity fields carry his id so tournament code
  // can route AI personality + badge attribution.
  const matches = bracket.filter(
    (b) => b && (b.npcId === ELIJAH_JOLES_ID || b.rankPoolId === ELIJAH_JOLES_ID),
  );
  assert.equal(matches.length, 1, 'exactly one Elijah entry in the forced-seed bracket');
  assert.equal(matches[0].rankPoolId, ELIJAH_JOLES_ID, 'rankPoolId carries Elijah id');
  assert.equal(matches[0].npcId, ELIJAH_JOLES_ID, 'npcId carries Elijah id for AI personality + badge credit');
  assert.equal(matches[0].name, 'Elijah Joles', 'name preserved');
});

// ─── checkAchievements: positive + negative paths
//
// Signature: checkAchievements(existingIds: string[], matchResult, profile)
// Returns: string[] of newly-earned achievement IDs.

test('checkAchievements awards beat_elijah on a legitimate decision win', () => {
  const earned = checkAchievements([], {
    result: 'win',
    winMethod: 'decision',
    opponentNpcId: 'special_elijah_joles',
    elijahBossWinsAfter: 1,
  }, {});
  assert.ok(earned.includes('beat_elijah'));
  assert.ok(!earned.includes('beat_elijah_legend'));
});

test('checkAchievements awards beat_elijah_legend on the 4th boss win (elijahBossWinsAfter >= 4)', () => {
  const earned = checkAchievements(['beat_elijah'], {
    result: 'win',
    winMethod: 'decision',
    opponentNpcId: 'special_elijah_joles',
    elijahBossWinsAfter: 4,
  }, {});
  assert.ok(earned.includes('beat_elijah_legend'));
});

test('checkAchievements withholds beat_elijah_legend at elijahBossWinsAfter=3', () => {
  const earned = checkAchievements(['beat_elijah'], {
    result: 'win',
    winMethod: 'decision',
    opponentNpcId: 'special_elijah_joles',
    elijahBossWinsAfter: 3,
  }, {});
  assert.ok(!earned.includes('beat_elijah_legend'),
    'legend tier triggers at >= 4 boss wins, not earlier');
});

test('checkAchievements does NOT award beat_elijah on a forfeit "win"', () => {
  const earned = checkAchievements([], {
    result: 'win',
    winMethod: 'forfeit',
    opponentNpcId: 'special_elijah_joles',
    elijahBossWinsAfter: 1,
  }, {});
  assert.ok(!earned.includes('beat_elijah'));
});

test('checkAchievements does NOT award beat_elijah on a disqualification "win"', () => {
  const earned = checkAchievements([], {
    result: 'win',
    winMethod: 'disqualification',
    opponentNpcId: 'special_elijah_joles',
    elijahBossWinsAfter: 1,
  }, {});
  assert.ok(!earned.includes('beat_elijah'));
});

test('checkAchievements does NOT award beat_elijah against a non-Elijah opponent', () => {
  const earned = checkAchievements([], {
    result: 'win',
    winMethod: 'decision',
    opponentNpcId: 'some_other_npc',
    elijahBossWinsAfter: 1,
  }, {});
  assert.ok(!earned.includes('beat_elijah'));
  assert.ok(!earned.includes('beat_elijah_legend'));
});

test('checkAchievements does NOT award beat_elijah on a loss', () => {
  const earned = checkAchievements([], {
    result: 'loss',
    winMethod: 'decision',
    opponentNpcId: 'special_elijah_joles',
    elijahBossWinsAfter: 0,
  }, {});
  assert.ok(!earned.includes('beat_elijah'));
});

// ─── checkAchievements: DQ_LIKE_WIN_METHODS rejects every variant

test('DQ_LIKE_WIN_METHODS exports the canonical disallowed set', () => {
  assert.ok(DQ_LIKE_WIN_METHODS.has('forfeit'));
  assert.ok(DQ_LIKE_WIN_METHODS.has('dq'));
  assert.ok(DQ_LIKE_WIN_METHODS.has('disqualification'));
});

test('checkAchievements rejects winMethod="dq" same as "disqualification"', () => {
  const earned = checkAchievements([], {
    result: 'win',
    winMethod: 'dq',
    opponentNpcId: 'special_elijah_joles',
    elijahBossWinsAfter: 1,
  }, {});
  assert.ok(!earned.includes('beat_elijah'),
    'short "dq" token must be treated the same as "disqualification"');
});

// ─── hydrateCareer purges Elijah from contaminated female saves
//
// Failure mode this guards: a women's career that somehow received Elijah in
// its rankingPool (e.g. mid-2026 bug, hand-edited save, regression). The
// hydrate-time heal must detect male specials and regenerate the pool with
// female-correct data, including dropping Elijah from rivals.

test('hydrateCareer cleans Elijah out of a contaminated female rankingPool and rivals', () => {
  // Start from a schema-valid female career so the hydrate-time validator
  // sees a well-formed save; then contaminate ONLY the rankingPool + rivals
  // so the heal's male-special detector has something concrete to repair.
  const fresh = createCareer({
    name: 'Test Wrestler',
    weightClass: 140,
    state: 'TN',
    gender: 'female',
  });
  const contaminatedElijah = buildElijahJolesNpc({
    weightClass: 140, tier: 'hs', style: 'womens_freestyle', scope: 'state',
  });
  const existingPool = Array.isArray(fresh.rankingPool) ? fresh.rankingPool : [];
  const contaminated = {
    ...fresh,
    // Downgrade the version so the rewriting heals run (current-version + phase
    // careers short-circuit at the top of hydrateCareer).
    version: 1,
    phase: null,
    rankingPool: [contaminatedElijah, ...existingPool],
    rivals: [
      { name: 'Elijah Joles', wins: 0, losses: 0 },
      ...(Array.isArray(fresh.rivals) ? fresh.rivals : []),
    ],
  };
  const hydrated = hydrateCareer(contaminated);
  const poolNames = (hydrated.rankingPool || []).map((p) => p.name);
  assert.ok(!poolNames.includes('Elijah Joles'),
    'Elijah must be purged from a female rankingPool by the hydrate heal');
  const poolIds = (hydrated.rankingPool || []).map((p) => p.id);
  assert.ok(!poolIds.includes(ELIJAH_JOLES_ID),
    'Elijah id must not survive the heal either');
  const rivalNames = (hydrated.rivals || []).map((r) => r.name);
  assert.ok(!rivalNames.includes('Elijah Joles'),
    'Elijah must be purged from rivals too');
});

// ─── buildSeededBracket carries npcId on naturally-seeded entries too
//
// Codex flagged that bracket entries previously preserved only rankPoolId,
// so tournament code couldn't route AI personality / dialogue / badge to
// the right NPC. The fix adds npcId; this test catches regression on the
// non-forced path (NPC promoted on overall, not via forcedSeedIds).

test('buildSeededBracket: NPCs in natural seeds also carry npcId', () => {
  const career = {
    wrestler: {
      name: 'Test Player',
      stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
    },
    rankingPool: Array.from({ length: 16 }, (_, i) => ({
      id: `pool_${i}`,
      name: `Pool ${i}`,
      overall: 90 - i,
      stats: { str: 80, spd: 80, tec: 80, end: 80, grt: 80 },
      weightClass: 165,
      scope: 'state',
      tier: 'hs',
      wins: 0, losses: 0,
    })),
  };
  const { bracket } = buildSeededBracket(career, 16, 'regular', 'folkstyle');
  const npcEntries = bracket.filter((b) => b && b.isPlayer !== true);
  assert.ok(npcEntries.length > 0, 'bracket must have NPC entries');
  for (const entry of npcEntries) {
    if (entry.rankPoolId) {
      // Synthetic fallback fillers have neither id; only assert on real pool entries.
      assert.equal(entry.npcId, entry.rankPoolId,
        `npcId must mirror rankPoolId for entry ${entry.name}`);
    }
  }
});

// ─── buildElijahBossOpponent.overall reflects the computed target
//
// Codex flagged that returning avgStats(stats) after clamp drifts below
// target at the top end (level 100 reports 97 instead of 99). Assert
// equality across the curve.

test('buildElijahBossOpponent.overall equals computeBossOverall(level, wins)', () => {
  const cases = [[1, 0], [10, 0], [25, 0], [50, 0], [100, 0], [50, 4], [100, 99]];
  for (const [playerLevel, bossWins] of cases) {
    const opp = buildElijahBossOpponent({ playerLevel, bossWins });
    const target = computeBossOverall(playerLevel, bossWins);
    assert.equal(opp.overall, target,
      `buildElijahBossOpponent(level=${playerLevel}, wins=${bossWins}).overall should match target ${target}`);
  }
});
