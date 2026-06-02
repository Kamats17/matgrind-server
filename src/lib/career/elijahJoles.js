// ─── Elijah Joles Featured-Wrestler Partnership ─────────────────────────────
//
// Real wrestler Elijah Joles (15, Tennessee, 165 lb) partnered with MatGrind
// through end of 2026. He gave permission to use his name, likeness, logo,
// slogan, photos, and bio creatively in-app.
//
// This module is the single source of truth for:
//   - stable special-NPC id
//   - per-tier stat blocks (non-flat - first special NPC with a skewed
//     stat profile; the spd/end gap is his "funky/unorthodox" fingerprint)
//   - adaptive boss-challenge overall (scales to player level + boss wins)
//   - trash-talk lines (opponentDialogue.js reads from here)
//   - AI style-bonus map (engine reads from here in getAICard)
//   - PARTNERSHIP_ACTIVE toggle - flip to retire the partnership
//
// MALE-CAREER ONLY. He is never injected into the women's pool or seeded
// into women's-freestyle career events. The new cards (cow_catcher,
// foot_sweep, surfboard) are universal across styles - their availability
// to women's freestyle is governed by each card's `styles` array, not by
// this module.

// Stable id - matches the existing 'special_<snake_name>' pattern used by
// SPECIAL_AI_WRESTLER_IDS in careerRankings.js.
export const ELIJAH_JOLES_ID = 'special_elijah_joles';

// Flip to false to retire the partnership. Gates:
//   - <ElijahBanner /> render (returns null)
//   - /#elijah route entry (graceful retirement notice)
//   - Career pool injection on new careers (existing careers keep him)
//   - Career schedule seeding on new careers
//   - Dialogue surfacing (getOpponentLine returns null)
// Existing badges/saves remain regardless.
export const PARTNERSHIP_ACTIVE = true;

// Non-flat per-tier stat blocks. Speed/Technique high, Endurance lower -
// matches Elijah's self-description (funky/unorthodox, fast, low stamina).
// Overalls: HS 76 (hard), College 85 (expert), Senior 92 (expert) -
// all below Chase Kamats (80/90/99) so Chase remains the canonical #1.
export const ELIJAH_JOLES_TIER_STATS = {
  hs:      { str: 72, spd: 82, tec: 80, end: 68, grt: 79 },
  college: { str: 82, spd: 90, tec: 88, end: 76, grt: 87 },
  senior:  { str: 90, spd: 96, tec: 94, end: 84, grt: 95 },
};

function avgStats(s) {
  return Math.round((s.str + s.spd + s.tec + s.end + s.grt) / 5);
}

/**
 * Build Elijah's canonical opponent shape for the male ranking pool.
 * Shape mirrors buildSpecialAiWrestlers entries in careerRankings.js so the
 * pool injection / bracket-builder path treats him like any other special NPC.
 *
 * @param {{ weightClass?: number, tier?: string, style?: string, scope?: string }} [opts]
 */
export function buildElijahJolesNpc({ weightClass, tier = 'hs', style = 'freestyle', scope = 'conference' } = {}) {
  const stats = ELIJAH_JOLES_TIER_STATS[tier] || ELIJAH_JOLES_TIER_STATS.hs;
  return {
    id: ELIJAH_JOLES_ID,
    name: 'Elijah Joles',
    school: 'Station Camp HS',
    state: 'TN',
    weightClass,
    style,
    tier,
    scope,
    stats: { ...stats },
    overall: avgStats(stats),
    h2h: { wins: 0, losses: 0, pins: 0, lastMeeting: null },
    wins: 0,
    losses: 0,
    isSpecial: true,
    featured: true,
    appearance: { primaryColor: 'red', accentColor: '#7f1d1d' },
  };
}

/**
 * Adaptive boss overall - sqrt-based curve that scales smoothly with the
 * unlimited level cap. Level 1 sits at the engine "hard"-tier floor (75)
 * and the curve only approaches the engine stat cap (99) at very high
 * level, so high-level players still see boss differentiation instead of
 * every save past mid-game facing the same 99 overall.
 *   level 1   → 75 (floor; "hard" difficulty tier)
 *   level 5   → 79
 *   level 10  → 81
 *   level 25  → 84
 *   level 50  → 89
 *   level 100 → 94
 *   level 145 → 99 (cap reached via base alone)
 * bossWins adds +3 per win, capped at +12 (4 wins). Combined with the
 * 75 floor, a +12 escalation pushes a fresh level-1 boss to 87 (expert
 * tier) and anything past about level 50 to the 99 engine cap.
 */
