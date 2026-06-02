// Tournament scoring tests - pure functions, no Firebase deps.
// Run with: node --test src/lib/tournamentScoring.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  computePlacement,
  computeTournamentPoints,
  PLACEMENT_POINTS,
  BRACKET_MULTIPLIERS,
  DIFFICULTY_MULTIPLIERS,
} = await import('./tournamentScoring.js');

// ─── computePlacement ──────────────────────────────────────────────────

test('computePlacement: non-eliminated player is the champion', () => {
  assert.equal(
    computePlacement({ playerEliminated: false, roundsWon: 3, playerRoundsToWin: 3 }),
    1,
  );
  // Even with 0 rounds won, if not eliminated (fresh tournament?), defaults to champion.
  assert.equal(
    computePlacement({ playerEliminated: false, roundsWon: 0, playerRoundsToWin: 3 }),
    1,
  );
});

test('computePlacement: 8-bracket - lost finals → 2, semis → 3, QFs → 5', () => {
  const toWin = 3;
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 2, playerRoundsToWin: toWin }), 2);
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 1, playerRoundsToWin: toWin }), 3);
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 0, playerRoundsToWin: toWin }), 5);
});

test('computePlacement: 16-bracket - R16 loss → 9', () => {
  const toWin = 4;
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 3, playerRoundsToWin: toWin }), 2);
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 2, playerRoundsToWin: toWin }), 3);
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 1, playerRoundsToWin: toWin }), 5);
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 0, playerRoundsToWin: toWin }), 9);
});

test('computePlacement: 32-bracket - R32 loss → 17', () => {
  const toWin = 5;
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 0, playerRoundsToWin: toWin }), 17);
  assert.equal(computePlacement({ playerEliminated: true, roundsWon: 1, playerRoundsToWin: toWin }), 9);
});

test('computePlacement: 24-bracket uses playerRoundsToWin=4 (bye through play-in)', () => {
  // In the 24-bracket, seeded players skip the play-in round; playerRoundsToWin=4.
  // A loss with 0 rounds won should be R16 (9), not R32 (17).
  assert.equal(
    computePlacement({ playerEliminated: true, roundsWon: 0, playerRoundsToWin: 4 }),
    9,
  );
});

test('computePlacement: falls back to bracketSize when playerRoundsToWin is missing', () => {
  assert.equal(
    computePlacement({ playerEliminated: true, roundsWon: 0, bracketSize: 8 }),
    5, // log2(8) = 3 → 2^2 + 1 = 5
  );
});

// ─── computeTournamentPoints ───────────────────────────────────────────

test('computeTournamentPoints: 8-bracket medium champion = 100', () => {
  const pts = computeTournamentPoints({ placement: 1, bracketSize: 8, difficulty: 'medium' });
  assert.equal(pts, 100);
});

test('computeTournamentPoints: 32-bracket hard champion = 263', () => {
  // 100 × 1.75 × 1.5 = 262.5 → 263
  const pts = computeTournamentPoints({ placement: 1, bracketSize: 32, difficulty: 'hard' });
  assert.equal(pts, 263);
});

test('computeTournamentPoints: 8-bracket easy 5th-place = 8', () => {
  // 10 × 1.0 × 0.75 = 7.5 → 8
  const pts = computeTournamentPoints({ placement: 5, bracketSize: 8, difficulty: 'easy' });
  assert.equal(pts, 8);
});

test('computeTournamentPoints: harder difficulty > easier for same result', () => {
  const easy = computeTournamentPoints({ placement: 3, bracketSize: 16, difficulty: 'easy' });
  const medium = computeTournamentPoints({ placement: 3, bracketSize: 16, difficulty: 'medium' });
  const hard = computeTournamentPoints({ placement: 3, bracketSize: 16, difficulty: 'hard' });
  assert.ok(easy < medium, `easy(${easy}) should be < medium(${medium})`);
  assert.ok(medium < hard, `medium(${medium}) should be < hard(${hard})`);
});

test('computeTournamentPoints: larger bracket > smaller bracket for same result', () => {
  const b8  = computeTournamentPoints({ placement: 1, bracketSize: 8,  difficulty: 'medium' });
  const b16 = computeTournamentPoints({ placement: 1, bracketSize: 16, difficulty: 'medium' });
  const b32 = computeTournamentPoints({ placement: 1, bracketSize: 32, difficulty: 'medium' });
  assert.ok(b8 < b16, `8(${b8}) should be < 16(${b16})`);
  assert.ok(b16 < b32, `16(${b16}) should be < 32(${b32})`);
});

test('computeTournamentPoints: better placement > worse placement for same bracket+difficulty', () => {
  const conf = { bracketSize: 16, difficulty: 'medium' };
  const first  = computeTournamentPoints({ ...conf, placement: 1 });
  const second = computeTournamentPoints({ ...conf, placement: 2 });
  const third  = computeTournamentPoints({ ...conf, placement: 3 });
  const r16    = computeTournamentPoints({ ...conf, placement: 9 });
  assert.ok(first > second);
  assert.ok(second > third);
  assert.ok(third > r16);
});

