// --- College Registry + Recruiting Offer Generation -----------------------
// Backs the recruiting flow at the end of the HS senior year. Pure data +
// pure functions; no Firestore. Returns offer cards keyed by a recruiting
// score derived from the wrestler's HS resume.

import { getStatePrestige } from './careerStates.js';

/**
 * Prestige scale 1-5 (5 = Iowa/Penn State elite, 1 = walk-on / low D1).
 * statFocus is the stat the program develops aggressively; we apply +3 to
 * that stat at acceptance (capped by college tier 90). conference is used
 * for the college schedule pool's flavor and for the dashboard header.
 */
// All school + conference names are fictional, chosen to evoke a real
// collegiate wrestling vibe without using any trademarked institution or
// athletic brand. Logos and colors stay generic until proper licenses are
// in place (or the user explicitly creates branded assets).
// Each college now declares which programs it sponsors. By default both
// hasMensWrestling and hasWomensWrestling are true (real US D1 men's
// programs are adding women's en masse). The 3 women's-flagship entries
// at the bottom are women's-only powerhouse analogs (think McKendree /
// North Central / Augsburg style programs).
export const COLLEGES = [
  // Prestige 5 - perennial top-4
  { id: 'iowa',      name: 'Hawk Ridge University',      state: 'IA', conference: 'Heartland Conference', prestige: 5, statFocus: 'grt', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'psu',       name: 'Mountain Crest University',  state: 'PA', conference: 'Heartland Conference', prestige: 5, statFocus: 'tec', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'okstate',   name: 'Range State University',     state: 'OK', conference: 'Plains Conference',    prestige: 5, statFocus: 'str', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'ohiostate', name: 'Capital State University',   state: 'OH', conference: 'Heartland Conference', prestige: 5, statFocus: 'spd', hasMensWrestling: true, hasWomensWrestling: true },
  // Prestige 4 - strong national contenders
  { id: 'michigan',  name: 'Lakeshore University',       state: 'MI', conference: 'Heartland Conference',     prestige: 4, statFocus: 'tec', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'ncstate',   name: 'Carolina Polytechnic',       state: 'NC', conference: 'Atlantic Conference',      prestige: 4, statFocus: 'spd', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'cornell',   name: 'Eastern Heights College',    state: 'NY', conference: 'Eastern Wrestling League', prestige: 4, statFocus: 'tec', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'lehigh',    name: 'Steel Valley University',    state: 'PA', conference: 'Eastern Wrestling League', prestige: 4, statFocus: 'grt', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'missouri',  name: 'Riverbend University',       state: 'MO', conference: 'Plains Conference',        prestige: 4, statFocus: 'str', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'nebraska',  name: 'Plains State University',    state: 'NE', conference: 'Heartland Conference',     prestige: 4, statFocus: 'end', hasMensWrestling: true, hasWomensWrestling: true },
  // Prestige 3 - solid mid-tier
  { id: 'wisconsin', name: 'Northwoods University',      state: 'WI', conference: 'Heartland Conference', prestige: 3, statFocus: 'end', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'minnesota', name: 'Northland State University', state: 'MN', conference: 'Heartland Conference', prestige: 3, statFocus: 'spd', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'uni',       name: 'Cedar Plains College',       state: 'IA', conference: 'Plains Conference',    prestige: 3, statFocus: 'grt', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'arizona',   name: 'Sunbelt State University',   state: 'AZ', conference: 'Plains Conference',    prestige: 3, statFocus: 'tec', hasMensWrestling: true, hasWomensWrestling: true },
  // Prestige 2 - lower D1
  { id: 'edinboro',  name: 'Iron County University',     state: 'PA', conference: 'Midland Conference',       prestige: 2, statFocus: 'tec', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'csubake',   name: 'Pacific Coast State',        state: 'CA', conference: 'Pacific Conference',       prestige: 2, statFocus: 'spd', hasMensWrestling: true, hasWomensWrestling: true },
  { id: 'rider',     name: 'Rivermark University',       state: 'NJ', conference: 'Eastern Wrestling League', prestige: 2, statFocus: 'end', hasMensWrestling: true, hasWomensWrestling: true },
  // Women's wrestling flagships (women's-only programs - analogs to
  // McKendree, North Central, Augsburg). Top-prestige for the women's
  // career path even when the bigger D1 schools also offer women's.
  { id: 'wflag1',    name: 'Briarcliff Womens College',  state: 'IL', conference: 'Heartland Conference', prestige: 5, statFocus: 'tec', hasMensWrestling: false, hasWomensWrestling: true },
  { id: 'wflag2',    name: 'Northcrest University',      state: 'IL', conference: 'Heartland Conference', prestige: 4, statFocus: 'grt', hasMensWrestling: false, hasWomensWrestling: true },
  { id: 'wflag3',    name: 'Lakeside Christian',         state: 'MN', conference: 'Heartland Conference', prestige: 4, statFocus: 'spd', hasMensWrestling: false, hasWomensWrestling: true },
];

