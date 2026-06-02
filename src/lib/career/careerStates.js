// ─── Career States ──────────────────────────────────────────────────────────
// 50 US states grouped by region with a wrestling-difficulty tier per state.
// Tiers shift the ranking pool's overall ranges and the prestige tier applied
// to state-championship trophies. PA is the bold default - it's the hardest
// path and the state title there carries the most weight.

export const STATE_TIER = {
  // S - wrestling powerhouse, deepest pool. PA gets its own tier so winning
  // a PA state title means more than any other state.
  PA: 'S',
  // A - strong traditional wrestling states.
  IA: 'A', OH: 'A', NJ: 'A', OK: 'A', MN: 'A', IL: 'A', CA: 'A', MO: 'A', MI: 'A',
  // B - solid programs, mid-pack difficulty.
  NY: 'B', FL: 'B', TX: 'B', VA: 'B', IN: 'B', WI: 'B', NC: 'B', GA: 'B', NE: 'B',
  // D - softer programs (small population / less wrestling tradition).
  AK: 'D', HI: 'D', VT: 'D', RI: 'D', ND: 'D', SD: 'D', WY: 'D', ME: 'D', NH: 'D',
  // Everything else defaults to C (handled by getStateTier fallback).
};

// Modifiers bumped up so no state has a negative baseline. The lowest tier
// (Growing) is roughly where the old default-C-tier sat, and everyone above
// gets a real boost. Keeps the ordering but removes the "you're below average"
// feel of the old D-tier.
const TIER_MODIFIERS = {
  S: { baseline: +6, spread: +9 }, // Elite
  A: { baseline: +4, spread: +6 }, // Powerhouse
  B: { baseline: +2, spread: +3 }, // Strong
  C: { baseline: +1, spread: +1 }, // Solid
  D: { baseline:  0, spread:  0 }, // Growing
};

// User-facing tier names. Less hierarchical than S/A/B/C/D so picking a
// "Solid" or "Growing" state doesn't feel like settling.
const TIER_NAME = {
  S: 'Elite',
  A: 'Powerhouse',
  B: 'Strong',
  C: 'Solid',
  D: 'Growing',
};

export function getStateTierName(stateCode) {
  return TIER_NAME[getStateTier(stateCode)] || TIER_NAME.C;
}

const TIER_PRESTIGE = {
  S: 'gold',   // PA state title = gold prestige
  A: 'gold',
  B: 'silver',
  C: null,
  D: null,
};

// ─── States grouped by region for the picker UI ────────────────────────────

export const STATES_BY_REGION = {
  Northeast: [
    { code: 'CT', name: 'Connecticut' },
    { code: 'ME', name: 'Maine' },
    { code: 'MA', name: 'Massachusetts' },
    { code: 'NH', name: 'New Hampshire' },
    { code: 'NJ', name: 'New Jersey' },
    { code: 'NY', name: 'New York' },
    { code: 'PA', name: 'Pennsylvania' },
    { code: 'RI', name: 'Rhode Island' },
    { code: 'VT', name: 'Vermont' },
  ],
  Midwest: [
    { code: 'IL', name: 'Illinois' },
    { code: 'IN', name: 'Indiana' },
    { code: 'IA', name: 'Iowa' },
    { code: 'KS', name: 'Kansas' },
    { code: 'MI', name: 'Michigan' },
    { code: 'MN', name: 'Minnesota' },
    { code: 'MO', name: 'Missouri' },
    { code: 'NE', name: 'Nebraska' },
    { code: 'ND', name: 'North Dakota' },
    { code: 'OH', name: 'Ohio' },
    { code: 'SD', name: 'South Dakota' },
    { code: 'WI', name: 'Wisconsin' },
  ],
  South: [
    { code: 'AL', name: 'Alabama' },
    { code: 'AR', name: 'Arkansas' },
    { code: 'DE', name: 'Delaware' },
    { code: 'FL', name: 'Florida' },
    { code: 'GA', name: 'Georgia' },
    { code: 'KY', name: 'Kentucky' },
    { code: 'LA', name: 'Louisiana' },
    { code: 'MD', name: 'Maryland' },
    { code: 'MS', name: 'Mississippi' },
    { code: 'NC', name: 'North Carolina' },
    { code: 'OK', name: 'Oklahoma' },
    { code: 'SC', name: 'South Carolina' },
    { code: 'TN', name: 'Tennessee' },
    { code: 'TX', name: 'Texas' },
    { code: 'VA', name: 'Virginia' },
    { code: 'WV', name: 'West Virginia' },
  ],
  West: [
    { code: 'AK', name: 'Alaska' },
    { code: 'AZ', name: 'Arizona' },
    { code: 'CA', name: 'California' },
    { code: 'CO', name: 'Colorado' },
    { code: 'HI', name: 'Hawaii' },
    { code: 'ID', name: 'Idaho' },
    { code: 'MT', name: 'Montana' },
    { code: 'NV', name: 'Nevada' },
    { code: 'NM', name: 'New Mexico' },
    { code: 'OR', name: 'Oregon' },
    { code: 'UT', name: 'Utah' },
    { code: 'WA', name: 'Washington' },
    { code: 'WY', name: 'Wyoming' },
  ],
};