test('computeTournamentPoints: unknown keys fall back to 1.0× (no zero)', () => {
  // 64 is now mapped (introduced with the 64-man bracket); use 999 as the
  // "will never be a real bracket size" sentinel instead.
  const unknownBracket = computeTournamentPoints({ placement: 1, bracketSize: 999, difficulty: 'medium' });
  const unknownDiff = computeTournamentPoints({ placement: 1, bracketSize: 8, difficulty: 'impossible' });
  assert.equal(unknownBracket, 100, 'unknown bracket should use 1.0×');
  assert.equal(unknownDiff, 100, 'unknown difficulty should use 1.0×');
});

test('computeTournamentPoints: unmapped placement gets the safety-net base', () => {
  // placement = 33 (R64 loss) and 65 (R128 loss) are both now mapped.
  // Use 129 ("theoretical R256 loss") as the unreachable-but-semantic
  // sentinel - 256 isn't in the bracket allowlist so 129 stays unmapped.
  const pts = computeTournamentPoints({ placement: 129, bracketSize: 32, difficulty: 'medium' });
  assert.ok(pts >= 1, 'safety net must prevent zero/negative scores');
});

test('computeTournamentPoints: always returns a positive integer', () => {
  for (const placement of [1, 2, 3, 5, 9, 17, 33, 65, 129]) {
    for (const bracketSize of [8, 16, 24, 32, 64, 128]) {
      for (const difficulty of ['easy', 'medium', 'hard', 'nightmare']) {
        const pts = computeTournamentPoints({ placement, bracketSize, difficulty });
        assert.ok(Number.isInteger(pts), `${placement}/${bracketSize}/${difficulty} not integer: ${pts}`);
        assert.ok(pts >= 1, `${placement}/${bracketSize}/${difficulty} < 1: ${pts}`);
      }
    }
  }
});

test('computePlacement: R64 elimination resolves to placement 33', () => {
  // 64-man bracket: 6 rounds to win. Losing R1 = roundsWon 0 / 6 remaining
  // → 2^(6-1) + 1 = 33.
  assert.equal(
    computePlacement({ playerEliminated: true, roundsWon: 0, playerRoundsToWin: 6 }),
    33,
  );
});

test('computePlacement: R128 elimination resolves to placement 65', () => {
  // 128-man bracket: 7 rounds to win. Losing R1 = roundsWon 0 / 7 remaining
  // → 2^(7-1) + 1 = 65.
  assert.equal(
    computePlacement({ playerEliminated: true, roundsWon: 0, playerRoundsToWin: 7 }),
    65,
  );
});

test('computePlacement: eliminated with remaining <= 0 = lost true finals = placement 2', () => {
  // This is the consolation / double_elim "WB champ loses true finals"
  // path. Player went undefeated through the WB (roundsWon === toWin),
  // then lost the true-finals match to the LB champion. They are eliminated
  // but the formula's `remaining = toWin - roundsWon` is 0. The defensive
  // branch must return 2 (finalist), not 1 (would be co-champion).
  for (const rounds of [3, 5, 6, 7]) {
    assert.equal(
      computePlacement({ playerEliminated: true, roundsWon: rounds, playerRoundsToWin: rounds }),
      2,
      `lost true finals after ${rounds} required wins must be placement 2`,
    );
  }
  // Negative remaining (defensive against future code that double-increments
  // roundsWon on a true-finals loss) must also clamp to placement 2.
  assert.equal(
    computePlacement({ playerEliminated: true, roundsWon: 8, playerRoundsToWin: 7 }),
    2,
  );
});

// ─── Constants sanity ─────────────────────────────────────────────────

test('constants: champion base > all other placements', () => {
  const championBase = PLACEMENT_POINTS[1];
  for (const [placement, base] of Object.entries(PLACEMENT_POINTS)) {
    if (Number(placement) === 1) continue;
    assert.ok(base < championBase, `placement ${placement} base ${base} should be < champion ${championBase}`);
  }
});

test('constants: bracket multipliers are monotonic with size', () => {
  const sizes = Object.keys(BRACKET_MULTIPLIERS).map(Number).sort((a, b) => a - b);
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(
      BRACKET_MULTIPLIERS[sizes[i]] > BRACKET_MULTIPLIERS[sizes[i - 1]],
      `bracket ${sizes[i]} multiplier should exceed ${sizes[i - 1]}`,
    );
  }
});

test('constants: difficulty multipliers ordered easy < medium < hard', () => {
  assert.ok(DIFFICULTY_MULTIPLIERS.easy < DIFFICULTY_MULTIPLIERS.medium);
  assert.ok(DIFFICULTY_MULTIPLIERS.medium < DIFFICULTY_MULTIPLIERS.hard);
});
