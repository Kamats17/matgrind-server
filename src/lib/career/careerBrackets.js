// ─── Career Brackets - Seeded Field Generator ───────────────────────────────
// For tournament + championship career events, build the bracket field by
// drawing from the ranking pool with real-life seeding. Scope-aware: a
// Conference Championships pulls from conference-scoped wrestlers and seeds
// the player by their conference rank; State Championships uses the state
// pool/rank; Sectionals/Regionals use the section scope. Regular tournaments
// fall back to the state pool so they keep showing the strongest field.

import { computeOverallFromStats } from './careerOpponents.js';

// Map an event's stakes value (from careerSchedule.js) to the ranking scope
// tag used on `career.rankingPool` entries and `career.rankings` keys.
function scopeForStakes(stakes) {
  switch (stakes) {
    case 'conference':    return 'conference';
    case 'conference_d1': return 'conference'; // college conference championship pulls from the conference pool
    case 'district':      return 'section';    // v9: district = intermediate between conf and regional; section pool fills 32-bracket
    case 'regional':      return 'section';    // pool has no 'regional' tag; section pool covers the regional field
    case 'state':         return 'state';
    default:              return 'state';      // 'regular', undefined, etc.
  }
}

// Pool predicate aligned with how careerRankings.js computes ranks at each
// scope: conference rank = conference-only pool; section rank = conference
// + section pool; state rank = the entire field.
function poolPredicateFor(scope) {
  if (scope === 'conference') return p => p.scope === 'conference';
  if (scope === 'section')    return p => p.scope === 'conference' || p.scope === 'section';
  return () => true; // state, default
}

/**
 * Build a seeded bracket field for a career tournament/championship.
 *
 * v7: senior-tier dual-style careers (men) carry per-style ranking pools
 * via `career.rankingPools[style]`. The optional `eventStyle` arg tells
 * the bracket which pool to draw from. Falls back to the singular
 * `career.rankingPool` for pre-senior careers and legacy senior careers.
 *
 * v8 (partnership): `forcedSeedIds` lets the schedule event force specific
 * NPCs into the bracket regardless of pure overall sort. Used to ensure
 * featured wrestlers (e.g. Elijah Joles) appear in their designated
 * tournaments at every weight class. Forced NPCs are looked up in the
 * source pool by id (then name fallback); missing ids log a warning and
 * are skipped rather than failing the bracket build.
 *
 * @param {object} career - full career object
 * @param {number} bracketSize - 8 | 16 | 32 | 64 | 128 (v9: 128 at HS State, College NCAA, Senior Worlds)
 * @param {string} [stakes] - event stakes ('conference' | 'regional' | 'state' | 'regular')
 * @param {string} [eventStyle] - the event's wrestling style; used to pick the
 *   per-style ranking pool when career.rankingPools is present (v7+).
 * @param {string[]} [forcedSeedIds] - pool ids that must appear in the bracket
 *   regardless of weight-class scope or overall sort. Resolved against the
 *   full source pool by id, then by name as a fallback. Honored after the
 *   player slot, in the caller's stated order. Used by partnership seeding
 *   (e.g. Elijah Joles) and Rivalry Heat to auto-seed a hot-feud rival.
 *   Missing entries log a warning and are skipped rather than failing.
 * @returns {{
 *   bracket: Array<object>,    // bracket array passed to createTournament
 *   playerSeed: number,        // 0-based seed index where the player landed
 *   skipShuffle: true,         // signal to createTournament to skip random shuffle
 * }}
 */
