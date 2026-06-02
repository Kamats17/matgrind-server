// Career Depth Pass v1 - Coach / Corner Advisor.
//
// One named HS coach (Petrov) with hand-written blue-collar trash-talk-free
// dialogue across the situations the result modal renders. College and
// senior tiers get generic placeholder coaches in v1; full content lands
// in v1.1.
//
// API:
//   - COACHES: descriptors keyed by coach id
//   - COACH_LINES: per-coach line pool keyed by situation
//   - getCoachLine(coachId, situation, rng?) -> string | null
//   - coachForTier(tier) -> descriptor or null
//   - computeScoutingBlurb(opponent) -> string | null
//
// Notes:
//   - Tone matches Elijah's existing trash-talk register: short, regional,
//     blue-collar. Avoid corporate cheer ("You've got this!") and clichés.
//   - Avoid naming real coaches or schools.
//   - Lines must be safe to render in any order; no inter-line state.

const HS_COACH_PETROV = {
  id: 'hs_coach_petrov',
  name: 'Coach Petrov',
  tier: 'hs',
  voice: 'blue_collar',
};

const GENERIC_COLLEGE_COACH = {
  id: 'generic_college_coach',
  name: 'Coach',
  tier: 'college',
  voice: 'neutral',
};

const GENERIC_SENIOR_COACH = {
  id: 'generic_senior_coach',
  name: 'Coach',
  tier: 'senior',
  voice: 'neutral',
};

export const COACHES = {
  hs_coach_petrov: HS_COACH_PETROV,
  generic_college_coach: GENERIC_COLLEGE_COACH,
  generic_senior_coach: GENERIC_SENIOR_COACH,
};

export const COACH_LINES = {
  hs_coach_petrov: {
    season_start: [
      "Long season. Show up every Tuesday and we'll get there.",
      "I'm not asking for perfect. I'm asking for present.",
      "Same room every day. That's the work.",
    ],
    season_end: [
      "Wasn't perfect. We got better. That matters.",
      "Take a week. Then I want you back in the room.",
      "We move on. Same room next year.",
    ],
    pre_match: [
      "Hands. Hips. Get to your offense.",
      "First takedown is yours if you want it.",
      "Don't wait. Don't reach. Wrestle your match.",
      "Whatever they show you in P1, take it apart in P2.",
      "Score early. Make them chase you for six minutes.",
    ],
    win: [
      "That's the work. Cool down, hydrate, be ready Tuesday.",
      "Knew it. Enjoy it tonight. Tuesday, we work.",
      "Hand raised. Now recover right.",
      "Good match. Boring win. That's the goal.",
    ],
    loss: [
      "Stand up. Walk out. We watch film Monday.",
      "Lost a match. Didn't lose the season.",
      "It happens. Don't carry it into next week.",
      "Mat doesn't care. We get back to work Monday.",
    ],
    pin_win: [
      "Pin's a pin. Finish clean next time.",
      "Hard to argue with six points. Good.",
      "Now do it again Saturday.",
      "That's the bonus the team needed. Good work.",
    ],
    pinned: [
      "Hate that one for you. We fix it Tuesday.",
      "We fix the bottom work. Tuesday. Bottom drills.",
      "Stand up. Walk it off. We don't talk about it tonight.",
      "Getting pinned happens. Don't let it happen twice.",
    ],
    championship_win: [
      "Title's yours. Earned every minute of it.",
      "Take the picture. Then back to the room.",
      "I'll save the speech. You did the work.",
      "Title to your name forever. Now go win the next one.",
    ],
    championship_loss: [
      "Came up short. Doesn't erase what got you here.",
      "Walk through that bracket Monday. Find what we missed.",
      "Year's not for nothing. We're back next October.",
      "Hand wasn't raised. The work doesn't change.",
    ],
  },
  generic_college_coach: {
    season_start: ["Long year. One day at a time."],
    season_end: ["That's the season. Rest up."],
    pre_match: ["Wrestle your match.", "Score early."],
    win: ["Good win. Recover right.", "Take care of the body."],
    loss: ["Move on. We watch film Monday.", "This one doesn't carry into next week."],
    pin_win: ["Pin's a pin."],
    pinned: ["We fix it in the room."],
    championship_win: ["You earned that title."],
    championship_loss: ["Came up short. Year's not for nothing."],
  },
  generic_senior_coach: {
    season_start: ["Long season. Show up ready."],
    season_end: ["That's the season. Recover, then reset."],
    pre_match: ["Wrestle your match.", "Don't reach."],
    win: ["Good win. Stay ready."],
    loss: ["Learn from it, then move on."],
    pin_win: ["Pin's a pin."],
    pinned: ["We fix the position that beat us."],
    championship_win: ["You earned every round."],
    championship_loss: ["Came up short. Doesn't erase the run."],
  },
};