export function computeBossOverall(playerLevel = 1, bossWins = 0) {
  const lv = Math.max(1, Number(playerLevel) || 1);
  const wins = Math.max(0, Number(bossWins) || 0);
  // sqrt(lv - 1) * 2 keeps lv=1 exactly at the 75 floor and gives roughly
  // +2 overall per doubling of level. Reaches the 99 cap around level 145
  // via base alone; below that the +12 boss-win escalation provides the
  // top-end boost so the boss feels meaningfully tougher every retry.
  const base = 75 + Math.floor(Math.sqrt(Math.max(0, lv - 1)) * 2);
  const escalated = base + Math.min(12, wins * 3);
  return Math.max(75, Math.min(99, escalated));
}

/**
 * Boss-Challenge variant - synthesizes a stat block that preserves the
 * spd-high/end-low skew while hitting the adaptive overall target.
 */
export function buildElijahBossOpponent({ playerLevel = 1, bossWins = 0 } = {}) {
  const overall = computeBossOverall(playerLevel, bossWins);
  // Skew matches ELIJAH_JOLES_TIER_STATS shape: spd/tec/grt above overall,
  // str around overall, end below.
  const skew = {
    str: 0,
    spd: +6,
    tec: +4,
    end: -8,
    grt: +3,
  };
  const stats = {
    str: Math.max(40, Math.min(99, overall + skew.str)),
    spd: Math.max(40, Math.min(99, overall + skew.spd)),
    tec: Math.max(40, Math.min(99, overall + skew.tec)),
    end: Math.max(40, Math.min(99, overall + skew.end)),
    grt: Math.max(40, Math.min(99, overall + skew.grt)),
  };
  return {
    id: ELIJAH_JOLES_ID,
    name: 'Elijah Joles',
    school: 'Station Camp HS',
    state: 'TN',
    weightClass: 165,
    style: 'freestyle',
    stats,
    // Return the computed target overall directly, not avgStats(stats). The
    // skew + 40..99 clamp drags the average below the intended target at
    // the high end of the curve (e.g. level 100 target=99 but skewed stats
    // average to 97). Keeping the UI readout consistent with the level/win
    // table means using the target value as the surfaced "overall."
    overall,
    isSpecial: true,
    featured: true,
    appearance: { primaryColor: 'red', accentColor: '#7f1d1d' },
    bossWins,
  };
}

// Trash-talk lines. Opponent dialogue module reads from here.
// pre_match - shown before the match starts
// win  - Elijah's line when HE defeats the player (player lost)
// loss - Elijah's line when HE loses (player won)
export const ELIJAH_TRASH_TALK = {
  pre_match: [
    'Do you only train in the winter?',
    'Have you ever wrestled before?',
    "Let's see what you've got.",
    'Wrestle through.',
    'Six minutes. Wrestle through.',
  ],
  win: [
    'Wrestle through.',
    "Nothing personal. I'm chasing gold.",
    'Good match. Keep it funky.',
    'Bring more next time.',
    "That's the pace. Wrestle through.",
  ],
  loss: [
    "Good match. I'll be back.",
    "Respect. That's why we wrestle.",
    'Down or up, wrestle through.',
    "You earned that one.",
    "Respect. You wrestled through.",
  ],
};

// AI-personality style bonuses - read by wrestlingEngine.js getAICard.
// Cards Elijah favors based on his stated moveset. The high-stamina penalty
// reflects his stated weakness.
export const ELIJAH_STYLE_BONUSES = {
  cow_catcher: 24,    // signature
  granby_roll: 22,
  slide_by: 18,
  ankle_pick: 18,
  foot_sweep: 16,
  double_leg: 14,
  front_headlock: 14,
  suplex: 12,
  surfboard: 12,
  _highStaminaPenalty: 8, // applied to any card with staminaCost >= 18
};

/**
 * Idempotently insert Elijah into a male-career ranking pool. Gated on
 * PARTNERSHIP_ACTIVE so flipping the partnership off stops injection into
 * NEW careers (existing careers keep him). Skips if a pool entry with the
 * same id OR name is already present.
 *
 * IMPORTANT: caller is responsible for not calling this on a women's pool.
 * This function does not gate on gender itself - it trusts its callers.
 */
export function ensureElijahJolesInMalePool(pool, opts = {}) {
  if (!PARTNERSHIP_ACTIVE) return pool;
  if (!Array.isArray(pool)) return pool;
  const haveIds = new Set(pool.map(p => p?.id).filter(Boolean));
  const haveNames = new Set(pool.map(p => p?.name).filter(Boolean));
  if (haveIds.has(ELIJAH_JOLES_ID)) return pool;
  if (haveNames.has('Elijah Joles')) return pool;
  return [...pool, buildElijahJolesNpc(opts)];
}
