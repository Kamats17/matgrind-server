// ─── Career Rivals ───────────────────────────────────────────────────────────
// Generates 3-5 named persistent rivals at career start. Rivals stay in your
// weight class (or follow you if you move up). H2H history persists across
// seasons so the dashboard can surface "you're 2-1 vs Marcus Delacroix" on
// the event preview.
//
// Phase A: basic generation only. H2H updates come from careerState.recordResult.
// Phase C adds cross-tier persistence (top 2 rivals follow to college, etc).

import { generateEventNames } from '../namePools.js';

const RIVAL_SCHOOLS_HS = [
  'Iowa City High', 'Stillwater Prep', 'Blacksburg Academy', 'Lehigh Valley HS',
  'Columbus Central', 'Minneapolis North', 'Pittsburgh East', 'State College HS',
  'Fargo Prep', 'Edinboro Academy', 'Cedar Rapids Tech', 'Lincoln HS',
];

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function rollStats(rng, tier) {
  // Rivals are top wrestlers in the player's weight class - they should
  // look like real competitors, not midpack filler. HS 60-80, college
  // 65-90, senior 70-99. The spread is tight so every rival reads as a
  // legitimate threat (no 50-overall "rival" with a 1-9 record).
  const base = tier === 'senior' ? 70 : tier === 'college' ? 65 : 60;
  const spread = tier === 'senior' ? 25 : tier === 'college' ? 22 : 18;
  const stats = {
    str: base + Math.floor(rng() * spread),
    spd: base + Math.floor(rng() * spread),
    tec: base + Math.floor(rng() * spread),
    end: base + Math.floor(rng() * spread),
    grt: base + Math.floor(rng() * spread),
  };
  const overall = Math.round((stats.str + stats.spd + stats.tec + stats.end + stats.grt) / 5);
  return { stats, overall };
}

// Stable id for the canonical #1 rival. Same id used in the ranking
// pool's special-NPC injection (careerRankings.SPECIAL_AI_WRESTLER_IDS)
// so the rival entry and the pool entry are the same wrestler.
export const CHASE_KAMATS_ID = 'special_chase_kamats';

const CHASE_KAMATS_TIER_OVERALL = { hs: 80, college: 90, senior: 99 };

/**
 * Build the canonical Chase Kamats rival for a given tier + weight class.
 * Top-overall NPC at the tier cap so he's the highest-rated AI the player
 * faces. Same shape as a generated rival; uses the stable CHASE_KAMATS_ID
 * so v6 hydrate can detect "already injected" idempotently.
 *
 * @param {{ weightClass?: number, tier?: string, style?: string }} [opts]
 */
export function buildChaseKamatsRival({ weightClass, tier = 'hs', style = 'folkstyle' } = {}) {
  const overall = CHASE_KAMATS_TIER_OVERALL[tier] ?? CHASE_KAMATS_TIER_OVERALL.hs;
  const stats = { str: overall, spd: overall, tec: overall, end: overall, grt: overall };
  return {
    id: CHASE_KAMATS_ID,
    name: 'Chase Kamats',
    school: 'Greenwood Catholic',
    weightClass,
    style,
    tier,
    stats,
    overall,
    h2h: { wins: 0, losses: 0, pins: 0, lastMeeting: null },
    isSpecial: true,
  };
}

/**
 * Idempotently ensure Chase Kamats is in the rivals array. If a rival
 * with CHASE_KAMATS_ID is already present, returns the same array
 * reference unchanged. Otherwise prepends him so he's visible at the
 * top of the rivals list.
 */
export function ensureChaseKamatsRival(rivals, opts) {
  if (!Array.isArray(rivals)) return rivals;
  if (rivals.some(r => r?.id === CHASE_KAMATS_ID)) return rivals;
  // Defensive: if a randomly-generated rival happened to be named "Chase
  // Kamats" already, leave the existing entry alone so we don't double up.
  if (rivals.some(r => r?.name === 'Chase Kamats')) return rivals;
  return [buildChaseKamatsRival(opts), ...rivals];
}

