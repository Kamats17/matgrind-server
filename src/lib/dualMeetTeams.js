// Dual-meet team generation and lineup helpers.
//
// A team is an array of 10 wrestlers, one per NCAA weight class. The player's
// hero occupies whichever class they chose on the setup screen; the other 9
// slots are either auto-generated (random mode) or filled from a saved roster
// (pre-draft mode). The opposing team is always auto-generated.

import { generateOpponent } from './tournamentOpponents.js';
import { generateEventNames } from './namePools.js';
import { NCAA_WEIGHT_CLASSES, weightStatDeltas } from './ncaaWeights.js';

// Short college-style name generator for AI teams
const TEAM_PREFIXES = [
  'Ridgeview', 'North Valley', 'Iron Hill', 'Cedar Creek', 'Copper State',
  'Lakeside', 'Summit', 'Granite', 'Eastport', 'Blackwood',
];
const TEAM_MASCOTS = [
  'Wolves', 'Grizzlies', 'Hawks', 'Titans', 'Bulldogs', 'Cyclones',
  'Raptors', 'Badgers', 'Mustangs', 'Vikings',
];

export function generateTeamName(exclude) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const p = TEAM_PREFIXES[Math.floor(Math.random() * TEAM_PREFIXES.length)];
    const m = TEAM_MASCOTS[Math.floor(Math.random() * TEAM_MASCOTS.length)];
    const name = `${p} ${m}`;
    if (name !== exclude) return name;
  }
  return 'Visiting Team';
}

/**
 * Clamp every stat into the playable band used by the engine.
 * @param {{str:number,spd:number,tec:number,end:number,grt:number}} stats
 */
function clampStats(stats) {
  const out = {};
  for (const k of Object.keys(stats)) {
    out[k] = Math.max(25, Math.min(90, Math.round(stats[k])));
  }
  return out;
}

/**
 * Generate a CPU opponent team across the supplied weight classes.
 * Reuses tournament opponent generation (name + archetype + colors) and then
 * applies a weight-class stat tweak so HWT feels heavier than 125.
 *
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {Set<string>} usedNames - names already taken (excludes duplicates vs player hero, etc.)
 * @param {string[]} usedColorIds - color ids already taken
 * @param {{ weights?: number[], gender?: 'male'|'female', usedFirsts?: Set<string>, usedLasts?: Set<string> }} [opts] - weight-class table to use; defaults to NCAA.
 * @returns {Array<{weight:number,name:string,stats:object,appearance:object,isHero:boolean}>}
 */
export function generateCpuTeam(difficulty, usedNames = new Set(), usedColorIds = [], opts = {}) {
  // Use a consistent "tournament round" so all wrestlers share a stat budget
  // roughly centred on the player's profile power band. 'qf' is a reasonable
  // mid-tier budget (see STAT_BUDGETS in tournamentOpponents.js).
  const budgetRound = 'qf';
  const weights = (Array.isArray(opts.weights) && opts.weights.length > 0)
    ? opts.weights
    : NCAA_WEIGHT_CLASSES;
  // Batch-generate the CPU roster so first/last names are de-collided across
  // the team - and, via the shared usedNames/usedFirsts/usedLasts sets, the
  // player's team too.
  const names = generateEventNames({
    count: weights.length, gender: opts.gender,
    used: usedNames, usedFirsts: opts.usedFirsts, usedLasts: opts.usedLasts,
  });
  return weights.map((weight, i) => {
    const opp = generateOpponent(budgetRound, difficulty, usedNames, usedColorIds, { gender: opts.gender, name: names[i] });
    const delta = weightStatDeltas(weight);
    const stats = clampStats({
      str: opp.stats.str + delta.str,
      spd: opp.stats.spd + delta.spd,
      tec: opp.stats.tec + delta.tec,
      end: opp.stats.end + delta.end,
      grt: opp.stats.grt + delta.grt,
    });
    return {
      weight,
      name: opp.name,
      stats,
      appearance: opp.appearance,
      isHero: false,
    };
  });
}

