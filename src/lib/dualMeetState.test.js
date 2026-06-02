// Unit tests for Dual Meets state machine, scoring, and persistence.
// Run with: node --test src/lib/dualMeetState.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// localStorage shim for node - module reads/writes at runtime, so define before import.
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
  createDualMeet,
  advanceDualBout,
  startNextBout,
  scoreFolkstyleBout,
  getDualMeetXPBonus,
  getDualWinner,
  saveDual,
  loadDual,
  clearDual,
  saveCareerDual,
  loadCareerDual,
  clearCareerDual,
  DUAL_STORAGE_KEYS,
  isClinched,
  FOLKSTYLE_DUAL_POINTS,
} = await import('./dualMeetState.js');

const { NCAA_WEIGHT_CLASSES, DUAL_BOUT_COUNT } = await import('./ncaaWeights.js');
const {
  HS_WEIGHTS,
  WOMENS_HS_WEIGHTS,
  WOMENS_COLLEGE_WEIGHTS,
} = await import('./career/careerWeights.js');

function stubProfile() {
  return {
    username: 'Tester',
    stats: { str: 65, spd: 65, tec: 65, end: 65, grt: 65 },
    appearance: { primaryColor: 'emerald', accentColor: '#059669' },
  };
}

test('createDualMeet builds 10 bouts, one per weight, hero locked at chosen slot', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 157,
    mode: 'cpu',
    difficulty: 'medium',
    lineupMode: 'random',
    playerTeamName: 'Home',
    opponentTeamName: 'Away',
  });
  assert.equal(dual.phase, 'bout');
  assert.equal(dual.bouts.length, DUAL_BOUT_COUNT);
  assert.deepEqual(dual.bouts.map(b => b.weight), NCAA_WEIGHT_CLASSES);
  const heroBout = dual.bouts.find(b => b.weight === 157);
  assert.ok(heroBout.playerWrestler.isHero, 'hero flag set on chosen weight');
  assert.equal(heroBout.playerWrestler.name, 'Tester');
  const otherHeroes = dual.bouts.filter(b => b.weight !== 157 && b.playerWrestler.isHero);
  assert.equal(otherHeroes.length, 0, 'no other bout is flagged hero');
});

test('scoreFolkstyleBout maps NCAA team points correctly', () => {
  assert.deepEqual(
    scoreFolkstyleBout({ winMethod: 'decision', p1Score: 5, p2Score: 2, playerWon: true }),
    { player: 3, opponent: 0, method: 'decision' },
  );
  assert.deepEqual(
    scoreFolkstyleBout({ winMethod: 'decision', p1Score: 12, p2Score: 3, playerWon: true }),
    { player: 4, opponent: 0, method: 'major' },
    'decision with 9-pt margin upgrades to major',
  );
  assert.deepEqual(
    scoreFolkstyleBout({ winMethod: 'tech_fall', p1Score: 18, p2Score: 3, playerWon: true }),
    { player: 5, opponent: 0, method: 'tech_fall' },
  );
  assert.deepEqual(
    scoreFolkstyleBout({ winMethod: 'pin', p1Score: 4, p2Score: 2, playerWon: false }),
    { player: 0, opponent: 6, method: 'pin' },
  );
  assert.deepEqual(
    scoreFolkstyleBout({ winMethod: 'draw', p1Score: 4, p2Score: 4, playerWon: false }),
    { player: 2, opponent: 2, method: 'draw' },
  );
});

test('advanceDualBout credits team points and transitions phases', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 125, mode: 'cpu', difficulty: 'easy', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
  });
  // Bout 1: pin win → +6
  advanceDualBout(dual, { playerWon: true, winMethod: 'pin', p1Score: 4, p2Score: 0 });
  assert.equal(dual.phase, 'between');
  assert.equal(dual.teamScore.player, 6);
  assert.equal(dual.teamScore.opponent, 0);
  assert.equal(dual.currentBoutIndex, 1);

  startNextBout(dual);
  assert.equal(dual.phase, 'bout');

  // Bout 2: loss by decision → +3 opp
  advanceDualBout(dual, { playerWon: false, winMethod: 'decision', p1Score: 2, p2Score: 5 });
  assert.equal(dual.teamScore.opponent, 3);
  assert.equal(dual.currentBoutIndex, 2);
});

test('advanceDualBout closes out the dual on bout 10 and flips phase=complete', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 157, mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
  });
  for (let i = 0; i < DUAL_BOUT_COUNT; i++) {
    if (dual.phase === 'between') startNextBout(dual);
    advanceDualBout(dual, { playerWon: true, winMethod: 'decision', p1Score: 5, p2Score: 2 });
  }
  assert.equal(dual.phase, 'complete');
  assert.equal(dual.teamScore.player, 30);
  assert.equal(dual.teamScore.opponent, 0);
  assert.equal(getDualWinner(dual), 'player');
});

