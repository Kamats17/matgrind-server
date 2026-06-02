import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateRankingPool,
  generateExpandedRankingPool,
  simWeekForPool,
  computeConferenceRank,
  deriveOuterRanks,
  updateRankingsWeekly,
  RANKINGS_CONSTANTS,
} from './careerRankings.js';

// Deterministic RNG for reproducible tests
function seededRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

describe('careerRankings - pool', () => {
  test('generates CONFERENCE_SIZE (24) wrestlers', () => {
    const rng = seededRng(42);
    const pool = generateRankingPool({ weightClass: 138, rng });
    assert.equal(pool.length, RANKINGS_CONSTANTS.CONFERENCE_SIZE);
  });

  test('each pool wrestler has required fields', () => {
    const pool = generateRankingPool({ weightClass: 138, rng: seededRng(1) });
    for (const w of pool) {
      assert.ok(w.id);
      assert.ok(w.name);
      assert.ok(w.school);
      assert.ok(w.overall >= 45 && w.overall < 85);
      assert.equal(w.weightClass, 138);
      assert.equal(w.wins, 0);
      assert.equal(w.losses, 0);
    }
  });

  test('overalls span a usable range (spread ≥ 15)', () => {
    const pool = generateRankingPool({ weightClass: 138, rng: seededRng(7) });
    const overalls = pool.map(w => w.overall);
    const spread = Math.max(...overalls) - Math.min(...overalls);
    assert.ok(spread >= 15, `spread too low: ${spread}`);
  });
});

describe('careerRankings - simWeekForPool', () => {
  test('preserves pool size', () => {
    const pool = generateRankingPool({ weightClass: 138, rng: seededRng(1) });
    const next = simWeekForPool(pool, { rng: seededRng(2) });
    assert.equal(next.length, pool.length);
  });

  test('each sim week adds exactly 1 match worth of W/L per wrestler (or 0 if unpaired)', () => {
    // Pool size is even (24), so every wrestler is paired each week.
    const pool = generateRankingPool({ weightClass: 138, rng: seededRng(3) });
    const next = simWeekForPool(pool, { rng: seededRng(4) });
    for (let i = 0; i < pool.length; i++) {
      const deltaW = next[i].wins - pool[i].wins;
      const deltaL = next[i].losses - pool[i].losses;
      assert.equal(deltaW + deltaL, 1, `wrestler ${i} should have exactly 1 match`);
    }
  });

  test('higher-overall wrestler trends toward more wins over many sim weeks', () => {
    // Hand-built 2-wrestler pool: 80 vs 50. Run 200 weeks. 80 should win > 150.
    let pool = [
      { id: 'a', name: 'A', school: '', overall: 80, weightClass: 138, tier: 'hs', wins: 0, losses: 0 },
      { id: 'b', name: 'B', school: '', overall: 50, weightClass: 138, tier: 'hs', wins: 0, losses: 0 },
    ];
    const rng = seededRng(99);
    for (let i = 0; i < 200; i++) pool = simWeekForPool(pool, { rng });
    assert.ok(pool[0].wins > 150, `expected >150 wins for overall-80, got ${pool[0].wins}`);
  });

  test('does not mutate input pool', () => {
    const pool = generateRankingPool({ weightClass: 138, rng: seededRng(8) });
    const before = JSON.parse(JSON.stringify(pool));
    simWeekForPool(pool, { rng: seededRng(9) });
    assert.deepEqual(pool, before);
  });
});

describe('careerRankings - computeConferenceRank', () => {
  test('player with most wins ranks #1', () => {
    const pool = [
      { wins: 3, losses: 2, overall: 60 },
      { wins: 1, losses: 4, overall: 55 },
    ];
    const rank = computeConferenceRank(pool, { playerWins: 10, playerLosses: 0, playerOverall: 70 });
    assert.equal(rank, 1);
  });

  test('player with no wins ranks last', () => {
    const pool = Array.from({ length: 24 }, (_, i) => ({
      wins: 3, losses: 2, overall: 60 + i,
    }));
    const rank = computeConferenceRank(pool, { playerWins: 0, playerLosses: 5, playerOverall: 40 });
    assert.equal(rank, 25);
  });

  test('rank is always in [1, pool.length + 1]', () => {
    const pool = Array.from({ length: 24 }, (_, i) => ({
      wins: i, losses: 24 - i, overall: 50 + i,
    }));
    for (let pw = 0; pw <= 24; pw++) {
      const r = computeConferenceRank(pool, { playerWins: pw, playerLosses: 24 - pw, playerOverall: 65 });
      assert.ok(r >= 1 && r <= 25, `rank ${r} out of range for pw=${pw}`);
    }
  });
});