// Synthetic walk-on "school" used when no real offer is on the table.
const WALK_ON_COLLEGE = {
  id: 'walkon',
  name: 'Regional State University',
  state: null,
  conference: 'Midland Conference',
  prestige: 1,
  statFocus: null,
};

const PITCHES_BY_PRESTIGE = {
  5: [
    'We win national titles. Come win one with us.',
    'Carver-Hawkeye is calling.',
    'You belong on the biggest stage.',
  ],
  4: [
    "We've got a top-10 lineup and a path to the podium.",
    'You can be our All-American at this weight.',
    'Our culture is championship-level.',
  ],
  3: [
    "Steady program with proven development. You'll wrestle Day 1.",
    'Big conference, real schedule, real chance to break through.',
    "We'll get you to NCAAs.",
  ],
  2: [
    "We'll let you wrestle, get reps, and build your record.",
    "Great chance to be a starter from the jump.",
    'Smaller program, bigger role.',
  ],
};

const DECK_BONUS_BY_PRESTIGE = {
  5: { type: 'unlock_card', cardId: 'cradle_finish', label: '+1 college signature card' },
  4: { type: 'stat_point',  count: 1, label: '+1 bonus stat point' },
};

const SCHOLARSHIP_BY_PRESTIGE = {
  5: 'Full Ride',
  4: 'Full Ride',
  3: 'Partial Scholarship',
  2: 'Partial Scholarship',
  1: 'Walk-On',
};

/**
 * Compute a 0-100 recruiting score from the player's HS resume. Higher score
 * unlocks larger and more prestigious offer pools.
 */
export function computeRecruitingScore(career) {
  if (!career) return 0;
  const titles = career.record?.titles || [];
  const stateTitles = titles.filter(t =>
    t.tier === 'hs' && (t.stakes === 'state' || t.type === 'state')
  ).length;

  const careerWins   = career.record?.careerWins   || 0;
  const careerLosses = career.record?.careerLosses || 0;
  const totalMatches = careerWins + careerLosses;
  const winPct = totalMatches > 0 ? careerWins / totalMatches : 0;

  const stateCode = career.wrestler?.state || null;
  const prestige = stateCode ? getStatePrestige(stateCode) : null;
  const statePrestigeBonus = prestige === 'gold' ? 12 : prestige === 'silver' ? 6 : 0;

  // Rivals beaten - sum of h2h wins across rival list. Cap at 10 pts.
  const rivalsBeaten = (career.rivals || []).reduce(
    (acc, r) => acc + (r.h2h?.wins || 0), 0
  );
  const rivalsBonus = Math.min(10, rivalsBeaten * 2);

  let score = 0;
  score += Math.min(60, stateTitles * 20);
  score += Math.min(40, Math.round(winPct * 50));
  score += statePrestigeBonus;
  score += rivalsBonus;
  return Math.max(0, Math.min(100, score));
}

function shuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickPitch(prestige, rng) {
  const pool = PITCHES_BY_PRESTIGE[prestige] || PITCHES_BY_PRESTIGE[3];
  return pool[Math.floor(rng() * pool.length)];
}

function buildOfferFromCollege(college, rng) {
  return {
    id: `offer_${college.id}`,
    collegeId: college.id,
    schoolName: college.name,
    prestige: college.prestige,
    stateOfSchool: college.state,
    conference: college.conference,
    statFocus: college.statFocus,
    deckBonus: DECK_BONUS_BY_PRESTIGE[college.prestige] || null,
    scholarshipNote: SCHOLARSHIP_BY_PRESTIGE[college.prestige] || 'Walk-On',
    pitch: pickPitch(college.prestige, rng),
  };
}

/**
 * Generate 0-5 college offers based on the player's HS resume.
 * Score bands -> (offer count, eligible prestige range):
 *   >= 80: 5 offers, prestige 4-5
 *   >= 60: 4 offers, prestige 3-5
 *   >= 40: 4 offers, prestige 2-4
 *   >= 25: 3 offers, prestige 1-3
 *   <  25: 0 real offers (walk-on only)
 */
export function generateCollegeOffers(career, { rng = Math.random } = {}) {
  const score = computeRecruitingScore(career);
  const isFemale = career?.wrestler?.gender === 'female';

  let count = 0;
  let prestigeMin = 1;
  let prestigeMax = 1;
  if (score >= 80)      { count = 5; prestigeMin = 4; prestigeMax = 5; }
  else if (score >= 60) { count = 4; prestigeMin = 3; prestigeMax = 5; }
  else if (score >= 40) { count = 4; prestigeMin = 2; prestigeMax = 4; }
  else if (score >= 25) { count = 3; prestigeMin = 1; prestigeMax = 3; }
  else                  { count = 0; }

  if (count === 0) {
    return { score, offers: [] };
  }

  // Filter colleges by gender. Women's careers see schools with
  // hasWomensWrestling: true (the default for all D1 entries plus the
  // 3 women's flagships). Men's careers see schools with
  // hasMensWrestling: true (the default for all D1 entries; women's
  // flagships are filtered out).
  const eligible = COLLEGES.filter(c =>
    c.prestige >= prestigeMin &&
    c.prestige <= prestigeMax &&
    (isFemale ? c.hasWomensWrestling !== false : c.hasMensWrestling !== false),
  );
  const picked = shuffle(eligible, rng).slice(0, count);
  const offers = picked.map(c => buildOfferFromCollege(c, rng));
  return { score, offers };
}

export function makeWalkOnOffer(rng = Math.random) {
  return {
    id: 'offer_walkon',
    collegeId: WALK_ON_COLLEGE.id,
    schoolName: `${WALK_ON_COLLEGE.name} (Walk-On)`,
    prestige: WALK_ON_COLLEGE.prestige,
    stateOfSchool: WALK_ON_COLLEGE.state,
    conference: WALK_ON_COLLEGE.conference,
    statFocus: null,
    deckBonus: null,
    scholarshipNote: 'Walk-On',
    pitch: pickPitch(1, rng),
  };
}

export function findCollegeById(collegeId) {
  if (collegeId === WALK_ON_COLLEGE.id) return WALK_ON_COLLEGE;
  return COLLEGES.find(c => c.id === collegeId) || null;
}

/**
 * Pick a different-from-player college from the registry (used to assign
 * a school to rivals carrying over from HS). Optional `gender` arg filters
 * to programs that sponsor that gender's wrestling - women's careers
 * never get a rival placed at a men's-only school and vice versa.
 */
export function pickRivalCollege(excludeCollegeId, rng = Math.random, gender = 'male') {
  const isFemale = gender === 'female';
  const eligible = COLLEGES.filter(c =>
    c.id !== excludeCollegeId &&
    c.id !== 'walkon' &&
    (isFemale ? c.hasWomensWrestling !== false : c.hasMensWrestling !== false),
  );
  return eligible[Math.floor(rng() * eligible.length)] || COLLEGES[0];
}
