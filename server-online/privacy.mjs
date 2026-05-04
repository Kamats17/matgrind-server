// Privacy / state serialization for the authoritative online server.
//
// `serializeStateForRecipient` is the ONLY function in the codebase
// allowed to construct a public view of `room.matchState` for broadcast
// to a player or spectator. It enforces an explicit allowlist of
// public fields; any field on the engine state that isn't in the
// allowlist or in the explicit private deny-list will trip a CI test.
//
// Why allowlist-first: a deny-list silently leaks new private fields
// added to the engine. The allowlist + deny-list pair forces the next
// person who adds an engine field to think about its privacy.
//
// Imported by roomManager.broadcastStateUpdate. Bare JSON.stringify of
// matchState is banned outside this module (CI grep).

// Top-level public fields. These ship to all recipients (player + spectator).
// Per-side private fields (hand contents, server-only challenge metadata)
// are kept on the room object, NOT on matchState, and shipped via separate
// private channels (state_update.hand, challenge_start, etc.).
export const PUBLIC_STATE_FIELDS = new Set([
  // Match meta
  'phase',
  'period',
  'clock',
  'maxPeriods',
  'wrestlingStyle',
  'aiDifficulty',
  'roundNumber',
  // Wrestlers (whole object - safe; no private subfields)
  'p1',
  'p2',
  // Active conditions (visible)
  'p1Conditions',
  'p2Conditions',
  // Match state
  'pressure',
  'initiative',
  'momentum',
  'chainActive',
  'boundary',
  'lastResult',
  'log',
  'winner',
  'winMethod',
  // Period transitions
  'periodChoicePending',
  'pendingChoiceFor',
  'period2Chooser',
  // Stalling / activity
  'turnHistory',
  'neutralStaleCount',
  'stallCount',
  'activityClock',
  // Pin attempt phase data
  'pinAttempt',
  // Freestyle/Greco
  'parTerreCountdown',
  // Per-match reroll budget
  'rerollsLeft',
]);

// Fields that exist on engine state but must never cross to clients.
// (Today engine state has no such fields — listed as a hook for the future.)
export const PRIVATE_STATE_FIELDS = new Set([
  // Add server-only fields here when the engine grows them.
  // Adding a field here without adding to PUBLIC_STATE_FIELDS forces
  // explicit private classification.
]);

/**
 * Serialize matchState for delivery to a specific recipient role.
 * @param {object} state - room.matchState
 * @param {'p1'|'p2'|'spectator'} role
 * @returns {object} new object with only public fields
 */
export function serializeStateForRecipient(state, role) {
  if (!state || typeof state !== 'object') {
    throw new Error('serializeStateForRecipient: state must be an object');
  }
  if (role !== 'p1' && role !== 'p2' && role !== 'spectator') {
    throw new Error(`serializeStateForRecipient: invalid role ${role}`);
  }
  const out = {};
  for (const key of PUBLIC_STATE_FIELDS) {
    if (key in state) out[key] = state[key];
  }
  // Future per-role redactions can land here. Today there are none —
  // every field in PUBLIC_STATE_FIELDS is broadcast-safe equally.
  return out;
}

/**
 * Strip private fields from a crash-dump payload before writing to
 * disk or shipping to logs. Same allowlist semantics: only public state
 * fields are retained; explicitly-private inputs (hands, raw events with
 * payloads that may contain timing details) are redacted.
 */
export function redactCrashDump(dump) {
  const safe = { ...dump };
  if (safe.matchState) {
    safe.matchState = serializeStateForRecipient(safe.matchState, 'spectator');
  }
  // Hands are private; never log raw card lists.
  delete safe.hands;
  delete safe.preGeneratedChallenges;
  // Inputs that triggered the throw are useful for debugging - keep card
  // ids and tier results but strip any raw event timing arrays which
  // could fingerprint user input cadence.
  if (safe.challenges) {
    delete safe.challenges;
  }
  return safe;
}

/**
 * Fail-loud validation: assert every key in `state` is classified as
 * either PUBLIC or PRIVATE. Used by the CI test to surface unclassified
 * engine additions.
 * @param {object} state
 * @returns {string[]} list of unclassified keys (empty if all classified)
 */
export function findUnclassifiedFields(state) {
  if (!state || typeof state !== 'object') return [];
  const unclassified = [];
  for (const key of Object.keys(state)) {
    if (!PUBLIC_STATE_FIELDS.has(key) && !PRIVATE_STATE_FIELDS.has(key)) {
      unclassified.push(key);
    }
  }
  return unclassified;
}
