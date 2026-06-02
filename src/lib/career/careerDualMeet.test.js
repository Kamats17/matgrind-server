// Career Dual Meet bridge tests. Cover the my_match flow (sims N-1 bouts,
// player plays 1), the full_dual flow (player plays all bouts), team-result
// computation, hero-bout-only career W/L crediting, schedule advancement,
// and rivalry H2H plumbing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// localStorage shim for node - createCareerDualMeet path doesn't touch it,
// but createDualMeet inside it might via downstream helpers.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

const {
  createCareerDualMeet,
  simulateNonHeroBouts,
  simulateOneBout,
  recordCareerDualMeetResult,
  recordCareerDualAbort,
} = await import('./careerDualMeet.js');
const { advanceDualBout, getDualWinner } = await import('../dualMeetState.js');
const { simulateDualMeetEvent } = await import('./simulateEvent.js');
const { createCareer, recordEventResult } = await import('./careerState.js');
const { generateHSSeason, generateCollegeSeason } = await import('./careerSchedule.js');
const { WOMENS_FIRST_NAMES, MENS_FIRST_NAMES } = await import('../namePools.js');

function fixedRng(seed = 1) {
  let n = seed;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

function buildCareer({ tier = 'hs', gender = 'male', weightClass } = {}) {
  // createCareer always starts at HS year 1 - construct there, then morph
  // to college if the test asks for it. Mirrors what advanceToNextSeason +
  // tier transitions do under the hood without needing the full lifecycle.
  const rng = fixedRng(7);
  const isFemale = gender === 'female';
  const hsWc = isFemale ? 130 : 145;
  const career = createCareer({
    name: 'Test Wrestler',
    state: 'IA',
    weightClass: hsWc,
    gender,
    rng,
  });
  career.phase = 'in_season';
  if (tier === 'hs') {
    if (typeof weightClass === 'number' && weightClass !== hsWc) {
      // Legal HS weight override.
      career.wrestler.weightClass = weightClass;
      // Re-generate schedule at the new weight so events match.
      career.schedule = {
        ...career.schedule,
        events: generateHSSeason({
          seasonYear: 1, year: 1, weightClass, gender, rivals: career.rivals, rng: fixedRng(11),
        }),
        currentEventIdx: 0,
      };
    }
    return career;
  }
  if (tier === 'college') {
    const collegeWc = weightClass ?? (isFemale ? 131 : 157);
    career.wrestler.tier = 'college';
    career.wrestler.year = 1;
    career.wrestler.weightClass = collegeWc;
    career.wrestler.style = isFemale ? 'womens_freestyle' : 'folkstyle';
    career.schedule = {
      ...career.schedule,
      events: generateCollegeSeason({
        seasonYear: 1, year: 1, weightClass: collegeWc, gender, rivals: career.rivals, rng: fixedRng(13),
      }),
      currentEventIdx: 0,
    };
    return career;
  }
  return career;
}

function firstDualMeetEvent(career) {
  return career.schedule.events.find(e => e.type === 'dual_meet');
}

describe('careerDualMeet - createCareerDualMeet', () => {
  test('throws on bad event type', () => {
    const career = buildCareer();
    assert.throws(() => createCareerDualMeet(career, { type: 'tournament', id: 'x' }, 'my_match'));
  });

  test('throws on bad lineup choice', () => {
    const career = buildCareer();
    const event = firstDualMeetEvent(career);
    assert.throws(() => createCareerDualMeet(career, event, 'wrestle_some_match'));
  });

  test('builds a dual with HS_WEIGHTS for an HS career (14 bouts, hero at career weight)', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, 'my_match');
    assert.equal(dual.bouts.length, 14, 'HS dual = 14 bouts');
    assert.equal(dual.heroWeightClass, 145);
    assert.ok(dual.bouts.find(b => b.weight === 145)?.playerWrestler.isHero);
    assert.equal(typeof dual.heroIdx, 'number');
    assert.equal(dual.weights[dual.heroIdx], 145);
    assert.equal(dual.careerEventId, event.id);
    assert.equal(dual.lineupChoice, 'my_match');
  });

  test('builds a dual with COLLEGE_WEIGHTS for a college career (10 bouts)', () => {
    const career = buildCareer({ tier: 'college', weightClass: 157 });
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, 'full_dual');
    assert.equal(dual.bouts.length, 10);
    assert.equal(dual.heroWeightClass, 157);
    assert.equal(dual.lineupChoice, 'full_dual');
  });

  test('builds a 14-bout women\'s HS dual with women\'s weights', () => {
    const career = buildCareer({ tier: 'hs', gender: 'female', weightClass: 130 });
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, 'my_match');
    assert.equal(dual.bouts.length, 14);
    assert.equal(dual.heroWeightClass, 130);
    assert.ok(dual.weights.includes(130));
    // Sanity: women's HS table includes 130 but NOT 138 (men's-only).
    assert.ok(!dual.weights.includes(138));
  });

  test('rivalry-dual injection replaces hero bout opponent with the rival', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    // Find the rivalry slot.
    const event = career.schedule.events.find(e => e.name === 'Rivalry Dual');
    assert.ok(event, 'rivalry dual slot exists');
    assert.equal(event.opponentIsRival, true);
    const dual = createCareerDualMeet(career, event, 'my_match');
    const heroBout = dual.bouts[dual.heroIdx];
    assert.equal(heroBout.opponentWrestler.name, event.opponent.name);
    assert.deepEqual(heroBout.opponentWrestler.stats, event.opponent.stats);
  });

  test("regression: women's career dual draws CPU names from the women's pool", () => {
    // Verifies the female PATH, not just female-looking text. The men's and
    // women's pools deliberately share many names, so a "looks female" check
    // is meaningless. Instead: every CPU first name must be in the actual
    // centralized women's pool, and no name EXCLUSIVE to the men's pool may
    // appear - a male-exclusive name could only get there via the male path.
    const womensFirst = new Set(WOMENS_FIRST_NAMES);
    const maleExclusive = new Set(MENS_FIRST_NAMES.filter(n => !womensFirst.has(n)));
    assert.ok(maleExclusive.size > 0, 'sanity: the pools have male-exclusive names');

    // Stub global Math.random so the test is reproducible. createCareerDualMeet
    // → createDualMeet → generateCpuTeam draws names without an injected rng.
    const origRandom = Math.random;
    Math.random = fixedRng(424242);
    try {
      const career = buildCareer({ tier: 'hs', gender: 'female', weightClass: 130 });
      const event = firstDualMeetEvent(career);
      const dual = createCareerDualMeet(career, event, 'full_dual');
      const cpuFirstNames = dual.opponentTeam
        .filter(w => !w.isHero)
        .map(w => String(w.name || '').split(' ')[0]);
      assert.ok(cpuFirstNames.length >= 10, 'sanity: many CPU bouts to sample names from');
      for (const first of cpuFirstNames) {
        assert.ok(
          womensFirst.has(first),
          `women's career CPU name "${first}" is not in the women's pool`,
        );
        assert.ok(
          !maleExclusive.has(first),
          `male-exclusive name "${first}" leaked into a women's career dual`,
        );
      }
    } finally {
      Math.random = origRandom;
    }
  });
});

