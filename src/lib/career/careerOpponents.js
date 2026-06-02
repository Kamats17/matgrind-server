// ─── Career Opponents - Difficulty Mapping ───────────────────────────────────
// Maps an opponent's overall rating to an AI difficulty preset. The previous
// system hardcoded difficulty by event type ('medium' for everything except
// championships), which meant a 50-overall walkover and an 85-overall state
// finalist played at the same level.
//
// Mapping is intentionally a *small* boost - most matches are still winnable,
// but state finals and top-seeded rivals genuinely feel real.

/**
 * Pick AI difficulty preset for an opponent based on their overall rating.
 * @param {number} overall - opponent's overall (0-100)
 * @returns {'easy' | 'medium' | 'hard' | 'expert'}
 */
export function pickDifficultyForOverall(overall) {
  const o = typeof overall === 'number' ? overall : 60;
  if (o < 55) return 'easy';
  if (o < 75) return 'medium';   // covers 55-74; 'medium' is the default for solid opponents
  if (o < 85) return 'hard';     // 75-84 = top of section / lower state-ranked
  return 'expert';               // 85+ = state finalists, #1 rivals
}

/**
 * Compute the average overall of a wrestler's stat block. Falls back to 60
 * when stats are missing - same default the engine uses.
 * @param {{ str?: number, spd?: number, tec?: number, end?: number, grt?: number } | null | undefined} stats
 */
export function computeOverallFromStats(stats) {
  if (!stats) return 60;
  const { str = 60, spd = 60, tec = 60, end = 60, grt = 60 } = stats;
  return Math.round((str + spd + tec + end + grt) / 5);
}
