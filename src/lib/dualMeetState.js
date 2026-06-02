// Dual-Meet state machine
//
// Mirrors the tournament state machine but with a straight-line 10-bout format
// and team scoring instead of an elimination bracket. One state object drives
// the DualSetupScreen → bout → DualScoreboard → DualResultScreen loop, and the
// same object is persisted to localStorage so a mid-dual refresh (or app
// suspend) resumes in the correct phase.
//
// This file is intentionally UI-agnostic - everything needed to render the
// scoreboard between bouts or the final screen comes from this state shape.

import { NCAA_WEIGHT_CLASSES, DUAL_BOUT_COUNT } from './ncaaWeights.js';
import { buildPlayerTeam, generateCpuTeam, generateTeamName } from './dualMeetTeams.js';
import { genderForStyle } from './namePools.js';

const STORAGE_KEY = 'matgrind_dual';
const CAREER_STORAGE_KEY = 'matgrind_career_dual';
const EXPIRY_MS = 48 * 60 * 60 * 1000;

/** NCAA folkstyle dual-meet team-point table. */
export const FOLKSTYLE_DUAL_POINTS = {
  decision: { winner: 3, loser: 0 },
  major:    { winner: 4, loser: 0 }, // 8+ point decision
  tech_fall:{ winner: 5, loser: 0 },
  pin:      { winner: 6, loser: 0 },
  forfeit:  { winner: 6, loser: 0 },
  dq:       { winner: 6, loser: 0 },
  draw:     { winner: 2, loser: 2 },
};

/** Given a match result, return folkstyle dual-meet team points. */
export function scoreFolkstyleBout({ winMethod, p1Score, p2Score, playerWon }) {
  const pts = (method) => FOLKSTYLE_DUAL_POINTS[method] || FOLKSTYLE_DUAL_POINTS.decision;
  const margin = Math.abs((p1Score || 0) - (p2Score || 0));

  if (winMethod === 'draw') {
    const p = pts('draw');
    return { player: p.winner, opponent: p.loser, method: 'draw' };
  }
  let method = winMethod;
  // simulateEvent.rollMatchOutcome emits 'major_decision' for 8+ point wins;
  // the engine emits 'major'. Normalize so simulated and engine bouts both
  // credit the major-decision team-point value.
  if (method === 'major_decision') method = 'major';
  if (method === 'tech') method = 'tech_fall';
  // Treat an unmarked 8+ decision as a major decision. The engine emits
  // 'decision' with a wide margin; NCAA folkstyle duals still reward majors.
  if ((method === 'decision' || !method || method === 'overtime') && margin >= 8 && margin < 15) {
    method = 'major';
  }
  if (!FOLKSTYLE_DUAL_POINTS[method]) method = 'decision';
  const p = pts(method);
  if (playerWon) return { player: p.winner, opponent: p.loser, method };
  return { player: p.loser, opponent: p.winner, method };
}

// ─── Creation ────────────────────────────────────────────────────────────────

/**
 * @param {object} profile - wrestler profile { username, stats, appearance }
 * @param {object} cfg
 * @param {number} cfg.heroWeightClass
 * @param {'cpu'|'hotseat'} cfg.mode
 * @param {'easy'|'medium'|'hard'} cfg.difficulty
 * @param {'random'|'predraft'} cfg.lineupMode
 * @param {string} cfg.playerTeamName
 * @param {string} cfg.opponentTeamName
 * @param {Array} [cfg.predraftRoster]  // for 'predraft' lineup mode
 * @param {number[]} [cfg.weights]      // weight-class table (lbs) for the bout list.
 *                                      //   Standalone duals default to NCAA (10 weights).
 *                                      //   Career duals pass NFHS HS (14) or other
 *                                      //   tier-appropriate tables. Stored on the snapshot
 *                                      //   so persistence + advancement use it consistently.
 * @param {string} [cfg.style]          // wrestling style for engine scoring; defaults to folkstyle.
 * @param {'male'|'female'} [cfg.gender] // gender for AI name pools; defaults to male.
 */