describe('careerDualMeet - simulateNonHeroBouts (my_match flow)', () => {
  test('sims (heroIdx) prelude bouts before the player\'s match', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, 'my_match');
    const heroIdx = dual.heroIdx;
    simulateNonHeroBouts(dual, fixedRng(3));
    // After sim, currentBoutIndex = heroIdx, prelude bouts are resolved.
    assert.equal(dual.currentBoutIndex, heroIdx);
    for (let i = 0; i < heroIdx; i++) {
      assert.ok(dual.bouts[i].result, `prelude bout ${i} resolved`);
    }
    assert.equal(dual.bouts[heroIdx].result, null, 'hero bout untouched');
    if (heroIdx > 0) assert.equal(dual.phase, 'between');
  });

  test('after hero bout, sim postlude closes out the dual', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, 'my_match');
    simulateNonHeroBouts(dual, fixedRng(3));
    // Player wins the hero bout by decision.
    advanceDualBout(dual, { playerWon: true, winMethod: 'decision', p1Score: 5, p2Score: 2 });
    simulateNonHeroBouts(dual, fixedRng(7));
    assert.equal(dual.phase, 'complete');
    for (const b of dual.bouts) assert.ok(b.result, 'every bout resolved');
  });

  test('full_dual mode never sims (player plays every bout)', () => {
    const career = buildCareer({ tier: 'college', weightClass: 157 });
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, 'full_dual');
    simulateNonHeroBouts(dual, fixedRng(11));
    assert.equal(dual.currentBoutIndex, 0);
    for (const b of dual.bouts) assert.equal(b.result, null);
  });
});

