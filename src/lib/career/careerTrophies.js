// ─── Career Trophies - Display Helpers ──────────────────────────────────────
// Helpers for rendering the Trophy Case. The trophy objects themselves are
// minted by careerState.recordEventResult - see record.titles[].

const TYPE_LABEL = {
  // HS
  state:              'State Champion',
  regional:           'Regional Champion',
  district:           'District Champion', // v9: HS postseason intermediate
  conference:         'Conference Champion',
  // College (collegiate naming, no NCAA brand)
  invitational:       'Invitational Champion',
  conference_d1:      'Conference Champion',
  ncaa:               'National Collegiate Champion',
  // Senior International (no IOC marks; generic descriptors only)
  open:               'Open Champion',
  us_open:            'American Open Champion',
  world_trials:       'World Team Member',
  olympic_trials:     'International Games Team Member',
  world_championship: 'World Champion',
  olympics:           'International Games Gold Medalist',
  // Generic fallbacks
  championship:       'Champion',
  tournament:         'Tournament Champion',
};

const TYPE_ICON = {
  // HS - cups for the big finishes, plaque for conference
  state:              'cup',
  regional:           'cup',
  district:           'plaque', // v9
  conference:         'plaque',
  // College - cups for NCAA + Conference, medal for invitationals
  invitational:       'medal',
  conference_d1:      'cup',
  ncaa:               'cup',
  // Senior International - medals everywhere (UWW tradition)
  open:               'medal',
  us_open:            'medal',
  world_trials:       'medal',
  olympic_trials:     'medal',
  world_championship: 'medal',
  olympics:           'medal',
  championship:       'cup',
  tournament:         'medal',
};

// Pre-prestige color hint per type. Prestige on the trophy itself (gold/silver)
// still wins; this fills in for types where the engine didn't assign prestige.
const TYPE_TIER_HINT = {
  state:              'gold',          // user's home state title - special
  regional:           'silver',
  district:           'silver',        // v9: matches regional tier
  conference:         null,            // bronze
  invitational:       null,            // bronze
  conference_d1:      'silver',
  ncaa:               'gold',          // big deal
  open:               null,
  us_open:            'silver',
  world_trials:       'silver',
  olympic_trials:     'silver',
  world_championship: 'gold',
  olympics:           'gold',          // ultimate
};

const COLOR_PALETTE = {
  gold:   { primary: '#fbbf24', secondary: '#b45309', glow: 'rgba(251,191,36,0.55)' },
  silver: { primary: '#d4d4d8', secondary: '#71717a', glow: 'rgba(212,212,216,0.45)' },
  bronze: { primary: '#b45309', secondary: '#78350f', glow: 'rgba(180,83,9,0.4)' },
};

/**
 * Color palette for a trophy based on prestige + type. Explicit prestige on
 * the trophy entry wins; otherwise we fall back to a per-type tier hint so
 * NCAA / World / Olympic golds never render as generic bronze.
 */
export function trophyColors(trophy) {
  const explicit = trophy?.prestige;
  if (explicit === 'gold')   return COLOR_PALETTE.gold;
  if (explicit === 'silver') return COLOR_PALETTE.silver;
  const hint = TYPE_TIER_HINT[trophy?.type];
  if (hint === 'gold')   return COLOR_PALETTE.gold;
  if (hint === 'silver') return COLOR_PALETTE.silver;
  // Tournament wins keep a stone-grey tone to distinguish from championships.
  if (trophy?.type === 'tournament') {
    return { primary: '#a8a29e', secondary: '#57534e', glow: 'rgba(168,162,158,0.35)' };
  }
  return COLOR_PALETTE.bronze;
}

/**
 * Trophy "shape" - affects which 3D primitive renders in the detail modal.
 */
export function trophyIcon(trophy) {
  return TYPE_ICON[trophy?.type] || 'cup';
}

/**
 * Display label for a trophy. Falls back to its name if the type is unusual.
 */
export function trophyTypeLabel(trophy) {
  if (!trophy) return '';
  return TYPE_LABEL[trophy.type] || trophy.name || 'Trophy';
}

