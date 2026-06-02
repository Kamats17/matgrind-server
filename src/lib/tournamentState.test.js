import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPlayerNextMatch, buildBracketStructure, isPlayerFirstBracketMatch } from './tournamentState.js';

// Minimal tournament fixture with a 4-bracket field. Player at seed 0
// faces seed 1 in the first match. The bracket array has a HOLE at seed 1
// (slot is undefined) to simulate the corrupted-snapshot state observed
// in production: a stale tournament snapshot whose bracket entries did not
// fully survive serialization or shape changes.
function makeTournamentWithUndefinedOpponentSlot() {
  const bracket = [
    { name: 'Player', stats: { str: 70, spd: 70, tec: 70, end: 70, grt: 70 }, isPlayer: true },
    undefined, // <-- the regression: opponent slot missing
    { name: 'NPC C', stats: { str: 65, spd: 65, tec: 65, end: 65, grt: 65 }, isPlayer: false },
    { name: 'NPC D', stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 }, isPlayer: false },
  ];
  return {
    tournamentFormat: 'single',
    bracket,
    playerSeed: 0,
    playerLosses: 0,
    matches: [
      { bracketSlots: [0, 1], winner: null, p1Score: null, p2Score: null, winMethod: null },
      { bracketSlots: [2, 3], winner: null, p1Score: null, p2Score: null, winMethod: null },
      { bracketSlots: [null, null], winner: null, p1Score: null, p2Score: null, winMethod: null },
    ],
    bracketSize: 4,
    inConsolation: false,
    consolationMatch: null,
    losersMatches: null,
    trueFinalsMatch: null,
  };
}

// REGRESSION (Mason 2026-05-04 + anonymous web user 2026-05-05):
// findPlayerNextMatch returned a "next match" object whose `opponent` was
// undefined when the bracket had an undefined slot at the opponent's seed.
// TournamentBracket then crashed at `nextMatch.opponent.name`. Contract:
// findPlayerNextMatch must never return a match descriptor whose `opponent`
// is undefined. If the bracket slot is missing, skip the match.
test('REGRESSION: returns null (or non-undefined opponent) when bracket[opponentSeed] is undefined', () => {
  const tournament = makeTournamentWithUndefinedOpponentSlot();
  const next = findPlayerNextMatch(tournament);
  if (next !== null) {
    assert.notEqual(next.opponent, undefined,
      'findPlayerNextMatch must not return a match with an undefined opponent');
  }
});

test('returns next match when bracket slot is populated', () => {
  const t = makeTournamentWithUndefinedOpponentSlot();
  // Fill the missing slot so the standard path works.
  t.bracket[1] = { name: 'NPC B', stats: { str: 65, spd: 65, tec: 65, end: 65, grt: 65 }, isPlayer: false };
  const next = findPlayerNextMatch(t);
  assert.ok(next, 'expected a next match');
  assert.equal(next.matchIndex, 0);
  assert.equal(next.opponent.name, 'NPC B');
});

test('returns null when player has no unresolved matches', () => {
  const t = makeTournamentWithUndefinedOpponentSlot();
  t.bracket[1] = { name: 'NPC B', stats: { str: 65, spd: 65, tec: 65, end: 65, grt: 65 }, isPlayer: false };
  // Mark player's match as resolved (won).
  t.matches[0].winner = 0;
  // No more matches involve the player at seed 0.
  const next = findPlayerNextMatch(t);
  assert.equal(next, null);
});

// REGRESSION: bracketSize=33 (NCAA D1 IRL) was passed through to the
// power-of-2 branch in buildBracketStructure. Math.log2(33) is non-integer,
// matchesInRound becomes fractional, the for-loop overshoots and emits
// matches that reference seed indices beyond the bracket array. Result: the
// player's first-round match gets an undefined opponent slot ("TBD") that
// never resolves, the Wrestle button never shows, the Begin button can't
// finish the play-in cascade. (Mason 2026-05-05.)
//
// buildBracketStructure must reject unsupported sizes outright. Only 8, 16,
// 24, 32, 64 are supported. Any other size is a data error.
test('REGRESSION: buildBracketStructure throws on non-power-of-2 sizes (e.g. 33)', () => {
  assert.throws(() => buildBracketStructure(33), /unsupported|invalid|bracket/i);
});

test('REGRESSION: buildBracketStructure throws on size 0', () => {
  assert.throws(() => buildBracketStructure(0), /unsupported|invalid|bracket/i);
});