describe('careerDualMeet - recordCareerDualAbort', () => {
  test('first abort initializes record.aborts=1 and a 1-entry abortLog', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    assert.equal(career.record.aborts ?? 0, 0, 'precondition: no aborts');
    const next = recordCareerDualAbort(career, 'evt_x_1', 'Conference Dual');
    assert.equal(next.record.aborts, 1);
    assert.ok(Array.isArray(next.record.abortLog));
    assert.equal(next.record.abortLog.length, 1);
    const entry = next.record.abortLog[0];
    assert.equal(entry.eventId, 'evt_x_1');
    assert.equal(entry.eventName, 'Conference Dual');
    assert.equal(entry.kind, 'dual_meet');
    assert.equal(typeof entry.at, 'number');
  });

  test('does not mutate the input career or its record', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const before = JSON.stringify(career.record);
    const next = recordCareerDualAbort(career, 'evt_y', 'Rivalry Dual');
    assert.equal(JSON.stringify(career.record), before, 'input record untouched');
    assert.notEqual(next.record, career.record, 'returns new record object');
  });

  test('subsequent aborts increment counter and append to log', () => {
    let career = buildCareer({ tier: 'hs', weightClass: 145 });
    career = recordCareerDualAbort(career, 'a', 'A');
    career = recordCareerDualAbort(career, 'b', 'B');
    career = recordCareerDualAbort(career, 'c', 'C');
    assert.equal(career.record.aborts, 3);
    assert.equal(career.record.abortLog.length, 3);
    assert.equal(career.record.abortLog[0].eventId, 'a');
    assert.equal(career.record.abortLog[2].eventId, 'c');
  });

  test('caps abortLog at 200 entries (FIFO drop)', () => {
    let career = buildCareer({ tier: 'hs', weightClass: 145 });
    for (let i = 0; i < 250; i++) {
      career = recordCareerDualAbort(career, `evt_${i}`, `name_${i}`);
    }
    assert.equal(career.record.aborts, 250, 'counter still tracks all aborts');
    assert.equal(career.record.abortLog.length, 200, 'log capped at 200');
    // Oldest 50 dropped; first remaining entry is evt_50.
    assert.equal(career.record.abortLog[0].eventId, 'evt_50');
    assert.equal(career.record.abortLog[199].eventId, 'evt_249');
  });

  test('returns input unchanged when career is null/missing record', () => {
    assert.equal(recordCareerDualAbort(null, 'x', 'X'), null);
    assert.equal(recordCareerDualAbort(undefined, 'x', 'X'), undefined);
    const noRecord = { wrestler: {} };
    assert.equal(recordCareerDualAbort(noRecord, 'x', 'X'), noRecord);
  });

  test('accepts null eventId / eventName without throwing', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const next = recordCareerDualAbort(career, null, null);
    assert.equal(next.record.aborts, 1);
    assert.equal(next.record.abortLog[0].eventId, null);
    assert.equal(next.record.abortLog[0].eventName, null);
  });

  test('default kind is "dual_meet"; can be overridden', () => {
    let career = buildCareer({ tier: 'hs', weightClass: 145 });
    career = recordCareerDualAbort(career, 'a', 'A');
    assert.equal(career.record.abortLog[0].kind, 'dual_meet');
    career = recordCareerDualAbort(career, 'b', 'B', 'tournament');
    assert.equal(career.record.abortLog[1].kind, 'tournament');
  });
});