/**
 * Build the player's team from hero + optional roster and/or AI fill.
 *
 * For MVP the "roster" simply lets callers pass in a pre-picked array of
 * teammates; if fewer than (weights.length - 1) are supplied, the remaining
 * slots are auto-filled with AI wrestlers (clearly flagged via the `isAiFill`
 * bool so the UI can label them). The hero slot is locked to the player-chosen
 * weight.
 *
 * @param {object} hero - { name, stats, appearance }
 * @param {number} heroWeightClass
 * @param {'easy'|'medium'|'hard'} difficulty
 * @param {object} opts
 * @param {Array<{weight:number,name:string,stats:object,appearance?:object}>} [opts.roster]
 * @param {Set<string>} [opts.usedNames]
 * @param {string[]} [opts.usedColorIds]
 * @param {Set<string>} [opts.usedFirsts] - shared first-name tracker (de-collide vs other team)
 * @param {Set<string>} [opts.usedLasts] - shared last-name tracker (de-collide vs other team)
 * @param {number[]} [opts.weights] - weight-class table to use; defaults to NCAA.
 * @param {'male'|'female'} [opts.gender] - gender for AI-fill name pool. Default male.
 * @returns {Array<{weight:number,name:string,stats:object,appearance:object,isHero:boolean,isAiFill?:boolean}>}
 */
export function buildPlayerTeam(hero, heroWeightClass, difficulty, opts = {}) {
  const usedNames = opts.usedNames || new Set([hero?.name].filter(Boolean));
  const usedColorIds = opts.usedColorIds || (hero?.appearance?.primaryColor ? [hero.appearance.primaryColor] : []);
  const weights = (Array.isArray(opts.weights) && opts.weights.length > 0)
    ? opts.weights
    : NCAA_WEIGHT_CLASSES;
  const usedFirsts = opts.usedFirsts || new Set();
  const usedLasts = opts.usedLasts || new Set();
  const rosterByWeight = new Map();
  for (const r of opts.roster || []) {
    if (!r || typeof r.weight !== 'number') continue;
    if (r.weight === heroWeightClass) continue; // hero slot is reserved
    rosterByWeight.set(r.weight, r);
  }
  // Seed used names with the fixed hero + rostered names, then batch-generate
  // the AI-fill teammates so their first/last names are de-collided against
  // the rest of the dual.
  for (const r of rosterByWeight.values()) usedNames.add(r.name);
  const aiFillCount = weights.filter(w => w !== heroWeightClass && !rosterByWeight.has(w)).length;
  const aiFillNames = generateEventNames({
    count: aiFillCount, gender: opts.gender,
    used: usedNames, usedFirsts, usedLasts,
  });
  let aiFillIdx = 0;

  return weights.map((weight) => {
    if (weight === heroWeightClass) {
      return {
        weight,
        name: hero?.name || 'You',
        stats: hero?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        appearance: hero?.appearance || { primaryColor: 'emerald', accentColor: '#059669' },
        isHero: true,
      };
    }
    const rostered = rosterByWeight.get(weight);
    if (rostered) {
      if (rostered.appearance?.primaryColor) usedColorIds.push(rostered.appearance.primaryColor);
      return {
        weight,
        name: rostered.name,
        stats: clampStats(rostered.stats),
        appearance: rostered.appearance || { primaryColor: 'blue', accentColor: '#2563eb' },
        isHero: false,
      };
    }
    // AI fill - pre-generated de-collided name + weight-class stat tweak.
    const opp = generateOpponent('qf', difficulty, usedNames, usedColorIds, { gender: opts.gender, name: aiFillNames[aiFillIdx++] });
    const delta = weightStatDeltas(weight);
    const stats = clampStats({
      str: opp.stats.str + delta.str,
      spd: opp.stats.spd + delta.spd,
      tec: opp.stats.tec + delta.tec,
      end: opp.stats.end + delta.end,
      grt: opp.stats.grt + delta.grt,
    });
    return {
      weight,
      name: opp.name,
      stats,
      appearance: opp.appearance,
      isHero: false,
      isAiFill: true,
    };
  });
}

/**
 * Validate a pre-draft roster. Returns { valid, errors } for the setup screen
 * to render inline. `predraft` is an array of {weight, name, ...} picks; the
 * hero weight is excluded so the caller has 9 slots to fill.
 */
export function validatePredraftRoster(roster, heroWeightClass) {
  const errors = [];
  if (!Array.isArray(roster)) {
    errors.push('Roster must be a list.');
    return { valid: false, errors };
  }
  const seen = new Set();
  for (const r of roster) {
    if (!r || typeof r.weight !== 'number') {
      errors.push('Every teammate needs a weight class.');
      continue;
    }
    if (r.weight === heroWeightClass) {
      errors.push(`Hero weight (${heroWeightClass}) is auto-filled - remove that pick.`);
    }
    if (seen.has(r.weight)) {
      errors.push(`Duplicate weight class: ${r.weight}.`);
    }
    seen.add(r.weight);
  }
  return { valid: errors.length === 0, errors };
}