test('REGRESSION: buildBracketStructure throws on negative size', () => {
  assert.throws(() => buildBracketStructure(-1), /unsupported|invalid|bracket/i);
});

test('buildBracketStructure accepts the supported power-of-2 sizes', () => {
  for (const size of [8, 16, 32, 64]) {
    const s = buildBracketStructure(size);
    assert.ok(Array.isArray(s.matches), `size ${size}: matches array`);
    // First-round seeds must reference valid indices [0, size-1].
    for (const m of s.matches.slice(0, size / 2)) {
      const [s1, s2] = m.bracketSlots;
      assert.ok(s1 < size, `size ${size}: seed ${s1} out of range`);
      assert.ok(s2 < size, `size ${size}: seed ${s2} out of range`);
    }
  }
});

test('buildBracketStructure accepts size 24 (24-bracket has play-in support)', () => {
  const s = buildBracketStructure(24);
  assert.ok(Array.isArray(s.matches));
});

// ── isPlayerFirstBracketMatch (Bracket Regular badge gating) ───────────
// Replaces the old roundKey-based detection that fired for every round
// whose key matched [r1, r16, r32, play-in, qf]. In 16/24/32/64 brackets
// the player crossed multiple such rounds in one tournament, inflating
// `tournaments_entered` 2-4x per run.

test('isPlayerFirstBracketMatch: true before any player match resolves', () => {
  const t = {
    playerSeed: 0,
    matches: [
      { bracketSlots: [0, 1], winner: null },
      { bracketSlots: [2, 3], winner: null },
      { bracketSlots: [null, null], winner: null },
    ],
  };
  assert.equal(isPlayerFirstBracketMatch(t), true, 'no resolved player match yet');
});

test('isPlayerFirstBracketMatch: true even when non-player matches are resolved', () => {
  const t = {
    playerSeed: 0,
    matches: [
      { bracketSlots: [0, 1], winner: null },        // player match, unresolved
      { bracketSlots: [2, 3], winner: 0 },           // non-player match, resolved (winner=seed 2)
      { bracketSlots: [null, null], winner: null },
    ],
  };
  assert.equal(isPlayerFirstBracketMatch(t), true, 'resolved non-player matches do not count');
});

test('isPlayerFirstBracketMatch: false after the player\'s first match resolves', () => {
  const t = {
    playerSeed: 0,
    matches: [
      { bracketSlots: [0, 1], winner: 0 },           // player won round 1
      { bracketSlots: [2, 3], winner: 2 },
      { bracketSlots: [null, null], winner: null },
    ],
  };
  assert.equal(isPlayerFirstBracketMatch(t), false, 'one resolved player match disqualifies');
});

test('isPlayerFirstBracketMatch: handles default playerSeed when undefined', () => {
  // Defaults to seed 0. With no resolved matches, returns true.
  const t = {
    matches: [
      { bracketSlots: [0, 1], winner: null },
      { bracketSlots: [2, 3], winner: null },
    ],
  };
  assert.equal(isPlayerFirstBracketMatch(t), true);
});

test('isPlayerFirstBracketMatch: false when player has prior win in earlier round (24-bracket play-in scenario)', () => {
  // 24-bracket player at seed 8: play-in resolved (round 1 win), now in R16.
  // Pre-fix the old roundKey detector saw R16's key === 'r16' and credited
  // tournamentEntered AGAIN, double-counting. Helper says false.
  const t = {
    playerSeed: 8,
    matches: [
      // Play-in matches (8 of them)
      { bracketSlots: [8, 23], winner: 8 },          // player won play-in
      { bracketSlots: [9, 22], winner: 9 },
      // R16 player match (idx 8): seeded 0 vs play-in winner; player propagated in
      ...Array.from({ length: 6 }, (_, i) => ({
        bracketSlots: [i + 2, 21 - i], winner: null,
      })),
      { bracketSlots: [0, 8], winner: null },        // player's R16 match, unresolved
    ],
  };
  assert.equal(isPlayerFirstBracketMatch(t), false, 'play-in already resolved so R16 is NOT first');
});

test('isPlayerFirstBracketMatch: malformed inputs short-circuit to false', () => {
  assert.equal(isPlayerFirstBracketMatch(null), false);
  assert.equal(isPlayerFirstBracketMatch(undefined), false);
  assert.equal(isPlayerFirstBracketMatch({}), false);
  assert.equal(isPlayerFirstBracketMatch({ matches: 'not-array' }), false);
});