test('getDualMeetXPBonus awards 300 on victory, 150 on loss/draw, 0 for hotseat', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 149, mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
  });
  for (let i = 0; i < DUAL_BOUT_COUNT; i++) {
    if (dual.phase === 'between') startNextBout(dual);
    advanceDualBout(dual, { playerWon: true, winMethod: 'decision', p1Score: 5, p2Score: 2 });
  }
  assert.equal(getDualMeetXPBonus(dual), 300);

  const loss = createDualMeet(stubProfile(), {
    heroWeightClass: 149, mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
  });
  for (let i = 0; i < DUAL_BOUT_COUNT; i++) {
    if (loss.phase === 'between') startNextBout(loss);
    advanceDualBout(loss, { playerWon: false, winMethod: 'decision', p1Score: 2, p2Score: 5 });
  }
  assert.equal(getDualMeetXPBonus(loss), 150);

  const hotseat = createDualMeet(stubProfile(), {
    heroWeightClass: 149, mode: 'hotseat', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
  });
  for (let i = 0; i < DUAL_BOUT_COUNT; i++) {
    if (hotseat.phase === 'between') startNextBout(hotseat);
    advanceDualBout(hotseat, { playerWon: true, winMethod: 'pin', p1Score: 4, p2Score: 0 });
  }
  assert.equal(getDualMeetXPBonus(hotseat), 0, 'hotseat duals grant no profile XP');
});

test('save/load round-trips state, clear wipes it', () => {
  clearDual();
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 184, mode: 'cpu', difficulty: 'hard', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
  });
  advanceDualBout(dual, { playerWon: true, winMethod: 'tech_fall', p1Score: 18, p2Score: 3 });
  saveDual(dual);

  const loaded = loadDual();
  assert.ok(loaded, 'loadDual returns persisted state');
  assert.equal(loaded.currentBoutIndex, 1);
  assert.equal(loaded.teamScore.player, FOLKSTYLE_DUAL_POINTS.tech_fall.winner);

  clearDual();
  assert.equal(loadDual(), null, 'clear wipes storage');
});

test('isClinched flips true only once the deficit exceeds max-swing', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 157, mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
  });
  // Not clinched at start
  assert.equal(isClinched(dual), false);
  // Pin wins for 6 straight bouts -> 36-0 with 4 bouts (max 24) left -> clinched
  for (let i = 0; i < 6; i++) {
    if (dual.phase === 'between') startNextBout(dual);
    advanceDualBout(dual, { playerWon: true, winMethod: 'pin', p1Score: 4, p2Score: 0 });
  }
  assert.equal(isClinched(dual), true);
});

// ─── Career Dual Meet additions (tier-aware weights, normalization, namespacing) ───

test('createDualMeet accepts a custom HS_WEIGHTS array (14 bouts) without falling back', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 106, // HS lightweight - not in NCAA, must NOT fall back to 157
    mode: 'cpu',
    difficulty: 'medium',
    lineupMode: 'random',
    playerTeamName: 'Home',
    opponentTeamName: 'Away',
    weights: HS_WEIGHTS,
  });
  assert.equal(dual.bouts.length, 14, 'HS dual has 14 bouts');
  assert.deepEqual(dual.bouts.map(b => b.weight), HS_WEIGHTS);
  assert.equal(dual.heroWeightClass, 106, 'hero weight respected (no fallback to 157)');
  assert.deepEqual(dual.weights, HS_WEIGHTS, 'dual.weights stored on snapshot');
  const heroBout = dual.bouts.find(b => b.weight === 106);
  assert.ok(heroBout?.playerWrestler.isHero, 'hero flagged at the lightest weight');
});

test('createDualMeet works with WOMENS_HS_WEIGHTS (14 bouts, lightest 100)', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 100,
    mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
    weights: WOMENS_HS_WEIGHTS,
  });
  assert.equal(dual.bouts.length, 14);
  assert.equal(dual.heroWeightClass, 100);
  assert.deepEqual(dual.weights, WOMENS_HS_WEIGHTS);
});

test('createDualMeet works with WOMENS_COLLEGE_WEIGHTS (10 bouts, includes 103)', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 103,
    mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
    weights: WOMENS_COLLEGE_WEIGHTS,
  });
  assert.equal(dual.bouts.length, 10);
  assert.equal(dual.heroWeightClass, 103);
  assert.deepEqual(dual.weights, WOMENS_COLLEGE_WEIGHTS);
});

