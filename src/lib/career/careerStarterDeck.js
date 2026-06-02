// ─── Career Mode - Starter Deck ──────────────────────────────────────────────
// These 28 cards are auto-granted to every new career at creation time.
// Everything else in the 111-card pool must be unlocked via the skill tree.
//
// Why 28 and not 20:
//   - The engine's deck validator requires a 24-card deck with category
//     minimums (5 neutral_attack + 4 neutral_counter + 3 transition + 3
//     top_turns + 3 bottom = 18). A ≤24 starter would force the player
//     into exactly one legal deck with zero swap choice at HS Freshman.
//   - 28 leaves 4 "flex" swaps so the player can start personalizing
//     their deck on day one - 1-2 cards per category are optional.
//   - The unlock pool still grows 28 → ~90 over a full career (user
//     chose "intentional partial unlock"), so the tree still forces
//     meaningful branch choice.
//
// The list was selected from fundamentals that every wrestler needs:
// no branch-signature cards, no grand-amplitude throws, no flashy
// leg-laces or spladles. All the flashy stuff is locked behind the tree.
//
// Card count history:
//   26 - original (5 neutral_counter)
//   28 - added fhl_sit_through + fhl_stand_up alongside the FHL_TRAPPED
//        ring expansion (4 -> 6 cards). Without these in the starter deck
//        career players hit the 4-card pool, not the new 6-card one.

export const CAREER_STARTER_DECK = [
  // ── neutral_attack (6) - core shots + setup
  'double_leg',
  'single_leg',
  'snap_spin',
  'snap_down',
  'arm_drag',
  'duck_under',

  // ── neutral_counter (7) - essential defenses, including full sprawl ring
  'sprawl',
  'front_headlock',
  're_shot',
  'whizzer',
  'peek_out',
  'fhl_sit_through',
  'fhl_stand_up',

  // ── transition (4) - core position management
  'spiral_ride',
  'tight_waist',
  'base_build',
  'head_post',

  // ── top_turns (5) - fundamental turns (no cradles-of-doom)
  'half_nelson',
  'arm_bar',
  'tilt',
  'near_side_cradle',
  'far_side_tilt',

  // ── bottom (6) - escape kit
  'stand_up',
  'sit_out',
  'switch_move',
  'hip_heist',
  'short_sit',
  'granby_roll',
];

export const CAREER_STARTER_DECK_SIZE = CAREER_STARTER_DECK.length;

// v7: women's-wrestling careers get the standard starter deck PLUS five
// women's-specific signature cards. Without this, a women's senior-tier
// match would have no access to the women's-only moves (gut wrench to
// leg lace, ankle pick, russian tie, bridge and turn, belly-down defense).
// At HS/college these cards are dormant - those tiers wrestle folkstyle
// (NFHS Girls / NCAA Women's both use folkstyle rules) so the women's-
// freestyle-tagged cards never surface in a folkstyle hand. They light
// up only at senior tier where the wrestlingStyle becomes
// 'womens_freestyle'.
export const WOMENS_CAREER_STARTER_ADD_ONS = [
  'russian_tie',
  'ankle_pick',
  'gut_wrench_to_leg_lace',
  'bridge_and_turn',
  'belly_down_defense',
];

/**
 * Return a fresh array copy. Callers should not mutate the exported
 * constant (JS arrays are mutable).
 *
 * For female careers, append the women's-specific signature cards so
 * those moves are in the player's pool when senior-tier women's
 * freestyle matches happen.
 */
export function getStarterDeckCardIds(gender = 'male') {
  if (gender === 'female') {
    return [...CAREER_STARTER_DECK, ...WOMENS_CAREER_STARTER_ADD_ONS];
  }
  return [...CAREER_STARTER_DECK];
}