// Career Depth Pass v1 - Forward-Only Prestige Badges.
// Four season-end badges minted from `career.seasonMeta` + `career.record`
// only. No retroactive grants for legacy seasons (eligibility is gated by
// `seasonMeta.badgeEligibleSeasonYear` checked at the call site in
// careerState.recordEventResult).
//
// Each badge has a deterministic `detect(career)` predicate. Detection runs
// once at season-end inside recordEventResult; earned badges are appended
// to `career.prestigeBadges[]` and surfaced via `lastEventBadges`.

export const PRESTIGE_BADGES = {
  undefeated_season: {
    id: 'undefeated_season',
    name: 'Undefeated Season',
    icon: '\u{1F947}', // 1st place medal
    description: 'Won every match this season AND earned a championship title.',
    detect: (career) => {
      const r = career?.record;
      if (!r) return false;
      const wins = Number(r.seasonWins) || 0;
      const losses = Number(r.seasonLosses) || 0;
      if (losses !== 0) return false;
      if (wins === 0) return false;
      // Title earned this season (championship/tournament with placement 1).
      const seasonYear = career.schedule?.seasonYear;
      const titles = Array.isArray(r.titles) ? r.titles : [];
      return titles.some(t => t.season === seasonYear &&
        (t.type === 'state' || t.type === 'regional' || t.type === 'conference' ||
         t.type === 'ncaa' || t.type === 'conference_d1' || t.type === 'invitational' ||
         t.type === 'world_championship' || t.type === 'olympics' ||
         t.type === 'us_open' || t.type === 'world_trials' || t.type === 'olympic_trials' ||
         t.type === 'championship' || t.type === 'tournament'));
    },
  },
  pin_king: {
    id: 'pin_king',
    name: 'Pin King',
    icon: '\u{1F451}', // crown
    description: 'Pinned 10+ opponents in a single season.',
    detect: (career) => (Number(career?.seasonMeta?.pinsThisSeason) || 0) >= 10,
  },
  giant_slayer: {
    id: 'giant_slayer',
    name: 'Giant Slayer',
    icon: '\u{2694}\u{FE0F}', // crossed swords
    description: 'Beat a top-3 ranked NPC in your scope this season.',
    detect: (career) => (Number(career?.seasonMeta?.giantSlayerWinsThisSeason) || 0) >= 1,
  },
  iron_will: {
    id: 'iron_will',
    name: 'Iron Will',
    icon: '\u{1F6E1}\u{FE0F}', // shield
    description: 'Completed a full season without taking a single negative tempBuff.',
    detect: (career) => {
      const meta = career?.seasonMeta;
      if (!meta) return false;
      const debuffs = Number(meta.debuffEventCount) || 0;
      const wins = Number(career?.record?.seasonWins) || 0;
      const losses = Number(career?.record?.seasonLosses) || 0;
      return debuffs === 0 && (wins + losses) > 0;
    },
  },
};

/**
 * Walk the prestige-badge detectors and return the newly earned badges
 * (those not already in `career.prestigeBadges`). Pure function; the caller
 * appends the returned descriptors to the persisted list.
 *
 * @param {object} career
 * @returns {Array<{ id: string, name: string, icon: string, description: string, seasonYear: number, tier: string, earnedAt: number }>}
 */
export function detectNewPrestigeBadges(career) {
  if (!career) return [];
  const already = new Set(
    (Array.isArray(career.prestigeBadges) ? career.prestigeBadges : []).map(b => b?.id)
  );
  const newlyEarned = [];
  const seasonYear = career.schedule?.seasonYear || 1;
  const tier = career.wrestler?.tier || 'hs';
  const now = Date.now();
  for (const key of Object.keys(PRESTIGE_BADGES)) {
    const def = PRESTIGE_BADGES[key];
    if (already.has(def.id)) continue;
    try {
      if (def.detect(career)) {
        newlyEarned.push({
          id: def.id,
          name: def.name,
          icon: def.icon,
          description: def.description,
          seasonYear,
          tier,
          earnedAt: now,
        });
      }
    } catch (_err) {
      // Detector errors should never crash season-end; just skip the badge.
    }
  }
  return newlyEarned;
}

/**
 * Group an array of trophies by season for the swipe carousel.
 * Returns Array<{ season, trophies[] }> sorted by season ascending.
 */
export function groupTrophiesBySeason(trophies) {
  if (!Array.isArray(trophies) || trophies.length === 0) return [];
  const buckets = new Map();
  for (const t of trophies) {
    const key = t.season ?? 0;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, list]) => ({ season, trophies: list }));
}