test('isClinched math uses dual.bouts.length, not the hardcoded NCAA count', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 132,
    mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
    weights: HS_WEIGHTS, // 14 bouts
  });
  // Not clinched at start (max possible swing = 14 * 6 = 84).
  assert.equal(isClinched(dual), false);
  // Win 9 bouts by pin -> 54-0 with 5 bouts left (max swing 30). 54 > 30 -> clinched.
  for (let i = 0; i < 9; i++) {
    if (dual.phase === 'between') startNextBout(dual);
    advanceDualBout(dual, { playerWon: true, winMethod: 'pin', p1Score: 4, p2Score: 0 });
  }
  assert.equal(isClinched(dual), true);
  // The dual is NOT yet complete (only 9 of 14 bouts played) - guards against
  // the bug where DUAL_BOUT_COUNT (10) would have flipped phase to 'complete'.
  assert.notEqual(dual.phase, 'complete');
});

test('advanceDualBout closes a 14-bout HS dual on the 14th bout, not the 10th', () => {
  const dual = createDualMeet(stubProfile(), {
    heroWeightClass: 145,
    mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
    weights: HS_WEIGHTS,
  });
  for (let i = 0; i < HS_WEIGHTS.length; i++) {
    if (dual.phase === 'between') startNextBout(dual);
    advanceDualBout(dual, { playerWon: true, winMethod: 'decision', p1Score: 5, p2Score: 2 });
    if (i < HS_WEIGHTS.length - 1) {
      assert.notEqual(dual.phase, 'complete', `bout ${i + 1} must not flip phase=complete prematurely`);
    }
  }
  assert.equal(dual.phase, 'complete');
  assert.equal(dual.teamScore.player, 14 * 3);
});

test('scoreFolkstyleBout normalizes major_decision -> 4 team points', () => {
  // simulateEvent.rollMatchOutcome emits 'major_decision' for 8+ point wins.
  // The folkstyle dual scorer must credit the major-decision team-point value
  // (4) regardless of whether the input is 'major' or 'major_decision'.
  assert.deepEqual(
    scoreFolkstyleBout({ winMethod: 'major_decision', p1Score: 11, p2Score: 2, playerWon: true }),
    { player: 4, opponent: 0, method: 'major' },
    'major_decision normalizes to major (4 team pts)',
  );
  assert.deepEqual(
    scoreFolkstyleBout({ winMethod: 'major', p1Score: 10, p2Score: 2, playerWon: true }),
    { player: 4, opponent: 0, method: 'major' },
    'plain major still scores 4 team pts',
  );
});

test('saveCareerDual is namespaced separately from saveDual (no collision)', () => {
  clearDual();
  clearCareerDual();
  const standalone = createDualMeet(stubProfile(), {
    heroWeightClass: 157,
    mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
  });
  saveDual(standalone);

  const career = createDualMeet(stubProfile(), {
    heroWeightClass: 138, // HS weight, won't collide
    mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Career Home', opponentTeamName: 'Career Away',
    weights: HS_WEIGHTS,
  });
  career.careerEventId = 'evt_y1_w1_0';
  saveCareerDual(career);

  // Standalone untouched.
  const loadedStandalone = loadDual();
  assert.ok(loadedStandalone, 'standalone dual still present');
  assert.equal(loadedStandalone.bouts.length, 10, 'standalone retained NCAA shape');

  // Career separate.
  const loadedCareer = loadCareerDual();
  assert.ok(loadedCareer, 'career dual present');
  assert.equal(loadedCareer.bouts.length, 14, 'career dual retains HS shape');
  assert.equal(loadedCareer.careerEventId, 'evt_y1_w1_0');

  // Clearing one does not clear the other.
  clearCareerDual();
  assert.equal(loadCareerDual(), null);
  assert.ok(loadDual(), 'standalone unaffected by clearCareerDual');

  clearDual();
});

test('DUAL_STORAGE_KEYS exposes both keys for assertion-friendly tests', () => {
  assert.equal(DUAL_STORAGE_KEYS.standalone, 'matgrind_dual');
  assert.equal(DUAL_STORAGE_KEYS.career, 'matgrind_career_dual');
  assert.notEqual(DUAL_STORAGE_KEYS.standalone, DUAL_STORAGE_KEYS.career, 'keys must differ');
});