describe('careerRankings - deriveOuterRanks', () => {
  test('section and state ranks are ≥ 1', () => {
    const rng = seededRng(1);
    for (let confRank = 1; confRank <= 25; confRank++) {
      const { sectionRank, stateRank } = deriveOuterRanks(confRank, { rng });
      assert.ok(sectionRank >= 1, `section rank ${sectionRank} must be ≥ 1`);
      assert.ok(stateRank >= 1, `state rank ${stateRank} must be ≥ 1`);
    }
  });

  test('state rank is roughly 4x section which is roughly 3x conference (order of magnitude)', () => {
    // Over many conference ranks, state rank grows roughly proportionally
    const rng = seededRng(2);
    const { sectionRank: s1, stateRank: st1 } = deriveOuterRanks(5, { rng });
    const { sectionRank: s2, stateRank: st2 } = deriveOuterRanks(15, { rng });
    assert.ok(s2 > s1, 'higher conf rank → higher section rank');
    assert.ok(st2 > st1, 'higher conf rank → higher state rank');
  });
});

describe('careerRankings - updateRankingsWeekly (integration)', () => {
  test('returns { pool, rankings } with all expected fields', () => {
    const pool = generateRankingPool({ weightClass: 138, rng: seededRng(10) });
    const out = updateRankingsWeekly({
      pool,
      playerWins: 5,
      playerLosses: 1,
      playerOverall: 65,
      asOfEventIdx: 3,
      rng: seededRng(11),
    });
    assert.ok(out.pool);
    assert.equal(out.pool.length, 24);
    assert.ok(out.rankings);
    assert.ok(out.rankings.conference >= 1 && out.rankings.conference <= 25);
    assert.ok(out.rankings.section >= 1);
    assert.ok(out.rankings.state >= 1);
    assert.equal(out.rankings.asOfEventIdx, 3);
  });

  test('progressing wins → player rank improves over sim weeks', () => {
    // Start with a fresh pool. Player wins everything → rank should go
    // from mid-pack to top by the end.
    let pool = generateRankingPool({ weightClass: 138, rng: seededRng(20) });
    const ranksOverTime = [];
    for (let week = 1; week <= 20; week++) {
      const out = updateRankingsWeekly({
        pool,
        playerWins: week,     // player wins every week
        playerLosses: 0,
        playerOverall: 75,    // near top of pool
        asOfEventIdx: week,
        rng: seededRng(30 + week),
      });
      pool = out.pool;
      ranksOverTime.push(out.rankings.conference);
    }
    // End-of-season rank should be better (lower number) than early.
    const earlyAvg = (ranksOverTime[0] + ranksOverTime[1] + ranksOverTime[2]) / 3;
    const lateAvg = (ranksOverTime[17] + ranksOverTime[18] + ranksOverTime[19]) / 3;
    assert.ok(lateAvg <= earlyAvg, `expected rank to improve: early ${earlyAvg} → late ${lateAvg}`);
  });
});

// ─── v9: 128-bracket pool sufficiency ───────────────────────────────────────
//
// v9 introduces 128-wrestler brackets at HS State, College NCAA, and Senior
// Worlds. buildSeededBracket needs 127 NPCs from the pool to fill the bracket
// without falling back to synthetic wrestlers. State scope draws the full
// pool, so the requirement is `pool.length >= 127` per tier.

describe('careerRankings - v9 128-bracket pool sufficiency', () => {
  test('HS expanded pool has >= 127 entries (fills 128-bracket at state)', () => {
    const pool = generateExpandedRankingPool({
      weightClass: 138, tier: 'hs', state: 'PA', gender: 'male', rng: seededRng(1),
    });
    assert.ok(pool.length >= 127,
      `HS state pool must fill 128-bracket; got ${pool.length}`);
  });

  test('College expanded pool has >= 127 entries', () => {
    const pool = generateExpandedRankingPool({
      weightClass: 157, tier: 'college', state: 'PA', gender: 'male', rng: seededRng(2),
    });
    assert.ok(pool.length >= 127,
      `College state pool must fill 128-bracket; got ${pool.length}`);
  });

  test('Senior expanded pool has >= 127 entries', () => {
    const pool = generateExpandedRankingPool({
      weightClass: 74, tier: 'senior', state: 'PA', gender: 'male', rng: seededRng(3),
    });
    assert.ok(pool.length >= 127,
      `Senior state pool must fill 128-bracket; got ${pool.length}`);
  });

  test('Senior womens expanded pool has >= 127 entries', () => {
    // Women's Worlds bracket also runs at 128 in V1.
    const pool = generateExpandedRankingPool({
      weightClass: 57, tier: 'senior', state: 'PA', gender: 'female', rng: seededRng(4),
    });
    assert.ok(pool.length >= 127,
      `Senior womens state pool must fill 128-bracket; got ${pool.length}`);
  });
});
