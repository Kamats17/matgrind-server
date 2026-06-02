// Career Depth Pass v1 - tournament whole-event tempBuff semantics.
//
// Contract: a career wrestler with a pending tempBuff entering a tournament
// gets that buff consumed exactly ONCE for the whole event, not once per
// bracket round. The caller (WrestlingGame.jsx) computes modifiers at
// tournament-start via applyCareerMatchModifiers, stashes them on the
// tournament UI state, applies them to every bout, and only forwards
// `consumedBuffSourceIds` to recordEventResult when the event finalizes.
//
// This test simulates that wire pattern by calling applyInterimTournamentMatch
// for N bracket rounds (which never touches tempBuffs) and recordEventResult
// once at the end with the consumed sourceIds. The buff must:
//   - survive every interim round
//   - be removed by the final recordEventResult
//   - count exactly once toward seasonMeta.debuffEventCount
//
// Run: node --test src/lib/career/careerTournamentModifiers.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createCareer, recordEventResult, applyInterimTournamentMatch } = await import('./careerState.js');

function fixedRng() {
  let n = 0;
  return () => {
    n = (n * 9301 + 49297) % 233280;
    return n / 233280;
  };
}

function debuffBuff() {
  return {
    sourceId: 'heavy_lift_risk',
    type: 'stat_boost_all',
    amount: -2,
    duration: 1,
    label: 'Tweaked back (-2 all)',
    debuff: true,
  };
}

function withPendingDebuff(career) {
  return {
    ...career,
    wrestler: {
      ...career.wrestler,
      tempBuffs: [debuffBuff()],
    },
  };
}

function firstTournamentEvent(career) {
  return career.schedule.events.find(e => e.type === 'tournament' || e.type === 'championship');
}

test('debuff survives 4 interim rounds and is consumed once at finalize', () => {
  let career = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng() });
  career = withPendingDebuff(career);
  const event = firstTournamentEvent(career);
  assert.ok(event, 'fixture has at least one tournament event');

  // Simulate 4 bracket rounds. applyInterimTournamentMatch must NOT touch
  // tempBuffs (consumption happens only at event finalize).
  for (let round = 0; round < 4; round++) {
    career = applyInterimTournamentMatch(career, event.id, {
      playerWon: true,
      winMethod: 'decision',
    });
    assert.equal(career.wrestler.tempBuffs.length, 1, `buff still present after round ${round + 1}`);
    assert.equal(career.wrestler.tempBuffs[0].sourceId, 'heavy_lift_risk');
  }
  // debuffEventCount stays at 0 across rounds (no consumption yet).
  assert.equal(career.seasonMeta.debuffEventCount, 0);

  // Finalize the tournament. Caller forwards the buff sourceIds it stashed
  // at tournament-start as consumedBuffSourceIds.
  const finalCareer = recordEventResult(career, event.id, {
    playerWon: true,
    placement: 1,
    winMethod: 'decision',
    matchesWon: 4,
    matchesLost: 0,
    consumedBuffSourceIds: ['heavy_lift_risk'],
    rng: fixedRng(),
  });

  // Buff consumed exactly once.
  assert.equal(finalCareer.wrestler.tempBuffs.length, 0, 'tempBuff cleared after event finalize');
  // debuffEventCount incremented exactly once for the tournament event.
  assert.equal(finalCareer.seasonMeta.debuffEventCount, 1);
});

test('positive buff in a tournament does NOT increment debuffEventCount', () => {
  let career = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng() });
  career = {
    ...career,
    wrestler: {
      ...career.wrestler,
      tempBuffs: [{
        sourceId: 'late_film_sleep',
        type: 'stamina_restore',
        amount: 0.10,
        duration: 1,
        label: '+10% stamina',
        debuff: false,
      }],
    },
  };
  const event = firstTournamentEvent(career);

  career = applyInterimTournamentMatch(career, event.id, { playerWon: true, winMethod: 'decision' });

  const final = recordEventResult(career, event.id, {
    playerWon: true,
    placement: 1,
    winMethod: 'decision',
    matchesWon: 1,
    matchesLost: 0,
    consumedBuffSourceIds: ['late_film_sleep'],
    rng: fixedRng(),
  });

  assert.equal(final.wrestler.tempBuffs.length, 0, 'positive buff consumed');
  assert.equal(final.seasonMeta.debuffEventCount, 0, 'positive buff does not count as debuff');
});

