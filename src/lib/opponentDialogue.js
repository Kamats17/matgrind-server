// Opponent dialogue lookup.
//
// Two layers:
//   1. Named-NPC lines (e.g. Elijah Joles partnership). Keyed by npcId. Future
//      named opponents drop entries into NAMED_LINES.
//   2. Generic feud-tier pools. Keyed by feud tier (`rival_hot`, `rival_blood`,
//      `rival_owned`) when the opponent is a rival above the corresponding
//      feudLevel threshold. The caller resolves the tier via
//      `feudTierKey(feudLevel(h2h))` from careerRivals.js.
//
// API surface:
//   - getOpponentLine(npcId, situation, rng?) - returns a string for the
//     given named NPC + situation, or null when no entry exists.
//   - getFeudLine(feudTier, situation, rng?) - returns a tier-keyed generic
//     trash-talk line for unnamed rivals climbing the feud ladder.
//
// All pools are static arrays; the runtime picks via rng (default Math.random).

import { ELIJAH_JOLES_ID, ELIJAH_TRASH_TALK, PARTNERSHIP_ACTIVE } from './career/elijahJoles.js';

// Named NPC dialogue. Elijah is gated on PARTNERSHIP_ACTIVE so flipping the
// partnership off at compile time removes him from the table cleanly; any
// other named opponents added later should drop in unconditionally.
const NAMED_LINES = {
  ...(PARTNERSHIP_ACTIVE ? { [ELIJAH_JOLES_ID]: ELIJAH_TRASH_TALK } : {}),
};

// Generic feud-tier pools. Tone is regional / blue-collar to match
// MatGrind's voice. Avoid trash-talk that names real people or schools.
const FEUD_LINES = {
  rival_hot: {
    pre_match: [
      "We're tied up. Time to settle who's actually better.",
      "Three matches in. People are starting to talk.",
      "Rubber match. Whoever wants it more takes it home.",
      "I been thinking about this one all week.",
    ],
    win: [
      "Good match. Earned that one.",
      "We keep meeting like this, you keep losing.",
      "I always wrestle through.",
      "That's how it's supposed to go.",
    ],
    loss: [
      "Nice try. We'll go again.",
      "You got me this time. Don't get comfortable.",
      "Hand raised but I'll see you Saturday.",
      "Mark it down. Next one's mine.",
    ],
  },
  rival_blood: {
    pre_match: [
      "This is getting personal. Good.",
      "Five times. Let's make six count.",
      "Whole gym's watching. Don't blink.",
      "You know me. I know you. Wrestle.",
    ],
    win: [
      "Owned. Again.",
      "Tell your coach the streak's still alive.",
      "I told you it'd be like this.",
      "Stop showing up if you don't want this.",
    ],
    loss: [
      "Got me. Won't happen twice.",
      "Take the W. I'm not finished with you.",
      "Rematch already on the books in my head.",
      "Hand raised. Doesn't matter. I'll be back.",
    ],
  },
  rival_owned: {
    pre_match: [
      "Don't even need a scouting report on you anymore.",
      "I know what you're gonna do before you do.",
      "Run it back. Same result.",
      "Save your breath. We both know how this ends.",
    ],
    win: [
      "Like I said.",
      "Bell to bell. Predictable.",
      "You can stop signing up for me. It's done.",
      "Pin or major? Doesn't matter. Done.",
    ],
    loss: [
      "Lucky. We'll see you at state.",
      "First one. Only one. Mark it.",
      "Streak broke. Won't crack twice.",
      "Hand raised. Cool. Cool. Cool.",
    ],
  },
};

function pick(rng, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Lookup a per-NPC dialogue line. Returns null when the npcId or situation
 * is not defined - callers should treat null as "no voice for this opponent."
 *
 * @param {string} npcId  stable NPC id
 * @param {string} situation  'pre_match' | 'win' | 'loss' | future keys
 * @param {() => number} [rng]
 * @returns {string|null}
 */
export function getOpponentLine(npcId, situation, rng = Math.random) {
  if (!npcId || !situation) return null;
  const lines = NAMED_LINES[npcId]?.[situation];
  return pick(rng, lines);
}

/**
 * Lookup a generic feud-tier line. Returns null when the tier or situation
 * is not defined. Caller derives `feudTier` via
 * `feudTierKey(feudLevel(rival.h2h))` from careerRivals.js.
 *
 * @param {'rival_hot'|'rival_blood'|'rival_owned'|null} feudTier
 * @param {string} situation
 * @param {() => number} [rng]
 * @returns {string|null}
 */
export function getFeudLine(feudTier, situation, rng = Math.random) {
  if (!feudTier || !situation) return null;
  const lines = FEUD_LINES[feudTier]?.[situation];
  return pick(rng, lines);
}

export const __test__ = { NAMED_LINES, FEUD_LINES };
