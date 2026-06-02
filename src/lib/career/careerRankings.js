// ─── Career Mode - Rankings ──────────────────────────────────────────────────
// Fills the dead space on the CareerDashboard Home tab with meaningful
// context: where does this wrestler stand in their conference, section,
// and state at their weight class?

import { getStateOverallModifier } from './careerStates.js';
import { generateEventNames } from '../namePools.js';
import { ELIJAH_JOLES_ID, buildElijahJolesNpc, PARTNERSHIP_ACTIVE as ELIJAH_PARTNERSHIP_ACTIVE } from './elijahJoles.js';

// Tier-aware label set for the three ranking scopes. The data shape stays
// the same (rankings.{conference, section, state}), only the displayed
// names change per tier. HS uses NFHS terminology, college uses NCAA-ish
// terminology, senior uses UWW terminology.
//
// Why per-tier: "State Ranking" makes no sense for a senior wrestler at the
// World Championships - they're competing against 80+ countries. "State
// Ranking" also doesn't fit a college wrestler who's chasing a national
// title. The label has to track the actual scope of competition.
export const RANKING_LABELS = {
  hs: {
    conference: 'Conference',
    section: 'Section',
    state: 'State',
    seedHint: 'state',
  },
  college: {
    conference: 'Conference',
    section: 'Region',
    state: 'Collegiate',
    seedHint: 'collegiate',
  },
  senior: {
    conference: 'National',
    section: 'Continental',
    state: 'World',
    seedHint: 'world',
  },
};

export function getRankingLabels(tier) {
  return RANKING_LABELS[tier] || RANKING_LABELS.hs;
}
//
// Why a pool exists: without NPC opponents to rank against, "state rank
// #14" is a made-up number. So at career creation we generate 24 NPC
// wrestlers at the player's weight in the same conference. They have
// their own weekly sim records, and the player's rank is computed
// against them. Section and state are derived via scaling + noise.
//
// Why only conference is fully simulated: 4 sections * 3 conferences *
// 24 wrestlers = 288 NPCs per weight class per state. Running full sim
// for 288 wrestlers per event is overkill for a leaderboard widget.
// Conference (24) is plenty of fidelity for feel; the outer numbers
// are extrapolation you'd never notice.

// Wrestler first/last name pools are centralized in src/lib/namePools.js.
// generateScopedPool draws names via generateEventNames.
const SCHOOLS = [
  'Riverside Prep', 'Northgate HS', 'Oakwood Academy', 'Summit Valley',
  'Westfield Central', 'Harborview HS', 'Millbrook Tech', 'Southridge',
  'Brookfield Catholic', 'Eastern Hills', 'Lakeshore Prep', 'Clearwater HS',
  'Vista Pines', 'Maple Grove', 'Stonebridge Academy', 'Pinecrest HS',
  'Evergreen Prep', 'Silver Creek', 'Highland Park HS', 'Ridgefield',
  'Forestwood HS', 'Liberty Central', 'Castleton Prep', 'Belmont HS',
  // v5 expansion: doubling the school pool gives the bigger ranking pools
  // a richer "town map" feel - the user noticed a 500-wrestler ranking
  // screen in v4 had heavy school reuse.
  'Greenwood Catholic', 'Ironwood HS', 'Cedar Ridge Prep', 'Birchfield',
  'Foxhollow Academy', 'Brighton Heights HS', 'Cliffside Charter',
  'Augusta Prep', 'Fairview Christian', 'Lincoln Trail HS', 'St. Adrian\'s',
  'Cypress Glen', 'Mariposa Valley', 'Rockcrest Tech', 'Devonshire HS',
  'Crestwood Academy', 'Plainfield Central', 'Whitcombe Prep',
  'Buckeye Hills', 'Sherwood Catholic', 'Elder Mills HS', 'Tarpon Bay',
  'Granite Peak Prep', 'Ashland Heights', 'Marshfield HS', 'Hawthorne Tech',
  'Saint Vincent\'s', 'New Haven Prep', 'Pemberton Catholic', 'Fairhaven HS',
  'Linden Park', 'Holbrook Academy', 'Carmel Ridge', 'Whitcraft Prep',
  'Northbridge Catholic', 'Camden Lakes', 'Fitzgerald Memorial',
  'Templeton Christian', 'Ashbury HS', 'Bramwell Tech', 'Kingsbury HS',
];

