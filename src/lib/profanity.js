// Profanity filter for user-controlled text (usernames, team names,
// and - when they exist - chat messages).
//
// Uses `obscenity` because its matcher handles the common evasions
// `bad-words` misses: leetspeak (`sh1t`), letter-spacing (`s h i t`),
// whitespace substitution (`s_h_i_t`), repeated chars (`shiiit`).
//
// Server-side Firestore rules add a denylist-regex backstop at
// /config/profanity_denylist - the client check is purely UX.

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

/** True if `text` contains a blocked term (or leet variant). */
export function containsProfanity(text) {
  if (!text || typeof text !== 'string') return false;
  return matcher.hasMatch(text);
}

/**
 * Pass-through that trims whitespace and throws if the text contains
 * profanity. Caller catches and surfaces a user-friendly toast.
 * The error message is a sentinel - UI code matches on it.
 */
export function filterOrThrow(text) {
  const t = (text || '').trim();
  if (containsProfanity(t)) {
    const err = /** @type {Error & { code?: string }} */ (new Error('PROFANITY'));
    err.code = 'PROFANITY';
    throw err;
  }
  return t;
}
