// --- Career Schedule Generator ---------------------------------------------
// Generates a realistic season schedule for a given tier + year. Each event
// is one of:
//   - 'dual'        -> legacy single-match dual at your weight class. Kept for
//                     in-progress careers whose schedule was generated before
//                     dual_meet shipped. New schedules emit 'dual_meet' instead.
//   - 'dual_meet'   -> team-format dual meet. Player chooses pre-dual whether
//                     to wrestle only their weight class (others sim) or to
//                     wrestle every bout in the dual.
//   - 'tournament'  -> open/invite tournament (small bracket)
//   - 'championship'-> end-of-season tournament (state / NCAAs / Worlds)
//
// v9 (scheduleVersion=1): expanded match counts.
//   - HS:        14 events -> 28 events (~24 worst-case / ~60 best-case matches)
//   - College:   16 events -> 28 events (~28 worst-case / ~63 best-case matches)
//   - Senior M:   6 events -> 18 base + 2 earned Worlds (20 max)
//                            (~18 worst-case / ~68 best-case matches)
//   - Senior W:   3 events ->  7 base + 1 earned Worlds (8 max)
//                            (~7 worst-case / ~32 best-case matches)
// 128-wrestler brackets land at HS State, College NCAA, Senior Worlds.
// V0 templates preserved verbatim. Legacy in-flight careers keep their
// existing schedules; new careers + next-season-after-bump get V1.

import { pickRivalOpponent, generateFillerOpponent } from './careerRivals.js';
import { generateTeamName } from '../dualMeetTeams.js';
import { ELIJAH_JOLES_ID, PARTNERSHIP_ACTIVE as ELIJAH_PARTNERSHIP_ACTIVE } from './elijahJoles.js';

// ─── Featured-wrestler seeding ──────────────────────────────────────────────
// Elijah Joles is a male-only freestyle wrestler. He is seeded into specific
// bracket-style events (no duals) across HS / College / Senior on male careers
// only. Cross-weight allowed - the bracket builder labels him "165 lb · Featured
// Wrestler" so cross-weight matchups read as deliberate exhibition slots.

function shouldSeedElijah({ gender, eventStyle }) {
  if (!ELIJAH_PARTNERSHIP_ACTIVE) return false;
  if (gender === 'female') return false;
  if (eventStyle === 'womens_freestyle') return false;
  return true;
}

// Tournament names that get Elijah seeded. Per tier: cap at 2 brackets so
// he doesn't appear in every event (anti-saturation).
const ELIJAH_SEED_EVENTS = {
  hs:      new Set(['Holiday Open', 'Mid-Season Classic']),
  college: new Set(['Frostline Invitational', 'Desert Showdown']),
  // Senior: freestyle events only (he's a freestyle wrestler). American
  // Open Freestyle + Freestyle Open Tournament cover the two seeding slots.
  senior:  new Set(['Freestyle Open Tournament', 'American Open Freestyle']),
};

function withElijahSeed(seedIds, eventName, tier, gateOpts) {
  if (!shouldSeedElijah(gateOpts)) return seedIds;
  const slot = ELIJAH_SEED_EVENTS[tier];
  if (!slot || !slot.has(eventName)) return seedIds;
  if (Array.isArray(seedIds) && seedIds.includes(ELIJAH_JOLES_ID)) return seedIds;
  return [ELIJAH_JOLES_ID, ...(Array.isArray(seedIds) ? seedIds : [])];
}

// --- HS schedule templates -------------------------------------------------