// v4 sizes (24/36/65 = 125 total). v5 (2026-04-30) makes the pool tier-aware
// to match the user-stated targets: HS / college 500 per weight class
// (~125 per grade level), senior / Worlds 1000 per weight class. Existing
// careers KEEP their v4-sized pool until a future v6 backfill explicitly
// tops them up; only NEW careers generated under v5+ get the deeper bench.
// Brought the legacy single-tier exports below as defaults so any caller
// that doesn't pass a tier (test fixtures) still gets a sensible size.
const CONFERENCE_SIZE = 24;          // legacy default - tier-specific values below
const SECTION_EXTRA_SIZE = 36;
const STATE_EXTRA_SIZE = 65;

// v5 tier-scaled pool sizes. Conference / section / state proportions
// preserved from v4 (~19% / 29% / 52%) so the leaderboard's relative
// distribution stays familiar. Total per tier:
//   hs       = 96 + 144 + 260 = 500
//   college  = 96 + 144 + 260 = 500
//   senior   = 192 + 288 + 520 = 1000
const POOL_SIZES_BY_TIER = {
  hs:      { conference: 96,  section: 144, state: 260 },
  college: { conference: 96,  section: 144, state: 260 },
  senior:  { conference: 192, section: 288, state: 520 },
};
const SECTIONS_PER_STATE = 4;
const CONFERENCES_PER_SECTION = 3;

// View sizes - the maximum number of rows the leaderboard can render per scope.
// Kept large so the rendering pipeline doesn't truncate before the threshold
// cutoff is applied. Actual visible rows are capped by RANKED_THRESHOLD.
export const RANKINGS_VIEW_SIZE = {
  conference: 25,
  section: 50,
  state: 100,
};

// Ranked-threshold - only rows at or below these ranks are considered "ranked"
// and get a numeric rank in the UI. Rows below the threshold collapse into a
// "+ X unranked" footer on the rankings screen, and rivals below the threshold
// show an "Unranked" badge in the Rivals to Watch widget.
//
// Why these specific cutoffs: real-world state rankings carry weight in
// proportion to scarcity. A 100th-ranked wrestler going 2-5 is absurd -
// "ranked" should mean genuinely good. Top 50 statewide / top 25 sectionally /
// top 16 in conference is a reasonable depth per scope.
export const RANKED_THRESHOLD = {
  conference: 16,
  section:    25,
  state:      50,
};

/**
 * Whether a given numeric rank earns a "ranked" label on a given scope.
 * Below the threshold = "Unranked".
 * @param {'conference' | 'section' | 'state'} scope
 * @param {number} rank - 1-based
 */
export function isRankedAt(scope, rank) {
  const cap = RANKED_THRESHOLD[scope];
  if (typeof cap !== 'number') return false;
  return typeof rank === 'number' && rank > 0 && rank <= cap;
}

// ─── Pool generation ───────────────────────────────────────────────────────

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Generate the player's 24-wrestler conference pool at career creation.
 * Overalls spread 45-85 so there's room above and below the player. Each
 * NPC is tagged `scope: 'conference'` so the expanded state/section pools
 * (see generateExpandedRankingPool) can coexist in one flat array.
 * @param {{ weightClass?: number, tier?: string, rng?: () => number }} [opts]
 */
export function generateRankingPool({ weightClass, tier = 'hs', rng = Math.random } = {}) {
  return generateScopedPool({
    weightClass, tier, rng,
    count: CONFERENCE_SIZE,
    scope: 'conference',
    used: new Set(),
    overallMin: 45, overallMax: 85,
    idPrefix: 'rank',
  });
}

