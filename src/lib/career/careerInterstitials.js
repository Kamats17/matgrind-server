// ─── Career Interstitials - Between-Match Events ────────────────────────────
// Small mini-events presented between bracket rounds in career tournaments.
// Each grants a temporary buff that lasts exactly the next match. The pool
// is rolled per-round so the choices vary, and dramatic options only appear
// in big tournaments (state championship gets the cool "coach pulls you
// aside" stuff).

const ALL_EVENTS = [
  {
    id: 'rest',
    label: 'Rest in the locker room',
    description: 'Restore stamina before the next round.',
    minStakes: 'tournament',
    buff: { type: 'stamina_restore', amount: 0.05, label: '+5% stamina' },
  },
  {
    id: 'scout',
    label: 'Watch your next opponent',
    description: '+1 SPD next round (faster reads from the prep work).',
    minStakes: 'tournament',
    buff: { type: 'stat_boost', stat: 'spd', amount: 1, label: '+1 SPD (scouted)' },
  },
  {
    id: 'pep_talk',
    label: 'Coach pep talk',
    description: '+1 grit for the next match.',
    minStakes: 'tournament',
    buff: { type: 'stat_boost', stat: 'grt', amount: 1, duration: 1, label: '+1 GRT' },
  },
  {
    id: 'warmup',
    label: 'Quick warm-up',
    description: '+1 speed but -2% stamina.',
    minStakes: 'tournament',
    buff: { type: 'stat_boost', stat: 'spd', amount: 1, duration: 1, staminaCost: 0.02, label: '+1 SPD' },
  },
  {
    id: 'tape_wrist',
    label: 'Re-tape your wrist',
    description: 'Reduces injury chance this match.',
    minStakes: 'tournament',
    buff: { type: 'injury_reduction', amount: 0.5, label: 'Injury -50%' },
  },
  {
    id: 'hydrate',
    label: 'Hydrate / refuel',
    description: 'Restore stamina lost in the previous match.',
    minStakes: 'tournament',
    buff: { type: 'stamina_restore', amount: 0.10, label: '+10% stamina' },
  },
  {
    id: 'weight_check',
    label: 'Cut weight scare',
    description: 'Risky: 80% no effect, 20% -3 to all stats next match.',
    minStakes: 'tournament',
    buff: { type: 'risk_weight_cut', label: 'Weigh-in roll' },
  },
  {
    id: 'crowd_hype',
    label: 'Soak in the crowd hype',
    description: '+1 grit; the building is electric.',
    minStakes: 'conference',
    buff: { type: 'stat_boost', stat: 'grt', amount: 1, duration: 1, label: '+1 GRT' },
  },
  {
    id: 'coach_corner',
    label: 'Coach pulls you aside',
    description: '+1 to your two highest stats for the next match.',
    minStakes: 'state',
    buff: { type: 'stat_boost_top2', amount: 1, duration: 1, label: 'Stat focus' },
  },
  {
    id: 'visualize',
    label: 'Visualize the match',
    description: '+1 GRT next round (mental rehearsal pays off).',
    minStakes: 'regional',
    buff: { type: 'stat_boost', stat: 'grt', amount: 1, duration: 1, label: '+1 GRT (visualized)' },
  },
];

const STAKES_TIER = { tournament: 0, conference: 1, regional: 2, state: 3 };

/**
 * Roll a small set of interstitial choices for the given event stakes.
 * Returns 2-3 distinct events the player can pick from.
 *
 * @param {object} opts
 * @param {string} opts.stakes  'tournament' | 'conference' | 'regional' | 'state'
 * @param {() => number} [opts.rng]
 * @returns {Array<object>} 2-3 events
 */
export function rollInterstitial({ stakes = 'tournament', rng = Math.random } = {}) {
  const tier = STAKES_TIER[stakes] ?? 0;
  // Filter events by min stakes - bigger tournaments unlock more dramatic options.
  const eligible = ALL_EVENTS.filter(e => (STAKES_TIER[e.minStakes] ?? 0) <= tier);
  if (eligible.length === 0) return [];

  const count = 2 + Math.floor(rng() * 2); // 2 or 3
  const choices = [];
  const used = new Set();
  while (choices.length < Math.min(count, eligible.length)) {
    const pick = eligible[Math.floor(rng() * eligible.length)];
    if (used.has(pick.id)) continue;
    used.add(pick.id);
    choices.push(pick);
  }
  return choices;
}

/**
 * Apply a chosen interstitial event to a wrestler's tempBuffs[]. Returns a
 * new wrestler object. The buff lasts exactly 1 match.
 *
 * Career Depth Pass v1: the buff is consumed at match start by the career
 * caller via `applyCareerMatchModifiers` (in careerMatchModifiers.js), which
 * returns a `consumedBuffSourceIds[]` that is then forwarded to
 * `recordEventResult` so `tickConsumedTempBuffs` can drop the consumed
 * entries. The old "engine consumes it on match start" comment was a
 * lie: the wrestlingEngine has no awareness of tempBuffs - the career
 * boundary is the consumer.
 *
 * For 'risk_weight_cut', resolve the roll here so persistence doesn't
 * carry the random side-effect.
 *
 * @param {object} wrestler - career.wrestler
 * @param {object} event - the chosen event from rollInterstitial
 * @param {() => number} [rng]
 * @returns {object} new wrestler with buff appended
 */
export function applyInterstitialChoice(wrestler, event, rng = Math.random) {
  if (!wrestler || !event) return wrestler;
  const tempBuffs = Array.isArray(wrestler.tempBuffs) ? [...wrestler.tempBuffs] : [];

  if (event.buff.type === 'risk_weight_cut') {
    if (rng() < 0.20) {
      // 20%: -3 to all stats for next match
      tempBuffs.push({
        sourceId: event.id,
        type: 'stat_boost_all',
        amount: -3,
        duration: 1,
        label: 'Bad weigh-in: -3 all stats',
        debuff: true,
      });
    }
    // else: no effect
  } else {
    // Career Depth Pass v1: stamp `debuff: false` by default. The
    // interstitial pool is overwhelmingly positive (rest, scout, pep talk,
    // hydrate, warmup, etc.). Authors can override with `buff.debuff = true`
    // on individual entries if a future option ships as a true debuff.
    tempBuffs.push({
      sourceId: event.id,
      debuff: event.buff.debuff === true,
      ...event.buff,
      duration: event.buff.duration ?? 1,
    });
  }

  return { ...wrestler, tempBuffs };
}

/**
 * DEPRECATED for new code paths.
 *
 * Career Depth Pass v1 introduced `tickConsumedTempBuffs(wrestler, consumedSourceIds)`
 * in `./careerMatchModifiers.js` as the authoritative consumer. It also returns
 * the consumed buff objects so `recordEventResult` can count debuffs against
 * `seasonMeta.debuffEventCount`.
 *
 * This original `tickTempBuffs` is kept as a stable export so legacy callers
 * (if any external scripts imported it) continue to work, but it has no live
 * callers inside the app. Prefer the new helper for all new wiring.
 *
 * @param {object} wrestler
 * @returns {object}
 */
export function tickTempBuffs(wrestler) {
  if (!wrestler) return wrestler;
  const tempBuffs = (wrestler.tempBuffs || [])
    .map(b => ({ ...b, duration: (b.duration ?? 1) - 1 }))
    .filter(b => b.duration > 0);
  return { ...wrestler, tempBuffs };
}

export const INTERSTITIAL_EVENTS = ALL_EVENTS;