export function createDualMeet(profile, cfg) {
  const weights = (Array.isArray(cfg.weights) && cfg.weights.length > 0)
    ? cfg.weights.slice()
    : NCAA_WEIGHT_CLASSES.slice();
  // No silent fallback. Caller is responsible for passing a hero weight that
  // exists in the chosen weights table. Career duals validate this in the
  // bridge module before getting here. Default to the centre weight only when
  // the standalone Dual Meet menu hands us a weight outside its own table.
  const heroWeightClass = weights.includes(cfg.heroWeightClass)
    ? cfg.heroWeightClass
    : (weights[Math.floor(weights.length / 2)] ?? weights[0]);
  const difficulty = cfg.difficulty || 'medium';
  const hero = {
    name: profile?.username || 'You',
    stats: profile?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
    appearance: profile?.appearance || { primaryColor: 'emerald', accentColor: '#059669' },
  };

  // gender drives the AI name pool. Career duals pass it explicitly; the
  // standalone Dual Meet derives it from the chosen wrestling style.
  const gender = cfg.gender || genderForStyle(cfg.style);
  const usedNames = new Set([hero.name]);
  const usedColorIds = hero.appearance.primaryColor ? [hero.appearance.primaryColor] : [];
  // Shared first/last trackers so no first or last name repeats across the
  // whole dual - both teams - not just within one team.
  const usedFirsts = new Set();
  const usedLasts = new Set();

  const playerTeam = buildPlayerTeam(hero, heroWeightClass, difficulty, {
    roster: cfg.lineupMode === 'predraft' ? cfg.predraftRoster || [] : [],
    usedNames,
    usedColorIds,
    usedFirsts,
    usedLasts,
    weights,
    gender,
  });
  // Seed used names with every player-team name before the CPU roster is
  // generated so a CPU wrestler can never duplicate a player-side name.
  for (const w of playerTeam) usedNames.add(w.name);
  const opponentTeam = generateCpuTeam(difficulty, usedNames, usedColorIds, {
    weights, gender, usedFirsts, usedLasts,
  });

  const bouts = weights.map((weight, i) => ({
    weight,
    playerWrestler: playerTeam[i],
    opponentWrestler: opponentTeam[i],
    result: null,             // { playerWon, winMethod, p1Score, p2Score, teamPointsAwarded }
    teamPointsAwarded: null,  // { player, opponent, method }
  }));

  const playerTeamName = (cfg.playerTeamName || '').trim() || 'Your Team';
  const opponentTeamName = (cfg.opponentTeamName || '').trim() || generateTeamName(playerTeamName);

  return {
    phase: 'bout',              // 'lineup' | 'bout' | 'between' | 'complete'
    mode: cfg.mode || 'cpu',    // 'cpu' | 'hotseat'
    difficulty,
    wrestlingStyle: cfg.style || 'folkstyle',
    weights,
    heroWeightClass,
    lineupMode: cfg.lineupMode || 'random',
    playerTeamName,
    opponentTeamName,
    playerTeam,
    opponentTeam,
    bouts,
    currentBoutIndex: 0,
    teamScore: { player: 0, opponent: 0 },
    createdAt: Date.now(),
    savedAt: Date.now(),
  };
}

// ─── Advancement ─────────────────────────────────────────────────────────────

/**
 * Record a bout result, credit team points, and transition phase.
 *
 * @param {object} dual
 * @param {{playerWon:boolean, winMethod:string, p1Score:number, p2Score:number}} result
 * @returns {object} updated dual (same reference - mutated in place, then returned)
 */
export function advanceDualBout(dual, result) {
  if (!dual || dual.phase === 'complete') return dual;
  const idx = dual.currentBoutIndex;
  if (idx < 0 || idx >= dual.bouts.length) return dual;

  const bout = dual.bouts[idx];
  const teamPoints = scoreFolkstyleBout(result);
  bout.result = {
    playerWon: !!result.playerWon,
    isDraw: result.winMethod === 'draw',
    winMethod: result.winMethod || 'decision',
    p1Score: result.p1Score ?? 0,
    p2Score: result.p2Score ?? 0,
  };
  bout.teamPointsAwarded = teamPoints;
  dual.teamScore.player += teamPoints.player;
  dual.teamScore.opponent += teamPoints.opponent;

  // Use dual.bouts.length, not the NCAA-anchored DUAL_BOUT_COUNT, so HS
  // (14-bout) and other tier-specific tables advance past the right index.
  if (idx + 1 >= dual.bouts.length) {
    dual.phase = 'complete';
  } else {
    dual.currentBoutIndex = idx + 1;
    dual.phase = 'between';
  }
  dual.savedAt = Date.now();
  return dual;
}