// Flat list: ["AL", "AK", ...] - useful for hydration validation.
export const ALL_STATE_CODES = Object.values(STATES_BY_REGION)
  .flat()
  .map(s => s.code)
  .sort();

export const DEFAULT_STATE = 'PA';

// ─── API ───────────────────────────────────────────────────────────────────

/**
 * Tier letter S/A/B/C/D for a state code. Unknown/missing → C (default).
 * @param {string|null|undefined} stateCode
 */
export function getStateTier(stateCode) {
  if (!stateCode) return 'C';
  return STATE_TIER[stateCode.toUpperCase()] || 'C';
}

/**
 * Pool-overall modifiers for a state. Add to existing min/max ranges in
 * `generateExpandedRankingPool`. Negative values lower the pool.
 * @param {string|null|undefined} stateCode
 * @returns {{ baseline: number, spread: number }}
 */
export function getStateOverallModifier(stateCode) {
  return TIER_MODIFIERS[getStateTier(stateCode)] || TIER_MODIFIERS.C;
}

/**
 * Prestige label awarded to a state-title trophy won in this state.
 * 'gold' for S/A, 'silver' for B, null for C/D.
 * @param {string|null|undefined} stateCode
 * @returns {'gold' | 'silver' | null}
 */
export function getStatePrestige(stateCode) {
  return TIER_PRESTIGE[getStateTier(stateCode)] ?? null;
}

/**
 * 1-5 star difficulty pip count for the picker UI.
 * @param {string|null|undefined} stateCode
 * @returns {number} 1-5
 */
export function getStateStars(stateCode) {
  switch (getStateTier(stateCode)) {
    case 'S': return 5;
    case 'A': return 4;
    case 'B': return 3;
    case 'C': return 2;
    case 'D': return 1;
    default:  return 2;
  }
}

/**
 * Look up the human-readable name for a code, falling back to the code itself.
 * @param {string} stateCode
 */
export function getStateName(stateCode) {
  if (!stateCode) return '';
  const code = stateCode.toUpperCase();
  for (const region of Object.values(STATES_BY_REGION)) {
    const found = region.find(s => s.code === code);
    if (found) return found.name;
  }
  return code;
}

/**
 * Sanitize / normalize a stateCode. Returns DEFAULT_STATE if invalid.
 * @param {unknown} stateCode
 */
export function normalizeState(stateCode) {
  if (typeof stateCode !== 'string') return DEFAULT_STATE;
  const code = stateCode.toUpperCase();
  return ALL_STATE_CODES.includes(code) ? code : DEFAULT_STATE;
}