/**
 * Generate a pool for a specific scope (conference / section / state). All
 * scopes share the same name/school namespace but stay distinct via the
 * `scope` tag. Overall spreads vary: section NPCs average a touch higher
 * (so Section Rank #1 isn't always a Conference #1), state wider still.
 * @param {{ weightClass?: number, tier?: string, rng?: () => number, count?: number, scope?: string, used?: Set<string>, overallMin?: number, overallMax?: number, idPrefix?: string, gender?: string }} opts
 */
function generateScopedPool({
  weightClass, tier, rng,
  count, scope, used,
  overallMin, overallMax,
  idPrefix,
  gender = 'male',
}) {
  // Names come from the centralized pool (src/lib/namePools.js). `used` is
  // shared across all three scopes of one expanded pool, so full-name dedup
  // spans the whole 500/1000-NPC field. enforceUniqueFirstLast is off here -
  // a 500+ NPC pool cannot have unique first names (only ~150-230 exist).
  // Event-level first/last de-collision happens later in buildSeededBracket.
  const pool = [];
  for (let i = 0; i < count; i++) {
    const name = generateEventNames({
      count: 1, gender, rng, used, enforceUniqueFirstLast: false,
    })[0];

    const overall = overallMin + Math.floor(rng() * (overallMax - overallMin));
    pool.push({
      id: `${idPrefix}_${scope}_${i}_${Math.floor(rng() * 1e6)}`,
      name,
      school: pick(rng, SCHOOLS),
      overall,
      weightClass,
      tier,
      scope,
      wins: 0,
      losses: 0,
    });
  }
  return pool;
}

// Tier-scaled overall ranges (per scope). HS caps at 80; College pushes up
// +10 baseline; Senior pushes up +15. State difficulty modifier (PA, etc.)
// stacks on top, but final values are clamped to the tier's cap.
const POOL_RANGES_BY_TIER = {
  hs:      { conf: [40, 78], sec: [45, 80], state: [48, 80], cap: 80 },
  college: { conf: [50, 88], sec: [55, 90], state: [58, 90], cap: 90 },
  senior:  { conf: [60, 95], sec: [65, 99], state: [70, 99], cap: 99 },
};

/**
 * Generate the full 3-scope ranking pool for top-25 conf / top-50 section /
 * top-100 state leaderboards. Returns ONE flat array of ~125 NPCs, each
 * tagged with scope ('conference' | 'section' | 'state'). The flat shape
 * keeps storage simple and lets simWeekForPool operate on one list.
 *
 * Pool overall ranges scale by tier (hs / college / senior). State difficulty
 * (PA, Iowa, etc.) shifts on top. All values clamp to the tier's overall cap
 * so a 92-overall HS freshman can never exist.
 *
 * @param {{ weightClass?: number, tier?: string, state?: string, rng?: () => number, count?: number }} [opts]
 */
// ─── Special / named AI wrestlers ────────────────────────────────────────
//
// A small set of named NPCs that exist in EVERY career's ranking pool.
// Each one has a stable id (so the v5->v6 hydrate can detect "already
// injected" idempotently) and a tier-scaled overall.
//
// Chase Kamats: top-overall AI in every career, the canonical #1 rival.
// Sits at the tier cap (HS 80, College 90, Senior 99) so he's the
// highest-rated NPC the player will ever face. The ranking weekly-sim
// is probabilistic, so he's competitive year-in / year-out but not
// guaranteed to win every state final.
//
// Jordon Eckstrom: a frequently-recurring named NPC at high-mid overall.
// Always present (one per pool, never doubled - fresh ID prefix prevents
// the pool generator from regenerating a Jordon with a colliding name).

const STAT_CAP_FALLBACK = { hs: 80, college: 90, senior: 99 };

function specialOverallForTier(tier, offsetFromCap = 0) {
  const cap = STAT_CAP_FALLBACK[tier] ?? STAT_CAP_FALLBACK.hs;
  return Math.max(40, Math.min(cap, cap - offsetFromCap));
}