// V0 (legacy, pre-v9). PRESERVED VERBATIM. Used by hydration path for
// in-flight careers whose seasonMeta.scheduleVersion === 0.
const HS_SCHEDULE_TEMPLATE_V0 = [
  { week: 1,  type: 'dual_meet',    name: 'Season Opener Dual' },
  { week: 2,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 3,  type: 'tournament',   name: 'Early Season Invitational', bracketSize: 8 },
  { week: 4,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 5,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 6,  type: 'tournament',   name: 'Holiday Open', bracketSize: 16 },
  { week: 8,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 9,  type: 'dual_meet',    name: 'Rivalry Dual' },
  { week: 10, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 11, type: 'tournament',   name: 'Mid-Season Classic', bracketSize: 8 },
  { week: 12, type: 'dual_meet',    name: 'Senior Night Dual' },
  { week: 13, type: 'championship', name: 'Conference Championships', bracketSize: 16, stakes: 'conference' },
  { week: 14, type: 'championship', name: 'Regional Qualifier',       bracketSize: 32, stakes: 'regional', qualifyFrom: 'conference' },
  { week: 15, type: 'championship', name: 'State Championship',       bracketSize: 64, stakes: 'state',    qualifyFrom: 'regional' },
];

// V1 (v9 expansion). 19 duals + 5 in-season tournaments + 4-level postseason
// (Conference 16 -> District 32 -> Regional 64 -> State 128). Some weeks
// carry multiple events; event ids disambiguate via _w${week}_${idx}.
const HS_SCHEDULE_TEMPLATE_V1 = [
  { week: 1,  type: 'dual_meet',    name: 'Season Opener Dual' },
  { week: 1,  type: 'dual_meet',    name: 'Early Tri-Meet' },
  { week: 2,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 2,  type: 'dual_meet',    name: 'Showcase Dual' },
  { week: 3,  type: 'tournament',   name: 'Early Season Invitational', bracketSize: 8 },
  { week: 4,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 4,  type: 'dual_meet',    name: 'Tri-Meet' },
  { week: 5,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 5,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 6,  type: 'tournament',   name: 'Holiday Open', bracketSize: 16 },
  { week: 7,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 7,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 8,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 8,  type: 'tournament',   name: 'Mid-Season Classic', bracketSize: 16 },
  { week: 9,  type: 'dual_meet',    name: 'Rivalry Dual' },
  { week: 10, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 10, type: 'dual_meet',    name: 'Tri-Meet' },
  { week: 11, type: 'tournament',   name: 'Late-Season Tournament', bracketSize: 32 },
  { week: 12, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 12, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 13, type: 'dual_meet',    name: 'Senior Night Dual' },
  { week: 13, type: 'dual_meet',    name: 'Cross-Town Dual' },
  { week: 14, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 14, type: 'tournament',   name: 'Conference Showcase', bracketSize: 16 },
  // Postseason ladder: Conference -> District -> Regional -> State.
  // qualifyFrom + recordEventResult's 4-level prune chain gate advancement.
  { week: 15, type: 'championship', name: 'Conference Championships', bracketSize: 16,  stakes: 'conference' },
  { week: 16, type: 'championship', name: 'District Qualifier',       bracketSize: 32,  stakes: 'district', qualifyFrom: 'conference' },
  { week: 17, type: 'championship', name: 'Regional Tournament',      bracketSize: 64,  stakes: 'regional', qualifyFrom: 'district' },
  { week: 18, type: 'championship', name: 'State Championship',       bracketSize: 128, stakes: 'state',    qualifyFrom: 'regional' },
];

function buildEventId(seasonYear, template, idx) {
  return `evt_y${seasonYear}_w${template.week}_${idx}`;
}