// Scouting blurb templates keyed by the opponent's TOP stat. Pulled from
// the engine's stat-effect signature: STR/SPD/TEC/END/GRT each carry a
// recognizable in-match tendency the player can read.
const SCOUT_TEMPLATES = {
  str: [
    "Power-based. Watch the body lock and the bear hug.",
    "Heavy hands. Stay off the cradle.",
    "He'll try to muscle you. Move your feet.",
  ],
  spd: [
    "Quick. Sets up shots fast.",
    "He shoots first. Set your defense early.",
    "Fast feet. Be ready for the first thirty seconds.",
  ],
  tec: [
    "Chain wrestler. Don't give him your hands.",
    "Slick on top. Stand up first chance.",
    "Technical. Stay in your stance.",
  ],
  end: [
    "Will grind you in P3. Score early.",
    "Cardio guy. Don't let it go the distance.",
    "Built for six minutes. Finish him in three.",
  ],
  grt: [
    "Won't quit. Keep scoring.",
    "Bites down. Don't expect any gifts.",
    "Stays in the match. Make him pay for it.",
  ],
};

function pick(rng, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Return the coach descriptor that should be assigned for a wrestler in
 * the given tier. Null when the tier is unknown (renderer no-ops on null).
 *
 * @param {string|undefined} tier
 * @returns {object|null}
 */
export function coachForTier(tier) {
  if (tier === 'hs') return HS_COACH_PETROV;
  if (tier === 'college') return GENERIC_COLLEGE_COACH;
  if (tier === 'senior') return GENERIC_SENIOR_COACH;
  return null;
}

/**
 * Resolve the coach for a career or tier string. Accepts either a tier
 * string ('hs' | 'college' | 'senior') or a career object; reads
 * `career.wrestler.tier` when given a career. Centralizes the "coach is
 * derived from wrestler.tier" rule so tier-transition reducers can rebind
 * the coach without repeating the lookup pattern.
 *
 * @param {string|object} careerOrTier
 * @returns {object|null}
 */
export function coachForCareerTier(careerOrTier) {
  const tier = typeof careerOrTier === 'string'
    ? careerOrTier
    : careerOrTier?.wrestler?.tier;
  return coachForTier(tier);
}

/**
 * Pull a random line for a coach + situation. Returns null when either
 * input is missing or the pool is empty.
 *
 * @param {string} coachId
 * @param {string} situation
 * @param {() => number} [rng]
 * @returns {string|null}
 */
export function getCoachLine(coachId, situation, rng = Math.random) {
  if (!coachId || !situation) return null;
  const lines = COACH_LINES[coachId]?.[situation];
  return pick(rng, lines);
}

/**
 * Compute a 1-line scouting blurb from an opponent's stat block. Picks the
 * opponent's top stat and returns a template appropriate to that tendency.
 * Recomputes every call (no caching), so stat changes between renders
 * surface immediately.
 *
 * @param {{stats?: {str?:number, spd?:number, tec?:number, end?:number, grt?:number}}} opponent
 * @param {() => number} [rng]
 * @returns {string|null}
 */
export function computeScoutingBlurb(opponent, rng = Math.random) {
  const stats = opponent?.stats;
  if (!stats || typeof stats !== 'object') return null;
  const keys = ['str', 'spd', 'tec', 'end', 'grt'];
  let topStat = null;
  let topValue = -Infinity;
  for (const key of keys) {
    const value = Number(stats[key]) || 0;
    if (value > topValue) {
      topValue = value;
      topStat = key;
    }
  }
  if (!topStat) return null;
  return pick(rng, SCOUT_TEMPLATES[topStat]);
}

export const __test__ = { COACHES, COACH_LINES, SCOUT_TEMPLATES };