export const SPECIAL_AI_WRESTLER_IDS = {
  CHASE_KAMATS:     'special_chase_kamats',
  JORDON_ECKSTROM:  'special_jordon_eckstrom',
  STETSON_CLARY:    'special_stetson_clary',
  JAXON_LOUIS:      'special_jaxon_louis',
  BRAYDEN_AIDE:     'special_brayden_aide',
  MARCUS_MCCAULEY:  'special_marcus_mccauley',
  GAVIN_BURCH:      'special_gavin_burch',
  // Featured-wrestler partnership - male-only canonical NPC. Skewed
  // (non-flat) stat block defined in elijahJoles.js, not synthesized here.
  ELIJAH_JOLES:     ELIJAH_JOLES_ID,
};

// Real-world cohort: named wrestlers seeded into the male ranking pool at
// conference scope. Stronger than average AI but below Chase / Jordon.
// All 5 appear at every tier; stats scale with the tier.
const COHORT_WRESTLERS = [
  { id: SPECIAL_AI_WRESTLER_IDS.STETSON_CLARY,   name: 'Stetson Clary',   school: 'Ridgeline HS',   hs: 76, college: 86, senior: 94 },
  { id: SPECIAL_AI_WRESTLER_IDS.JAXON_LOUIS,     name: 'Jaxon Louis',     school: 'Westport HS',    hs: 75, college: 85, senior: 92 },
  { id: SPECIAL_AI_WRESTLER_IDS.BRAYDEN_AIDE,    name: 'Brayden Aide',    school: 'Northgate HS',   hs: 74, college: 84, senior: 91 },
  { id: SPECIAL_AI_WRESTLER_IDS.MARCUS_MCCAULEY, name: 'Marcus McCauley', school: 'Clearfield HS',  hs: 72, college: 82, senior: 89 },
  { id: SPECIAL_AI_WRESTLER_IDS.GAVIN_BURCH,     name: 'Gavin Burch',     school: 'Lakeview HS',    hs: 70, college: 80, senior: 87 },
];

// Women's-side canonical NPC ids. v7 introduces the women's career path;
// these are the women's-pool analogs of the male canonical NPCs above.
// Valerie Aikens is the top-overall women's NPC (tier cap), and the four
// close-behind names sit just below at 78/88/97 and 76/87/96.
export const WOMENS_SPECIAL_AI_WRESTLER_IDS = {
  VALERIE_AIKENS:   'special_valerie_aikens',
  LARISSA_NEWTON:   'special_larissa_newton',
  ANGELEE_KAMATS:   'special_angelee_kamats',
  NIKI_GARWOOD:     'special_niki_garwood',
  BROOKE_GABERSECK: 'special_brooke_gaberseck',
};

/**
 * Build the special NPCs for a given tier + weight class. Stable IDs make
 * the injection idempotent (hydrate checks `pool.some(p => p.id === ID)`
 * before adding). Stats default to overall = stat across the board so
 * the bracket builder doesn't have to synthesize a stat block.
 *
 * @param {{ weightClass?: number, tier?: string, scope?: string }} [opts]
 */