function buildEventFromTemplate({ tpl, idx, seasonYear, year, weightClass, style, rivals, fillerUsed, reservedNames, tier, gender, rng, weights = null }) {
  const id = buildEventId(seasonYear, tpl, idx);
  // v9: senior-tier per-style weight resolution. Men's dual-style careers
  // carry both freestyle + greco kg snaps in `wrestler.weights`. Schedule
  // events tagged with a style must stamp the right per-style weight or
  // dual_meet creation (createCareerDualMeet) snaps to the wrong table.
  // weightClass arg defaults to the wrestler's display weight (freestyle for
  // men, women's freestyle for women); for senior + tpl.style + matching
  // weights[tpl.style], override with the per-style value.
  const eventStyle = tpl.style || style;
  const resolvedWeightClass =
    (tier === 'senior' && weights && eventStyle && Number.isFinite(weights[eventStyle]))
      ? weights[eventStyle]
      : weightClass;
  const base = {
    id,
    seasonYear,
    year,
    week: tpl.week,
    type: tpl.type,
    name: tpl.name,
    weightClass: resolvedWeightClass,
    style: eventStyle,
    status: 'upcoming',
    result: null,
  };
  if (tpl.type === 'dual' || tpl.type === 'dual_meet') {
    const isRivalryDual = tpl.name === 'Rivalry Dual' && rivals.length > 0;
    const opponent = isRivalryDual
      ? pickRivalOpponent(rivals, { rng })
      : generateFillerOpponent({
          // v9: filler opponent at the event's resolved (per-style) weight,
          // not the wrestler's display weight. Senior Greco dual at 77kg
          // must have a 77kg opponent so event.opponent.weightClass matches
          // event.weightClass for rivalry promotion + opponent tracking.
          weightClass: resolvedWeightClass,
          tier,
          style: eventStyle,
          gender,
          rng,
          used: fillerUsed,
          reserved: reservedNames,
        });
    const dualExtras = tpl.type === 'dual_meet'
      ? { opponentTeamName: generateTeamName(), lineupChoice: null }
      : {};
    return { ...base, opponent, opponentIsRival: isRivalryDual, ...dualExtras };
  }
  // tournament | championship | invitational
  // Elijah Joles partnership seeding: gate per tier + event name + gender +
  // style; helper returns the rival seed list unchanged when the gate is closed.
  const baseSeedIds = rivals.slice(0, Math.min(2, rivals.length)).map(r => r.id);
  const seededRivalIds = withElijahSeed(baseSeedIds, tpl.name, tier, { gender, eventStyle });
  return {
    ...base,
    bracketSize: tpl.bracketSize,
    stakes: tpl.stakes || 'regular',
    ...(tpl.qualifyFrom ? { qualifyFrom: tpl.qualifyFrom } : {}),
    ...(tpl.bestOf ? { bestOf: tpl.bestOf } : {}),
    seededRivalIds,
  };
}

/**
 * Build a season schedule for an HS wrestler.
 *
 * @param {object} opts
 * @param {number} [opts.seasonYear]
 * @param {number} [opts.year]
 * @param {number} [opts.weightClass]
 * @param {string} [opts.gender]
 * @param {any[]} [opts.rivals]
 * @param {() => number} [opts.rng]
 * @param {number} [opts.scheduleVersion] - 0 (legacy) or 1 (v9 expansion). Default 0.
 */
export function generateHSSeason({ seasonYear, year, weightClass, gender = 'male', rivals = [], rng = Math.random, scheduleVersion = 0 }) {
  const template = scheduleVersion >= 1 ? HS_SCHEDULE_TEMPLATE_V1 : HS_SCHEDULE_TEMPLATE_V0;
  const fillerUsed = new Set();
  const reservedNames = new Set(rivals.map(r => r.name));
  return template.map((tpl, idx) => buildEventFromTemplate({
    tpl, idx, seasonYear, year, weightClass,
    style: 'folkstyle',
    rivals, fillerUsed, reservedNames,
    tier: 'hs', gender, rng,
  }));
}

// --- College schedule templates --------------------------------------------