// ─── Women's canonical NPCs ──────────────────────────────────────────────
//
// Valerie Aikens is the women's-side analog of Chase Kamats: top-overall
// AI in every women's career, the canonical #1 rival. The four close-behind
// names (Larissa Newton, Angelee Kamats, Niki Garwood, Brooke Wennin)
// are also stable special NPCs at HS 76-78 / college 87-88 / senior 96-97.

export const VALERIE_AIKENS_ID = 'special_valerie_aikens';
export const LARISSA_NEWTON_ID = 'special_larissa_newton';
export const ANGELEE_KAMATS_ID = 'special_angelee_kamats';
export const NIKI_GARWOOD_ID = 'special_niki_garwood';
export const BROOKE_GABERSECK_ID = 'special_brooke_gaberseck';

const VALERIE_AIKENS_TIER_OVERALL = { hs: 80, college: 90, senior: 99 };
const TIER1_CLOSE_OVERALL = { hs: 78, college: 88, senior: 97 };
const TIER2_CLOSE_OVERALL = { hs: 76, college: 87, senior: 96 };

function buildSpecialWomensNpc({ id, name, school, weightClass, tier, style, overall }) {
  const stats = { str: overall, spd: overall, tec: overall, end: overall, grt: overall };
  return {
    id,
    name,
    school,
    weightClass,
    style,
    tier,
    stats,
    overall,
    h2h: { wins: 0, losses: 0, pins: 0, lastMeeting: null },
    isSpecial: true,
  };
}

/**
 * Build the canonical Valerie Aikens rival for a given tier + weight class.
 * Top-overall NPC at the tier cap so she's the highest-rated AI a female
 * career will face. Same shape as a generated rival; uses the stable
 * VALERIE_AIKENS_ID so v7 hydrate can detect "already injected" idempotently.
 *
 * @param {{ weightClass?: number, tier?: string, style?: string }} [opts]
 */
export function buildValerieAikensRival({ weightClass, tier = 'hs', style = 'womens_freestyle' } = {}) {
  return buildSpecialWomensNpc({
    id: VALERIE_AIKENS_ID,
    name: 'Valerie Aikens',
    school: 'Linden Park',
    weightClass,
    tier,
    style,
    overall: VALERIE_AIKENS_TIER_OVERALL[tier] ?? VALERIE_AIKENS_TIER_OVERALL.hs,
  });
}

/**
 * Build the four close-behind women's special NPCs. Returned in priority
 * order (highest overall first) so callers can prepend / inject naturally.
 *
 * @param {{ weightClass?: number, tier?: string, style?: string }} [opts]
 */
export function buildCloseBehindWomensNpcs({ weightClass, tier = 'hs', style = 'womens_freestyle' } = {}) {
  const tier1 = TIER1_CLOSE_OVERALL[tier] ?? TIER1_CLOSE_OVERALL.hs;
  const tier2 = TIER2_CLOSE_OVERALL[tier] ?? TIER2_CLOSE_OVERALL.hs;
  return [
    buildSpecialWomensNpc({
      id: LARISSA_NEWTON_ID, name: 'Larissa Newton',
      school: 'Greenwood Catholic', weightClass, tier, style, overall: tier1,
    }),
    buildSpecialWomensNpc({
      id: ANGELEE_KAMATS_ID, name: 'Angelee Kamats',
      school: 'Cedar Ridge Prep', weightClass, tier, style, overall: tier1,
    }),
    buildSpecialWomensNpc({
      id: NIKI_GARWOOD_ID, name: 'Niki Garwood',
      school: 'Brighton Heights HS', weightClass, tier, style, overall: tier2,
    }),
    buildSpecialWomensNpc({
      id: BROOKE_GABERSECK_ID, name: 'Brooke Wennin',
      school: 'Foxhollow Academy', weightClass, tier, style, overall: tier2,
    }),
  ];
}

/**
 * Idempotently ensure Valerie Aikens + the four close-behind women's NPCs
 * are in the rivals array. Returns the same array reference unchanged
 * if they're all already present.
 */