export function buildSpecialAiWrestlers({ weightClass, tier = 'hs', scope = 'conference' } = {}) {
  const chaseOverall = specialOverallForTier(tier, 0);   // top of tier
  const jordonOverall = specialOverallForTier(tier, 6);  // 6 below cap
  const synth = (o) => ({ str: o, spd: o, tec: o, end: o, grt: o });
  return [
    {
      id: SPECIAL_AI_WRESTLER_IDS.CHASE_KAMATS,
      name: 'Chase Kamats',
      school: 'Greenwood Catholic',
      overall: chaseOverall,
      stats: synth(chaseOverall),
      weightClass,
      tier,
      scope,
      wins: 0,
      losses: 0,
      isSpecial: true,
    },
    {
      id: SPECIAL_AI_WRESTLER_IDS.JORDON_ECKSTROM,
      name: 'Jordon Eckstrom',
      school: 'Ironwood HS',
      overall: jordonOverall,
      stats: synth(jordonOverall),
      weightClass,
      tier,
      scope,
      wins: 0,
      losses: 0,
      isSpecial: true,
    },
    ...COHORT_WRESTLERS.map(c => {
      const overall = c[tier] ?? c.hs;
      return {
        id: c.id,
        name: c.name,
        school: c.school,
        overall,
        stats: synth(overall),
        weightClass,
        tier,
        scope,
        wins: 0,
        losses: 0,
        isSpecial: true,
      };
    }),
    // Featured-wrestler partnership. Male-only. Appended via the builder so
    // his non-flat stat block (the partnership's mechanical fingerprint) is
    // preserved; not synthesized from a flat overall. Skipped entirely when
    // the partnership is retired - existing careers keep him via the
    // idempotent ensureSpecialAiWrestlers gate at hydrate time.
    ...(ELIJAH_PARTNERSHIP_ACTIVE
      ? [buildElijahJolesNpc({ weightClass, tier, style: 'freestyle', scope })]
      : []),
  ];
}

/**
 * Append any missing special NPCs to a pool. Idempotent: if a special
 * with the same id already exists, the slot is skipped. Used by both
 * generateExpandedRankingPool (for new careers) and the v5->v6 hydrate
 * path (for existing careers).
 *
 * @param {Array<object>} pool
 * @param {{ weightClass?: number, tier?: string, scope?: string }} [opts]
 */
export function ensureSpecialAiWrestlers(pool, opts) {
  if (!Array.isArray(pool)) return pool;
  const haveIds = new Set(pool.map(p => p?.id).filter(Boolean));
  const haveNames = new Set(pool.map(p => p?.name).filter(Boolean));
  const specials = buildSpecialAiWrestlers(opts);
  const additions = [];
  for (const s of specials) {
    // Belt-and-suspenders: an old career might have a wrestler named
    // "Chase Kamats" generated by random RNG before this round shipped.
    // Skip the inject if either the id OR the exact name is already
    // present, so we never end up with two Chases in one pool.
    if (haveIds.has(s.id)) continue;
    if (haveNames.has(s.name)) continue;
    additions.push(s);
  }
  if (additions.length === 0) return pool;
  return [...pool, ...additions];
}

// ─── Women's special NPC injection (v7) ──────────────────────────────────
//
// Mirror of buildSpecialAiWrestlers + ensureSpecialAiWrestlers, but for
// women's careers. Valerie Aikens at the tier cap; the four close-behind
// names at -2 / -3 below cap. All injected to conference scope so they
// surface in the top-25 leaderboard view.

/**
 * @param {{ weightClass?: number, tier?: string, scope?: string }} [opts]
 */
function buildSpecialWomensAiWrestlers({ weightClass, tier = 'hs', scope = 'conference' } = {}) {
  const valerieOverall = specialOverallForTier(tier, 0);   // tier cap
  const closeAOverall  = specialOverallForTier(tier, 2);   // -2
  const closeBOverall  = specialOverallForTier(tier, 3);   // -3
  const synth = (o) => ({ str: o, spd: o, tec: o, end: o, grt: o });
  return [
    {
      id: WOMENS_SPECIAL_AI_WRESTLER_IDS.VALERIE_AIKENS,
      name: 'Valerie Aikens',
      school: 'Linden Park',
      overall: valerieOverall,
      stats: synth(valerieOverall),
      weightClass, tier, scope,
      wins: 0, losses: 0, isSpecial: true,
    },
    {
      id: WOMENS_SPECIAL_AI_WRESTLER_IDS.LARISSA_NEWTON,
      name: 'Larissa Newton',
      school: 'Greenwood Catholic',
      overall: closeAOverall,
      stats: synth(closeAOverall),
      weightClass, tier, scope,
      wins: 0, losses: 0, isSpecial: true,
    },
    {
      id: WOMENS_SPECIAL_AI_WRESTLER_IDS.ANGELEE_KAMATS,
      name: 'Angelee Kamats',
      school: 'Cedar Ridge Prep',
      overall: closeAOverall,
      stats: synth(closeAOverall),
      weightClass, tier, scope,
      wins: 0, losses: 0, isSpecial: true,
    },
    {
      id: WOMENS_SPECIAL_AI_WRESTLER_IDS.NIKI_GARWOOD,
      name: 'Niki Garwood',
      school: 'Brighton Heights HS',
      overall: closeBOverall,
      stats: synth(closeBOverall),
      weightClass, tier, scope,
      wins: 0, losses: 0, isSpecial: true,
    },
    {
      id: WOMENS_SPECIAL_AI_WRESTLER_IDS.BROOKE_GABERSECK,
      name: 'Brooke Wennin',
      school: 'Foxhollow Academy',
      overall: closeBOverall,
      stats: synth(closeBOverall),
      weightClass, tier, scope,
      wins: 0, losses: 0, isSpecial: true,
    },
  ];
}