// V0 (legacy, pre-v9). PRESERVED VERBATIM.
const COLLEGE_SCHEDULE_TEMPLATE_V0 = [
  { week: 1,  type: 'dual_meet',    name: 'Season Opener Dual' },
  { week: 2,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 3,  type: 'invitational', name: 'Frostline Invitational',           bracketSize: 32, stakes: 'invitational' },
  { week: 4,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 5,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 6,  type: 'invitational', name: 'New Year Open',                    bracketSize: 32, stakes: 'invitational' },
  { week: 7,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 8,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 9,  type: 'dual_meet',    name: 'Rivalry Dual' },
  { week: 10, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 11, type: 'invitational', name: 'Desert Showdown',                  bracketSize: 32, stakes: 'invitational' },
  { week: 12, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 13, type: 'dual_meet',    name: 'Senior Day Dual' },
  { week: 14, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 15, type: 'championship', name: 'Conference Championship',          bracketSize: 16, stakes: 'conference_d1' },
  { week: 17, type: 'championship', name: 'Collegiate National Championship', bracketSize: 32, stakes: 'ncaa' },
];

// V1 (v9 expansion). 20 duals + 6 invitationals + Conference 32 + NCAA 128.
const COLLEGE_SCHEDULE_TEMPLATE_V1 = [
  { week: 1,  type: 'dual_meet',    name: 'Season Opener Dual' },
  { week: 1,  type: 'dual_meet',    name: 'Early Tri-Meet' },
  { week: 2,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 2,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 3,  type: 'invitational', name: 'Frostline Invitational', bracketSize: 32, stakes: 'invitational' },
  { week: 4,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 4,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 5,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 5,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 6,  type: 'invitational', name: 'New Year Open',          bracketSize: 32, stakes: 'invitational' },
  { week: 7,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 7,  type: 'invitational', name: 'Mid-Major Open',         bracketSize: 32, stakes: 'invitational' },
  { week: 8,  type: 'dual_meet',    name: 'Non-Conference Dual' },
  { week: 8,  type: 'dual_meet',    name: 'Conference Dual' },
  { week: 9,  type: 'dual_meet',    name: 'Rivalry Dual' },
  { week: 9,  type: 'invitational', name: 'Eastern Invitational',   bracketSize: 32, stakes: 'invitational' },
  { week: 10, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 10, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 11, type: 'invitational', name: 'Desert Showdown',        bracketSize: 64, stakes: 'invitational' },
  { week: 11, type: 'dual_meet',    name: 'Showcase Dual' },
  { week: 12, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 12, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 13, type: 'dual_meet',    name: 'Senior Day Dual' },
  { week: 13, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 14, type: 'dual_meet',    name: 'Conference Dual' },
  { week: 14, type: 'invitational', name: 'Last Chance Open',       bracketSize: 32, stakes: 'invitational' },
  { week: 15, type: 'championship', name: 'Conference Championship',           bracketSize: 32,  stakes: 'conference_d1' },
  { week: 17, type: 'championship', name: 'Collegiate National Championship',  bracketSize: 128, stakes: 'ncaa' },
];

/**
 * @param {object} opts
 * @param {number} [opts.seasonYear]
 * @param {number} [opts.year]
 * @param {number} [opts.weightClass]
 * @param {string} [opts.gender]
 * @param {any[]} [opts.rivals]
 * @param {() => number} [opts.rng]
 * @param {number} [opts.scheduleVersion]
 */
export function generateCollegeSeason({ seasonYear, year, weightClass, gender = 'male', rivals = [], rng = Math.random, scheduleVersion = 0 }) {
  // NCAA Women's Wrestling competes in freestyle (not folkstyle - that's
  // the men's NCAA ruleset). NCWWC and the new NCAA Women's championship
  // use UWW women's freestyle. Tag every women's-career college event
  // with 'womens_freestyle' so engine scoring matches.
  const collegeStyle = gender === 'female' ? 'womens_freestyle' : 'folkstyle';
  const template = scheduleVersion >= 1 ? COLLEGE_SCHEDULE_TEMPLATE_V1 : COLLEGE_SCHEDULE_TEMPLATE_V0;
  const fillerUsed = new Set();
  const reservedNames = new Set(rivals.map(r => r.name));
  return template.map((tpl, idx) => buildEventFromTemplate({
    tpl, idx, seasonYear, year, weightClass,
    style: collegeStyle,
    rivals, fillerUsed, reservedNames,
    tier: 'college', gender, rng,
  }));
}