describe('careerDualMeet - recordCareerDualMeetResult', () => {
  function buildCompletedDual(career, lineupChoice, heroResult) {
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, lineupChoice);
    if (lineupChoice === 'my_match') {
      simulateNonHeroBouts(dual, fixedRng(3));
      advanceDualBout(dual, heroResult);
      simulateNonHeroBouts(dual, fixedRng(5));
    } else {
      // full_dual: walk through every bout. Hero bout uses heroResult; others
      // are deterministic decisions for assertions.
      for (let i = 0; i < dual.bouts.length; i++) {
        if (i === dual.heroIdx) {
          advanceDualBout(dual, heroResult);
        } else {
          advanceDualBout(dual, { playerWon: i % 2 === 0, winMethod: 'decision', p1Score: 5, p2Score: 2 });
        }
        // Mimic the production loop: between -> bout transition (no-op for this test).
        if (dual.phase === 'between') dual.phase = 'bout';
      }
    }
    assert.equal(dual.phase, 'complete');
    return { dual, event };
  }

  test('my_match win: hero bout +1 to season W, dualSummary stamped, currentEventIdx +1', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const beforeIdx = career.schedule.currentEventIdx;
    const beforeWins = career.record.seasonWins;
    const { dual, event } = buildCompletedDual(career, 'my_match', { playerWon: true, winMethod: 'pin', p1Score: 4, p2Score: 0 });
    const { nextCareer, teamWinner, xpGained } = recordCareerDualMeetResult(career, event.id, dual);
    assert.equal(nextCareer.record.seasonWins, beforeWins + 1, 'hero bout credits +1 W');
    assert.equal(nextCareer.record.careerWins, beforeWins + 1);
    assert.equal(nextCareer.schedule.currentEventIdx, beforeIdx + 1, 'event idx advances by 1');
    const finishedEvent = nextCareer.schedule.events.find(e => e.id === event.id);
    assert.equal(finishedEvent.status, 'won');
    assert.ok(finishedEvent.dualSummary, 'team summary stamped');
    assert.equal(typeof finishedEvent.dualSummary.teamScore.player, 'number');
    assert.equal(finishedEvent.lineupChoice, 'my_match');
    assert.ok(['player', 'opponent', 'draw'].includes(teamWinner));
    assert.ok(xpGained > 0, 'XP credited');
  });

  test('my_match loss: hero bout +1 to season L, NOT a season win even if team won', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, 'my_match');
    simulateNonHeroBouts(dual, fixedRng(13));
    // Hero loses. Other 13 bouts already simulated above; we accept whatever
    // the team result is - the test cares about the player's individual record.
    advanceDualBout(dual, { playerWon: false, winMethod: 'decision', p1Score: 1, p2Score: 7 });
    simulateNonHeroBouts(dual, fixedRng(17));
    const beforeLosses = career.record.seasonLosses;
    const { nextCareer } = recordCareerDualMeetResult(career, event.id, dual);
    assert.equal(nextCareer.record.seasonLosses, beforeLosses + 1, 'hero bout credits +1 L');
    assert.equal(nextCareer.record.seasonWins, career.record.seasonWins, 'season W untouched');
  });

  test('full_dual: only the hero bout result counts toward career W/L', () => {
    const career = buildCareer({ tier: 'college', weightClass: 157 });
    const beforeWins = career.record.seasonWins;
    const beforeLosses = career.record.seasonLosses;
    const { dual, event } = buildCompletedDual(career, 'full_dual', { playerWon: true, winMethod: 'major_decision', p1Score: 11, p2Score: 2 });
    const { nextCareer } = recordCareerDualMeetResult(career, event.id, dual);
    // One bout decided by the hero -> +1 W. The other bouts (deterministic
    // alternating winners in the test fixture) do NOT contribute to career W/L.
    assert.equal(nextCareer.record.seasonWins, beforeWins + 1);
    assert.equal(nextCareer.record.seasonLosses, beforeLosses);
  });

  test('rivalry dual records H2H against the rival via existing recordEventResult plumbing', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const event = career.schedule.events.find(e => e.name === 'Rivalry Dual');
    assert.equal(event.opponentIsRival, true);
    const rivalId = event.opponent.id;
    const dual = createCareerDualMeet(career, event, 'my_match');
    simulateNonHeroBouts(dual, fixedRng(2));
    advanceDualBout(dual, { playerWon: true, winMethod: 'pin', p1Score: 4, p2Score: 0 });
    simulateNonHeroBouts(dual, fixedRng(4));
    const { nextCareer } = recordCareerDualMeetResult(career, event.id, dual);
    const rival = nextCareer.rivals.find(r => r.id === rivalId);
    assert.ok(rival, 'rival still present');
    assert.equal(rival.h2h.wins, 1, 'rival H2H wins +1 after rivalry-dual win');
    assert.equal(rival.h2h.pins, 1, 'pin tracked in H2H');
  });

  test('postseason gating does not trigger on dual_meet (HS player can lose the dual without losing State)', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const conferenceBefore = career.schedule.events.find(e => e.stakes === 'conference');
    const stateBefore = career.schedule.events.find(e => e.stakes === 'state');
    const regionalBefore = career.schedule.events.find(e => e.stakes === 'regional');
    assert.ok(stateBefore && regionalBefore && conferenceBefore, 'fresh HS schedule has all 3 postseason events');
    const event = firstDualMeetEvent(career);
    const dual = createCareerDualMeet(career, event, 'my_match');
    simulateNonHeroBouts(dual, fixedRng(8));
    advanceDualBout(dual, { playerWon: false, winMethod: 'decision', p1Score: 1, p2Score: 8 });
    simulateNonHeroBouts(dual, fixedRng(8));
    const { nextCareer } = recordCareerDualMeetResult(career, event.id, dual);
    const stateAfter = nextCareer.schedule.events.find(e => e.stakes === 'state');
    const regionalAfter = nextCareer.schedule.events.find(e => e.stakes === 'regional');
    assert.ok(stateAfter && regionalAfter, 'losing a dual_meet does NOT prune postseason events (only championship losses do)');
  });
});