test('explicit empty consumedBuffSourceIds still ticks duration-1 buffs', () => {
  // When the caller has wired modifiers but the match consumed nothing
  // matching by sourceId (e.g. multi-event buff), the natural duration tick
  // still fires. This preserves the contract that an empty array means
  // "I am the consumer; tick normally."
  let career = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng() });
  career = withPendingDebuff(career);
  const event = firstTournamentEvent(career);

  const final = recordEventResult(career, event.id, {
    playerWon: true,
    placement: 1,
    winMethod: 'decision',
    matchesWon: 1,
    matchesLost: 0,
    consumedBuffSourceIds: [],
    rng: fixedRng(),
  });

  assert.equal(final.wrestler.tempBuffs.length, 0, 'duration-1 buff expired via tick under empty-but-explicit contract');
  assert.equal(final.seasonMeta.debuffEventCount, 1, 'debuff counted because caller wired modifiers');
});

test('played one round then forfeit consumes applied tempBuff exactly once', () => {
  // Models the WrestlingGame.handleCareerTournamentForfeit path: the player
  // entered the bracket (so applyCareerMatchModifiers ran and the buff was
  // physically applied to a played round) and then quit before finishing.
  // The new finalizeCareerTournamentResult helper forwards
  // consumedBuffSourceIds from the tag-validated ref so the applied buff
  // gets consumed exactly once on the forfeit-shaped result payload.
  let career = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng() });
  career = withPendingDebuff(career);
  const event = firstTournamentEvent(career);

  // One round played and won; player then bails before round 2.
  career = applyInterimTournamentMatch(career, event.id, { playerWon: true, winMethod: 'decision' });
  assert.equal(career.wrestler.tempBuffs.length, 1, 'buff still present after round 1');

  // Forfeit-shaped result (summarizeForfeitedTournament emits a non-champion
  // placement). The helper forwards consumedBuffSourceIds because the ref was
  // populated when the player entered the bracket.
  const final = recordEventResult(career, event.id, {
    playerWon: false,
    placement: 5,
    winMethod: 'decision',
    matchesWon: 1,
    matchesLost: 1,
    consumedBuffSourceIds: ['heavy_lift_risk'],
    rng: fixedRng(),
  });

  assert.equal(final.wrestler.tempBuffs.length, 0, 'applied buff consumed by forfeit finalize');
  assert.equal(final.seasonMeta.debuffEventCount, 1, 'debuff counted once on forfeit');
});

test('simulated tournament without applying modifiers preserves tempBuff', () => {
  // Models the handleSimulateWeek tournament branch where the player never
  // enters the bracket. applyCareerMatchModifiers never ran, the ref was
  // never populated, so finalizeCareerTournamentResult sees a null read and
  // omits consumedBuffSourceIds entirely. Strict contract leaves tempBuffs
  // untouched - the pending debuff carries over to a future event.
  let career = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng() });
  career = withPendingDebuff(career);
  const event = firstTournamentEvent(career);

  // No applyInterimTournamentMatch call - pure sim path.
  const final = recordEventResult(career, event.id, {
    playerWon: false,
    placement: 5,
    winMethod: 'decision',
    matchesWon: 0,
    matchesLost: 1,
    // consumedBuffSourceIds OMITTED - models the helper's pure-sim path.
    rng: fixedRng(),
  });

  assert.equal(final.wrestler.tempBuffs.length, 1, 'buff preserved on pure-sim tournament');
  assert.equal(final.wrestler.tempBuffs[0].sourceId, 'heavy_lift_risk');
  assert.equal(final.seasonMeta.debuffEventCount, 0, 'no debuff count on pure-sim');
});

test('omitted consumedBuffSourceIds PRESERVES tempBuffs (strict contract)', () => {
  // Sim duals, sim tournaments, and not-yet-wired paths call recordEventResult
  // WITHOUT consumedBuffSourceIds. The new contract is: no field, no tick.
  // The buff stays on the wrestler so it lands on a subsequent real match.
  // Previously a duration-1 buff would silently expire here AND count toward
  // debuffEventCount; that is fixed under the strict contract.
  let career = createCareer({ name: 'Test', weightClass: 138, rng: fixedRng() });
  career = withPendingDebuff(career);
  const event = firstTournamentEvent(career);

  career = applyInterimTournamentMatch(career, event.id, { playerWon: true, winMethod: 'decision' });

  const final = recordEventResult(career, event.id, {
    playerWon: true,
    placement: 1,
    winMethod: 'decision',
    matchesWon: 1,
    matchesLost: 0,
    // consumedBuffSourceIds omitted
    rng: fixedRng(),
  });

  assert.equal(final.wrestler.tempBuffs.length, 1, 'buff preserved when caller did not wire modifiers');
  assert.equal(final.seasonMeta.debuffEventCount, 0, 'no debuff count without explicit consumption');
});