// --- Senior schedule templates ---------------------------------------------

// V0 templates (legacy, pre-v9). PRESERVED VERBATIM.
const SENIOR_WOMENS_TEMPLATE_V0 = (trialsName) => [
  { week: 4,  type: 'tournament',   name: "Women's Open Tournament",     bracketSize: 32, stakes: 'open',            style: 'womens_freestyle' },
  { week: 10, type: 'championship', name: "Women's American Open",       bracketSize: 16, stakes: 'us_open',         style: 'womens_freestyle' },
  { week: 22, type: 'championship', name: `Women's ${trialsName.name}`,  bracketSize: 16, stakes: trialsName.stakes, bestOf: 3, style: 'womens_freestyle' },
];

const SENIOR_MENS_TEMPLATE_V0 = (trialsName) => [
  { week: 4,  type: 'tournament',   name: 'Freestyle Open Tournament',       bracketSize: 32, stakes: 'open',            style: 'freestyle' },
  { week: 5,  type: 'tournament',   name: 'Greco Open Tournament',           bracketSize: 32, stakes: 'open',            style: 'greco' },
  { week: 10, type: 'championship', name: 'American Open Freestyle',         bracketSize: 16, stakes: 'us_open',         style: 'freestyle' },
  { week: 11, type: 'championship', name: 'American Open Greco',             bracketSize: 16, stakes: 'us_open',         style: 'greco' },
  { week: 22, type: 'championship', name: `Freestyle ${trialsName.name}`,    bracketSize: 16, stakes: trialsName.stakes, bestOf: 3, style: 'freestyle' },
  { week: 23, type: 'championship', name: `Greco ${trialsName.name}`,        bracketSize: 16, stakes: trialsName.stakes, bestOf: 3, style: 'greco' },
];

const SENIOR_LEGACY_TEMPLATE_V0 = (trialsName, style) => [
  { week: 4,  type: 'tournament',   name: 'Open Tournament',         bracketSize: 32, stakes: 'open',            style },
  { week: 10, type: 'championship', name: 'American Open',           bracketSize: 16, stakes: 'us_open',         style },
  { week: 22, type: 'championship', name: trialsName.name,           bracketSize: 16, stakes: trialsName.stakes, bestOf: 3, style },
];

// V1 templates (v9 expansion). Add senior duals (USA dual exhibitions, club
// duals, Beat the Streets, World Cup), Pan-Am tournaments, Bill Farrell /
// Schultz Memorial. Trials bump 16 -> 32. Worlds bump 16 -> 128 (appended
// per-style on Trials win; see recordEventResult).
const SENIOR_WOMENS_TEMPLATE_V1 = (trialsName) => [
  { week: 3,  type: 'tournament',   name: "Women's Bill Farrell",                  bracketSize: 16, stakes: 'open',            style: 'womens_freestyle' },
  { week: 4,  type: 'tournament',   name: "Women's Open Tournament",               bracketSize: 32, stakes: 'open',            style: 'womens_freestyle' },
  { week: 7,  type: 'dual_meet',    name: "Women's Beat the Streets",                                                          style: 'womens_freestyle' },
  { week: 8,  type: 'tournament',   name: "Women's Pan-Am Championships",          bracketSize: 32, stakes: 'open',            style: 'womens_freestyle' },
  { week: 10, type: 'championship', name: "Women's American Open",                 bracketSize: 16, stakes: 'us_open',         style: 'womens_freestyle' },
  { week: 14, type: 'dual_meet',    name: "Women's World Cup Dual",                                                            style: 'womens_freestyle' },
  { week: 22, type: 'championship', name: `Women's ${trialsName.name}`,            bracketSize: 32, stakes: trialsName.stakes, bestOf: 3, style: 'womens_freestyle' },
];

