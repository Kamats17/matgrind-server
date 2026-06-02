// Career Match Modifiers
// Translates a career wrestler's pending `tempBuffs[]` into engine-acceptable
// stat / stamina modifiers and a list of player-facing banner strings, then
// (after the match) ticks consumed buffs off the wrestler.
//
// Wiring contract (Career Depth Pass v1):
//   1. At career match start, the caller passes `career.wrestler` into
//      `applyCareerMatchModifiers` and receives the modified stat block plus
//      a `staminaMultiplier` to forward to `createInitialMatchState` as
//      `opts.p1StaminaMultiplier`.
//   2. The returned `banners[]` strings are rendered pre-match so the player
//      sees the buff/debuff labels in play.
//   3. The returned `consumedBuffSourceIds[]` is forwarded to the match
//      result payload; `recordEventResult` then calls
//      `tickConsumedTempBuffs(wrestler, consumedSourceIds)` to remove the
//      consumed buffs and decrement surviving durations.
//   4. For tournaments, modifiers are computed ONCE at the first bracket
//      round of the event and stashed; consumption happens only when the
//      tournament event finalizes via `recordEventResult` (avoids per-round
//      double consumption).
//
// `sanitizeTempBuffs` is the hydration-safe entry point; never throws on
// malformed input. It backfills a stable, deterministic `sourceId` for legacy
// buffs missing one so subsequent ticks can target them by id.

const KNOWN_BUFF_TYPES = new Set([
  'stamina_restore',
  'stat_boost_all',
  'stat_boost',
  'stat_boost_top2',
  'timing_boost',
  'scout_cards',
  'injury_reduction',
  'risk_weight_cut',
]);

const STAT_KEYS = ['str', 'spd', 'tec', 'end', 'grt'];

const STAMINA_MULTIPLIER_MIN = 0.3;
const STAMINA_MULTIPLIER_MAX = 2.0;

const DURATION_MIN = 1;
const DURATION_MAX = 10;

function slugify(value) {
  if (value == null) return 'untitled';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'untitled';
}

function clampDuration(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(DURATION_MIN, Math.min(DURATION_MAX, Math.round(n)));
}

function clampStat(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(99, Math.round(value)));
}

function clampStaminaMultiplier(value) {
  if (!Number.isFinite(value)) return 1.0;
  return Math.max(STAMINA_MULTIPLIER_MIN, Math.min(STAMINA_MULTIPLIER_MAX, value));
}

/**
 * Drop malformed tempBuff entries and backfill mandatory fields. Never
 * throws. Returns a fresh array.
 *
 *  - Non-object entries (null, undefined, strings) are dropped
 *  - Entries with no `type` or with an unknown `type` are dropped
 *  - `duration` is coerced to a positive integer in [1, 10]
 *  - Missing `sourceId` is backfilled as `legacy_${idx}_${type}_${labelSlug}`
 *    so subsequent ticks stay stable across saves
 *  - Missing `debuff` defaults to false (explicit > implicit; do not infer
 *    from amount sign)
 */
export function sanitizeTempBuffs(tempBuffs) {
  if (!Array.isArray(tempBuffs)) return [];
  const out = [];
  for (let idx = 0; idx < tempBuffs.length; idx++) {
    const entry = tempBuffs[idx];
    if (!entry || typeof entry !== 'object') continue;
    if (!entry.type || !KNOWN_BUFF_TYPES.has(entry.type)) continue;
    const labelSlug = slugify(entry.label || entry.type);
    out.push({
      ...entry,
      sourceId: entry.sourceId || `legacy_${idx}_${entry.type}_${labelSlug}`,
      duration: clampDuration(entry.duration ?? 1),
      label: entry.label || entry.type,
      debuff: entry.debuff === true,
    });
  }
  return out;
}

/**
 * Compute per-match modifiers from a career wrestler's pending `tempBuffs[]`.
 * Returns the modified base stats (clamped 0..99), an aggregate stamina
 * multiplier (clamped to a safe range), the count of scouted opponent cards,
 * pre-match banner strings, and the list of buff sourceIds being consumed
 * this match.
 *
 * Pure function. Does not mutate `wrestler`.
 *
 * @param {object} wrestler  career.wrestler
 * @returns {{
 *   stats: { str: number, spd: number, tec: number, end: number, grt: number },
 *   staminaMultiplier: number,
 *   scoutCardCount: number,
 *   banners: string[],
 *   consumedBuffSourceIds: string[],
 * }}
 */
