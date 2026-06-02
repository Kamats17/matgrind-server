// Bracket-shape invariants for the 64-man and 128-man additions, plus a
// cross-product check that createTournament can hand back a valid tournament
// object for every (size × format) pair the UI exposes.
//
// The size×format cross-product was added after a code-review note: the
// single-elim builder is the safe path, but the consolation / double_elim
// builders sit on top of it and could introduce size-specific edge cases
// (e.g. an off-by-one when computing the loser bracket for 128).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage before importing tournamentState so saveTournament's
// `localStorage.setItem` call works under node:test. The implementation
// already swallows errors but the warnings flood test output otherwise.
const memStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memStore.has(k) ? memStore.get(k) : null),
  setItem: (k, v) => { memStore.set(k, String(v)); },
  removeItem: (k) => { memStore.delete(k); },
  clear: () => { memStore.clear(); },
};

const {
  buildBracketStructure,
  createTournament,
  advanceMatch,
  getNextMatch,
  finishSimulation,
  resolveByeRounds,
} = await import('./tournamentState.js');
const { computePlacement } = await import('./tournamentScoring.js');

// ─── buildBracketStructure shape ─────────────────────────────────────────

test('buildBracketStructure(64): 6 rounds, 63 matches, first round is Round of 64', () => {
  const r = buildBracketStructure(64);
  assert.equal(r.totalRounds, 6);
  // 32 + 16 + 8 + 4 + 2 + 1 = 63
  assert.equal(r.matches.length, 63);
  assert.equal(r.roundRanges[0].label, 'Round of 64');
  assert.equal(r.roundRanges[r.roundRanges.length - 1].label, 'Finals');
});

test('buildBracketStructure(128): 7 rounds, 127 matches, first round is Round of 128', () => {
  const r = buildBracketStructure(128);
  assert.equal(r.totalRounds, 7);
  // 64 + 32 + 16 + 8 + 4 + 2 + 1 = 127
  assert.equal(r.matches.length, 127);
  assert.equal(r.roundRanges[0].label, 'Round of 128');
  assert.equal(r.roundRanges[r.roundRanges.length - 1].label, 'Finals');
});

test('buildBracketStructure(128): no malformed first-round pairings', () => {
  // The historical failure mode for an unsupported power-of-two was matches
  // whose seeds exceeded bracketSize-1 (i.e. "TBD" opponents that never
  // resolved). Walk the first round and assert seed bounds.
  const r = buildBracketStructure(128);
  const r1 = r.roundRanges[0];
  for (let i = r1.start; i <= r1.end; i++) {
    const [a, b] = r.matches[i].bracketSlots;
    assert.ok(a !== null && a < 128, `R1 match ${i} slot A out of range: ${a}`);
    assert.ok(b !== null && b < 128, `R1 match ${i} slot B out of range: ${b}`);
  }
});

// ─── createTournament cross-product (size × format) ──────────────────────

const STUB_PROFILE = {
  username: 'TestPlayer',
  stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
  appearance: null,
};

const ALL_SIZES = [8, 16, 24, 32, 64, 128];
const ALL_FORMATS = ['single', 'consolation', 'double_elim'];

test('createTournament: every (size × format) pair produces a valid tournament', () => {
  for (const size of ALL_SIZES) {
    for (const format of ALL_FORMATS) {
      const t = createTournament(STUB_PROFILE, 'medium', 'folkstyle', size, format);
      assert.ok(t, `${size}/${format} returned no tournament`);
      assert.equal(t.bracketSize, size, `${size}/${format} stored wrong bracketSize`);
      assert.ok(Array.isArray(t.bracket) && t.bracket.length === size,
        `${size}/${format} bracket length mismatch: ${t.bracket?.length}`);
      assert.ok(Array.isArray(t.matches) && t.matches.length > 0,
        `${size}/${format} produced an empty match list`);
      // Player must be findable by playerSeed and not be `undefined`.
      const playerEntry = t.bracket[t.playerSeed ?? 0];
      assert.ok(playerEntry && typeof playerEntry.name === 'string',
        `${size}/${format} player entry missing or malformed`);
      // No undefined opponents in the first-round pairings the player could face.
      const firstRound = t.roundRanges[0];
      for (let i = firstRound.start; i <= firstRound.end; i++) {
        const [a, b] = t.matches[i].bracketSlots;
        assert.ok(t.bracket[a], `${size}/${format} R1 match ${i} slot A points to missing entry (seed ${a})`);
        assert.ok(t.bracket[b], `${size}/${format} R1 match ${i} slot B points to missing entry (seed ${b})`);
      }
    }
  }
});