const SENIOR_MENS_TEMPLATE_V1 = (trialsName) => [
  { week: 2,  type: 'dual_meet',    name: 'USA vs World Exhibition',               style: 'freestyle' },
  { week: 3,  type: 'tournament',   name: 'Bill Farrell Memorial',                 bracketSize: 16, stakes: 'open',            style: 'freestyle' },
  { week: 3,  type: 'tournament',   name: 'Schultz Memorial',                      bracketSize: 16, stakes: 'open',            style: 'greco' },
  { week: 4,  type: 'tournament',   name: 'Freestyle Open Tournament',             bracketSize: 32, stakes: 'open',            style: 'freestyle' },
  { week: 5,  type: 'tournament',   name: 'Greco Open Tournament',                 bracketSize: 32, stakes: 'open',            style: 'greco' },
  { week: 6,  type: 'dual_meet',    name: 'Pan-Am Dual',                                                                       style: 'greco' },
  { week: 7,  type: 'dual_meet',    name: 'NLWC vs PRTC Club Dual',                                                            style: 'freestyle' },
  { week: 8,  type: 'tournament',   name: 'Pan-Am Championships F',                bracketSize: 32, stakes: 'open',            style: 'freestyle' },
  { week: 9,  type: 'tournament',   name: 'Pan-Am Championships G',                bracketSize: 32, stakes: 'open',            style: 'greco' },
  { week: 10, type: 'championship', name: 'American Open Freestyle',               bracketSize: 16, stakes: 'us_open',         style: 'freestyle' },
  { week: 11, type: 'championship', name: 'American Open Greco',                   bracketSize: 16, stakes: 'us_open',         style: 'greco' },
  { week: 13, type: 'dual_meet',    name: 'National Team Exhibition',                                                          style: 'freestyle' },
  { week: 14, type: 'dual_meet',    name: 'Beat the Streets NYC',                                                              style: 'freestyle' },
  { week: 16, type: 'dual_meet',    name: 'RTC Showcase Dual',                                                                 style: 'freestyle' },
  { week: 18, type: 'dual_meet',    name: 'World Cup Dual',                                                                    style: 'freestyle' },
  { week: 20, type: 'dual_meet',    name: 'International Friendly',                                                            style: 'greco' },
  { week: 22, type: 'championship', name: `Freestyle ${trialsName.name}`,          bracketSize: 32, stakes: trialsName.stakes, bestOf: 3, style: 'freestyle' },
  { week: 23, type: 'championship', name: `Greco ${trialsName.name}`,              bracketSize: 32, stakes: trialsName.stakes, bestOf: 3, style: 'greco' },
];

const SENIOR_LEGACY_TEMPLATE_V1 = (trialsName, style) => [
  { week: 4,  type: 'tournament',   name: 'Open Tournament',                       bracketSize: 32, stakes: 'open',            style },
  { week: 7,  type: 'dual_meet',    name: 'Club Exhibition Dual',                                                              style },
  { week: 10, type: 'championship', name: 'American Open',                         bracketSize: 16, stakes: 'us_open',         style },
  { week: 14, type: 'dual_meet',    name: 'International Dual',                                                                style },
  { week: 22, type: 'championship', name: trialsName.name,                         bracketSize: 32, stakes: trialsName.stakes, bestOf: 3, style },
];

/**
 * Senior International (Olympic / World) season generator.
 *
 * Year-mod-4 = Olympic year (Olympic Trials); otherwise World Championship
 * year (World Team Trials). The "make the team" event (Olympics or Worlds)
 * is appended to the schedule on a Trials win inside recordEventResult.
 * Bracket size of that followup is 16 for V0 schedules and 128 for V1
 * (gated by seasonMeta.scheduleVersion).
 */
/**
 * @param {object} opts
 * @param {number} [opts.seasonYear]
 * @param {number} [opts.year]
 * @param {number} [opts.weightClass]
 * @param {string} [opts.style]
 * @param {string} [opts.gender]
 * @param {any[]} [opts.rivals]
 * @param {() => number} [opts.rng]
 * @param {number} [opts.scheduleVersion]
 * @param {object} [opts.weights]
 */