/**
 * Append any missing women's special NPCs to a pool. Idempotent.
 * Only used for women's-career ranking pools.
 */
export function ensureSpecialWomensAiWrestlers(pool, opts) {
  if (!Array.isArray(pool)) return pool;
  const haveIds = new Set(pool.map(p => p?.id).filter(Boolean));
  const haveNames = new Set(pool.map(p => p?.name).filter(Boolean));
  const specials = buildSpecialWomensAiWrestlers(opts);
  const additions = [];
  for (const s of specials) {
    if (haveIds.has(s.id)) continue;
    if (haveNames.has(s.name)) continue;
    additions.push(s);
  }
  if (additions.length === 0) return pool;
  return [...pool, ...additions];
}

/**
 * @param {{ weightClass?: number, tier?: string, state?: string, gender?: string, rng?: () => number }} [opts]
 */
export function generateExpandedRankingPool({ weightClass, tier = 'hs', state, gender = 'male', rng = Math.random } = {}) {
  const mod = getStateOverallModifier(state);
  const tierRanges = POOL_RANGES_BY_TIER[tier] || POOL_RANGES_BY_TIER.hs;
  const cap = tierRanges.cap;
  const shift = ([lo, hi]) => ({
    lo: Math.max(30, Math.min(cap - 1, lo + mod.baseline)),
    hi: Math.max(35, Math.min(cap,     hi + mod.baseline + mod.spread)),
  });
  const used = new Set();
  const c  = shift(tierRanges.conf);
  const s  = shift(tierRanges.sec);
  const st = shift(tierRanges.state);
  // v5: tier-aware pool sizes. Defaults to HS sizes for any unrecognized
  // tier so the legacy contract (always-returns-something) holds.
  const sizes = POOL_SIZES_BY_TIER[tier] || POOL_SIZES_BY_TIER.hs;
  const conf = generateScopedPool({
    weightClass, tier, rng, count: sizes.conference, scope: 'conference',
    used, overallMin: c.lo, overallMax: c.hi, idPrefix: 'rank', gender,
  });
  const section = generateScopedPool({
    weightClass, tier, rng, count: sizes.section, scope: 'section',
    used, overallMin: s.lo, overallMax: s.hi, idPrefix: 'rank', gender,
  });
  const stateScope = generateScopedPool({
    weightClass, tier, rng, count: sizes.state, scope: 'state',
    used, overallMin: st.lo, overallMax: st.hi, idPrefix: 'rank', gender,
  });
  // Inject canonical named NPCs into conference scope so they show up
  // in the top-25 leaderboard view. Female careers get the women's-side
  // pantheon (Valerie Aikens + close-behind 4); male careers get the
  // men's-side pantheon (Chase Kamats + Jordon Eckstrom). Idempotent
  // via stable IDs.
  if (gender === 'female') {
    return ensureSpecialWomensAiWrestlers(
      [...conf, ...section, ...stateScope],
      { weightClass, tier, scope: 'conference' },
    );
  }
  return ensureSpecialAiWrestlers(
    [...conf, ...section, ...stateScope],
    { weightClass, tier, scope: 'conference' },
  );
}