test('createTournament(128, "single"): playerRoundsToWin is 7 (no byes)', () => {
  const t = createTournament(STUB_PROFILE, 'medium', 'folkstyle', 128, 'single');
  // Power-of-two brackets put every wrestler through the same number of
  // rounds as totalRounds. Career-mode 24-brackets bypass this via the
  // play-in; here we assert the standard path.
  assert.equal(t.playerRoundsToWin, 7);
  assert.equal(t.totalRounds, 7);
});

test('createTournament(64, "single"): playerRoundsToWin is 6', () => {
  const t = createTournament(STUB_PROFILE, 'medium', 'folkstyle', 64, 'single');
  assert.equal(t.playerRoundsToWin, 6);
  assert.equal(t.totalRounds, 6);
});

// ─── Player-wins-all completion (regression for the consolation /
//     double-elim "undefeated WB winner stranded with no nextMatch" bug)

const PLAYER_WIN = { playerWon: true, p1Score: 5, p2Score: 0, winMethod: 'pin' };

function playUntilComplete(tournament, maxIterations = 200) {
  for (let i = 0; i < maxIterations; i++) {
    if (tournament.phase === 'complete') return tournament;
    const nm = getNextMatch(tournament);
    if (nm) {
      tournament = advanceMatch(tournament, PLAYER_WIN);
      continue;
    }
    // No next match for the player. Either we are mid-simulation (auto-sim
    // pending) or the implementation has stranded us. Step through
    // finishSimulation; if phase didn't change, we are stuck and should
    // fail the test instead of looping forever.
    const before = tournament.phase;
    tournament = finishSimulation(tournament);
    if (tournament.phase === before && !getNextMatch(tournament)) {
      throw new Error(`tournament stuck in phase=${tournament.phase} after iteration ${i} with no nextMatch`);
    }
  }
  throw new Error(`tournament did not complete within ${maxIterations} iterations (phase=${tournament.phase})`);
}

for (const size of ALL_SIZES) {
  for (const format of ALL_FORMATS) {
    test(`player-wins-all completes ${size}/${format}`, () => {
      memStore.clear();
      let t = createTournament(STUB_PROFILE, 'medium', 'folkstyle', size, format);
      // Production UI calls resolveByeRounds after createTournament so the
      // 24-bracket play-in resolves before the player wrestles. Mirror that
      // here; it is a no-op for the power-of-two sizes.
      t = resolveByeRounds(t);
      const finished = playUntilComplete(t);
      assert.equal(finished.phase, 'complete',
        `${size}/${format} did not reach 'complete' (got ${finished.phase})`);
      assert.equal(finished.playerEliminated, false,
        `${size}/${format} marked player eliminated despite winning all`);
    });
  }
}

// ─── True-finals loss paths (regression for the WB-undefeated -> placement-1
//     bug surfaced by the earlier adversarial review)

const PLAYER_LOSS = { playerWon: false, p1Score: 0, p2Score: 5, winMethod: 'pin' };

/**
 * Drive the player through a tournament with `nextResult(nm, ctx)` deciding
 * each match. Returns the final tournament + a log of (matchIndex, won) for
 * after-the-fact debugging.
 */