export function ensureWomensSpecialRivals(rivals, opts) {
  if (!Array.isArray(rivals)) return rivals;
  const presentIds = new Set(rivals.map(r => r?.id).filter(Boolean));
  const presentNames = new Set(rivals.map(r => r?.name).filter(Boolean));
  const additions = [];
  if (!presentIds.has(VALERIE_AIKENS_ID) && !presentNames.has('Valerie Aikens')) {
    additions.unshift(buildValerieAikensRival(opts));
  }
  for (const npc of buildCloseBehindWomensNpcs(opts)) {
    if (!presentIds.has(npc.id) && !presentNames.has(npc.name)) {
      additions.push(npc);
    }
  }
  if (additions.length === 0) return rivals;
  return [...additions, ...rivals];
}

/**
 * Generate initial rival set for a fresh career. Returns 3-5 named wrestlers
 * at the player's weight class.
 *
 * Male careers (gender !== 'female'): Chase Kamats is prepended as the
 * canonical #1 rival; Larissa/Angelee/Niki/Brooke are NOT injected.
 * Female careers (gender === 'female'): Valerie Aikens is prepended plus
 * the four close-behind women's NPCs; Chase Kamats is NOT injected.
 *
 * @param {{ weightClass?: number, tier?: string, style?: string, gender?: string, rng?: () => number, count?: number }} [opts]
 */
export function generateRivals({ weightClass, tier = 'hs', style = 'folkstyle', gender = 'male', rng = Math.random, count } = {}) {
  const isFemale = gender === 'female';
  const reservedNames = isFemale
    ? ['Valerie Aikens', 'Larissa Newton', 'Angelee Kamats', 'Niki Garwood', 'Brooke Wennin']
    : ['Chase Kamats', 'Stetson Clary', 'Jaxon Louis', 'Brayden Aide', 'Marcus McCauley', 'Gavin Burch'];
  const n = count ?? (3 + Math.floor(rng() * 3)); // 3-5
  const rivals = [];
  // Reserved = the canonical special NPCs (Chase Kamats etc.); they are
  // injected separately below and must never be randomly regenerated.
  const reserved = new Set(reservedNames);
  const usedNames = new Set();
  const usedFirsts = new Set();
  const usedLasts = new Set();
  for (let i = 0; i < n; i++) {
    const fullName = generateEventNames({
      count: 1, gender, rng, used: usedNames, reserved, usedFirsts, usedLasts,
    })[0];

    const { stats, overall } = rollStats(rng, tier);
    rivals.push({
      id: `rival_${Date.now()}_${i}_${Math.floor(rng() * 1e6)}`,
      name: fullName,
      school: pick(rng, RIVAL_SCHOOLS_HS),
      weightClass,
      style,
      tier,
      stats,
      overall,
      h2h: { wins: 0, losses: 0, pins: 0, lastMeeting: null },
    });
  }
  if (isFemale) {
    // Women's careers: Valerie Aikens at the top + four close-behind specials.
    return [
      buildValerieAikensRival({ weightClass, tier, style: style === 'folkstyle' ? 'womens_freestyle' : style }),
      ...buildCloseBehindWomensNpcs({ weightClass, tier, style: style === 'folkstyle' ? 'womens_freestyle' : style }),
      ...rivals,
    ];
  }
  // Men's careers: Chase Kamats prepended.
  return [buildChaseKamatsRival({ weightClass, tier, style }), ...rivals];
}

// Pick one rival as the opponent for an event. Pure function over the rivals
// array - callers can add filters (e.g., prefer rivals with fewer meetings).
export function pickRivalOpponent(rivals, { avoidIds = [], rng = Math.random } = {}) {
  const pool = rivals.filter(r => !avoidIds.includes(r.id));
  if (pool.length === 0) return rivals[Math.floor(rng() * rivals.length)] || null;
  return pool[Math.floor(rng() * pool.length)];
}

// Career Depth Pass v1 - Rivalry Heat.
// Derived feud temperature from accumulated H2H. Pure function, never persisted.
// Pin wins count double because they're emotionally weighted in wrestling
// (a pin is the clearest "I dominated you" outcome). Tiers used by UI flame
// escalation + bracket auto-seed:
//   feud >= 3: rival_hot   (1 flame)
//   feud >= 5: rival_blood (2 flames)
//   feud >= 8: rival_owned (3 flames)
export const FEUD_HOT = 3;
export const FEUD_BLOOD = 5;
export const FEUD_OWNED = 8;