/**
 * Build the leaderboard views shown on the rankings detail screen. Takes
 * a flat pool (conference + section + state NPCs) and produces three
 * ranked arrays, each capped at its target length:
 *    conference: top 25 of conference-scope wrestlers + player
 *    section:    top 50 of conference+section wrestlers + player
 *    state:      top 100 of all wrestlers + player
 *
 * Each entry is shaped for display: { id, name, school, overall, wins,
 * losses, isPlayer, rank }. Player is highlighted via isPlayer=true.
 */
/**
 * @param {Array<object>} pool
 * @param {{ player?: { name?: string, school?: string, overall?: number, wins?: number, losses?: number } }} [opts]
 */
export function buildRankingsViews(pool, { player } = {}) {
  const playerEntry = player ? {
    id: '__player__',
    name: player.name || 'You',
    school: player.school || 'Your School',
    overall: player.overall || 55,
    wins: player.wins || 0,
    losses: player.losses || 0,
    scope: 'conference',
    isPlayer: true,
  } : null;

  const tagged = (Array.isArray(pool) ? pool : []).map(w => ({ ...w, isPlayer: false }));
  const all = playerEntry ? [...tagged, playerEntry] : tagged;

  const sortByRecord = (a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aPct = a.wins / Math.max(1, a.wins + a.losses);
    const bPct = b.wins / Math.max(1, b.wins + b.losses);
    if (bPct !== aPct) return bPct - aPct;
    return (b.overall || 0) - (a.overall || 0);
  };

  const rank = (list, cap) => {
    const sorted = [...list].sort(sortByRecord);
    return sorted.slice(0, cap).map((w, i) => ({ ...w, rank: i + 1 }));
  };

  const confList = all.filter(w => w.scope === 'conference');
  const sectionList = all.filter(w => w.scope === 'conference' || w.scope === 'section');
  const stateList = all;

  return {
    conference: rank(confList, RANKINGS_VIEW_SIZE.conference),
    section:    rank(sectionList, RANKINGS_VIEW_SIZE.section),
    state:      rank(stateList, RANKINGS_VIEW_SIZE.state),
  };
}

// ─── Per-week update ───────────────────────────────────────────────────────

/**
 * Logistic win probability: higher-overall wrestler wins more often, but
 * the gap isn't deterministic. A +10 overall gap → ~73% win rate.
 */
function winProbability(myOverall, oppOverall) {
  const diff = myOverall - oppOverall;
  return 1 / (1 + Math.exp(-diff / 8));
}

/**
 * Sim each pool wrestler's weekly match against a random peer. Mutates
 * a NEW array (no in-place edits). The player is excluded - their W-L
 * comes from real gameplay (careerState.record).
 */
export function simWeekForPool(pool, { rng = Math.random } = {}) {
  if (!pool || pool.length < 2) return pool;
  // Pair up by shuffling indices.
  const idxs = pool.map((_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }

  const next = pool.map(w => ({ ...w }));
  for (let i = 0; i + 1 < idxs.length; i += 2) {
    const a = next[idxs[i]];
    const b = next[idxs[i + 1]];
    const pA = winProbability(a.overall, b.overall);
    const aWon = rng() < pA;
    if (aWon) { a.wins++; b.losses++; }
    else      { b.wins++; a.losses++; }
  }
  return next;
}

/**
 * Compute the player's position against the pool. Player's own record
 * (wins/losses) comes from the real careerState record, not the sim.
 * Returns 1-based rank where 1 = best.
 *
 * Tiebreak: total wins desc, then win percentage desc, then overall desc.
 */
export function computeConferenceRank(pool, { playerWins, playerLosses, playerOverall }) {
  const all = [
    ...pool.map(w => ({ wins: w.wins, losses: w.losses, overall: w.overall, isPlayer: false })),
    { wins: playerWins || 0, losses: playerLosses || 0, overall: playerOverall || 0, isPlayer: true },
  ];
  all.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    const aPct = a.wins / Math.max(1, a.wins + a.losses);
    const bPct = b.wins / Math.max(1, b.wins + b.losses);
    if (bPct !== aPct) return bPct - aPct;
    return b.overall - a.overall;
  });
  return all.findIndex(w => w.isPlayer) + 1;
}

