// ─── Tournament Scoring ─────────────────────────────────────────────────
//
// Pure, deterministic helpers for placement + points. Kept as its own
// module so it's test-friendly without pulling in Firebase / React.
//
// Placement uses the traditional bracket convention:
//   1 = champion
//   2 = finalist (lost finals)
//   3 = semifinalist (lost semis, both tied at 3)
//   5 = quarterfinalist (lost QFs, 4-way tie at 5)
//   9 = lost round-of-16 (8-way tie)
//  17 = lost round-of-32 (16-way tie)
//
// Formula: eliminated after winning `roundsWon` out of `playerRoundsToWin`
// → placement = 2^(remaining - 1) + 1, where remaining = playerRoundsToWin - roundsWon.
//
// `playerRoundsToWin` (not `totalRounds`) is the right denominator for the
// 24-bracket, where seeds 0-7 get a bye through the play-in round. Using
// totalRounds would mis-rank the player's slot by one round.

/** Placement base points (higher = better finish). */
export const PLACEMENT_POINTS = {
  1: 100,
  2: 50,
  3: 25,
  5: 10,
  9: 5,
  17: 3,
  33: 2,    // lost R64  (32-way tie) - introduced with the 64-man bracket
  65: 1.5,  // lost R128 (64-way tie) - introduced with the 128-man bracket
};

/** Default base when a placement isn't explicitly mapped (deep-elimination safety net). */
export const PLACEMENT_POINTS_DEFAULT = 1;

/** Bracket-size multiplier - bigger brackets earn more per placement. */
export const BRACKET_MULTIPLIERS = {
  8: 1.0,
  16: 1.25,
  24: 1.5,
  32: 1.75,
  64: 2.0,
  128: 2.25,
};

/** Difficulty multiplier - harder AI earns more per placement. */
export const DIFFICULTY_MULTIPLIERS = {
  easy: 0.75,
  medium: 1.0,
  hard: 1.5,
};

/**
 * Compute bracket placement (1, 2, 3, 5, 9, 17, …) from the end-of-tournament
 * snapshot. If `playerRoundsToWin` is missing, falls back to log2(bracketSize).
 *
 * @param {object} args
 * @param {boolean} args.playerEliminated
 * @param {number} args.roundsWon
 * @param {number} [args.playerRoundsToWin]  - preferred; handles 24-bracket byes
 * @param {number} [args.bracketSize]        - fallback denominator
 * @returns {number} placement (1 = champion)
 */
export function computePlacement({ playerEliminated, roundsWon, playerRoundsToWin, bracketSize }) {
  if (!playerEliminated) return 1;
  const toWin = (typeof playerRoundsToWin === 'number' && playerRoundsToWin > 0)
    ? playerRoundsToWin
    : (bracketSize ? Math.ceil(Math.log2(bracketSize)) : 3);
  const remaining = toWin - (roundsWon || 0);
  // `remaining <= 0` AND eliminated means the player completed every
  // required round but still got eliminated - the only path that produces
  // this in consolation / double_elim is losing the true-finals match
  // after sweeping the winner bracket. Finalist = placement 2, not 1.
  if (remaining <= 0) return 2;
  return Math.pow(2, remaining - 1) + 1;
}

/**
 * Compute points earned for a single tournament result.
 *
 *   points = round(placement_base × bracket_multiplier × difficulty_multiplier)
 *
 * Unknown bracket/difficulty keys fall back to 1.0 multipliers so future bracket
 * sizes or difficulty names don't zero-out the score.
 *
 * @param {object} args
 * @param {number} args.placement
 * @param {number} args.bracketSize
 * @param {string} args.difficulty
 * @returns {number} points (integer, ≥ 1)
 */
export function computeTournamentPoints({ placement, bracketSize, difficulty }) {
  const base = PLACEMENT_POINTS[placement] ?? PLACEMENT_POINTS_DEFAULT;
  const bracketMult = BRACKET_MULTIPLIERS[bracketSize] ?? 1.0;
  const diffMult = DIFFICULTY_MULTIPLIERS[difficulty] ?? 1.0;
  return Math.max(1, Math.round(base * bracketMult * diffMult));
}
