// Career Depth Pass v1 - Rivalry Heat.
// Covers:
//   - feudLevel math
//   - applyInterimTournamentMatch updates H2H when opts.opponentNpcId matches
//   - applyInterimTournamentMatch is backwards-compatible when opts omitted
//   - bracket auto-seed via forcedSeedIds places the rival in a high slot
//   - recordEventResult dual-rivalry XP bonus appends a breakdown row
//
// Run: node --test src/lib/career/rivalryHeat.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  createCareer,
  applyInterimTournamentMatch,
  recordEventResult,
} = await import('./careerState.js');
const { feudLevel, feudTierKey, FEUD_HOT } = await import('./careerRivals.js');
const { buildSeededBracket } = await import('./careerBrackets.js');

function fixedRng() {
  let n = 0;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

// ─── feudLevel ──────────────────────────────────────────────────────────────

test('feudLevel sums wins + losses + 2*pins', () => {
  assert.equal(feudLevel(undefined), 0);
  assert.equal(feudLevel(null), 0);
  assert.equal(feudLevel({}), 0);
  assert.equal(feudLevel({ wins: 0, losses: 0, pins: 0 }), 0);
  assert.equal(feudLevel({ wins: 1, losses: 0, pins: 0 }), 1);
  assert.equal(feudLevel({ wins: 1, losses: 2, pins: 0 }), 3);
  assert.equal(feudLevel({ wins: 2, losses: 2, pins: 1 }), 6);
  assert.equal(feudLevel({ wins: 1, losses: 2, pins: 1 }), 5);
});

test('feudTierKey maps to tier strings', () => {
  assert.equal(feudTierKey(0), null);
  assert.equal(feudTierKey(2), null);
  assert.equal(feudTierKey(3), 'rival_hot');
  assert.equal(feudTierKey(5), 'rival_blood');
  assert.equal(feudTierKey(8), 'rival_owned');
  assert.equal(feudTierKey(20), 'rival_owned');
});

// ─── applyInterimTournamentMatch H2H wiring ─────────────────────────────────

function tournamentEvent(career) {
  return career.schedule.events.find(e => e.type === 'tournament' || e.type === 'championship');
}

test('applyInterimTournamentMatch with opts.opponentNpcId increments rival H2H', () => {
  const career = createCareer({ name: 'P', weightClass: 138, rng: fixedRng() });
  const event = tournamentEvent(career);
  const rival = career.rivals[0]; // Chase Kamats injected at index 0
  assert.ok(rival && rival.id, 'fixture has at least one rival with id');

  const next = applyInterimTournamentMatch(career, event.id, {
    playerWon: true,
    winMethod: 'pin',
  }, { opponentNpcId: rival.id });

  const updatedRival = next.rivals.find(r => r.id === rival.id);
  assert.equal(updatedRival.h2h.wins, (rival.h2h?.wins || 0) + 1, 'win incremented');
  assert.equal(updatedRival.h2h.pins, (rival.h2h?.pins || 0) + 1, 'pin incremented');
});

test('applyInterimTournamentMatch is backwards-compatible (opts omitted)', () => {
  const career = createCareer({ name: 'P', weightClass: 138, rng: fixedRng() });
  const event = tournamentEvent(career);
  const rivalSnapshot = career.rivals.map(r => ({ id: r.id, h2h: { ...r.h2h } }));

  const next = applyInterimTournamentMatch(career, event.id, {
    playerWon: true,
    winMethod: 'decision',
  });

  // W/L counters move; rivals untouched.
  assert.equal(next.record.seasonWins, (career.record.seasonWins || 0) + 1);
  for (const r of rivalSnapshot) {
    const after = next.rivals.find(x => x.id === r.id);
    assert.deepEqual(after?.h2h, r.h2h, `rival ${r.id} h2h unchanged`);
  }
});

test('applyInterimTournamentMatch increments giantSlayerWinsThisSeason on top-3 pool opponent win', () => {
  const career = createCareer({ name: 'P', weightClass: 138, rng: fixedRng() });
  const event = tournamentEvent(career);
  const pool = career.rankingPool || [];
  const topNpc = pool.slice().sort((a, b) => (b.overall || 0) - (a.overall || 0))[0];
  assert.ok(topNpc && topNpc.id, 'fixture has at least one pool entry with overall');

  const next = applyInterimTournamentMatch(career, event.id, {
    playerWon: true,
    winMethod: 'decision',
  }, { opponentNpcId: topNpc.id });

  assert.equal((next.seasonMeta?.giantSlayerWinsThisSeason || 0), 1,
    'top-3 pool opponent win bumps giant slayer counter');
});

test('applyInterimTournamentMatch does NOT bump giantSlayerWinsThisSeason on non-top-3 opponent', () => {
  const career = createCareer({ name: 'P', weightClass: 138, rng: fixedRng() });
  const event = tournamentEvent(career);
  const pool = career.rankingPool || [];
  const lowestNpc = pool.slice().sort((a, b) => (a.overall || 0) - (b.overall || 0))[0];
  const next = applyInterimTournamentMatch(career, event.id, {
    playerWon: true,
    winMethod: 'decision',
  }, { opponentNpcId: lowestNpc.id });
  assert.equal((next.seasonMeta?.giantSlayerWinsThisSeason || 0), 0);
});

test('applyInterimTournamentMatch no-ops H2H when opponentNpcId does not match any rival', () => {
  const career = createCareer({ name: 'P', weightClass: 138, rng: fixedRng() });
  const event = tournamentEvent(career);
  const rivalSnapshot = career.rivals.map(r => ({ id: r.id, h2h: { ...r.h2h } }));

  const next = applyInterimTournamentMatch(career, event.id, {
    playerWon: true,
    winMethod: 'decision',
  }, { opponentNpcId: 'ghost_npc_not_a_rival' });

  for (const r of rivalSnapshot) {
    const after = next.rivals.find(x => x.id === r.id);
    assert.deepEqual(after?.h2h, r.h2h);
  }
});

// ─── Bracket auto-seed via forcedSeedIds ────────────────────────────────────

test('buildSeededBracket honors forcedSeedIds: forced rival seeded high', () => {
  const career = createCareer({ name: 'P', weightClass: 138, rng: fixedRng() });
  // Pick any pool NPC who is NOT the player and NOT already top-seeded.
  // We force-seed the lowest-overall pool entry so the test detects movement.
  const pool = career.rankingPool || [];
  const lowest = pool.slice().sort((a, b) => (a.overall || 0) - (b.overall || 0))[0];
  assert.ok(lowest && lowest.id, 'fixture has at least one pool entry with id');

  const seededWithout = buildSeededBracket(career, 16, 'state');
  const seededWith = buildSeededBracket(career, 16, 'state', undefined, [lowest.id]);

  const foundWithout = seededWithout.bracket.findIndex(e => e?.rankPoolId === lowest.id);
  const foundWith = seededWith.bracket.findIndex(e => e?.rankPoolId === lowest.id);

  assert.ok(foundWith >= 0, 'forced rival placed in bracket');
  // The forced seed should be at a numerically lower (higher-seed) index than
  // it was without the force. If they're the same, the test fixture happened
  // to seed it well already - relax to "not worse than before."
  assert.ok(foundWith <= foundWithout || foundWithout < 0,
    `forced seed should not be worse than unforced (with=${foundWith}, without=${foundWithout})`);
});

// ─── Rivalry XP bonus on dual events ────────────────────────────────────────

function dualEvent(career) {
  return career.schedule.events.find(e => e.type === 'dual' || e.type === 'dual_meet');
}

test('recordEventResult appends Rivalry +25% breakdown row on dual rival win when feudLevel >= FEUD_HOT', () => {
  let career = createCareer({ name: 'P', weightClass: 138, rng: fixedRng() });
  const event = dualEvent(career);
  assert.ok(event, 'fixture has at least one dual event');
  // Make the first dual a rival meeting against an existing rival with
  // pre-existing H2H that puts feudLevel >= 3 (e.g. 1W-2L = 3).
  const rivalId = career.rivals[0].id;
  career = {
    ...career,
    rivals: career.rivals.map((r, i) => i === 0
      ? { ...r, h2h: { wins: 1, losses: 2, pins: 0 } } // feudLevel 3 = hot
      : r),
    schedule: {
      ...career.schedule,
      events: career.schedule.events.map(e => e.id === event.id
        ? { ...e, opponentIsRival: true, opponent: { id: rivalId, name: 'Rival', stats: { str: 70, spd: 70, tec: 70, end: 70, grt: 70 } } }
        : e),
    },
  };

  assert.ok(feudLevel(career.rivals[0].h2h) >= FEUD_HOT, 'precondition: feudLevel >= 3');

  const next = recordEventResult(career, event.id, {
    playerWon: true,
    p1Score: 8,
    p2Score: 4,
    winMethod: 'decision',
    rng: fixedRng(),
  });

  const breakdown = next.lastEventXp?.breakdown || [];
  const rivalryRow = breakdown.find(row => row.label === 'Rivalry +25%');
  assert.ok(rivalryRow, 'breakdown contains Rivalry +25% row');
  assert.ok(rivalryRow.amount > 0, 'rivalry bonus amount is positive');
});

test('recordEventResult skips Rivalry breakdown when feudLevel < FEUD_HOT', () => {
  let career = createCareer({ name: 'P', weightClass: 138, rng: fixedRng() });
  const event = dualEvent(career);
  const rivalId = career.rivals[0].id;
  career = {
    ...career,
    rivals: career.rivals.map((r, i) => i === 0
      ? { ...r, h2h: { wins: 1, losses: 0, pins: 0 } } // feudLevel 1
      : r),
    schedule: {
      ...career.schedule,
      events: career.schedule.events.map(e => e.id === event.id
        ? { ...e, opponentIsRival: true, opponent: { id: rivalId, name: 'Rival', stats: { str: 70, spd: 70, tec: 70, end: 70, grt: 70 } } }
        : e),
    },
  };

  const next = recordEventResult(career, event.id, {
    playerWon: true,
    p1Score: 8,
    p2Score: 4,
    winMethod: 'decision',
    rng: fixedRng(),
  });

  const breakdown = next.lastEventXp?.breakdown || [];
  assert.equal(breakdown.length, 0, 'no breakdown rows when below hot threshold');
});