describe('careerDualMeet - simulateDualMeetEvent', () => {
  test('produces a fully resolved snapshot ready for recordCareerDualMeetResult', () => {
    const career = buildCareer({ tier: 'hs', weightClass: 145 });
    const event = firstDualMeetEvent(career);
    const dual = simulateDualMeetEvent(career, event, fixedRng(3));
    assert.equal(dual.phase, 'complete');
    for (const b of dual.bouts) assert.ok(b.result, 'every bout has a result');
    assert.equal(dual.bouts.length, 14, 'HS sim uses 14 bouts');
    const { nextCareer } = recordCareerDualMeetResult(career, event.id, dual);
    const finished = nextCareer.schedule.events.find(e => e.id === event.id);
    assert.ok(finished.dualSummary, 'team metadata persists through recordCareerDualMeetResult');
    assert.equal(['won', 'lost'].includes(finished.status), true);
  });

  test('woman college sim emits 10 bouts in womens_freestyle style', () => {
    const career = buildCareer({ tier: 'college', gender: 'female', weightClass: 131 });
    const event = firstDualMeetEvent(career);
    assert.equal(event.style, 'womens_freestyle');
    const dual = simulateDualMeetEvent(career, event, fixedRng(5));
    assert.equal(dual.bouts.length, 10);
    assert.equal(dual.wrestlingStyle, 'womens_freestyle');
  });
});

// ── simulateOneBout (mid-dual "Simulate Bout" button) ───────────────────
// Drives the user-requested workflow: in full_dual mode the player can
// play 3-4 bouts and then sim the rest to finish faster. Each click sims
// the SINGLE bout currently queued at dual.currentBoutIndex.