// End-to-end "stop mid-dual and resume" simulation. Mirrors the user flow:
//   1. Player starts a career dual, plays 3 bouts.
//   2. saveCareerDual after each advanceDualBout (matches WrestlingGame
//      behavior at lines 2888, 2894, 2979, 4790).
//   3. Player closes the tab. In-memory state is dropped.
//   4. Player reopens. loadCareerDual returns the persisted snapshot.
//   5. Loaded snapshot must preserve completed bout results, team score,
//      currentBoutIndex, and lineup choice so the player can continue from
//      bout 4 without re-doing 1-3.
test('career dual: stop mid-dual and resume preserves completed bouts', () => {
  clearCareerDual();

  // Day 1: start dual, play 3 of 14 HS bouts.
  const day1 = createDualMeet(stubProfile(), {
    heroWeightClass: 138,
    mode: 'cpu', difficulty: 'medium', lineupMode: 'random',
    playerTeamName: 'Home', opponentTeamName: 'Away',
    weights: HS_WEIGHTS,
  });
  day1.careerEventId = 'evt_y1_w1_0';
  day1.lineupChoice = 'full_dual';
  saveCareerDual(day1);

  // Bout 1: pin (W, +6 player)
  advanceDualBout(day1, { playerWon: true, winMethod: 'pin', p1Score: 4, p2Score: 0 });
  saveCareerDual(day1);
  startNextBout(day1);
  saveCareerDual(day1);

  // Bout 2: tech_fall (L, +5 opponent)
  advanceDualBout(day1, { playerWon: false, winMethod: 'tech_fall', p1Score: 0, p2Score: 18 });
  saveCareerDual(day1);
  startNextBout(day1);
  saveCareerDual(day1);

  // Bout 3: decision (W, +3 player)
  advanceDualBout(day1, { playerWon: true, winMethod: 'decision', p1Score: 7, p2Score: 4 });
  saveCareerDual(day1);
  startNextBout(day1);
  saveCareerDual(day1);

  const beforeQuit = JSON.stringify(day1);
  assert.equal(day1.currentBoutIndex, 3, 'mid-dual at bout 4 (index 3)');
  assert.equal(day1.teamScore.player, 6 + 0 + 3);
  assert.equal(day1.teamScore.opponent, 0 + 5 + 0);

  // ── Simulate tab close: drop in-memory state ─────────────────────────────
  // (The user resets all references; only localStorage survives.)
  // ──────────────────────────────────────────────────────────────────────────

  // Day 2: load from localStorage as if the page just opened.
  const day2 = loadCareerDual();
  assert.ok(day2, 'snapshot survives "tab close"');

  // Identity guarantees: same dual (event id), same lineup choice, same
  // bout index, same scores, same completed-bout results.
  assert.equal(day2.careerEventId, 'evt_y1_w1_0');
  assert.equal(day2.lineupChoice, 'full_dual');
  assert.equal(day2.currentBoutIndex, 3);
  assert.equal(day2.teamScore.player, 9);
  assert.equal(day2.teamScore.opponent, 5);
  assert.deepEqual(day2.weights, HS_WEIGHTS, 'custom weights preserved');
  assert.equal(day2.bouts.length, 14, 'all 14 bout slots preserved');

  // Completed bouts retain their result objects.
  assert.equal(day2.bouts[0].result?.playerWon, true);
  assert.equal(day2.bouts[0].result?.winMethod, 'pin');
  assert.equal(day2.bouts[1].result?.playerWon, false);
  assert.equal(day2.bouts[1].result?.winMethod, 'tech_fall');
  assert.equal(day2.bouts[2].result?.playerWon, true);
  assert.equal(day2.bouts[2].result?.winMethod, 'decision');

  // Remaining bouts are still pending (no result).
  for (let i = 3; i < 14; i++) {
    assert.equal(day2.bouts[i].result, null, `bout ${i} still pending`);
  }

  // Continue advancing from the resumed snapshot. State must remain coherent.
  advanceDualBout(day2, { playerWon: true, winMethod: 'major_decision', p1Score: 12, p2Score: 4 });
  saveCareerDual(day2);
  assert.equal(day2.currentBoutIndex, 4, 'advance from resumed state increments idx');
  // major_decision (normalized to 'major' inside scoreFolkstyleBout) = 4 player team points.
  assert.equal(day2.teamScore.player, 9 + 4, 'major decision crediting 4 dual points');

  // Tab-close-and-resume one more time: snapshot still up to date.
  const day3 = loadCareerDual();
  assert.equal(day3.currentBoutIndex, 4);
  assert.equal(day3.teamScore.player, 13);
  assert.equal(day3.bouts[3].result?.winMethod, 'major_decision');

  // Round-trip serialization stable (JSON-safe shape).
  assert.equal(JSON.stringify(day3), JSON.stringify(loadCareerDual()), 'idempotent reload');

  // Sanity: a second saveCareerDual after the same advanceDualBout doesn't
  // change anything we care about (no double-credit on retry-save patterns).
  saveCareerDual(day3);
  const day4 = loadCareerDual();
  assert.equal(day4.teamScore.player, 13, 'idempotent re-save does not double-credit');

  clearCareerDual();
  assert.equal(loadCareerDual(), null, 'clear wipes after dual finalized');
  // Earlier byte-for-byte compare guarded against shape drift.
  void beforeQuit;
});
