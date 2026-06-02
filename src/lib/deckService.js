// Deck Builder - Phase 3
//
// A "deck" is an ordered list of 24 unique folkstyle card ids. Singleton
// (max 1 copy of each card) keeps deck-building authentic to wrestling -
// you don't stack three "double legs" - and also simplifies the editor UI
// to a checkbox-like per-card toggle rather than a spinner.
//
// MatGrind's card data (src/lib/wrestlingCards.js) has these folkstyle
// categories, with available-card counts (at time of writing):
//   neutral_attack: 23, neutral_counter: 20, transition: 15,
//   top_turns: 9, bottom: 6
// Total folkstyle pool = 73 cards. The freestyle/greco-only categories
// `throw` and `par_terre_top` are intentionally excluded from minimums.
//
// Category minimums sum to 18, leaving 6 flex slots to shape archetypes.
//
// Persistence (see firestoreService.saveDecks + getProfile backfill):
//   profile.decks = Deck[]
//   profile.activeDeckId = string | null
//
// Deck shape:
//   { id: string, name: string, cards: string[] }   // cards.length === 24
//
// At match init, WrestlingGame resolves activeDeckId → deckToCardIdSet()
// → passes to buildHand() via state.<player>.allowedCardIds.

import { CARDS } from './wrestlingCards.js';

export const DECK_SIZE = 24;
export const MAX_COPIES_PER_CARD = 1; // Singleton rule.

// Folkstyle-only category minimums. Sum = 18; the remaining 6 slots are
// free-form flex. `throw` and `par_terre_top` are excluded - no folkstyle
// cards exist in those categories.
export const CATEGORY_MINIMUMS = {
  neutral_attack: 5,
  neutral_counter: 4,
  transition: 3,
  top_turns: 3,
  bottom: 3,
};

// Categories that participate in validation. Anything outside this list
// is still legal to include (flex slots) but doesn't satisfy a minimum.
export const TRACKED_CATEGORIES = Object.keys(CATEGORY_MINIMUMS);

/**
 * Generate a new 16-char id (good enough for deck ids; collisions are
 * bounded by the per-user profile so global uniqueness isn't required).
 */