function drive(tournament, nextResult, maxIterations = 300) {
  const log = [];
  for (let i = 0; i < maxIterations; i++) {
    if (tournament.phase === 'complete') return { tournament, log };
    const nm = getNextMatch(tournament);
    if (nm) {
      const result = nextResult(nm, { iteration: i, log });
      log.push({ matchIndex: nm.matchIndex, won: !!result.playerWon });
      tournament = advanceMatch(tournament, result);
      continue;
    }
    const before = tournament.phase;
    tournament = finishSimulation(tournament);
    if (tournament.phase === before && !getNextMatch(tournament)) {
      throw new Error(`stuck phase=${tournament.phase} after iter ${i} (log: ${JSON.stringify(log)})`);
    }
  }
  throw new Error(`did not complete within ${maxIterations} iterations (phase=${tournament.phase})`);
}

for (const format of ['consolation', 'double_elim']) {
  test(`undefeated WB champ losing true finals = placement 2 (128/${format})`, () => {
    memStore.clear();
    let t = createTournament(STUB_PROFILE, 'medium', 'folkstyle', 128, format);
    t = resolveByeRounds(t);
    // Win every match except the true finals.
    const { tournament: finished } = drive(t, (nm) =>
      nm.matchIndex === 'true_finals' ? PLAYER_LOSS : PLAYER_WIN,
    );
    assert.equal(finished.phase, 'complete', `${format}: phase should be complete`);
    assert.equal(finished.playerEliminated, true,
      `${format}: WB champ losing true finals must mark playerEliminated=true`);
    const placement = computePlacement({
      playerEliminated: finished.playerEliminated,
      roundsWon: finished.roundsWon,
      playerRoundsToWin: finished.playerRoundsToWin,
    });
    assert.equal(placement, 2,
      `${format}: finals-losing WB champ must be placement 2, got ${placement}`);
  });
}

for (const format of ['consolation', 'double_elim']) {
  test(`LB climber losing true finals = placement 2 (128/${format})`, () => {
    memStore.clear();
    let t = createTournament(STUB_PROFILE, 'medium', 'folkstyle', 128, format);
    t = resolveByeRounds(t);
    // Lose the very first WB match the player faces, win every LB match,
    // then lose true finals.
    let losses = 0;
    const { tournament: finished } = drive(t, (nm) => {
      if (typeof nm.matchIndex === 'number' && losses === 0) {
        losses = 1;
        return PLAYER_LOSS;
      }
      if (nm.matchIndex === 'true_finals') return PLAYER_LOSS;
      return PLAYER_WIN;
    });
    assert.equal(finished.phase, 'complete', `${format}: phase should be complete`);
    assert.equal(finished.playerEliminated, true,
      `${format}: LB climber losing true finals must mark playerEliminated=true`);
    const placement = computePlacement({
      playerEliminated: finished.playerEliminated,
      roundsWon: finished.roundsWon,
      playerRoundsToWin: finished.playerRoundsToWin,
    });
    assert.equal(placement, 2,
      `${format}: LB climber losing true finals must be placement 2, got ${placement}`);
  });
}

test('LB climber winning true finals = placement 1 (128/double_elim)', () => {
  memStore.clear();
  let t = createTournament(STUB_PROFILE, 'medium', 'folkstyle', 128, 'double_elim');
  t = resolveByeRounds(t);
  // Lose first WB match, then win every remaining match including true finals.
  let losses = 0;
  const { tournament: finished } = drive(t, (nm) => {
    if (typeof nm.matchIndex === 'number' && losses === 0) {
      losses = 1;
      return PLAYER_LOSS;
    }
    return PLAYER_WIN;
  });
  assert.equal(finished.phase, 'complete');
  assert.equal(finished.playerEliminated, false,
    'LB climber winning true finals must NOT be marked eliminated');
  const placement = computePlacement({
    playerEliminated: finished.playerEliminated,
    roundsWon: finished.roundsWon,
    playerRoundsToWin: finished.playerRoundsToWin,
  });
  assert.equal(placement, 1, `LB-climb champion must be placement 1, got ${placement}`);
});