export function feudLevel(h2h) {
  if (!h2h || typeof h2h !== 'object') return 0;
  const wins = Number(h2h.wins) || 0;
  const losses = Number(h2h.losses) || 0;
  const pins = Number(h2h.pins) || 0;
  return wins + losses + pins * 2;
}

export function feudTierKey(level) {
  if (level >= FEUD_OWNED) return 'rival_owned';
  if (level >= FEUD_BLOOD) return 'rival_blood';
  if (level >= FEUD_HOT) return 'rival_hot';
  return null;
}

// Update a rival's H2H after a match. Returns a new rivals array (immutable).
export function recordH2H(rivals, rivalId, { playerWon, winMethod, eventId }) {
  return rivals.map(r => {
    if (r.id !== rivalId) return r;
    const h2h = { ...r.h2h };
    if (playerWon) h2h.wins = (h2h.wins || 0) + 1;
    else h2h.losses = (h2h.losses || 0) + 1;
    if (playerWon && winMethod === 'pin') h2h.pins = (h2h.pins || 0) + 1;
    h2h.lastMeeting = { eventId, playerWon, winMethod, at: Date.now() };
    return { ...r, h2h };
  });
}

const MAX_RIVALS = 8;

/**
 * Convert a pool entry (a non-rival NPC the player has wrestled multiple
 * times) into a full rival. Returns a new rivals array. Caller should also
 * tag the pool entry with `isRival: true` for the rivals snapshot UI.
 *
 * @param {Array<object>} rivals - current rivals
 * @param {object} poolEntry - entry from career.rankingPool
 * @param {object} h2hSeed - { wins, losses, pins, lastMeeting }
 */
export function promoteToRival(rivals, poolEntry, h2hSeed) {
  if (!poolEntry || !poolEntry.id) return rivals;
  if (rivals.some(r => r.id === poolEntry.id)) return rivals;

  const promoted = {
    id: poolEntry.id,
    name: poolEntry.name,
    school: poolEntry.school,
    weightClass: poolEntry.weightClass,
    style: poolEntry.style || 'folkstyle',
    tier: poolEntry.tier || 'hs',
    stats: poolEntry.stats || null,
    overall: poolEntry.overall ?? 60,
    h2h: {
      wins:  h2hSeed?.wins  || 0,
      losses: h2hSeed?.losses || 0,
      pins:   h2hSeed?.pins   || 0,
      lastMeeting: h2hSeed?.lastMeeting || null,
    },
    promoted: true,
  };

  const next = [...rivals, promoted];
  if (next.length <= MAX_RIVALS) return next;

  // Cap at MAX_RIVALS - drop the lowest-overall non-promoted rival to keep
  // story-anchor rivals (initial roster) front-and-center over churn.
  const sortable = next
    .map((r, i) => ({ r, i }))
    .filter(x => !x.r.promoted)
    .sort((a, b) => (a.r.overall || 0) - (b.r.overall || 0));
  if (sortable.length > 0) {
    const dropIdx = sortable[0].i;
    return next.filter((_, i) => i !== dropIdx);
  }
  // All rivals are already promoted - drop the oldest (first added).
  return next.slice(next.length - MAX_RIVALS);
}

export const RIVAL_PROMOTION_THRESHOLD = 2; // meetings before non-rival can promote