export function generateDeckId() {
  return 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Return a Set of card ids legal for folkstyle decks. */
function _folkstyleCardIdSet() {
  const out = new Set();
  for (const [id, c] of Object.entries(CARDS)) {
    if ((c.styles || []).includes('folkstyle')) out.add(id);
  }
  return out;
}

// Cache - CARDS is immutable at runtime.
let _FOLK_SET_CACHE = null;
function folkstyleCardIds() {
  if (!_FOLK_SET_CACHE) _FOLK_SET_CACHE = _folkstyleCardIdSet();
  return _FOLK_SET_CACHE;
}

/** Category count for a deck - shape-validated. Returns {} for invalid input. */
export function deckCategoryCounts(deck) {
  const out = {};
  if (!deck || !Array.isArray(deck.cards)) return out;
  for (const id of deck.cards) {
    const c = CARDS[id];
    if (!c) continue;
    out[c.category] = (out[c.category] || 0) + 1;
  }
  return out;
}

/** Total card count (ignoring duplicates). */
export function deckCardCount(deck) {
  return Array.isArray(deck?.cards) ? deck.cards.length : 0;
}

/** Convert to Set<cardId> for buildHand's `allowedCardIds` parameter. */
export function deckToCardIdSet(deck) {
  const out = new Set();
  if (!deck || !Array.isArray(deck.cards)) return out;
  for (const id of deck.cards) out.add(id);
  return out;
}

/**
 * Validate a deck against all MVP rules:
 *   - shape: cards is a 24-length string array
 *   - all ids exist in CARDS
 *   - all ids are folkstyle-legal
 *   - singleton (no duplicates)
 *   - every tracked category meets its minimum
 *   - (optional) all ids are in the allowedCardIds set - career mode only
 *
 * The second argument is optional. Passing `{ allowedCardIds: Set<string> }`
 * restricts the deck to cards the player has actually unlocked in their
 * career. Omit (or pass null/undefined) for unrestricted validation, which
 * is the behavior outside career mode.
 *
 * Returns { ok: boolean, errors: string[] }. Errors are human-readable
 * and suitable for direct rendering in the DecksScreen error strip.
 */
export function validateDeck(deck, { allowedCardIds = null } = {}) {
  const errors = [];
  const restrict = allowedCardIds instanceof Set && allowedCardIds.size > 0;

  if (!deck || typeof deck !== 'object') {
    return { ok: false, errors: ['Deck is missing or malformed.'] };
  }
  if (!deck.name || typeof deck.name !== 'string' || !deck.name.trim()) {
    errors.push('Deck needs a name.');
  }
  if (!Array.isArray(deck.cards)) {
    return { ok: false, errors: [...errors, 'Deck has no card list.'] };
  }

  const n = deck.cards.length;
  if (n !== DECK_SIZE) {
    errors.push(`Deck must have exactly ${DECK_SIZE} cards (has ${n}).`);
  }

  const seen = new Set();
  const folk = folkstyleCardIds();
  for (const id of deck.cards) {
    if (typeof id !== 'string') {
      errors.push('Deck contains a non-string card id.');
      continue;
    }
    if (!CARDS[id]) {
      errors.push(`Unknown card "${id}".`);
      continue;
    }
    if (!folk.has(id)) {
      errors.push(`"${CARDS[id].name}" is not folkstyle-legal.`);
    }
    if (restrict && !allowedCardIds.has(id)) {
      errors.push(`"${CARDS[id].name}" is not yet unlocked.`);
    }
    if (MAX_COPIES_PER_CARD === 1 && seen.has(id)) {
      errors.push(`Duplicate: "${CARDS[id].name}" (max 1 copy per card).`);
    }
    seen.add(id);
  }

  const counts = deckCategoryCounts(deck);
  for (const cat of TRACKED_CATEGORIES) {
    const need = CATEGORY_MINIMUMS[cat];
    const have = counts[cat] || 0;
    if (have < need) {
      errors.push(`Needs at least ${need} ${_prettyCategory(cat)} (has ${have}).`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function _prettyCategory(cat) {
  return ({
    neutral_attack: 'neutral attack',
    neutral_counter: 'neutral counter',
    transition: 'transition',
    top_turns: 'top turn',
    bottom: 'bottom',
  })[cat] || cat;
}

/** Create an empty deck skeleton - caller populates .cards in the editor. */
export function newEmptyDeck(name = 'New Deck') {
  return {
    id: generateDeckId(),
    name: name.slice(0, 40),
    cards: [],
  };
}

/** Clone a starter preset into a mutable user-owned deck with a fresh id. */
export function cloneStarter(key, name) {
  const preset = STARTER_DECKS[key];
  if (!preset) throw new Error(`Unknown starter deck: ${key}`);
  return {
    id: generateDeckId(),
    name: (name || preset.name).slice(0, 40),
    cards: [...preset.cards],
  };
}

// ─── STARTER DECKS ────────────────────────────────────────────────────────────
//
// Each starter is a viable 24-card folkstyle deck that passes validateDeck().
// Three distinct playstyles give new players a meaningful choice without
// requiring them to know the 73-card pool.
//
// Scrambler - fast chains, reactive counters, bottom-heavy escapes.
// Power     - big neutral offense, turning combinations on top.
// Grinder   - top-dominant, high-control, patient match management.

export const STARTER_DECKS = {
  scrambler: {
    key: 'scrambler',
    name: 'Scrambler',
    description: 'Fast chain attacks. Counter-heavy. Strong from bottom.',
    cards: [
      // neutral_attack (6)
      'arm_drag', 'duck_under', 'snap_spin', 'go_behind',
      'scramble_reattack', 'scramble_come_out_top',
      // neutral_counter (6)
      'scramble_clear_hips', 'sprawl', 're_shot', 'peek_out',
      'whizzer_hop', 'limp_leg',
      // transition (3)
      'head_post', 'hand_control_escape', 'base_build',
      // top_turns (3)
      'arm_bar', 'tilt', 'crossface_cradle',
      // bottom (6)
      'stand_up', 'switch_move', 'sit_out', 'granby_roll',
      'hip_heist', 'tripod_stand',
    ],
  },
  power: {
    key: 'power',
    name: 'Power',
    description: 'Heavy neutral offense. Devastating turns on top.',
    cards: [
      // neutral_attack (9)
      'double_leg', 'single_leg', 'high_crotch', 'sweep_single',
      'fireman_carry', 'run_the_pipe', 'elevate_and_trip',
      'mat_return_from_leg', 'rear_lift',
      // neutral_counter (4)
      'sprawl', 'front_headlock', 'fhl_snap_spin', 'fhl_body_dump',
      // transition (3)
      'spiral_ride', 'tight_waist', 'claw_ride',
      // top_turns (5)
      'half_nelson', 'power_half', 'near_side_cradle',
      'far_side_tilt', 'crossface_cradle',
      // bottom (3)
      'stand_up', 'switch_move', 'sit_out',
    ],
  },
  grinder: {
    key: 'grinder',
    name: 'Grinder',
    description: 'Dominant on top. Patient riding. Pressure wears opponents down.',
    cards: [
      // neutral_attack (5)
      'double_leg', 'single_leg', 'snap_down', 'inside_trip', 'rear_mat_return',
      // neutral_counter (4)
      'sprawl', 'front_headlock', 'down_block', 'stuff_head',
      // transition (6)
      'spiral_ride', 'ankle_ride', 'tight_waist', 'chop_and_drive',
      'cross_face_pressure', 'cross_wrist_ride',
      // top_turns (6)
      'half_nelson', 'power_half', 'arm_bar', 'tilt', 'arm_turk', 'leg_turk',
      // bottom (3)
      'stand_up', 'sit_out', 'granby_roll',
    ],
  },
};

/** For UI - list of starter keys in display order. */
export const STARTER_KEYS = ['scrambler', 'power', 'grinder'];
