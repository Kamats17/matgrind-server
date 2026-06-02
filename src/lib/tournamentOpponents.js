// ─── Tournament Opponent Generation ──────────────────────────────────────────
import { COLOR_PRESETS, getRandomColor } from './wrestlerColors.js';
import { generateEventNames } from './namePools.js';

// Stat budget by round + difficulty (total stat points across 5 attributes).
//
// The spread between tiers used to be shallow (≈30 points from easy→hard at
// the qf tier), which meant an "easy" opponent still averaged ~50 per stat -
// close enough to a default profile (60 avg) that players reported easy
// feeling as grueling as hard, and hard feeling soft. The widened curve
// below targets roughly 40/57/71 stats per attribute at the qf tier so the
// gap is actually felt across 10 bouts of a dual.
const STAT_BUDGETS = {
  easy:   { r128: 130, r64: 150, r32: 170, r16: 190, qf: 210, sf: 225, finals: 240 },
  medium: { r128: 200, r64: 225, r32: 250, r16: 270, qf: 285, sf: 300, finals: 315 },
  hard:   { r128: 260, r64: 290, r32: 320, r16: 340, qf: 355, sf: 370, finals: 400 },
};

// Archetype templates - distribution ratios across STR/SPD/TEC/END/GRT
const ARCHETYPES = [
  { name: 'Power',     ratios: [0.28, 0.14, 0.18, 0.18, 0.22] },
  { name: 'Speed',     ratios: [0.14, 0.28, 0.22, 0.20, 0.16] },
  { name: 'Technical', ratios: [0.16, 0.18, 0.28, 0.20, 0.18] },
  { name: 'Balanced',  ratios: [0.20, 0.20, 0.20, 0.20, 0.20] },
  { name: 'Grinder',   ratios: [0.18, 0.16, 0.18, 0.26, 0.22] },
];

const STAT_KEYS = ['str', 'spd', 'tec', 'end', 'grt'];

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Generate stats for an opponent based on round and difficulty.
 * @param {'r128'|'r64'|'r32'|'r16'|'qf'|'sf'|'finals'} round
 * @param {'easy'|'medium'|'hard'|'expert'} difficulty
 * @returns {{ str: number, spd: number, tec: number, end: number, grt: number }}
 */
function generateStats(round, difficulty) {
  const budget = STAT_BUDGETS[difficulty]?.[round] || 270;
  const archetype = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];

  /** @type {{ str: number, spd: number, tec: number, end: number, grt: number }} */
  const stats = { str: 0, spd: 0, tec: 0, end: 0, grt: 0 };
  STAT_KEYS.forEach((key, i) => {
    const base = Math.round(budget * archetype.ratios[i]);
    const jitter = Math.floor(Math.random() * 11) - 5; // ±5
    stats[key] = clamp(base + jitter, 30, 85);
  });

  return stats;
}

/**
 * Generate a single tournament opponent.
 * @param {'r128'|'r64'|'r32'|'r16'|'qf'|'sf'|'finals'} round
 * @param {'easy'|'medium'|'hard'|'expert'} difficulty
 * @param {Set<string>} usedNames
 * @param {string[]} usedColorIds
 * @param {{ gender?: 'male'|'female', name?: string }} [opts] - `name` reuses a
 *   pre-generated name (batch generation); omit it to generate one here.
 * @returns {{ name: string, stats: object, appearance: { primaryColor: string, accentColor: string } }}
 */
export function generateOpponent(round, difficulty, usedNames, usedColorIds = [], opts = {}) {
  const name = opts.name || generateEventNames({ count: 1, gender: opts.gender, used: usedNames })[0];
  const stats = generateStats(round, difficulty);
  const color = getRandomColor(usedColorIds);
  usedColorIds.push(color.id);

  return {
    name,
    stats,
    appearance: { primaryColor: color.id, accentColor: color.dark },
  };
}

/**
 * Generate a bracket of wrestlers.
 * Index 0 = player, rest = CPU opponents.
 * @param {string} playerName
 * @param {object} playerStats
 * @param {object|null} playerAppearance
 * @param {'easy'|'medium'|'hard'|'expert'} difficulty
 * @param {number} bracketSize - 8, 16, 24, 32, 64, or 128
 * @param {{ gender?: 'male'|'female' }} [opts]
 * @returns {Array<{ name: string, stats: object, appearance: object, isPlayer: boolean }>}
 */
export function generateBracket(playerName, playerStats, playerAppearance, difficulty, bracketSize = 8, opts = {}) {
  const usedNames = new Set([playerName]);
  const playerColorId = playerAppearance?.primaryColor || 'emerald';
  const usedColorIds = [playerColorId];

  const bracket = [{
    name: playerName,
    stats: playerStats,
    appearance: playerAppearance || { primaryColor: 'emerald', accentColor: '#059669' },
    isPlayer: true,
  }];

  const opponentCount = bracketSize - 1;
  // Generate the whole opponent field at once so first/last names are
  // de-collided across the entire bracket, not just against the player.
  const names = generateEventNames({ count: opponentCount, gender: opts.gender, used: usedNames });
  for (let i = 0; i < opponentCount; i++) {
    const opp = generateOpponent('qf', difficulty, usedNames, usedColorIds, { gender: opts.gender, name: names[i] });
    bracket.push({ ...opp, isPlayer: false });
  }

  return bracket;
}