/**
 * Given a conference rank, approximate section and state ranks.
 * Deterministic within a conference rank but noise per-call so numbers
 * can drift slightly week to week (feels realistic).
 */
export function deriveOuterRanks(conferenceRank, { rng = Math.random } = {}) {
  const sectionNoise = Math.floor((rng() - 0.5) * 4);  // -2..+1
  const stateNoise = Math.floor((rng() - 0.5) * 12);   // -6..+5
  const sectionRank = Math.max(
    1,
    conferenceRank * CONFERENCES_PER_SECTION - Math.floor(CONFERENCES_PER_SECTION / 2) + sectionNoise
  );
  const stateRank = Math.max(
    1,
    sectionRank * SECTIONS_PER_STATE - Math.floor(SECTIONS_PER_STATE / 2) + stateNoise
  );
  return { sectionRank, stateRank };
}

// ─── Top-level integration hook ────────────────────────────────────────────

/**
 * Rankings update called from careerState.recordEventResult after every
 * career event. NPCs accumulate wins/losses at the same rate the player
 * does: a dual = 1 match each, a tournament = N matches each (where N is
 * the player's bracket round count). Without this scaling the pool
 * accumulates ~1 match per event while the player banks 4-5 in a single
 * tournament, leaving the leaderboard reading "you 5-0, top NPC 1-0".
 *
 * @param {{ pool: Array<object>, playerWins?: number, playerLosses?: number, playerOverall?: number, asOfEventIdx?: number, matchesPlayed?: number, rng?: () => number }} args
 */
export function updateRankingsWeekly({
  pool,
  playerWins,
  playerLosses,
  playerOverall,
  asOfEventIdx,
  matchesPlayed = 1,
  rng = Math.random,
}) {
  const passes = Math.max(1, Math.min(16, Math.floor(matchesPlayed)));
  let nextPool = pool;
  for (let i = 0; i < passes; i++) {
    nextPool = simWeekForPool(nextPool, { rng });
  }

  // If the pool has scope tags (conference/section/state), compute exact
  // ranks for each scope. Otherwise fall back to the legacy derive-from-
  // conference approximation so old careers that predate the expanded
  // pool still render something reasonable.
  const hasScopes = Array.isArray(nextPool) && nextPool.some(w => w.scope);
  if (hasScopes) {
    const confPool = nextPool.filter(w => w.scope === 'conference');
    const secPool = nextPool.filter(w => w.scope === 'conference' || w.scope === 'section');
    const conference = computeConferenceRank(confPool, { playerWins, playerLosses, playerOverall });
    const section = computeConferenceRank(secPool, { playerWins, playerLosses, playerOverall });
    const state = computeConferenceRank(nextPool, { playerWins, playerLosses, playerOverall });
    return {
      pool: nextPool,
      rankings: { conference, section, state, asOfEventIdx },
    };
  }

  const conference = computeConferenceRank(nextPool, { playerWins, playerLosses, playerOverall });
  const { sectionRank, stateRank } = deriveOuterRanks(conference, { rng });
  return {
    pool: nextPool,
    rankings: {
      conference,
      section: sectionRank,
      state: stateRank,
      asOfEventIdx,
    },
  };
}

// ─── Constants for tests / UI tooltips ─────────────────────────────────────

export const RANKINGS_CONSTANTS = {
  CONFERENCE_SIZE,
  SECTION_EXTRA_SIZE,
  STATE_EXTRA_SIZE,
  SECTIONS_PER_STATE,
  CONFERENCES_PER_SECTION,
};