describe('careerDualMeet - simulateOneBout (mid-dual sim button)', () => {
  test('sims the queued bout, increments currentBoutIndex, sets phase between', () => {
    const career = buildCareer();
    const event = career.schedule.events.find(e => e.type === 'dual_meet');
    const dual = createCareerDualMeet(career, event, 'full_dual');
    const before = dual.currentBoutIndex;
    assert.equal(dual.bouts[before].result, null);
    simulateOneBout(dual, fixedRng(2));
    assert.ok(dual.bouts[before].result, 'queued bout now has a result');
    assert.equal(dual.currentBoutIndex, before + 1, 'index advances by 1');
    assert.equal(dual.phase, 'between', 'phase routes back to between');
  });

  test('flips phase to complete when simming the last bout', () => {
    const career = buildCareer();
    const event = career.schedule.events.find(e => e.type === 'dual_meet');
    const dual = createCareerDualMeet(career, event, 'full_dual');
    // Sim every bout one at a time until complete.
    let safety = dual.bouts.length + 5;
    while (dual.phase !== 'complete' && safety-- > 0) {
      simulateOneBout(dual, fixedRng(safety + 1));
    }
    assert.equal(dual.phase, 'complete', 'finishes after bouts.length sim calls');
    assert.ok(dual.bouts.every(b => b.result), 'every bout has a result');
  });

  test('credits team points consistently with the engine path', () => {
    const career = buildCareer();
    const event = career.schedule.events.find(e => e.type === 'dual_meet');
    const dual = createCareerDualMeet(career, event, 'full_dual');
    const startScore = { ...dual.teamScore };
    simulateOneBout(dual, fixedRng(13));
    const delta = (dual.teamScore.player - startScore.player)
      + (dual.teamScore.opponent - startScore.opponent);
    // Folkstyle dual points for any decisive method are >= 3 (decision low),
    // <= 6 (pin/forfeit/dq high). Draws are 2+2=4. So a single bout always
    // adds at least 3 to one side OR 2 to both. Sanity-check the magnitude.
    assert.ok(delta >= 2 && delta <= 6, `single-bout delta ${delta} is in folkstyle range`);
  });

  test('no-op when phase is already complete', () => {
    const career = buildCareer();
    const event = career.schedule.events.find(e => e.type === 'dual_meet');
    const dual = createCareerDualMeet(career, event, 'full_dual');
    // Force-complete via repeated sims.
    while (dual.phase !== 'complete') {
      simulateOneBout(dual, fixedRng(3));
    }
    const finalScoreSnapshot = JSON.stringify(dual.teamScore);
    const finalIdx = dual.currentBoutIndex;
    simulateOneBout(dual, fixedRng(99));
    assert.equal(JSON.stringify(dual.teamScore), finalScoreSnapshot, 'team score unchanged');
    assert.equal(dual.currentBoutIndex, finalIdx, 'index unchanged');
  });

  test('mixed flow: play 3 bouts via advanceDualBout, sim 7 via simulateOneBout', () => {
    const career = buildCareer();
    const event = career.schedule.events.find(e => e.type === 'dual_meet');
    const dual = createCareerDualMeet(career, event, 'full_dual');
    // Three "played" bouts: caller passes a synthetic match-end result
    // (mirrors handleContinueCareerDualMeet behavior).
    advanceDualBout(dual, { playerWon: true,  winMethod: 'pin',      p1Score: 4, p2Score: 0 });
    advanceDualBout(dual, { playerWon: false, winMethod: 'decision', p1Score: 3, p2Score: 7 });
    advanceDualBout(dual, { playerWon: true,  winMethod: 'major_decision', p1Score: 12, p2Score: 4 });
    assert.equal(dual.currentBoutIndex, 3);
    assert.equal(dual.phase, 'between');
    // Player decides to sim the rest. Loop simulateOneBout until complete.
    while (dual.phase !== 'complete') {
      simulateOneBout(dual, fixedRng(dual.currentBoutIndex + 17));
    }
    assert.equal(dual.phase, 'complete');
    // First 3 bouts retain the played results we set; remaining bouts have
    // sim-derived results (any winMethod, any score).
    assert.equal(dual.bouts[0].result.winMethod, 'pin');
    assert.equal(dual.bouts[1].result.winMethod, 'decision');
    assert.equal(dual.bouts[2].result.winMethod, 'major_decision');
    for (let i = 3; i < dual.bouts.length; i++) {
      assert.ok(dual.bouts[i].result, `bout ${i} sim'd to result`);
    }
    // getDualWinner runs cleanly post-mix (no NaN/undefined paths).
    const winner = getDualWinner(dual);
    assert.ok(['player', 'opponent', 'draw'].includes(winner));
  });
});
