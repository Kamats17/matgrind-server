// ─── Career Mode - Leveling ──────────────────────────────────────────────────
// Career XP / level / skill-point system.
//
// Career level is deliberately SEPARATE from the global profile level
// (profileUtils.computeXP). The global level is an account-wide meta stat
// that accumulates across every mode the user plays; career level is
// per-career and resets when the user retires and starts a new career.
// Mixing them would mean a retired-champion's first HS Freshman career
// starts at level 80 and can instantly unlock everything, destroying the
// progression arc the user explicitly asked for.
//
// Curve target:
//   HS frosh end      (~20 matches):  ~level  5
//   HS senior end     (~80 matches):  ~level 20-25
//   College end       (~200 matches): ~level 45-55
//   Full 12-yr arc    (~300 matches): ~level 60-65
// At ~1 skill point per level, a complete career earns ~60 pts.
// The tree's full-unlock cost is ~130, so the player unlocks roughly
// half - forcing branch focus and supporting replay.

// ─── XP curve ───────────────────────────────────────────────────────────────
//
// Triangular-number curve: level N requires 100 * N * (N+1) / 2 total XP.
//   L1 = 0       (you start at 1)
//   L2 = 200
//   L5 = 1500
//   L10 = 5500
//   L30 = 46500
//   L55 = 154000
//   L65 = 214500
//
// Monotonic + cheap to compute in both directions. No JSON table needed.

const XP_CURVE_COEFF = 100; // tweakable - scales total XP required

export function xpForLevel(level) {
  if (level <= 1) return 0;
  return XP_CURVE_COEFF * ((level * (level + 1)) / 2) - XP_CURVE_COEFF;
}

/**
 * Inverse: given total XP, return { level, xpIntoLevel, xpForNext }.
 *
 * 2026-05-06: cap removed. Career level climbs indefinitely for prestige
 * once the skill tree is fully unlocked (~mid-60s). Skill points keep
 * accruing into pointsAvailable but typically have nothing to spend on -
 * intentional. UI gates a "Prestige" pill on level > 99 and otherwise
 * renders unbounded.
 *
 * MAX_CAREER_LEVEL retained as an exported constant pinned at 99 so
 * callers that want the "soft cap" (e.g. dashboard prestige badge gate)
 * have a stable reference. It is no longer used by computeCareerLevel.
 */
export const MAX_CAREER_LEVEL = 99;

export function computeCareerLevel(totalXp) {
  if (!totalXp || totalXp <= 0) {
    return { level: 1, xpIntoLevel: 0, xpForNext: xpForLevel(2) };
  }
  // Small closed-form inverse of the triangular curve - plenty fast
  // enough for a per-event call, and we'd do this once per match.
  // We just walk up until the threshold exceeds totalXp. The triangular
  // sum grows quadratically, so even absurd XP values resolve in O(sqrt)
  // iterations - 1 billion XP -> level ~4000 -> ~4000 loop iterations.
  let level = 1;
  while (xpForLevel(level + 1) <= totalXp) {
    level++;
  }
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return {
    level,
    xpIntoLevel: totalXp - floor,
    xpForNext: Math.max(0, ceil - totalXp),
  };
}

// ─── XP sources ─────────────────────────────────────────────────────────────

const BASE_WIN_XP = 80;
const BASE_LOSS_XP = 30;
const WIN_METHOD_BONUS = {
  pin: 40,
  tech: 25,
  major: 15,
  // decision / forfeit / default: 0
};

const PLACEMENT_XP = {
  1: 200,
  2: 140,
  3: 90,
  4: 60,
};
const PLACEMENT_PARTICIPATION_XP = 30; // any non-top-4 placement

const CHAMPIONSHIP_TITLE_BONUS = 300;
const SEASON_COMPLETION_BONUS = 150;

/**
 * XP for a single event result. `event.type` comes from careerSchedule.js
 * ('dual' | 'dual_meet' | 'tournament' | 'championship' | 'invitational').
 *
 * @param {object} result
 * @param {boolean} result.playerWon
 * @param {string}  [result.winMethod]   'decision'|'pin'|'tech'|'major'
 * @param {number}  [result.placement]   1-based; 1 = won tournament
 * @param {string}  [eventType]          'dual'|'dual_meet'|'tournament'|'championship'|'invitational'
 */
export function xpForEventResult(result, eventType = 'dual') {
  if (!result) return 0;
  // 'dual_meet' is the team-format career dual; XP is computed from the
  // hero-bout result and matches the legacy single-match 'dual' XP curve.
  // Listed explicitly so a future refactor that adds a 'dual'-only branch
  // does not silently regress dual_meet XP.
  const baseEventType = eventType === 'dual_meet' ? 'dual' : eventType;
  let xp = result.playerWon ? BASE_WIN_XP : BASE_LOSS_XP;

  if (result.playerWon && result.winMethod) {
    xp += WIN_METHOD_BONUS[result.winMethod] || 0;
  }

  // Tournaments / championships add a placement component on top
  // of the base win/loss from the final match.
  if (
    (baseEventType === 'tournament' || baseEventType === 'championship') &&
    typeof result.placement === 'number'
  ) {
    xp += PLACEMENT_XP[result.placement] ?? PLACEMENT_PARTICIPATION_XP;
    if (baseEventType === 'championship' && result.placement === 1) {
      xp += CHAMPIONSHIP_TITLE_BONUS;
    }
  }

  return xp;
}

export function seasonCompletionXp() {
  return SEASON_COMPLETION_BONUS;
}

// ─── Applying XP to a wrestler ───────────────────────────────────────────────

/**
 * Pure helper: add XP to a wrestler's totals, roll level, and grant one
 * skill point per level gained. Returns a NEW wrestler object - never
 * mutates input. `leveledUp` and `skillPointsGained` are reported for
 * UI animation.
 *
 * @param {object} wrestler
 * @param {number} xpGained
 * @returns {{ wrestler: object, leveledUp: boolean, skillPointsGained: number }}
 */
export function applyXpToWrestler(wrestler, xpGained) {
  if (!wrestler) {
    return { wrestler, leveledUp: false, skillPointsGained: 0 };
  }
  const prevXp = wrestler.xp || 0;
  const prevLevel = wrestler.level || computeCareerLevel(prevXp).level;
  const nextXp = Math.max(0, prevXp + (xpGained | 0));
  const { level: nextLevel } = computeCareerLevel(nextXp);
  const gained = Math.max(0, nextLevel - prevLevel);

  const skillTree = wrestler.skillTree || { unlockedNodes: [], pointsAvailable: 0, focus: null };

  return {
    wrestler: {
      ...wrestler,
      xp: nextXp,
      level: nextLevel,
      skillTree: {
        ...skillTree,
        pointsAvailable: (skillTree.pointsAvailable || 0) + gained,
      },
    },
    leveledUp: gained > 0,
    skillPointsGained: gained,
  };
}

// ─── Exports for tests / tuning ─────────────────────────────────────────────

export const XP_CONSTANTS = {
  BASE_WIN_XP,
  BASE_LOSS_XP,
  WIN_METHOD_BONUS,
  PLACEMENT_XP,
  PLACEMENT_PARTICIPATION_XP,
  CHAMPIONSHIP_TITLE_BONUS,
  SEASON_COMPLETION_BONUS,
  XP_CURVE_COEFF,
};