/** Advance from 'between' back into the next bout. */
export function startNextBout(dual) {
  if (!dual || dual.phase !== 'between') return dual;
  dual.phase = 'bout';
  dual.savedAt = Date.now();
  return dual;
}

/** True once the dual is mathematically out of reach for either side. */
export function isClinched(dual) {
  if (!dual) return false;
  const totalBouts = dual.bouts?.length ?? DUAL_BOUT_COUNT;
  const remainingBouts = totalBouts - (dual.currentBoutIndex ?? 0);
  if (remainingBouts <= 0) return true;
  const maxSwing = remainingBouts * FOLKSTYLE_DUAL_POINTS.pin.winner; // 6 pts each
  return Math.abs(dual.teamScore.player - dual.teamScore.opponent) > maxSwing;
}

/** Winner once a dual has completed. 'draw' if team scores are equal. */
export function getDualWinner(dual) {
  if (!dual) return null;
  if (dual.teamScore.player > dual.teamScore.opponent) return 'player';
  if (dual.teamScore.opponent > dual.teamScore.player) return 'opponent';
  return 'draw';
}

// ─── Bonus XP for dual completion ────────────────────────────────────────────

/**
 * XP awarded to the profile at dual-meet completion. Credit in addition to the
 * per-bout XP already granted by the normal match-end flow.
 *   Completion bonus: +150 XP
 *   Victory bonus:    +150 XP on top (total +300 for a win)
 * Hotseat duals skip the profile XP entirely (local fun, no stakes).
 */
export function getDualMeetXPBonus(dual) {
  if (!dual || dual.phase !== 'complete' || dual.mode !== 'cpu') return 0;
  const won = getDualWinner(dual) === 'player';
  return 150 + (won ? 150 : 0);
}

/** Breakdown for the result screen - same total as getDualMeetXPBonus. */
export function getDualMeetXPBreakdown(dual) {
  if (!dual || dual.phase !== 'complete' || dual.mode !== 'cpu') return [];
  const items = [{ label: 'Dual meet complete', xp: 150 }];
  if (getDualWinner(dual) === 'player') {
    items.push({ label: 'Dual meet victory 🏆', xp: 150 });
  }
  return items;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function writeDual(key, dual) {
  if (!dual) return;
  try {
    localStorage.setItem(key, JSON.stringify({ ...dual, savedAt: Date.now() }));
  } catch (e) {
    // Storage quota or disabled - not fatal
    console.warn('[DualMeet] save error:', e);
  }
}

function readDual(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const ts = data.savedAt || data.createdAt || 0;
    if (Date.now() - ts > EXPIRY_MS) {
      try { localStorage.removeItem(key); } catch (_e) { /* ignore */ }
      return null;
    }
    return data;
  } catch (_e) {
    return null;
  }
}

function dropDual(key) {
  try { localStorage.removeItem(key); } catch (_e) { /* ignore */ }
}

// Standalone Dual Meet (game mode menu) persistence. Career duals MUST NOT
// touch this key, otherwise a player with a standalone dual in flight would
// have it overwritten when their career dual starts.
export function saveDual(dual) { writeDual(STORAGE_KEY, dual); }
export function loadDual() { return readDual(STORAGE_KEY); }
export function clearDual() { dropDual(STORAGE_KEY); }

// Career-mode dual persistence. Hardwired to a separate localStorage key so
// the standalone and career dual snapshots cannot collide.
export function saveCareerDual(dual) { writeDual(CAREER_STORAGE_KEY, dual); }
export function loadCareerDual() { return readDual(CAREER_STORAGE_KEY); }
export function clearCareerDual() { dropDual(CAREER_STORAGE_KEY); }

// Exported so tests can assert exact key names without re-importing the
// constants under a different alias.
export const DUAL_STORAGE_KEYS = {
  standalone: STORAGE_KEY,
  career: CAREER_STORAGE_KEY,
};

// ─── Gating ──────────────────────────────────────────────────────────────────

/**
 * Dual Meets is gated until the player has completed at least one exhibition
 * match - keeps brand-new users from bouncing off a 10-bout grind cold.
 * Returns { eligible: boolean, reason?: string }.
 */
export function canStartDualMeet(_profile) {
  // Dual Meets are available to everyone. The prior "play 1 exhibition
  // first" gate was glitched (some profiles never accrue matches_played)
  // and blocked new users from starting their first Dual. The profile
  // arg is kept for future gating hooks (e.g. per-style unlocks).
  return { eligible: true };
}