export function generateSeniorSeason({ seasonYear, year, weightClass, style = 'freestyle', gender, rivals = [], rng = Math.random, scheduleVersion = 0, weights = null }) {
  const trialsName = (year % 4 === 0)
    ? { name: 'International Games Trials', stakes: 'olympic_trials' }
    : { name: 'World Team Trials',          stakes: 'world_trials' };

  // Per-gender senior templates (women's freestyle vs. men's dual-style vs.
  // legacy). v9 versioning picks V0 vs V1; buildEventFromTemplate threads
  // gender + tier into withElijahSeed so freestyle-only Elijah slots land
  // correctly on the male senior schedule.
  let tpls;
  if (gender === 'female' || style === 'womens_freestyle') {
    tpls = scheduleVersion >= 1
      ? SENIOR_WOMENS_TEMPLATE_V1(trialsName)
      : SENIOR_WOMENS_TEMPLATE_V0(trialsName);
  } else if (gender === 'male') {
    tpls = scheduleVersion >= 1
      ? SENIOR_MENS_TEMPLATE_V1(trialsName)
      : SENIOR_MENS_TEMPLATE_V0(trialsName);
  } else {
    tpls = scheduleVersion >= 1
      ? SENIOR_LEGACY_TEMPLATE_V1(trialsName, style)
      : SENIOR_LEGACY_TEMPLATE_V0(trialsName, style);
  }

  const fillerUsed = new Set();
  const reservedNames = new Set(rivals.map(r => r.name));
  return tpls.map((tpl, idx) => buildEventFromTemplate({
    tpl, idx, seasonYear, year, weightClass,
    style: tpl.style || style,
    rivals, fillerUsed, reservedNames,
    tier: 'senior', gender, rng, weights,
  }));
}

/**
 * Generate schedule for any tier. Dispatches by tier; college and senior
 * use real templates instead of falling back to HS.
 *
 * v9: `scheduleVersion` arg. Default 0 (legacy) so any unupdated caller
 * keeps the old behavior. Production callers in careerState.js
 * (createCareer, advanceToNextSeason, confirmTierTransition) thread
 * scheduleVersion=1 explicitly.
 *
 * @param {object} [opts]
 * @param {string} [opts.tier]
 * @param {number} [opts.seasonYear]
 * @param {number} [opts.year]
 * @param {number} [opts.weightClass]
 * @param {string} [opts.style]
 * @param {string} [opts.gender]
 * @param {any[]} [opts.rivals]
 * @param {() => number} [opts.rng]
 * @param {number} [opts.scheduleVersion]
 * @param {object} [opts.weights]
 */
export function generateSeasonSchedule({ tier = 'hs', seasonYear, year, weightClass, style = 'folkstyle', gender, rivals = [], rng = Math.random, scheduleVersion = 0, weights = null } = {}) {
  if (tier === 'college') {
    return generateCollegeSeason({ seasonYear, year, weightClass, gender, rivals, rng, scheduleVersion });
  }
  if (tier === 'senior') {
    return generateSeniorSeason({ seasonYear, year, weightClass, style, gender, rivals, rng, scheduleVersion, weights });
  }
  return generateHSSeason({ seasonYear, year, weightClass, gender, rivals, rng, scheduleVersion });
}

// Helper: find next upcoming event, or null if season is complete.
export function findNextEvent(events) {
  return events.find(e => e.status === 'upcoming') || null;
}

// Helper: season summary - counts of W/L/titles - for offseason screens.
export function summarizeSeason(events) {
  let wins = 0, losses = 0, titles = [];
  for (const e of events) {
    if (e.status === 'won') wins++;
    if (e.status === 'lost') losses++;
    if (e.type === 'championship' && e.result?.placement === 1) {
      titles.push({ name: e.name, stakes: e.stakes });
    }
  }
  return { wins, losses, titles };
}