export function buildSeededBracket(career, bracketSize, stakes, eventStyle, forcedSeedIds = []) {
  if (!career || !bracketSize) {
    throw new Error('buildSeededBracket: career and bracketSize required');
  }

  const scope = scopeForStakes(stakes);

  const wrestler = career.wrestler;
  const playerOverall = computeOverallFromStats(wrestler?.stats);
  const playerEntry = {
    name: wrestler?.name || 'You',
    stats: wrestler?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
    appearance: wrestler?.appearance || { primaryColor: 'emerald', accentColor: '#059669' },
    isPlayer: true,
    overall: playerOverall,
  };

  // Filter the ranking pool to entries that belong in this event's scope.
  // Conference event = conference-only NPCs; section/regional event =
  // conference + section NPCs (mirrors careerRankings.js section-rank
  // computation); state event = the full field. If the filtered pool is
  // too small to fill the bracket, fall back to the full pool so the
  // bracket still fills (better than crashing).
  //
  // v7: prefer the per-style pool if the event has a style and the
  // career has the per-style pools map. Falls back to the singular pool
  // for pre-senior tiers and legacy careers.
  const perStylePool = eventStyle && career.rankingPools && career.rankingPools[eventStyle];
  const sourcePool = Array.isArray(perStylePool) && perStylePool.length > 0
    ? perStylePool
    : career.rankingPool;
  const fullPool = (sourcePool || []).filter(p => p && p.id);
  const scopedPool = fullPool.filter(poolPredicateFor(scope));
  const pool = scopedPool.length >= bracketSize - 1 ? scopedPool : fullPool;

  // Initial seed order: highest overall first. Forced seeds are resolved
  // against the FULL source pool (not the scope-filtered pool) so featured
  // wrestlers can appear in any tournament even when they wouldn't naturally
  // fall in scope (partnership seeding). Career Depth Pass rivalry heat also
  // uses this path to surface a hot-feud rival into the bracket. Order is the
  // caller's stated order; duplicates against natural seeds are deduped by id.
  let sortedNpcs = pool.slice().sort((a, b) => (b.overall || 0) - (a.overall || 0));
  if (Array.isArray(forcedSeedIds) && forcedSeedIds.length > 0) {
    const forced = [];
    const sortedIds = new Set(sortedNpcs.map(n => n?.id).filter(Boolean));
    for (const fid of forcedSeedIds) {
      if (!fid) continue;
      const match = fullPool.find(p => p.id === fid)
                 || fullPool.find(p => p.name === fid); // name fallback
      if (!match) {
        // Surface but don't fail: pool may not contain this NPC at this tier.

        console.warn(`[buildSeededBracket] forcedSeedId not found in pool: ${fid}`);
        continue;
      }
      if (sortedIds.has(match.id)) {
        // Already in natural seeds. Promote ordering by removing the existing
        // entry from sortedNpcs so the forced prepend wins.
        sortedNpcs = sortedNpcs.filter(n => n?.id !== match.id);
      }
      forced.push(match);
      sortedIds.add(match.id);
    }
    if (forced.length > 0) sortedNpcs = [...forced, ...sortedNpcs];
  }

  // v6 (2026-04-30): cap any single last name at 2 occurrences inside one
  // bracket. Player reported 4+ Edwards / 3+ Carters / 3+ Larsens in 64-man
  // brackets. v6.1 (2026-05-01): same cap also applies to FIRST names -
  // player saw 2 "Hunter"s in an 8-bracket. Walk the overall-sorted NPC
  // list and skip an entry whose first OR last name has already filled
  // its 2 slots; the next-best NPC gets the slot instead.
  const MAX_PER_NAME_PART = 2;
  const splitName = (name) => {
    const parts = (name || '').trim().split(/\s+/);
    if (parts.length === 0) return { first: '', last: '' };
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts[parts.length - 1] };
  };
  const firstNameCounts = new Map();
  const lastNameCounts = new Map();
  const usedFullNames = new Set();
  const filteredNpcs = [];
  const overflowNpcs = [];
  for (const npc of sortedNpcs) {
    const { first, last } = splitName(npc?.name);
    // Hard rule (no exceptions): never seat two wrestlers with the identical
    // full name in one bracket. A collision can occur if the ranking pool
    // ever holds a duplicate name. The duplicate is dropped entirely - the
    // bracket fills that slot from the next NPC or a synthetic wrestler
    // instead. A career NPC is never renamed to resolve this.
    const fullKey = String(npc?.name || '').trim().toLowerCase();
    if (fullKey && usedFullNames.has(fullKey)) continue;
    const fc = firstNameCounts.get(first) || 0;
    const lc = lastNameCounts.get(last) || 0;
    if (fc < MAX_PER_NAME_PART && lc < MAX_PER_NAME_PART) {
      filteredNpcs.push(npc);
      firstNameCounts.set(first, fc + 1);
      lastNameCounts.set(last, lc + 1);
    } else {
      overflowNpcs.push(npc);
    }
    // Both filtered and overflow entries are real bracket bodies, so both
    // claim their full name against later duplicates.
    if (fullKey) usedFullNames.add(fullKey);
  }
  // If the cap left us short on NPCs (extreme edge case where the pool is
  // truly tiny + name-collision-heavy), fall back to letting the overflow
  // entries fill the bracket so we never ship a half-empty bracket. Only
  // happens when filteredNpcs.length < bracketSize - 1.
  const usableNpcs = filteredNpcs.length >= bracketSize - 1
    ? filteredNpcs
    : [...filteredNpcs, ...overflowNpcs];

  // Build a synthetic stat block for each NPC. Pool entries don't carry full
  // stats - synthesize them from `overall` so the engine has something to
  // work with. Spread is small (±5) so the overall stays stable.
  const synthStats = (overall) => {
    const o = overall || 60;
    return { str: o, spd: o, tec: o, end: o, grt: o };
  };

  // Player's seed = their rank within this scope. A top-ranked conference
  // wrestler in the Conference Championships gets the 1-seed; same wrestler
  // at State gets a worse seed because the field is deeper.
  const scopeRank = career?.rankings?.[scope] ?? bracketSize;
  const playerSeed = Math.max(1, Math.min(bracketSize, scopeRank)) - 1; // 0-based

  // Final bracket array: ordered seed 0 (top) → seed N-1 (bottom).
  // Player inserted at their seed; NPCs fill the rest in overall order.
  const bracket = new Array(bracketSize).fill(null);
  bracket[playerSeed] = playerEntry;

  let npcIdx = 0;
  for (let i = 0; i < bracketSize; i++) {
    if (bracket[i]) continue; // player slot
    const npc = usableNpcs[npcIdx++] || null;
    if (npc) {
      const overall = npc.overall ?? 60;
      bracket[i] = {
        name: npc.name,
        school: npc.school,
        stats: npc.stats || synthStats(overall),
        appearance: npc.appearance || null,
        isPlayer: false,
        overall,
        rankPoolId: npc.id,           // link back so future matchups update pool
        npcId: npc.id,                // stable NPC identity threaded into createInitialMatchState
                                      // so AI personality + opponent dialogue + badge attribution route correctly
      };
    } else {
      // Pool exhausted - fall back to a synthetic NPC so the bracket fills.
      bracket[i] = {
        name: `Wrestler ${i + 1}`,
        stats: synthStats(60),
        appearance: { primaryColor: 'red', accentColor: '#dc2626' },
        isPlayer: false,
        overall: 60,
      };
    }
  }

  return { bracket, playerSeed, skipShuffle: true };
}