// Generate a generic (non-rival) opponent for filler duals. Simpler shape -
// no h2h tracking, just a disposable one-off. Gender selects the name pool.
//
// `used` / `reserved` de-duplicate filler names across a season: `used` is a
// shared Set the caller threads through every filler call (mutated here on
// accept); `reserved` holds names that must never be produced (rivals +
// special NPCs). To keep a fixed-seed season's rng stream byte-identical to
// the pre-dedup version, the candidate is drawn with the exact same call as
// before, and a colliding candidate is replaced with a zero-rng draw that
// consumes no caller rng (deterministic Tier-2 scan inside generateEventNames).
export function generateFillerOpponent({
  weightClass, tier = 'hs', style = 'folkstyle', gender = 'male', rng = Math.random,
  used = new Set(), reserved = new Set(),
}) {
  const { stats, overall } = rollStats(rng, tier);
  // id drawn before name so the rng consumption order matches the pre-fix code.
  const id = `filler_${Date.now()}_${Math.floor(rng() * 1e6)}`;
  let name = generateEventNames({ count: 1, gender, rng })[0];
  if (used.has(name) || reserved.has(name)) {
    name = generateEventNames({ count: 1, gender, rng: () => 0, used, reserved })[0];
  }
  used.add(name);
  return {
    id,
    name,
    school: pick(rng, RIVAL_SCHOOLS_HS),
    weightClass,
    style,
    tier,
    stats,
    overall,
    isRival: false,
  };
}

// --- Cross-tier rival follow ---------------------------------------------
// Top-2 HS rivals follow you to college (player's stats grew, theirs grew
// too). Top-2 college rivals probabilistically follow to senior international
// based on how good they got. The carry-over preserves story arcs across
// tier transitions instead of throwing all rivals away on every promotion.

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function bumpStats(stats, delta) {
  if (!stats) return stats;
  return {
    str: clamp((stats.str || 60) + delta, 50, 99),
    spd: clamp((stats.spd || 60) + delta, 50, 99),
    tec: clamp((stats.tec || 60) + delta, 50, 99),
    end: clamp((stats.end || 60) + delta, 50, 99),
    grt: clamp((stats.grt || 60) + delta, 50, 99),
  };
}

/**
 * Promote up to 2 top HS rivals into college rivals. Each gets +8 to +14
 * overall (random), tier='college', a different-from-player college school.
 * H2H history is preserved so the dashboard can keep showing "you're 2-1
 * vs Marcus".
 * @param {Array<object>} rivals
 * @param {{ rng?: () => number, playerCollegeId?: string|null, pickCollege?: (excludeId: string|null, rng: () => number) => any }} [opts]
 */
export function followRivalsToCollege(rivals, { rng = Math.random, playerCollegeId, pickCollege } = {}) {
  if (!Array.isArray(rivals) || rivals.length === 0) return [];
  const sorted = [...rivals].sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const top = sorted.slice(0, 2);
  return top.map(r => {
    const delta = 8 + Math.floor(rng() * 7); // 8..14
    const newOverall = clamp((r.overall || 60) + delta, 60, 90);
    const stats = bumpStats(r.stats, delta);
    const college = typeof pickCollege === 'function'
      ? pickCollege(playerCollegeId, rng)
      : null;
    return {
      ...r,
      tier: 'college',
      style: 'folkstyle',
      school: college?.name || r.school,
      collegeId: college?.id || null,
      stats,
      overall: newOverall,
    };
  });
}

/**
 * Probabilistically promote up to 2 top college rivals into senior rivals.
 * Probability of "making the senior level" is `clamp((overall-70)/25, 0.05, 0.85)`
 * so a 90-overall rival has ~80% chance, a 70-overall rival has ~5%. Each
 * passing rival gets +10 overall, the player's chosen senior style, and the
 * player's senior weight class (so they actually compete head-to-head).
 * @param {Array<object>} rivals
 * @param {{ rng?: () => number, playerStyle?: string, playerWeightClass?: number|null }} [opts]
 */
export function followRivalsToSenior(rivals, { rng = Math.random, playerStyle = 'freestyle', playerWeightClass = null } = {}) {
  if (!Array.isArray(rivals) || rivals.length === 0) return [];
  const sorted = [...rivals].sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const passes = [];
  for (const r of sorted) {
    if (passes.length >= 2) break;
    const overall = r.overall || 60;
    const prob = clamp((overall - 70) / 25, 0.05, 0.85);
    if (rng() < prob) passes.push(r);
  }
  return passes.map(r => {
    const newOverall = clamp((r.overall || 60) + 10, 65, 99);
    const stats = bumpStats(r.stats, 10);
    return {
      ...r,
      tier: 'senior',
      style: playerStyle,
      weightClass: playerWeightClass ?? r.weightClass,
      stats,
      overall: newOverall,
    };
  });
}