export function applyCareerMatchModifiers(wrestler) {
  const baseStats = wrestler?.stats || { str: 0, spd: 0, tec: 0, end: 0, grt: 0 };
  const result = {
    stats: {
      str: clampStat(baseStats.str),
      spd: clampStat(baseStats.spd),
      tec: clampStat(baseStats.tec),
      end: clampStat(baseStats.end),
      grt: clampStat(baseStats.grt),
    },
    staminaMultiplier: 1.0,
    scoutCardCount: 0,
    banners: [],
    consumedBuffSourceIds: [],
  };

  const buffs = Array.isArray(wrestler?.tempBuffs) ? wrestler.tempBuffs : [];
  if (buffs.length === 0) return result;

  let staminaMul = 1.0;

  for (const buff of buffs) {
    if (!buff || typeof buff !== 'object') continue;

    switch (buff.type) {
      case 'stat_boost_all': {
        const amount = Number(buff.amount) || 0;
        for (const stat of STAT_KEYS) {
          result.stats[stat] = clampStat(result.stats[stat] + amount);
        }
        result.banners.push(buff.label || `${amount >= 0 ? '+' : ''}${amount} all stats`);
        break;
      }
      case 'stat_boost': {
        const amount = Number(buff.amount) || 0;
        const stat = buff.stat;
        if (STAT_KEYS.includes(stat)) {
          result.stats[stat] = clampStat(result.stats[stat] + amount);
          result.banners.push(buff.label || `${amount >= 0 ? '+' : ''}${amount} ${stat.toUpperCase()}`);
        }
        if (Number.isFinite(buff.staminaCost)) {
          staminaMul *= 1.0 - Number(buff.staminaCost);
        }
        break;
      }
      case 'stat_boost_top2': {
        const amount = Number(buff.amount) || 0;
        const sorted = STAT_KEYS
          .map(s => [s, result.stats[s]])
          .sort((a, b) => b[1] - a[1]);
        for (let i = 0; i < 2 && i < sorted.length; i++) {
          const stat = sorted[i][0];
          result.stats[stat] = clampStat(result.stats[stat] + amount);
        }
        result.banners.push(buff.label || `+${amount} to top 2 stats`);
        break;
      }
      case 'stamina_restore': {
        const amount = Number(buff.amount) || 0;
        staminaMul *= 1.0 + amount;
        result.banners.push(buff.label || `${amount >= 0 ? '+' : ''}${Math.round(amount * 100)}% stamina`);
        break;
      }
      case 'timing_boost': {
        result.banners.push(buff.label || 'Timing boost');
        break;
      }
      case 'scout_cards': {
        result.scoutCardCount += Number(buff.count) || 0;
        result.banners.push(buff.label || `Scout ${buff.count || 0} cards`);
        break;
      }
      case 'injury_reduction': {
        result.banners.push(buff.label || 'Injury reduction');
        break;
      }
      default:
        continue;
    }

    if (buff.sourceId) result.consumedBuffSourceIds.push(buff.sourceId);
  }

  result.staminaMultiplier = clampStaminaMultiplier(staminaMul);
  return result;
}

/**
 * Remove consumed buffs from `wrestler.tempBuffs[]` and decrement
 * surviving buffs' duration by 1 (drop when <= 0). Returns the new wrestler
 * AND the list of buff objects that were removed this tick. `recordEventResult`
 * needs the actual objects (not just sourceIds) to count debuffs against
 * `seasonMeta.debuffEventCount`.
 *
 * @param {object} wrestler
 * @param {string[]} consumedSourceIds  ids of buffs consumed by the match
 * @returns {{ wrestler: object, consumedBuffs: object[] }}
 */
export function tickConsumedTempBuffs(wrestler, consumedSourceIds = []) {
  if (!wrestler) return { wrestler, consumedBuffs: [] };
  const buffs = Array.isArray(wrestler.tempBuffs) ? wrestler.tempBuffs : [];
  if (buffs.length === 0) return { wrestler, consumedBuffs: [] };

  const consumedSet = new Set(Array.isArray(consumedSourceIds) ? consumedSourceIds : []);
  const consumedBuffs = [];
  const survivors = [];

  for (const buff of buffs) {
    if (!buff || typeof buff !== 'object') continue;
    if (buff.sourceId && consumedSet.has(buff.sourceId)) {
      consumedBuffs.push(buff);
      continue;
    }
    const nextDuration = (Number(buff.duration) || 1) - 1;
    if (nextDuration <= 0) {
      consumedBuffs.push(buff);
      continue;
    }
    survivors.push({ ...buff, duration: nextDuration });
  }

  return {
    wrestler: { ...wrestler, tempBuffs: survivors },
    consumedBuffs,
  };
}

export const __test__ = {
  STAMINA_MULTIPLIER_MIN,
  STAMINA_MULTIPLIER_MAX,
  DURATION_MIN,
  DURATION_MAX,
  KNOWN_BUFF_TYPES,
};
