// Wrestling Match Engine
// Supports folkstyle (NFHS), freestyle (UWW), and Greco-Roman (UWW) modes
// Clean state machine with validated transitions

import { POSITIONS, CONDITIONS, CARDS, getAvailableCards, getScores } from './wrestlingCards.js';
import { SKILL_TIERS } from './cardArchetypeMechanics.js';

export const PERIOD_DURATION = 120; // 2 min folkstyle periods
export const FREESTYLE_PERIOD_DURATION = 180; // 3 min freestyle/greco periods

// Helper: true for freestyle, greco, and womens_freestyle (shared international rules)
function isInternationalStyle(style) {
  return style === 'freestyle' || style === 'greco' || style === 'womens_freestyle';
}

// Helper: true when the women's freestyle ruleset is in use. Same on-mat
// engine as men's freestyle (UWW unified rules) - split out so UI/career
// code can branch on it for badges, weight classes, and roster.
export function isWomensStyle(style) {
  return style === 'womens_freestyle';
}

// ─── Initial State ────────────────────────────────────────────────────────────

export function createInitialMatchState(
  p1Name = 'Green Wrestler',
  p2Name = 'Red Wrestler',
  wrestlingStyle = 'folkstyle',
  p1Stats = null,
  p2Stats = null,
  aiDifficulty = 'medium',
  initialInitiative = null
) {
  const intl = isInternationalStyle(wrestlingStyle);
  return {
    phase: 'playing',  // 'playing' | 'pin_attempt' | 'period_break' | 'overtime' | 'finished'
    period: 1,
    clock: intl ? FREESTYLE_PERIOD_DURATION : PERIOD_DURATION,
    maxPeriods: intl ? 2 : 3,
    wrestlingStyle,
    aiDifficulty, // 'easy' | 'medium' | 'hard'
    roundNumber: 0,
    p1: createWrestler(p1Name, 'p1', p1Stats),
    p2: createWrestler(p2Name, 'p2', p2Stats),
    p1Conditions: [],
    p2Conditions: [],
    pressure: { p1OnP2: 0, p2OnP1: 0 },
    initiative: initialInitiative || (Math.random() < 0.5 ? 'p1' : 'p2'), // use saved value for replays, random for live
    momentum: 'neutral',
    chainActive: false,
    boundary: false,
    lastResult: null,
    log: [],
    winner: null,
    winMethod: null,
    periodChoicePending: false,
    pendingChoiceFor: null,
    period2Chooser: null, // tracks who actually made the period 2 choice (after defer resolution)
    turnHistory: { p1: {}, p2: {} },
    neutralStaleCount: 0, // consecutive stalemates -triggers referee warning at 3, penalty at 5
    // Phase 3 - per-player stalling count. Counts consecutive rounds the
    // player chose a defensive `neutral_counter` card while the opponent
    // held initiative in an already-stale neutral (neutralStaleCount ≥ 2).
    // Warnings 1 & 2 are free; at 3 the opponent gets +1 and the counter
    // resets. See checkStalling() below.
    stallCount: { p1: 0, p2: 0 },
    activityClock: 0,     // freestyle: consecutive non-scoring rounds -triggers passivity
    // Pin attempt phase data
    pinAttempt: null, // { attacker, cardId, pinChance, offenseCards, defenseCards, stage, stage1DefCard }
    parTerreCountdown: null, // Greco/freestyle: rounds remaining before par terre resets to neutral
    // Per-match hand-reroll budget. Each side gets 2 rerolls; using one
    // discards the current 6-card hand and draws a fresh one (see
    // rerollHand below). The move timer keeps ticking - burning clock is
    // the strategic cost. Server-authoritative in online mode.
    rerollsLeft: { p1: 2, p2: 2 },
  };
}

function createWrestler(name, id, stats = null) {
  const s = stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
  return {
    id,
    name,
    score: 0,
    stats: s,
    stamina: 200 + (s.end - 50) * 0.2, // END 50→200, END 80→206, END 100→210
    position: POSITIONS.NEUTRAL,
    takedownCount: 0,
    escapeCount: 0,
    reversalCount: 0,
    nearFallCount: 0,
    exposureCount: 0,       // freestyle: back exposures scored
    grandAmplitudeCount: 0, // freestyle: grand amplitude throws landed
    pinCount: 0,
    defensiveResistance: 0, // built up by successful pin defenses
    pinDepth: 0,            // how many consecutive pin-threatening turns this wrestler has survived
    bottomRounds: 0,        // consecutive rounds spent on bottom (used for baseline defensiveResistance)
    rideTimeStreak: 0,      // consecutive control wins from TOP -reaches 3 → riding time bonus (+1 pt)
    controlStreak: 0,       // consecutive control wins before attempting a turn -rewards riding-first strategy
  };
}

// ─── Match-position descriptor ──────────────────────────────────────────────
// Pure helper: from `state` alone, return a short tag describing where the
// match stands so the player knows what they're walking into before picking
// a card. Surfaces the rich CONDITIONS data (FHL, leg secured, scramble,
// broken-down, etc.) that wasn't visible to players before.
//
// Tone is for color hint only - urgent for FHL/leg-attack/scramble/rear-
// standing, neutral for clean neutral or tie-up, top/bottom for ride states.

const POSITION_NAME_MAX = 12;
function shortName(name) {
  if (typeof name !== 'string') return '';
  if (name.length <= POSITION_NAME_MAX) return name;
  return name.slice(0, POSITION_NAME_MAX - 1) + '…';
}

export function describeMatchPosition(state) {
  if (!state || !state.p1 || !state.p2) {
    return { tag: '', tone: 'neutral' };
  }
  // Phase short-circuits: pin attempts and terminal phases override the
  // normal position read so the chip never shows stale ride / FHL state
  // during a transition the player can't act on.
  if (state.phase === 'finished') {
    return { tag: 'Match finished', tone: 'neutral' };
  }
  if (state.phase === 'pin_attempt' && state.pinAttempt?.attacker) {
    const attackerSide = state.pinAttempt.attacker;
    const attackerName = shortName(state[attackerSide]?.name || 'Wrestler');
    return { tag: `Pin attempt - ${attackerName}`, tone: 'urgent' };
  }
  if (state.phase === 'period_break') {
    return { tag: `Period ${state.period} - reset`, tone: 'neutral' };
  }
  if (state.phase === 'overtime') {
    return { tag: 'Overtime - sudden victory', tone: 'urgent' };
  }

  const p1 = state.p1;
  const p2 = state.p2;
  const p1Name = shortName(p1.name || 'P1');
  const p2Name = shortName(p2.name || 'P2');
  const p1c = state.p1Conditions || [];
  const p2c = state.p2Conditions || [];

  // Greco par-terre clock: bottom can stall to force a reset to neutral.
  // When the engine has set parTerreCountdown, surface "rounds left" so the
  // bottom wrestler knows how close they are to a reset. Show before any
  // generic top/bottom tag so the timer takes priority.
  if (state.parTerreCountdown !== null && typeof state.parTerreCountdown === 'number' && state.parTerreCountdown > 0) {
    const left = state.parTerreCountdown;
    const r = left === 1 ? 'round' : 'rounds';
    return { tag: `Par terre - ${left} ${r} until reset`, tone: 'urgent' };
  }

  const isNeutral = p1.position === POSITIONS.NEUTRAL && p2.position === POSITIONS.NEUTRAL;

  if (isNeutral) {
    // Resolution order: most consequential / urgent state wins.
    if (p1c.includes(CONDITIONS.LEG_ATTACK_SECURED)) return { tag: `${p1Name} has a leg`, tone: 'urgent' };
    if (p2c.includes(CONDITIONS.LEG_ATTACK_SECURED)) return { tag: `${p2Name} has a leg`, tone: 'urgent' };
    if (p1c.includes(CONDITIONS.LEG_ATTACK_TRAPPED)) return { tag: `${p1Name} caught`, tone: 'urgent' };
    if (p2c.includes(CONDITIONS.LEG_ATTACK_TRAPPED)) return { tag: `${p2Name} caught`, tone: 'urgent' };
    if (p1c.includes(CONDITIONS.FRONT_HEADLOCK_CONTROL)) return { tag: `${p1Name} has FHL`, tone: 'urgent' };
    if (p2c.includes(CONDITIONS.FRONT_HEADLOCK_CONTROL)) return { tag: `${p2Name} has FHL`, tone: 'urgent' };
    if (p1c.includes(CONDITIONS.FRONT_HEADLOCK_TRAPPED)) return { tag: `${p1Name} in FHL`, tone: 'urgent' };
    if (p2c.includes(CONDITIONS.FRONT_HEADLOCK_TRAPPED)) return { tag: `${p2Name} in FHL`, tone: 'urgent' };
    if (p1c.includes(CONDITIONS.REAR_STANDING)) return { tag: `${p1Name} behind`, tone: 'urgent' };
    if (p2c.includes(CONDITIONS.REAR_STANDING)) return { tag: `${p2Name} behind`, tone: 'urgent' };
    if (p1c.includes(CONDITIONS.SCRAMBLE) || p2c.includes(CONDITIONS.SCRAMBLE)) return { tag: 'Scramble', tone: 'urgent' };
    // Greco doesn't have collar ties (upper-body-only style); the
    // equivalent over-under battle is called pummeling.
    if (p1c.includes(CONDITIONS.TIE_UP) || p2c.includes(CONDITIONS.TIE_UP)) {
      const label = state.wrestlingStyle === 'greco' ? 'Pummel' : 'Collar tie';
      return { tag: label, tone: 'neutral' };
    }
    if (p1c.includes(CONDITIONS.INSIDE_POSITION)) return { tag: `${p1Name} - inside`, tone: 'neutral' };
    if (p2c.includes(CONDITIONS.INSIDE_POSITION)) return { tag: `${p2Name} - inside`, tone: 'neutral' };
    return { tag: 'Neutral', tone: 'neutral' };
  }

  // Top / bottom split - one wrestler is on top, the other on bottom.
  const topSide  = p1.position === POSITIONS.TOP ? 'p1' : (p2.position === POSITIONS.TOP ? 'p2' : null);
  const botSide  = p1.position === POSITIONS.BOTTOM ? 'p1' : (p2.position === POSITIONS.BOTTOM ? 'p2' : null);
  if (!topSide || !botSide) {
    // Defensive fallback - shouldn't happen but never returns empty.
    return { tag: 'In position', tone: 'neutral' };
  }
  const topName = shortName(state[topSide].name || 'Top');
  const botName = shortName(state[botSide].name || 'Bot');
  const topConds = state[`${topSide}Conditions`] || [];
  const botConds = state[`${botSide}Conditions`] || [];

  // Top qualifier
  let topTag;
  if (topConds.includes(CONDITIONS.LEG_RIDE_ESTABLISHED))    topTag = `${topName} - legs in`;
  else if (topConds.includes(CONDITIONS.TOP_PRESSURE))       topTag = `${topName} - heavy ride`;
  else if (topConds.includes(CONDITIONS.CONTROL_ESTABLISHED)) topTag = `${topName} - in control`;
  else                                                        topTag = `${topName} on top`;

  // Bottom qualifier
  let botTag;
  if (botConds.includes(CONDITIONS.BROKEN_DOWN))     botTag = `${botName} - flat`;
  else if (botConds.includes(CONDITIONS.RECOVERING)) botTag = `${botName} - recovering`;
  else if (botConds.includes(CONDITIONS.GOOD_BASE))  botTag = `${botName} - solid base`;
  else if (botConds.includes(CONDITIONS.BASE_BUILT)) botTag = `${botName} - on base`;
  else                                                botTag = `${botName} on bottom`;

  // Tone: urgent if bottom is in trouble (broken-down) or top has legs in;
  // otherwise the side-tone hints at who has the leverage.
  let tone = 'top'; // default - in a top/bottom split, the top has control
  if (botConds.includes(CONDITIONS.BROKEN_DOWN) || topConds.includes(CONDITIONS.LEG_RIDE_ESTABLISHED)) {
    tone = 'urgent';
  } else if (botConds.includes(CONDITIONS.GOOD_BASE) || botConds.includes(CONDITIONS.BASE_BUILT)) {
    tone = 'bottom'; // bottom is fighting back
  }
  return { tag: `${topTag} · ${botTag}`, tone };
}

// ─── Build Hand ────────────────────────────────────────────────────────────────

// Slot quotas define the balanced hand composition per position
function getSlotQuotas(position, style = 'folkstyle') {
  switch (position) {
    case POSITIONS.NEUTRAL:
      return [
        { categories: ['neutral_attack'], count: 2 },
        { categories: ['neutral_counter'], count: 2 },
        { categories: ['transition'], count: 2 },
      ];
    case POSITIONS.TOP:
      if (style === 'folkstyle') {
        return [
          { categories: ['top_turns'], count: 3 },
          { categories: ['transition'], count: 3 },
        ];
      }
      return [
        { categories: ['top_turns'], count: 2 },
        { categories: ['transition'], count: 2 },
        { categories: ['par_terre_top'], count: 2 },
      ];
    case POSITIONS.BOTTOM:
      return [
        { categories: ['bottom'], count: 2 },
        { categories: ['transition'], count: 2 },
      ];
    default:
      return [];
  }
}

/**
 * Build a hand for `position`. When `allowedCardIds` is a Set (Phase 3
 * Deck Builder), the candidate pool is first filtered to only cards in
 * that deck. If the filtered pool can't cover a full hand (edge-case
 * deck + position combo), we fall back to the unfiltered pool so the
 * match never softlocks - the deck is a preference, not a hard wall.
 * Passing `null` / `undefined` is a no-op and preserves legacy behavior
 * for users who haven't picked an active deck.
 */
export function buildHand(position, conditions = [], size = 6, style = 'folkstyle', allowedCardIds = null) {
  let available = getAvailableCards(position, conditions, style);
  if (allowedCardIds instanceof Set && allowedCardIds.size > 0) {
    const filtered = available.filter(c => allowedCardIds.has(c.id));
    // Softlock guard - if the deck doesn't give us enough playable cards
    // for this position, ignore the filter and draw from the full pool.
    if (filtered.length >= size) {
      available = filtered;
    }
  }
  if (available.length === 0) {
    return getAvailableCards(POSITIONS.NEUTRAL, [], style).slice(0, size);
  }
  if (available.length <= size) {
    return [...available].sort(() => Math.random() - 0.5);
  }

  // Group by category and shuffle each group
  const byCategory = {};
  for (const card of available) {
    const cat = card.category || 'general';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(card);
  }
  Object.values(byCategory).forEach(arr => arr.sort(() => Math.random() - 0.5));

  // Fill quota slots first -guarantees balanced hand composition
  const result = [];
  const usedIds = new Set();
  const quotas = getSlotQuotas(position, style);

  for (const quota of quotas) {
    let filled = 0;
    for (const cat of quota.categories) {
      const pool = byCategory[cat] || [];
      for (const card of pool) {
        if (filled >= quota.count || result.length >= size) break;
        if (!usedIds.has(card.id)) {
          result.push(card);
          usedIds.add(card.id);
          filled++;
        }
      }
    }
  }

  // Fill remaining flex slots, preferring underrepresented categories
  if (result.length < size) {
    const remaining = available.filter(c => !usedIds.has(c.id));
    const catCounts = {};
    for (const c of result) catCounts[c.category] = (catCounts[c.category] || 0) + 1;
    remaining.sort((a, b) => {
      const aCount = catCounts[a.category] || 0;
      const bCount = catCounts[b.category] || 0;
      if (aCount !== bCount) return aCount - bCount;
      return Math.random() - 0.5;
    });
    for (const card of remaining) {
      if (result.length >= size) break;
      result.push(card);
      usedIds.add(card.id);
      catCounts[card.category] = (catCounts[card.category] || 0) + 1;
    }
  }

  const hand = result.slice(0, size);

  // Scramble guarantee: when SCRAMBLE is active, ensure at least 1 scramble card in hand
  if (conditions.includes(CONDITIONS.SCRAMBLE)) {
    const hasScrambleCard = hand.some(c => SCRAMBLE_CARD_IDS.has(c.id));
    if (!hasScrambleCard) {
      const scrambleCards = available.filter(c => SCRAMBLE_CARD_IDS.has(c.id));
      if (scrambleCards.length > 0) {
        const picked = scrambleCards[Math.floor(Math.random() * scrambleCards.length)];
        hand[hand.length - 1] = picked; // replace last card
      }
    }
  }

  // Top-position get-legs-in guarantee: if the player is on top and every
  // card in the hand is a setup/control (no actual scoring path: takedowns,
  // near falls, escapes, reversals), guarantee get_legs_in is one of the 6.
  // Without this the player can be stuck on top with only breakdown/transition
  // cards and no way to start a scoring chain.
  if (position === POSITIONS.TOP) {
    const isSetupOnly = (c) => {
      const t = c.scoreEffect?.type;
      return t === 'setup' || t === 'control' || !t;
    };
    const allSetups = hand.every(isSetupOnly);
    const hasGetLegsIn = hand.some(c => c.id === 'get_legs_in');
    if (allSetups && !hasGetLegsIn) {
      const getLegsIn = available.find(c => c.id === 'get_legs_in');
      if (getLegsIn) {
        hand[hand.length - 1] = getLegsIn; // replace last card
      }
    }
  }

  // Shuffle the final hand so quota order isn't predictable
  hand.sort(() => Math.random() - 0.5);

  return hand;
}

/**
 * Redraw a player's hand, paid for by a per-match reroll. Caller is
 * responsible for decrementing `rerollsLeft` before calling this - the
 * draw itself is pure.
 *
 * Overlap rule (player request): up to 2 cards from `prevHand` may carry
 * over, but:
 *   • the carry-overs must have distinct `category` values, and
 *   • a carry-over may not be the only card of its category in the new
 *     hand - i.e. no "lone X-type" stays the same, otherwise the reroll
 *     feels useless when you only had one counter / escape to begin with.
 *
 * Iteratively re-checks after each replacement because evicting a
 * carry-over from a 2-card category can leave the OTHER carry-over
 * lone-of-category. Up to 5 passes; falls back to last state if the
 * eligible pool runs dry.
 */
export function rerollHand(prevHand, position, conditions = [], size = 6, style = 'folkstyle', allowedCardIds = null) {
  const prevIds = new Set((prevHand || []).map(c => c.id));
  let hand = buildHand(position, conditions, size, style, allowedCardIds);

  // Pre-compute the replacement pool: cards eligible at this position +
  // condition + style, filtered by deck if applicable, EXCLUDING anything
  // in the previous hand (we never re-draw a discarded card directly).
  const pool = getAvailableCards(position, conditions, style)
    .filter(c => !prevIds.has(c.id))
    .filter(c => !(allowedCardIds instanceof Set && allowedCardIds.size > 0) || allowedCardIds.has(c.id));

  for (let pass = 0; pass < 5; pass++) {
    const violators = findRerollViolators(hand, prevIds);
    if (violators.size === 0) break;

    const usedIds = new Set(hand.map(c => c.id));
    const candidates = pool.filter(p => !usedIds.has(p.id));
    if (candidates.length === 0) break; // pool exhausted, accept current state

    // Shuffle so iterative passes don't always pick the same replacement.
    candidates.sort(() => Math.random() - 0.5);

    let cIdx = 0;
    hand = hand.map(c => {
      if (!violators.has(c.id) || cIdx >= candidates.length) return c;
      const replacement = candidates[cIdx++];
      return replacement;
    });
  }

  return hand;
}

/**
 * Identify carry-over cards (still present from prevHand) that violate
 * the reroll constraint:
 *   1. Lone-of-category in the new hand (using its only X-type would feel
 *      identical to the pre-reroll state for that category).
 *   2. More than 2 carry-overs total.
 *   3. Two carry-overs sharing a category (carry-overs must be distinct
 *      types - picking 2 escapes from the old hand defeats the redraw).
 *
 * Lone-of-category is checked first because evicting a lone-of-category
 * carry-over usually frees up category slots; evicting a duplicate
 * carry-over only reduces count.
 */
function findRerollViolators(hand, prevIds) {
  const carryovers = hand.filter(c => prevIds.has(c.id));
  if (carryovers.length === 0) return new Set();

  const catCounts = {};
  for (const c of hand) {
    const cat = c.category || 'general';
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }

  const violators = new Set();
  const seenCats = new Set();
  let kept = 0;

  // Process lone-of-category carry-overs first (always violate), then
  // pick up to 2 distinct-category carry-overs as keepers.
  const sorted = [...carryovers].sort((a, b) => {
    const aLone = ((catCounts[a.category || 'general'] || 0) === 1) ? 1 : 0;
    const bLone = ((catCounts[b.category || 'general'] || 0) === 1) ? 1 : 0;
    return bLone - aLone; // lone first → flagged before they consume keeper slots
  });

  for (const c of sorted) {
    const cat = c.category || 'general';
    const isLone = (catCounts[cat] || 0) === 1;
    if (isLone || seenCats.has(cat) || kept >= 2) {
      violators.add(c.id);
    } else {
      seenCats.add(cat);
      kept++;
    }
  }
  return violators;
}

// ─── Phase 3 - Referee Calls (stalling) ────────────────────────────────────
//
// Folkstyle rule (matches real NCAA / NFHS scoring): the FIRST stalling
// call is a free warning; every subsequent stalling call awards
// STALLING_PENALTY (1 pt in folkstyle) to the opponent. The counter
// keeps accumulating - it does NOT reset after a penalty - so an
// offender who keeps ducking the action keeps bleeding points to the
// other guy.
//
// Trigger: player P picks a `neutral_counter` card from the neutral
// position while the opponent holds initiative AND the neutral has
// already stalled (`neutralStaleCount >= 2`). Increment P's personal
// stallCount.
//
// stallCount[player] state machine:
//   1   -> free warning (announcement only)
//   2+  -> +1 STALLING_PENALTY to opponent (every subsequent stall)
//
// This replaces the previous "1 & 2 free, 3 = penalty + reset" rule
// per user feedback - the old rule rarely landed because the offender
// would mix in one active turn between stalls and the count reset.
//
// The existing `neutralStaleCount`-based system in resolveRound handles
// mutual inactivity (both wrestlers stalling). This per-player layer
// specifically targets a wrestler who's been ducking while their
// opponent pushes - the classic folkstyle stalling case.
//
// Called from resolveRound just before it returns the new state. Pure:
// takes state + who played what, mutates state in-place (resolveRound
// already operates on a deepCopy, so mutating s here is safe).
export function checkStalling(s, player, card, opponent) {
  if (s.wrestlingStyle !== 'folkstyle') return;
  if (!card || card.category !== 'neutral_counter') return;
  if (s[player].position !== POSITIONS.NEUTRAL) return;
  if (s.initiative !== opponent) return;
  if ((s.neutralStaleCount || 0) < 2) return;

  if (!s.stallCount) s.stallCount = { p1: 0, p2: 0 };
  s.stallCount[player] = (s.stallCount[player] || 0) + 1;
  const count = s.stallCount[player];
  const offender = s[player]?.name || player.toUpperCase();
  const benefactor = s[opponent]?.name || opponent.toUpperCase();

  if (count >= 2) {
    // Penalty awarded. STALLING_PENALTY = 1 in folkstyle. Counter does
    // NOT reset - persistent stalling keeps awarding points each round.
    const pts = getScores(s.wrestlingStyle).STALLING_PENALTY || 1;
    s[opponent] = { ...s[opponent], score: s[opponent].score + pts };
    const entry = `⚠ Stalling penalty (call ${count}) - ${offender} · +${pts} ${benefactor}`;
    s.log = [...(s.log || []), { round: s.roundNumber, entry, type: 'stalling_penalty' }];
    const prior = s.lastResult?.message ? s.lastResult.message + ' · ' : '';
    s.lastResult = {
      ...(s.lastResult || {}),
      type: 'stalling_penalty',
      stallingOffender: player,
      stallingBeneficiary: opponent,
      stallingCallCount: count,
      message: prior + `Stalling! ${offender} penalised (+${pts} ${benefactor})`,
    };
  } else {
    // First call: free warning. Next stalling action awards a point.
    const entry = `⚠ Stalling warning - ${offender} · next stall awards a point`;
    s.log = [...(s.log || []), { round: s.roundNumber, entry, type: 'stalling_warning' }];
    const prior = s.lastResult?.message ? s.lastResult.message + ' · ' : '';
    s.lastResult = {
      ...(s.lastResult || {}),
      type: s.lastResult?.type || 'stalling_warning',
      stallingOffender: player,
      stallingWarningCount: count,
      message: prior + `Stalling warning: ${offender} - next stall is +1 to opponent`,
    };
  }
}

// ─── Core Round Resolution ────────────────────────────────────────────────────

// Per-archetype micro-mechanic skill bonuses (optional). Each side's tier
// (PERFECT / GOOD / MISS) maps to a flat power bonus and a narrowed RNG
// variance - see src/lib/cardArchetypeMechanics.js for the source of truth.
// Defaults to MISS so existing callers keep current behavior (±10 RNG, no
// flat bonus). PvP/AI callers should pass real results.
export function resolveRound(state, p1CardId, p2CardId, p1Skill = null, p2Skill = null, rng = Math.random) {
  if (!state || (state.phase !== 'playing' && state.phase !== 'overtime')) return state;

  const p1Card = CARDS[p1CardId];
  const p2Card = CARDS[p2CardId];

  if (!p1Card || !p2Card) return state;

  let s = deepCopy(state);
  s.roundNumber += 1;

  if (!s.turnHistory) s.turnHistory = { p1: {}, p2: {} };

  // RECOVERING decay: auto-clear after 3 rounds
  for (const who of ['p1', 'p2']) {
    const cKey = `${who}Conditions`;
    if (s[cKey]?.includes(CONDITIONS.RECOVERING)) {
      s[`${who}RecoveringRounds`] = (s[`${who}RecoveringRounds`] || 0) + 1;
      if (s[`${who}RecoveringRounds`] >= 3) {
        s[cKey] = s[cKey].filter(c => c !== CONDITIONS.RECOVERING);
        s[`${who}RecoveringRounds`] = 0;
      }
    }
  }

  // Deduct stamina - scaled by END (higher END = lower effective cost)
  const endScale = (w) => w.stats ? 1 - (w.stats.end - 50) / 500 : 1; // range 0.94-1.06
  s.p1 = { ...s.p1, stamina: Math.max(0, s.p1.stamina - p1Card.staminaCost * endScale(s.p1)) };
  s.p2 = { ...s.p2, stamina: Math.max(0, s.p2.stamina - p2Card.staminaCost * endScale(s.p2)) };

  // Calculate power BEFORE recording this round's cards
  let p1Power = computePower(p1Card, s, 'p1', p2Card);
  let p2Power = computePower(p2Card, s, 'p2', p1Card);

  // Apply per-archetype micro-mechanic flat bonuses. Capped via Math.max
  // so a malformed payload can't subtract from base power.
  p1Power += Math.max(0, Number(p1Skill?.bonus) || 0);
  p2Power += Math.max(0, Number(p2Skill?.bonus) || 0);

  // Cache tiers so every exit path of resolveRound can stamp them onto
  // s.lastResult - UI surfaces them in the round-result toast (Task 12).
  const p1SkillTier = p1Skill?.tier || 'MISS';
  const p2SkillTier = p2Skill?.tier || 'MISS';
  const tagSkill = (st) => {
    if (st && st.lastResult) {
      st.lastResult.p1SkillTier = p1SkillTier;
      st.lastResult.p2SkillTier = p2SkillTier;
    }
    return st;
  };

  // Record turn card usage
  if (TURN_CARD_IDS.has(p1Card.id)) {
    s.turnHistory.p1[p1Card.id] = (s.turnHistory.p1[p1Card.id] || 0) + 1;
  }
  if (TURN_CARD_IDS.has(p2Card.id)) {
    s.turnHistory.p2[p2Card.id] = (s.turnHistory.p2[p2Card.id] || 0) + 1;
  }

  // Randomize - default ±10 so card selection skill outweighs luck.
  // Per-archetype micro-mechanics narrow it based on the player's tier
  // (see SKILL_TIERS in cardArchetypeMechanics.js):
  //   PERFECT → ±4  (tight, reliable - earned it)
  //   GOOD    → ±5
  //   MISS    → ±3  (tight + zero bonus - low floor, low ceiling)
  // Range is clamped 1..10 to stop a malformed payload from dialing
  // variance up to absurd values.
  const clampRange = (r) => {
    const n = Number(r);
    if (!Number.isFinite(n)) return 10;
    return Math.min(10, Math.max(1, n));
  };
  const p1Range = clampRange(p1Skill?.rngRange ?? 10);
  const p2Range = clampRange(p2Skill?.rngRange ?? 10);
  p1Power += rng() * (p1Range * 2) - p1Range;
  p2Power += rng() * (p2Range * 2) - p2Range;

  // Boundary reset
  const isBoundary = rng() < 0.08; // slightly reduced for better pacing
  if (isBoundary) {
    const hadControl = s.p1.position !== POSITIONS.NEUTRAL || s.p2.position !== POSITIONS.NEUTRAL;
    let entry;
    if (hadControl) {
      entry = 'Out of bounds - return to referee position.';
      s.pressure = { p1OnP2: 0, p2OnP1: 0 };
      s.chainActive = false;
      // Always clear FHL and leg attack conditions on boundary (can't maintain holds out of bounds)
      const boundClearConds = [
        CONDITIONS.FRONT_HEADLOCK_CONTROL, CONDITIONS.FRONT_HEADLOCK_TRAPPED,
        CONDITIONS.LEG_ATTACK_SECURED, CONDITIONS.LEG_ATTACK_TRAPPED,
        CONDITIONS.LEG_RIDE_ESTABLISHED,
        CONDITIONS.SCRAMBLE, CONDITIONS.TIE_UP,
      ];
      s.p1Conditions = s.p1Conditions.filter(c => !boundClearConds.includes(c));
      s.p2Conditions = s.p2Conditions.filter(c => !boundClearConds.includes(c));
    } else {
      entry = 'Out of bounds -wrestlers return to neutral.';
      s.p1 = { ...s.p1, position: POSITIONS.NEUTRAL };
      s.p2 = { ...s.p2, position: POSITIONS.NEUTRAL };
      s.pressure = { p1OnP2: 0, p2OnP1: 0 };
      s.chainActive = false;
      s.p1Conditions = [];
      s.p2Conditions = [];
    }
    s.log = [...s.log, { round: s.roundNumber, entry, type: 'boundary_reset' }];
    s.lastResult = { type: 'boundary_reset', message: entry };
    // Faster clock: 10-18 seconds per action
    s.clock = Math.max(0, s.clock - (10 + Math.floor(rng() * 8)));
    // International style activity clock: boundary counts as non-scoring
    if (isInternationalStyle(s.wrestlingStyle)) {
      s.activityClock = (s.activityClock || 0) + 1;
      s = checkPassivity(s);
    }
    return tagSkill(checkEndConditions(s));
  }

  // Mirror-setup clash: if both wrestlers play the SAME pure-setup card
  // (e.g. collar_tie vs collar_tie), it's a mutual tie-up - no winner, just
  // a shared position. Nobody "wins" the neck grip; they're both grabbing.
  const p1Setup = p1Card.scoreEffect?.type === 'setup';
  const p2Setup = p2Card.scoreEffect?.type === 'setup';
  if (p1Setup && p2Setup && p1Card.id === p2Card.id && p1Card.scoreEffect?.setsCondition) {
    const cond = p1Card.scoreEffect.setsCondition;
    if (!s.p1Conditions.includes(cond)) s.p1Conditions = [...s.p1Conditions, cond];
    if (!s.p2Conditions.includes(cond)) s.p2Conditions = [...s.p2Conditions, cond];
    const entry = `Both wrestlers ${p1Card.name.toLowerCase()} - mutual ${cond.replace(/_/g, ' ')}, no advantage.`;
    s.log = [...s.log, { round: s.roundNumber, entry, type: 'mutual_setup' }];
    s.lastResult = {
      type: 'mutual_setup',
      message: entry,
      p1CardId: p1Card.id,
      p2CardId: p2Card.id,
      p1CardName: p1Card.name,
      p2CardName: p2Card.name,
    };
    s.clock = Math.max(0, s.clock - (10 + Math.floor(rng() * 8)));
    if (isInternationalStyle(s.wrestlingStyle)) {
      s.activityClock = (s.activityClock || 0) + 1;
      s = checkPassivity(s);
    }
    return tagSkill(checkEndConditions(s));
  }

  // Determine outcome
  const diff = p1Power - p2Power;
  let result;

  if (Math.abs(diff) < 8) {
    const edgeWinner = diff > 0 ? 'p1' : 'p2';
    const edgeCard = diff > 0 ? p1Card : p2Card;
    const loserCard = diff > 0 ? p2Card : p1Card;
    result = buildPartialResult(s, edgeCard, edgeWinner, loserCard);
  } else if (diff > 0) {
    result = buildWinResult(s, p1Card, 'p1', p2Card, rng);
  } else {
    result = buildWinResult(s, p2Card, 'p2', p1Card, rng);
  }

  s = applyResult(s, result);
  s.lastResult = { ...result, p1CardId: p1Card.id, p2CardId: p2Card.id, p1CardName: p1Card.name, p2CardName: p2Card.name };
  // Faster clock: 10-18 seconds per action (was 8-14)
  s.clock = Math.max(0, s.clock - (10 + Math.floor(rng() * 8)));
  // Snapshot the position tag at the moment this action resolved so the
  // match-log row can show "where the mat was" alongside what happened.
  const positionAtAction = describeMatchPosition(s).tag;
  s.log = [...s.log, { round: s.roundNumber, entry: result.message, type: result.type, position: positionAtAction }];

  // International style activity clock tracking
  if (isInternationalStyle(s.wrestlingStyle)) {
    const scoringTypes = ['takedown', 'escape', 'reversal', 'near_fall', 'pin_attempt_trigger', 'exposure', 'grand_amplitude'];
    if (scoringTypes.includes(result.type)) {
      s.activityClock = 0;
      s._passivityWarned = false;
    } else {
      s.activityClock = (s.activityClock || 0) + 1;
      s = checkPassivity(s);
    }

    // Per-player passivity: track consecutive non-scoring card plays
    const passiveCardTypes = ['setup', 'defense'];
    for (const pid of ['p1', 'p2']) {
      const card = pid === 'p1' ? p1Card : p2Card;
      const se = card.scoreEffect;
      const playedPassive = se && passiveCardTypes.includes(se.type);
      const key = `_${pid}PassiveRounds`;
      if (playedPassive) {
        s[key] = (s[key] || 0) + 1;
        if (s[key] === 3) {
          const entry = `⚠ ACTIVITY WARNING - ${s[pid].name} is not attacking! Score or face passivity!`;
          s.log = [...s.log, { round: s.roundNumber, entry, type: 'passivity_warning' }];
          s.lastResult = { ...s.lastResult, type: 'passivity_warning', message: entry };
        }
        if (s[key] >= 4) {
          const opp = pid === 'p1' ? 'p2' : 'p1';
          const scores = getScores(s.wrestlingStyle);
          const isGreco = s.wrestlingStyle === 'greco';
          s[opp] = { ...s[opp], score: s[opp].score + scores.PASSIVITY };
          s.momentum = opp;
          s[key] = 0;

          if (isGreco) {
            // Greco: ordered par terre
            s[opp] = { ...s[opp], position: POSITIONS.TOP };
            s[pid] = { ...s[pid], position: POSITIONS.BOTTOM, pinDepth: 0, bottomRounds: 0 };
            s[`${opp}Conditions`] = [CONDITIONS.CONTROL_ESTABLISHED];
            s[`${pid}Conditions`] = [];
            s.pressure = { p1OnP2: 0, p2OnP1: 0 };
            s.pressure[opp === 'p1' ? 'p1OnP2' : 'p2OnP1'] = 15;
            s.parTerreCountdown = 3;
            const entry = `PASSIVITY - ${s[pid].name} penalized for inaction! ${s[opp].name} gets +1 and ordered par terre top.`;
            s.log = [...s.log, { round: s.roundNumber, entry, type: 'passivity' }];
            s.lastResult = { type: 'passivity', message: entry };
          } else {
            // Freestyle: just the point, stay in current position
            const entry = `PASSIVITY - ${s[pid].name} penalized for inaction! ${s[opp].name} gets +1.`;
            s.log = [...s.log, { round: s.roundNumber, entry, type: 'passivity' }];
            s.lastResult = { type: 'passivity', message: entry };
          }
        }
      } else {
        s[key] = 0;
      }
    }
  }

  // Par terre countdown - Greco-Roman: top must score within 3 rounds or
  // the position resets to neutral. Scoring restarts the window for top so
  // a successful gut wrench buys them another 3-round attack chance. A
  // bottom reversal flips the position so the countdown becomes irrelevant.
  // Stalemates / non-scoring rounds tick the clock down. This is the
  // mechanism that lets a defensive bottom run the clock to neutral.
  if (s.parTerreCountdown !== null && s.wrestlingStyle === 'greco') {
    const scoringTypes = ['takedown', 'near_fall', 'exposure', 'pin_attempt_trigger',
                          'grand_amplitude', 'takedown_near_fall', 'reversal'];
    const scored = scoringTypes.includes(result.type);
    const topSide = s.p1.position === POSITIONS.TOP ? 'p1' : (s.p2.position === POSITIONS.TOP ? 'p2' : null);
    const topScored = scored && topSide && result.attacker === topSide;
    const bottomScored = scored && topSide && result.attacker !== topSide;

    if (bottomScored) {
      // Bottom escaped or reversed - position changing, countdown moot.
      s.parTerreCountdown = null;
    } else if (topScored) {
      // Top scored a turn - restart the 3-round attack window.
      s.parTerreCountdown = 3;
    } else {
      // Stalemate or non-scoring round - tick clock down. At zero, reset.
      s.parTerreCountdown -= 1;
      if (s.parTerreCountdown <= 0) {
        s.p1 = { ...s.p1, position: POSITIONS.NEUTRAL, pinDepth: 0, bottomRounds: 0 };
        s.p2 = { ...s.p2, position: POSITIONS.NEUTRAL, pinDepth: 0, bottomRounds: 0 };
        s.p1Conditions = [];
        s.p2Conditions = [];
        s.parTerreCountdown = null;
        s.chainActive = false;
        s.initiative = null;
        const ptEntry = 'Par terre time expired - wrestlers return to standing.';
        s.log = [...s.log, { round: s.roundNumber, entry: ptEntry, type: 'par_terre_reset' }];
      }
    }
  }

  // Overtime sudden victory: first score wins
  if (s.phase === 'overtime' || state.phase === 'overtime') {
    s.phase = 'overtime'; // preserve overtime phase
    const scoringTypes = ['takedown', 'escape', 'reversal', 'near_fall', 'pin_attempt_trigger', 'exposure', 'grand_amplitude'];
    if (scoringTypes.includes(result.type)) {
      const winner = result.attacker;
      s.winner = winner;
      s.winMethod = 'overtime';
      s.phase = 'finished';
      s.log = [...s.log, { round: s.roundNumber, entry: `SUDDEN VICTORY - ${s[winner].name} scores first and wins!`, type: 'overtime' }];
      return tagSkill(s);
    }
  }

  // Phase 3 - referee stalling check. Runs on the fully-resolved state
  // so it sees the latest position/initiative/neutralStaleCount values
  // *after* this round's logic has applied. Mutates s directly.
  checkStalling(s, 'p1', p1Card, 'p2');
  checkStalling(s, 'p2', p2Card, 'p1');

  return tagSkill(checkEndConditions(s));
}

// ─── Passivity Check (International Styles) ─────────────────────────────────

function checkPassivity(state) {
  let s = state;
  if (!isInternationalStyle(s.wrestlingStyle)) return s;

  const isGreco = s.wrestlingStyle === 'greco';

  // Warning at 2 non-scoring rounds
  if ((s.activityClock || 0) === 2 && !s._passivityWarned) {
    s = { ...s, _passivityWarned: true };
    const warnTarget = s.initiative ? (s.initiative === 'p1' ? 'p2' : 'p1') : null;
    const warnName = warnTarget ? s[warnTarget].name : 'Both wrestlers';
    const entry = `⚠ ACTIVITY WARNING - ${warnName} must score or face passivity!`;
    s.log = [...s.log, { round: s.roundNumber, entry, type: 'passivity_warning' }];
  }

  if ((s.activityClock || 0) >= 3) {
    const activeWrestler = s.initiative || 'p1';
    const passiveWrestler = activeWrestler === 'p1' ? 'p2' : 'p1';
    const scores = getScores(s.wrestlingStyle);

    s = { ...s };
    s[activeWrestler] = { ...s[activeWrestler], score: s[activeWrestler].score + scores.PASSIVITY };
    s.activityClock = 0;
    s.momentum = activeWrestler;

    if (isGreco) {
      // Greco-Roman: ordered par terre -active wrestler gets top position + timer
      s[activeWrestler] = { ...s[activeWrestler], position: POSITIONS.TOP };
      s[passiveWrestler] = { ...s[passiveWrestler], position: POSITIONS.BOTTOM, pinDepth: 0, bottomRounds: 0 };
      s[`${activeWrestler}Conditions`] = [CONDITIONS.CONTROL_ESTABLISHED];
      s[`${passiveWrestler}Conditions`] = [];
      s.pressure = { p1OnP2: 0, p2OnP1: 0 };
      s.pressure[activeWrestler === 'p1' ? 'p1OnP2' : 'p2OnP1'] = 15;
      s.parTerreCountdown = 3; // 3 rounds to score from ordered par terre
      const entry = `PASSIVITY - ${s[passiveWrestler].name} is passive! ${s[activeWrestler].name} gets +1 and ordered par terre top.`;
      s.log = [...s.log, { round: s.roundNumber, entry, type: 'passivity' }];
    } else {
      // Freestyle: 1 point awarded, wrestlers stay in current position (no ordered par terre)
      const entry = `PASSIVITY - ${s[passiveWrestler].name} is passive! ${s[activeWrestler].name} gets +1.`;
      s.log = [...s.log, { round: s.roundNumber, entry, type: 'passivity' }];
    }
  }

  return s;
}

// ─── Pin Attempt Phase ────────────────────────────────────────────────────────

// Compute weighted pin chance using the full formula
export function computePinChance(state, attacker, cardId) {
  const defender = attacker === 'p1' ? 'p2' : 'p1';
  const attackerW = state[attacker];
  const defenderW = state[defender];
  const pressKey = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
  const pressure = (state.pressure[pressKey] || 0);
  const attackerConds = state[`${attacker}Conditions`] || [];

  // 1. Base move strength -capped so initial pin chance stays under 30%
  const BASE_STRENGTH = {
    near_side_cradle: 0.18,
    far_side_cradle: 0.18,
    power_half: 0.16,
    arm_bar: 0.10,
    arm_turk: 0.14,
    leg_turk: 0.14,
    half_nelson: 0.10,
    fhl_gator_roll: 0.08,
    tilt: 0.05,
    far_side_tilt: 0.05,
    // Freestyle grand amplitude throws
    suplex: 0.10,
    headlock_throw: 0.08,
    lateral_drop: 0.07,
    bear_hug_lift: 0.10,
    // Freestyle/Greco par terre exposure
    gut_wrench: 0.06,
    leg_lace: 0.05,
    step_over: 0.04,
    // Greco-specific
    reverse_lift: 0.12,
    arm_drag_to_gut_wrench: 0.07,
  };
  let pinChance = BASE_STRENGTH[cardId] || 0.06;

  // 2. Control strength -additive, not multiplicative, to prevent runaway stacking
  const hasControl = attackerConds.includes(CONDITIONS.CONTROL_ESTABLISHED);
  const hasPressure = attackerConds.includes(CONDITIONS.TOP_PRESSURE);
  if (hasControl) pinChance += 0.04;
  if (hasPressure) pinChance += 0.04;

  // 3. Pressure level (0-100 scale, max +0.06)
  pinChance += (pressure / 100) * 0.06;

  // 4. Stamina advantage (max +0.04 / -0.04)
  const staminaDiff = attackerW.stamina - defenderW.stamina;
  if (staminaDiff > 0) pinChance += (staminaDiff / 100) * 0.04;
  if (staminaDiff < 0) pinChance += (staminaDiff / 100) * 0.04; // negative = reduces

  // 5. Near-fall depth: card's scoreEffect pinChance (scaled down)
  const card = CARDS[cardId];
  if (card?.scoreEffect?.pinChance) {
    pinChance += card.scoreEffect.pinChance * 0.15;
  }

  // 6. Defensive resistance (GRIT accelerates resistance buildup - applied at pin resolution)
  pinChance -= (defenderW.defensiveResistance || 0) * 0.03;

  // 7a. STR vs GRT: attacker's strength vs defender's grit (max ±0.04)
  if (attackerW.stats && defenderW.stats) {
    pinChance += (attackerW.stats.str - defenderW.stats.grt) / 2500;
  }

  // 7b. International pin speed bonus (1-second hold vs 2-second folkstyle)
  if (isInternationalStyle(state.wrestlingStyle)) {
    pinChance += 0.02;
  }

  return Math.max(0.03, Math.min(0.30, pinChance));
}

// Stage 1 of the three-stage pin mini-game -attacker uses setup cards only (no pin_finish, no pin_power_drive)
// Defender picks from all 4 cards; whichever they use is burned for later stages.
export function resolvePinStage1(state, offenseCardId, defenseCardId, rng = Math.random) {
  if (!state || state.phase !== 'pin_attempt' || !state.pinAttempt) return state;
  // Safety: pin_finish and pin_power_drive are not allowed in Stage 1
  if (offenseCardId === 'pin_finish' || offenseCardId === 'pin_power_drive') return state;

  let s = deepCopy(state);
  const { attacker } = s.pinAttempt;
  const defender = attacker === 'p1' ? 'p2' : 'p1';

  const offCard = PIN_OFFENSE_CARDS[offenseCardId];
  const defCard = PIN_DEFENSE_CARDS[defenseCardId];

  if (!offCard || !defCard) return s;

  // Stamina cost
  s[attacker] = { ...s[attacker], stamina: Math.max(0, s[attacker].stamina - (offCard.staminaCost || 8)) };
  s[defender] = { ...s[defender], stamina: Math.max(0, s[defender].stamina - (defCard.staminaCost || 10)) };

  // Stage 1 chance -fresh defender gets -0.18 discount (full energy, first burst of resistance)
  const FRESH_DEFENDER_BONUS = 0.18;
  let chance = s.pinAttempt.pinChance + (offCard.bonus || 0) - (defCard.resistance || 0) - FRESH_DEFENDER_BONUS;

  // Matchup bonus/penalty: correct read +0.10, getting read -0.10
  const matchup = PIN_MATCHUPS[offenseCardId];
  if (matchup) {
    if (matchup.beats === defenseCardId) chance += 0.10;
    else if (matchup.losesTo === defenseCardId) chance -= 0.10;
  }

  chance = Math.max(0.03, Math.min(0.72, chance));

  s.roundNumber += 1;
  s.clock = Math.max(0, s.clock - (8 + Math.floor(rng() * 6)));

  if (rng() < chance) {
    // Rare Stage 1 pin -attacker forced through before defender could adjust
    s[attacker] = { ...s[attacker], pinCount: (s[attacker].pinCount || 0) + 1 };
    const entry = `${s[attacker].name} drives through instantly - PINNED in Stage 1! Match over!`;
    s.log = [...s.log, { round: s.roundNumber, entry, type: 'pin' }];
    s.lastResult = { type: 'pin', attacker, message: entry };
    s.winner = attacker;
    s.winMethod = 'pin';
    s.phase = 'finished';
    s.pinAttempt = null;
  } else {
    // Defender survives Stage 1 -but their card is now spent
    // GRIT accelerates defensive resistance buildup
    const gritFactor1 = s[defender].stats ? 1 + (s[defender].stats.grt - 50) / 200 : 1;
    s[defender] = {
      ...s[defender],
      defensiveResistance: Math.min(8, (s[defender].defensiveResistance || 0) + 1 * gritFactor1),
    };
    // Early-escape roll: defender breaks the pin attempt before it goes deep.
    // Probability scales with GRT (50 GRT = 20% baseline, 80 GRT ~30%, etc.).
    // Awards NEAR_FALL_3 - NEAR_FALL_2 as the bonus -> 3 NF total when paired
    // with the +2 already awarded by pin_attempt_trigger. Matches the rule
    // "escape on 1st or 2nd try -> 3 NF".
    const stage1Scores = getScores(s.wrestlingStyle);
    const earlyEscapeChance1 = 0.20 * gritFactor1;
    const earlyEscape1 = rng() < earlyEscapeChance1;
    if (earlyEscape1) {
      const bonus = (stage1Scores.NEAR_FALL_3 || 3) - (stage1Scores.NEAR_FALL_2 || 2);
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + bonus,
      };
      // Roll the fully-escape outcome BEFORE the tech-fall check so the
      // RNG is consumed deterministically (test fixtures depend on a
      // fixed seed and should not see the call order shift).
      const fullyEscaped1Roll = rng() < 0.30;
      // Real-wrestling rule: if the bonus alone clinches the tech fall
      // (lead >= 15 in folkstyle, >= 10 international), the match ends
      // before the defender's "escape" is awarded - the buzzer cuts it
      // off. Without this guard the engine would write the +1 escape on
      // top of the score, ending tech matches as 18-1 / 16-1 instead
      // of 18-0 / 16-0.
      const techThreshold1 = isInternationalStyle(s.wrestlingStyle) ? 10 : 15;
      const techReached1 = Math.abs(s[attacker].score - s[defender].score) >= techThreshold1;
      const fullyEscaped1 = fullyEscaped1Roll && !techReached1;
      const entry = techReached1
        ? `${s[defender].name} ${defCard.escapeText} - pin broken, but the lead is too much! +${bonus} near-fall bonus seals the tech.`
        : fullyEscaped1
          ? `${s[defender].name} ${defCard.escapeText} - escapes early! +${bonus} near-fall bonus, escape to neutral!`
          : `${s[defender].name} ${defCard.escapeText} - breaks pin attempt early! +${bonus} near-fall bonus, still on bottom.`;
      s.log = [...s.log, { round: s.roundNumber, entry, type: 'near_fall' }];
      s.lastResult = { type: 'near_fall', attacker, message: entry };
      if (fullyEscaped1) {
        s[defender] = {
          ...s[defender],
          position: POSITIONS.NEUTRAL,
          score: s[defender].score + (stage1Scores.ESCAPE || 1),
          escapeCount: (s[defender].escapeCount || 0) + 1,
          pinDepth: 0,
          bottomRounds: 0,
        };
        s[attacker] = { ...s[attacker], position: POSITIONS.NEUTRAL, rideTimeStreak: 0 };
        s.p1Conditions = [];
        s.p2Conditions = [];
        s.pressure = { p1OnP2: 0, p2OnP1: 0 };
        s.momentum = defender;
        s.turnHistory = { p1: {}, p2: {} };
      }
      s.phase = 'playing';
      s.pinAttempt = null;
      return checkEndConditions(s);
    }
    const entry = `${s[defender].name} ${defCard.escapeText} -fights off Stage 1! ${s[attacker].name} adjusting pressure...`;
    s.log = [...s.log, { round: s.roundNumber, entry, type: 'pin_stage1' }];
    s.lastResult = { type: 'pin_stage1_survived', defCard: defenseCardId, message: entry };
    // Advance to Stage 2 -defender's card is burned
    s.pinAttempt = { ...s.pinAttempt, stage: 2, burnedDefCards: [...(s.pinAttempt.burnedDefCards || []), defenseCardId] };
    // Phase stays 'pin_attempt'
  }

  return s;
}

// Stage 2 - Attacker adjusts pressure. pin_power_drive unlocked, pin_finish still locked.
// Defender has 3 remaining cards (1 burned from Stage 1).
// pinChance gets +0.05 worn-down bonus.
export function resolvePinStage2(state, offenseCardId, defenseCardId, rng = Math.random) {
  if (!state || state.phase !== 'pin_attempt' || !state.pinAttempt) return state;
  // Safety: pin_finish is not allowed in Stage 2
  if (offenseCardId === 'pin_finish') return state;
  // Safety: reject burned defense cards
  const burned = state.pinAttempt?.burnedDefCards || [];
  if (burned.includes(defenseCardId)) return state;

  let s = deepCopy(state);
  const { attacker } = s.pinAttempt;
  const defender = attacker === 'p1' ? 'p2' : 'p1';

  const offCard = PIN_OFFENSE_CARDS[offenseCardId];
  const defCard = PIN_DEFENSE_CARDS[defenseCardId];

  if (!offCard || !defCard) return s;

  // Stamina cost
  s[attacker] = { ...s[attacker], stamina: Math.max(0, s[attacker].stamina - (offCard.staminaCost || 8)) };
  s[defender] = { ...s[defender], stamina: Math.max(0, s[defender].stamina - (defCard.staminaCost || 10)) };

  // Stage 2: minimal worn-down (+0.00) -defender still fresh enough to fight
  let chance = s.pinAttempt.pinChance + 0.00;
  chance += (offCard.bonus || 0);
  chance -= (defCard.resistance || 0);

  // Matchup bonus/penalty
  const matchup = PIN_MATCHUPS[offenseCardId];
  if (matchup) {
    if (matchup.beats === defenseCardId) chance += 0.10;
    else if (matchup.losesTo === defenseCardId) chance -= 0.10;
  }

  chance = Math.max(0.03, Math.min(0.80, chance));

  s.roundNumber += 1;
  s.clock = Math.max(0, s.clock - (8 + Math.floor(rng() * 6)));

  if (rng() < chance) {
    // PIN SUCCESS in Stage 2
    s[attacker] = { ...s[attacker], pinCount: (s[attacker].pinCount || 0) + 1 };
    const entry = `${s[attacker].name} drives through in Stage 2 - PINNED! Match over!`;
    s.log = [...s.log, { round: s.roundNumber, entry, type: 'pin' }];
    s.lastResult = { type: 'pin', attacker, message: entry };
    s.winner = attacker;
    s.winMethod = 'pin';
    s.phase = 'finished';
    s.pinAttempt = null;
  } else {
    // Defender survives Stage 2 -second card is burned
    const gritFactor2 = s[defender].stats ? 1 + (s[defender].stats.grt - 50) / 200 : 1;
    s[defender] = {
      ...s[defender],
      defensiveResistance: Math.min(8, (s[defender].defensiveResistance || 0) + 1 * gritFactor2),
    };
    // Early-escape roll at Stage 2 (same rule as Stage 1, slightly higher
    // baseline because the defender has soaked more pressure). Awards
    // NEAR_FALL_3 - NEAR_FALL_2 = 1 bonus -> 3 NF total. Matches "escape on
    // 1st or 2nd try -> 3 NF".
    const stage2Scores = getScores(s.wrestlingStyle);
    const earlyEscapeChance2 = 0.22 * gritFactor2;
    const earlyEscape2 = rng() < earlyEscapeChance2;
    if (earlyEscape2) {
      const bonus = (stage2Scores.NEAR_FALL_3 || 3) - (stage2Scores.NEAR_FALL_2 || 2);
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + bonus,
      };
      // See Stage 1 for the rationale: roll first (deterministic RNG),
      // then suppress the escape if the bonus already clinched the tech
      // fall - the match is over before the defender's escape registers.
      const fullyEscaped2Roll = rng() < 0.30;
      const techThreshold2 = isInternationalStyle(s.wrestlingStyle) ? 10 : 15;
      const techReached2 = Math.abs(s[attacker].score - s[defender].score) >= techThreshold2;
      const fullyEscaped2 = fullyEscaped2Roll && !techReached2;
      const entry = techReached2
        ? `${s[defender].name} ${defCard.escapeText} - pin broken, but the lead is too much! +${bonus} near-fall bonus seals the tech.`
        : fullyEscaped2
          ? `${s[defender].name} ${defCard.escapeText} - escapes after Stage 2! +${bonus} near-fall bonus, escape to neutral!`
          : `${s[defender].name} ${defCard.escapeText} - breaks pin in Stage 2! +${bonus} near-fall bonus, still on bottom.`;
      s.log = [...s.log, { round: s.roundNumber, entry, type: 'near_fall' }];
      s.lastResult = { type: 'near_fall', attacker, message: entry };
      if (fullyEscaped2) {
        s[defender] = {
          ...s[defender],
          position: POSITIONS.NEUTRAL,
          score: s[defender].score + (stage2Scores.ESCAPE || 1),
          escapeCount: (s[defender].escapeCount || 0) + 1,
          pinDepth: 0,
          bottomRounds: 0,
        };
        s[attacker] = { ...s[attacker], position: POSITIONS.NEUTRAL, rideTimeStreak: 0 };
        s.p1Conditions = [];
        s.p2Conditions = [];
        s.pressure = { p1OnP2: 0, p2OnP1: 0 };
        s.momentum = defender;
        s.turnHistory = { p1: {}, p2: {} };
      }
      s.phase = 'playing';
      s.pinAttempt = null;
      return checkEndConditions(s);
    }
    const entry = `${s[defender].name} ${defCard.escapeText} -fights off Stage 2! ${s[attacker].name} going for the finish...`;
    s.log = [...s.log, { round: s.roundNumber, entry, type: 'pin_stage2' }];
    s.lastResult = { type: 'pin_stage2_survived', defCard: defenseCardId, message: entry };
    // Advance to Stage 3 -burn this defense card too
    s.pinAttempt = { ...s.pinAttempt, stage: 3, burnedDefCards: [...(s.pinAttempt.burnedDefCards || []), defenseCardId] };
    // Phase stays 'pin_attempt'
  }

  return s;
}

// Stage 3 - Final pin attempt. All offense cards available (including pin_finish).
// Defender has 2 remaining cards (2 burned). +0.12 worn-down bonus.
// If defender survives: 20% escape to neutral, 80% stays on bottom with near-fall points.
export function resolvePinStage3(state, offenseCardId, defenseCardId, rng = Math.random) {
  if (!state || state.phase !== 'pin_attempt' || !state.pinAttempt) return state;
  // Safety: reject burned defense cards
  const burned = state.pinAttempt?.burnedDefCards || [];
  if (burned.includes(defenseCardId)) return state;

  let s = deepCopy(state);
  const { attacker } = s.pinAttempt;
  const defender = attacker === 'p1' ? 'p2' : 'p1';

  const offCard = PIN_OFFENSE_CARDS[offenseCardId];
  const defCard = PIN_DEFENSE_CARDS[defenseCardId];

  if (!offCard || !defCard) return s;

  // Stamina cost
  s[attacker] = { ...s[attacker], stamina: Math.max(0, s[attacker].stamina - (offCard.staminaCost || 8)) };
  s[defender] = { ...s[defender], stamina: Math.max(0, s[defender].stamina - (defCard.staminaCost || 10)) };

  const scores = getScores(s.wrestlingStyle);

  // Stage 3: worn-down bonus (+0.06) -defender fatigued from 2 prior stages
  let chance = s.pinAttempt.pinChance + 0.06;
  chance += (offCard.bonus || 0);
  chance -= (defCard.resistance || 0);

  // Matchup bonus/penalty
  const matchup = PIN_MATCHUPS[offenseCardId];
  if (matchup) {
    if (matchup.beats === defenseCardId) chance += 0.10;
    else if (matchup.losesTo === defenseCardId) chance -= 0.10;
  }

  chance = Math.max(0.03, Math.min(0.92, chance));

  s.roundNumber += 1;
  s.clock = Math.max(0, s.clock - (8 + Math.floor(rng() * 6)));

  if (rng() < chance) {
    // PIN SUCCESS
    s[attacker] = { ...s[attacker], pinCount: (s[attacker].pinCount || 0) + 1 };
    const entry = `${s[attacker].name} completes the pin - PINNED! Match over!`;
    s.log = [...s.log, { round: s.roundNumber, entry, type: 'pin' }];
    s.lastResult = { type: 'pin', attacker, message: entry };
    s.winner = attacker;
    s.winMethod = 'pin';
    s.phase = 'finished';
    s.pinAttempt = null;
  } else {
    // DEFENDER BREAKS THE PIN -but stays on bottom with near-fall risk
    const gritFactor3 = s[defender].stats ? 1 + (s[defender].stats.grt - 50) / 200 : 1;
    s[defender] = {
      ...s[defender],
      defensiveResistance: Math.min(8, (s[defender].defensiveResistance || 0) + 1 * gritFactor3),
    };

    // Small chance (~20%) of full escape to neutral. Roll BEFORE the
    // tech-fall check so the RNG is consumed deterministically; the
    // outcome only matters if the bonus didn't already clinch the tech.
    const fullyEscapedRoll = rng() < 0.20;

    // Stage 3 break-out bonus is the difference between NEAR_FALL_4 (the
    // total target for surviving all 3 stages) and NEAR_FALL_2 (already
    // awarded by pin_attempt_trigger). Previously this added the full
    // NEAR_FALL_4 on top of the initial 2 -> 6 NF total, breaking real
    // folkstyle scoring (max NF = 4 pts). Now: 2 (trigger) + 2 (bonus) = 4.
    const stage3Bonus = (scores.NEAR_FALL_4 || 4) - (scores.NEAR_FALL_2 || 2);

    // Apply the bonus to the attacker first so we can decide whether the
    // tech-fall lead has been clinched. Real-wrestling rule: a 15+ lead
    // ends the match the instant the points cross the line. The defender's
    // escape (would-be +1) doesn't register because the buzzer cut it off.
    // Without this guard a 14-0 -> +4 NF tech ended 18-1 instead of 18-0,
    // and a 12-0 -> +4 NF ended 16-1 instead of 16-0.
    s[attacker] = {
      ...s[attacker],
      score: s[attacker].score + stage3Bonus,
    };
    const techThreshold3 = isInternationalStyle(s.wrestlingStyle) ? 10 : 15;
    const techReached3 = Math.abs(s[attacker].score - s[defender].score) >= techThreshold3;
    const fullyEscaped = fullyEscapedRoll && !techReached3;

    if (fullyEscaped) {
      const entry = `${s[defender].name} ${defCard.escapeText} -escapes to neutral! +${stage3Bonus} near-fall bonus, +1 escape`;
      s.log = [...s.log, { round: s.roundNumber, entry, type: 'escape' }];
      s.lastResult = { type: 'escape', attacker: defender, message: entry };
      s[defender] = {
        ...s[defender],
        position: POSITIONS.NEUTRAL,
        score: s[defender].score + scores.ESCAPE,
        escapeCount: (s[defender].escapeCount || 0) + 1,
        pinDepth: 0,
        bottomRounds: 0,
      };
      s[attacker] = { ...s[attacker], position: POSITIONS.NEUTRAL, rideTimeStreak: 0 };
      s.p1Conditions = [];
      s.p2Conditions = [];
      s.pressure = { p1OnP2: 0, p2OnP1: 0 };
      s.momentum = defender;
      s.turnHistory = { p1: {}, p2: {} };
    } else if (techReached3) {
      // Tech-fall clinched by the bonus alone. The defender broke the
      // pin, but the score lead seals the match before any escape award.
      const entry = `${s[defender].name} ${defCard.escapeText} - pin broken, but the lead is too much! +${stage3Bonus} near-fall bonus seals the tech.`;
      s.log = [...s.log, { round: s.roundNumber, entry, type: 'near_fall' }];
      s.lastResult = { type: 'near_fall', attacker, message: entry };
      // Position stays as-is; checkEndConditions below will set winner.
    } else {
      // Stays on bottom - attacker holds top. Bonus already applied above
      // (the unified pre-check needed it on the score before evaluating
      // tech-fall reach), so no second add here.
      const entry = `${s[defender].name} ${defCard.escapeText} -pin broken! +${stage3Bonus} near-fall bonus, still on bottom.`;
      s.log = [...s.log, { round: s.roundNumber, entry, type: 'near_fall' }];
      s.lastResult = { type: 'near_fall', attacker, message: entry };
      s[attacker] = { ...s[attacker], position: POSITIONS.TOP };
      s[defender] = { ...s[defender], position: POSITIONS.BOTTOM };
      const pk = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { ...s.pressure, [pk]: Math.min(100, (s.pressure[pk] || 0) + 20) };
      s[`${attacker}Conditions`] = [CONDITIONS.CONTROL_ESTABLISHED];
      const defConds = s[`${defender}Conditions`] || [];
      if (!defConds.includes(CONDITIONS.RECOVERING)) {
        s[`${defender}Conditions`] = [...defConds, CONDITIONS.RECOVERING];
      }
      s[`${defender}RecoveringRounds`] = 0; // reset decay counter
      s.momentum = attacker;
    }

    s.phase = 'playing';
    s.pinAttempt = null;
  }

  return checkEndConditions(s);
}

// Legacy alias for backward compatibility
export const resolvePinAttempt = resolvePinStage3;

// AI pin card selection -weighted random so CPU isn't always predictable
function weightedPinPick(options, fallback) {
  if (!options.length) return fallback;
  // Weighted random: higher-scored cards are more likely but not guaranteed
  const total = options.reduce((sum, o) => sum + Math.max(1, o.score), 0);
  let roll = Math.random() * total;
  for (const o of options) {
    roll -= Math.max(1, o.score);
    if (roll <= 0) return o.id;
  }
  return options[0].id;
}

export function getAIPinOffenseCard(state, aiPlayer) {
  const ai = state[aiPlayer];
  const difficulty = state.aiDifficulty || 'medium';
  const randomness = difficulty === 'easy' ? 15 : difficulty === 'hard' ? 1 : 3;
  const options = Object.values(PIN_OFFENSE_CARDS)
    .map(c => ({ ...c, score: (c.bonus || 0) * 100 - (c.staminaCost || 0) * (ai.stamina < 40 ? 2 : 0.5) + Math.random() * randomness }))
    .sort((a, b) => b.score - a.score);
  // Easy: pure random pick; Medium: weighted random; Hard: always best
  if (difficulty === 'easy') return options[Math.floor(Math.random() * options.length)]?.id || 'pin_adjust_pressure';
  if (difficulty === 'hard') return options[0]?.id || 'pin_adjust_pressure';
  return weightedPinPick(options, 'pin_adjust_pressure');
}

export function getAIPinDefenseCard(state, aiPlayer) {
  const ai = state[aiPlayer];
  const difficulty = state.aiDifficulty || 'medium';
  const randomness = difficulty === 'easy' ? 15 : difficulty === 'hard' ? 1 : 3;
  const options = Object.values(PIN_DEFENSE_CARDS)
    .map(c => ({ ...c, score: (c.resistance || 0) * 100 - (c.staminaCost || 0) * (ai.stamina < 30 ? 3 : 1) + Math.random() * randomness }))
    .sort((a, b) => b.score - a.score);
  if (difficulty === 'easy') return options[Math.floor(Math.random() * options.length)]?.id || 'pin_fight_hands';
  if (difficulty === 'hard') return options[0]?.id || 'pin_fight_hands';
  return weightedPinPick(options, 'pin_fight_hands');
}

// Stage 1 offense: only lock/adjust (no pin_finish, no pin_power_drive)
export function getAIPinOffenseCardStage1(state, aiPlayer) {
  const ai = state[aiPlayer];
  const difficulty = state.aiDifficulty || 'medium';
  const randomness = difficulty === 'easy' ? 15 : difficulty === 'hard' ? 1 : 3;
  const stage1Cards = Object.values(PIN_OFFENSE_CARDS).filter(c => c.id !== 'pin_finish' && c.id !== 'pin_power_drive');
  const options = stage1Cards
    .map(c => ({ ...c, score: (c.bonus || 0) * 100 - (c.staminaCost || 0) * (ai.stamina < 40 ? 2 : 0.5) + Math.random() * randomness }))
    .sort((a, b) => b.score - a.score);
  if (difficulty === 'easy') return options[Math.floor(Math.random() * options.length)]?.id || 'pin_lock_position';
  if (difficulty === 'hard') return options[0]?.id || 'pin_lock_position';
  return weightedPinPick(options, 'pin_lock_position');
}

// Stage 2 offense: lock/adjust/power_drive (no pin_finish)
export function getAIPinOffenseCardStage2(state, aiPlayer) {
  const ai = state[aiPlayer];
  const difficulty = state.aiDifficulty || 'medium';
  const randomness = difficulty === 'easy' ? 15 : difficulty === 'hard' ? 1 : 3;
  const stage2Cards = Object.values(PIN_OFFENSE_CARDS).filter(c => c.id !== 'pin_finish');
  const options = stage2Cards
    .map(c => ({ ...c, score: (c.bonus || 0) * 100 - (c.staminaCost || 0) * (ai.stamina < 40 ? 2 : 0.5) + Math.random() * randomness }))
    .sort((a, b) => b.score - a.score);
  if (difficulty === 'easy') return options[Math.floor(Math.random() * options.length)]?.id || 'pin_power_drive';
  if (difficulty === 'hard') return options[0]?.id || 'pin_power_drive';
  return weightedPinPick(options, 'pin_power_drive');
}

// Stage 2 defense: excludes 1 burned card
export function getAIPinDefenseCardStage2(state, aiPlayer, burnedDefCards) {
  const ai = state[aiPlayer];
  const difficulty = state.aiDifficulty || 'medium';
  const randomness = difficulty === 'easy' ? 15 : difficulty === 'hard' ? 1 : 3;
  const burned = Array.isArray(burnedDefCards) ? burnedDefCards : [burnedDefCards];
  const options = Object.values(PIN_DEFENSE_CARDS)
    .filter(c => !burned.includes(c.id))
    .map(c => ({ ...c, score: (c.resistance || 0) * 100 - (c.staminaCost || 0) * (ai.stamina < 30 ? 3 : 1) + Math.random() * randomness }))
    .sort((a, b) => b.score - a.score);
  if (difficulty === 'easy') return options[Math.floor(Math.random() * options.length)]?.id || 'pin_roll_through';
  if (difficulty === 'hard') return options[0]?.id || 'pin_roll_through';
  return weightedPinPick(options, 'pin_roll_through');
}

// Stage 3 defense: excludes 2 burned cards
export function getAIPinDefenseCardStage3(state, aiPlayer, burnedDefCards) {
  const ai = state[aiPlayer];
  const difficulty = state.aiDifficulty || 'medium';
  const randomness = difficulty === 'easy' ? 15 : difficulty === 'hard' ? 1 : 3;
  const options = Object.values(PIN_DEFENSE_CARDS)
    .filter(c => !burnedDefCards.includes(c.id))
    .map(c => ({ ...c, score: (c.resistance || 0) * 100 - (c.staminaCost || 0) * (ai.stamina < 30 ? 3 : 1) + Math.random() * randomness }))
    .sort((a, b) => b.score - a.score);
  if (difficulty === 'easy') return options[Math.floor(Math.random() * options.length)]?.id || 'pin_fight_hands';
  if (difficulty === 'hard') return options[0]?.id || 'pin_fight_hands';
  return weightedPinPick(options, 'pin_fight_hands');
}

// ─── Pin Phase Card Definitions ───────────────────────────────────────────────

// Pin card matchup system: each offense card beats one defense and loses to another.
// Correct read: +0.10 bonus. Getting read: -0.10 penalty.
// This makes the pin mini-game a strategic guessing game, not just stat-checking.
export const PIN_MATCHUPS = {
  // Lock Position: locks the hold tight → beats Fight Hands (can't strip a locked grip),
  //   but Bridge breaks the lock with explosive upward force
  pin_lock_position:   { beats: 'pin_fight_hands', losesTo: 'pin_bridge' },
  // Adjust Pressure: shifts angle to counter movement → beats Bridge (adjusts around it),
  //   but Hip Switch exploits the shifting weight
  pin_adjust_pressure: { beats: 'pin_bridge',       losesTo: 'pin_hip_switch' },
  // Power Drive: brute force through → beats Roll Through (too much power to roll),
  //   but Fight Hands strips the grips during the overcommitted drive
  pin_power_drive:     { beats: 'pin_roll_through', losesTo: 'pin_fight_hands' },
  // Finish: full commitment → beats Hip Switch (overwhelms the switch),
  //   but Roll Through uses the momentum against the attacker
  pin_finish:          { beats: 'pin_hip_switch',   losesTo: 'pin_roll_through' },
};

export const PIN_OFFENSE_CARDS = {
  pin_lock_position: {
    id: 'pin_lock_position',
    name: 'Lock Position',
    description: 'Drive hips through, seal the shoulders',
    staminaCost: 8,
    bonus: 0.08,
    beats: 'Fight Hands',
    losesTo: 'Bridge',
  },
  pin_adjust_pressure: {
    id: 'pin_adjust_pressure',
    name: 'Adjust Pressure',
    description: 'Shift weight to counter the bridge',
    staminaCost: 6,
    bonus: 0.04,
    beats: 'Bridge',
    losesTo: 'Hip Switch',
  },
  pin_power_drive: {
    id: 'pin_power_drive',
    name: 'Power Drive',
    description: 'Maximum pressure -drive hips through',
    staminaCost: 10,
    bonus: 0.10,
    beats: 'Roll Through',
    losesTo: 'Fight Hands',
  },
  pin_finish: {
    id: 'pin_finish',
    name: 'Finish the Pin',
    description: 'Commit full body weight to the fall',
    staminaCost: 12,
    bonus: 0.14,
    beats: 'Hip Switch',
    losesTo: 'Roll Through',
  },
};

export const PIN_DEFENSE_CARDS = {
  pin_bridge: {
    id: 'pin_bridge',
    name: 'Bridge',
    description: 'Explosive hip bridge to break the fall',
    staminaCost: 14,
    resistance: 0.22,
    escapeText: 'bridges hard',
    beats: 'Lock Position',
    losesTo: 'Adjust Pressure',
  },
  pin_roll_through: {
    id: 'pin_roll_through',
    name: 'Roll Through',
    description: 'Roll into the pressure to break the hold',
    staminaCost: 10,
    resistance: 0.16,
    escapeText: 'rolls through',
    beats: 'Finish the Pin',
    losesTo: 'Power Drive',
  },
  pin_fight_hands: {
    id: 'pin_fight_hands',
    name: 'Fight Hands',
    description: 'Control and strip the locking grip',
    staminaCost: 8,
    resistance: 0.12,
    escapeText: 'strips the grip',
    beats: 'Power Drive',
    losesTo: 'Lock Position',
  },
  pin_hip_switch: {
    id: 'pin_hip_switch',
    name: 'Hip Switch',
    description: 'Explosive hip switch to break shoulder contact',
    staminaCost: 12,
    resistance: 0.20,
    beats: 'Adjust Pressure',
    losesTo: 'Finish the Pin',
    escapeText: 'switches hips explosively',
  },
};

// ─── Turn cards -diminishing returns when spammed ────────────────────────────
const TURN_CARD_IDS = new Set([
  'tilt', 'far_side_tilt', 'half_nelson', 'power_half',
  'near_side_cradle', 'arm_bar', 'arm_turk', 'leg_turk',
  'crossface_cradle',
  // Freestyle/Greco par terre top cards also count as turn-type
  'gut_wrench', 'leg_lace', 'step_over',
  // Greco-specific
  'reverse_lift', 'arm_drag_to_gut_wrench',
  // Folkstyle leg-ride chain + bar-arm family (v2 expansion)
  'grapevine_power_half', 'cross_body_ride', 'saturday_night_ride',
  'leg_cradle', 'leg_ride_power_half', 'banana_split', 'spladle',
  'chicken_wing', 'double_arm_bar',
]);

// PIN-eligible cards -these can trigger the pin_attempt phase
const PIN_ELIGIBLE_CARDS = new Set([
  'near_side_cradle', 'power_half', 'arm_bar', 'arm_turk', 'leg_turk',
  'half_nelson', 'fhl_gator_roll', 'crossface_cradle',
  // Freestyle/Greco exposure cards can also trigger pins (at lower rates)
  'gut_wrench', 'leg_lace', 'step_over',
  // Greco-specific
  'reverse_lift', 'arm_drag_to_gut_wrench',
  // Folkstyle leg-ride chain + bar-arm family (v2 expansion)
  'grapevine_power_half', 'cross_body_ride', 'saturday_night_ride',
  'leg_cradle', 'leg_ride_power_half', 'banana_split', 'spladle',
  'chicken_wing', 'double_arm_bar',
]);

// Grand amplitude cards -always pin-eligible without pinDepth requirement
const GRAND_AMPLITUDE_CARDS = new Set([
  'suplex', 'headlock_throw', 'lateral_drop', 'bear_hug_lift',
  // Greco par terre grand amplitude
  'reverse_lift',
]);

// FHL branch cards
const FHL_BRANCH_IDS = new Set([
  'fhl_go_behind', 'fhl_knee_tap', 'fhl_whipover',
  'fhl_cement_mixer', 'fhl_gator_roll', 'fhl_snap_spin',
]);

// Leg attack cards -these can produce a partial "leg attack secured" result on close wins
// single_leg and high_crotch use control→LEG_ATTACK_SECURED directly via scoreEffect
// These takedown-type cards go through buildPartialResult's leg intercept instead
const LEG_ATTACK_CARD_IDS = new Set([
  'sweep_single', 'double_leg', 'fireman_carry',
]);

// Leg finish cards -available after securing a leg attack
const LEG_FINISH_IDS = new Set([
  'run_the_pipe', 'elevate_and_trip', 'mat_return_from_leg',
]);

// Scramble-specific cards
const SCRAMBLE_CARD_IDS = new Set([
  'scramble_reattack', 'scramble_come_out_top', 'scramble_clear_hips',
]);

// Tie-up follow-up cards
const TIE_UP_FOLLOW_IDS = new Set([
  'snap_spin', 'inside_trip', 'drag_by',
]);

// Bottom escape/reversal cards
const BOTTOM_ACTION_IDS = new Set([
  'stand_up', 'switch_move', 'sit_out', 'granby_roll',
  'hip_heist', 'hand_control_escape', 'short_sit', 'base_build', 'head_post',
  'tripod_stand', 'belly_down',
  // Freestyle bottom offense
  're_shot_from_bottom', 'roll_through_attack',
  // Greco bottom defense
  'bridge_defense',
  // Folkstyle bottom expansion (v2)
  'peterson_roll', 'wing_roll', 'fake_switch_to_granby', 'granby_to_peterson',
  'sit_out_turn_in', 'short_offense_switch', 'reverse_switch', 'outside_roll',
  'cross_body_defense',
]);

// Chain follow-up bonus: rewards setup → action sequences
const CHAIN_BONUS = 14;
const CHAIN_SEQUENCES = {
  [CONDITIONS.TIE_UP]: new Set(['snap_spin', 'inside_trip', 'drag_by', 'slide_by', 'duck_under']),
  [CONDITIONS.FRONT_HEADLOCK_CONTROL]: FHL_BRANCH_IDS,
  [CONDITIONS.LEG_ATTACK_SECURED]: LEG_FINISH_IDS,
  [CONDITIONS.REAR_STANDING]: new Set(['rear_mat_return', 'rear_trip', 'rear_lift']),
  [CONDITIONS.HAND_FIGHTING]: new Set(['hand_fight_snap', 'hand_fight_reattack']),
  // Top chains -riding → turning
  [CONDITIONS.BROKEN_DOWN]: new Set(['half_nelson', 'far_side_tilt', 'crossface_cradle']),
  [CONDITIONS.CONTROL_ESTABLISHED]: new Set(['near_side_cradle', 'arm_bar', 'tilt', 'gut_wrench', 'leg_lace', 'step_over', 'reverse_lift', 'arm_drag_to_gut_wrench', 'get_legs_in']),
  [CONDITIONS.TOP_PRESSURE]: new Set(['arm_turk', 'leg_turk']),
  // Folkstyle leg-ride chain - setup via get_legs_in
  [CONDITIONS.LEG_RIDE_ESTABLISHED]: new Set([
    'grapevine_power_half', 'cross_body_ride', 'saturday_night_ride',
    'leg_cradle', 'leg_ride_power_half', 'banana_split', 'spladle',
  ]),
  // Bottom chains -setup → escape
  [CONDITIONS.BASE_BUILT]: new Set(['stand_up', 'tripod_stand']),
  [CONDITIONS.GOOD_BASE]: new Set(['switch_move', 'sit_out']),
  [CONDITIONS.INSIDE_POSITION]: new Set(['arm_throw', 'shuck_by']),
};

function computePower(card, state, player, opponentCard) {
  let power = card.basePower;
  const wrestler = state[player];
  const opponent = player === 'p1' ? state.p2 : state.p1;
  const defender = player === 'p1' ? 'p2' : 'p1';

  // Stamina penalty: kicks in below threshold -higher END raises the threshold slightly
  const fatigueThreshold = wrestler.stats
    ? 120 + (wrestler.stats.end - 50) * 0.15  // END 50→120, END 80→124.5, END 100→127.5
    : 120;
  if (wrestler.stamina < fatigueThreshold) {
    power *= 0.55 + (wrestler.stamina / fatigueThreshold) * 0.45;
  }

  if (state.momentum === player) power += 12;
  if (state.initiative === player) power += 8;

  // Counter system: strongAgainst gives +26 bonus, being countered gives -22 penalty
  // Rewards players who read their opponent and pick the right counter
  if (card.strongAgainst && card.strongAgainst.includes(opponentCard.id)) {
    power += 26;
  }
  // Counters penalty: if opponent's card lists this card as a counter, attacker is weakened
  if (card.counters && card.counters.includes(opponentCard.id)) {
    power -= 22;
  }

  if (wrestler.position === POSITIONS.BOTTOM) {
    const pressureKey = player === 'p1' ? 'p2OnP1' : 'p1OnP2';
    power -= (state.pressure[pressureKey] || 0) * 0.25;
  }

  // Diminishing returns on turn cards (includes freestyle par terre top)
  if (TURN_CARD_IDS.has(card.id)) {
    const history = (state.turnHistory || {})[player] || {};
    const timesUsed = history[card.id] || 0;
    if (timesUsed >= 1) {
      // Freestyle exposure cards have less diminishing returns (repeatable by design)
      const isExposure = card.scoreEffect?.type === 'exposure';
      // TEC reduces diminishing-return penalty (max 20% reduction at TEC 100)
      const tecReduction = wrestler.stats ? (wrestler.stats.tec / 100) * 0.2 : 0;
      power -= timesUsed * (isExposure ? 8 : 14) * (1 - tecReduction);
    }
    if (wrestler.stamina < 120) {
      power -= (120 - wrestler.stamina) * 0.12; // fatigue makes turns harder
    }
    // Riding-first bonus: control moves before a turn attempt increase its chance of success.
    // Turning cold (no prior riding) is harder -defender isn't broken down yet.
    const cStreak = wrestler.controlStreak || 0;
    if (cStreak >= 2) {
      power += 18; // well-established ride → strong turn chance
    } else if (cStreak === 1) {
      power += 9;  // some riding → modest bonus
    } else {
      power -= 14; // no riding → cold turn is risky
    }
  }

  // Defensive adaptation for bottom wrestler
  if (BOTTOM_ACTION_IDS.has(card.id) && wrestler.position === POSITIONS.BOTTOM) {
    const topHistory = (state.turnHistory || {})[defender] || {};
    let totalTurnAttempts = 0;
    for (const id of TURN_CARD_IDS) {
      totalTurnAttempts += topHistory[id] || 0;
    }
    if (totalTurnAttempts >= 2) {
      power += Math.min(totalTurnAttempts * 8, 28);
    }
    if (opponent.stamina < 120) {
      power += (120 - opponent.stamina) * 0.14; // bottom wrestler gains when top is gassed
    }
    const defConds = state[`${player}Conditions`] || [];
    // RECOVERING gives extra urgency/power to escape -wrestler fighting for their life
    if (defConds.includes(CONDITIONS.RECOVERING)) {
      power += 10;
    }
    // GOOD_BASE: earned by surviving turn attempts -gives solid bonus to escapes/reversals
    if (defConds.includes(CONDITIONS.GOOD_BASE)) {
      power += 6;
    }
    // BASE_BUILT: earned by base_build card -stronger escape attempts
    if (defConds.includes(CONDITIONS.BASE_BUILT)) {
      power += 6;
    }
  }

  // HAND_FIGHTING: earned in neutral scrambles -setup and takedown bonus
  if (wrestler.position === POSITIONS.NEUTRAL) {
    const myConds = state[`${player}Conditions`] || [];
    if (myConds.includes(CONDITIONS.HAND_FIGHTING)) {
      if (card.scoreEffect?.type === 'setup') power += 8;
      if (card.scoreEffect?.type === 'takedown') power += 5;
      if (card.scoreEffect?.type === 'counter') power += 6;
      if (card.scoreEffect?.type === 'grand_amplitude') power += 8;
    }
    // INSIDE_POSITION (Greco): underhook advantage powers up throws significantly
    if (myConds.includes(CONDITIONS.INSIDE_POSITION)) {
      if (card.scoreEffect?.type === 'grand_amplitude') power += 12;
      if (card.scoreEffect?.type === 'takedown') power += 8;
    }
    // TIE_UP: established by collar_tie/underhook -powers up chain follow-ups
    if (myConds.includes(CONDITIONS.TIE_UP)) {
      if (card.scoreEffect?.type === 'takedown') power += 10;
      if (card.scoreEffect?.type === 'setup') power += 8;
      if (card.scoreEffect?.type === 'control') power += 8;
    }
    // LEG_ATTACK_SECURED: attacker has a leg -leg finish cards get a bonus
    if (myConds.includes(CONDITIONS.LEG_ATTACK_SECURED)) {
      if (LEG_FINISH_IDS.has(card.id)) power += 9;
    }
    // REAR_STANDING: attacker is behind -rear finishers get a bonus
    if (myConds.includes(CONDITIONS.REAR_STANDING)) {
      if (card.scoreEffect?.type === 'takedown') power += 14;
    }
  }

  // Chain follow-up bonus: rewards setup → action sequences (stacks with condition bonuses)
  const playerConds = state[`${player}Conditions`] || [];
  for (const cond of playerConds) {
    const chainSet = CHAIN_SEQUENCES[cond];
    if (chainSet && chainSet.has(card.id)) {
      power += CHAIN_BONUS;
      break; // one chain bonus max
    }
  }

  // ── Wrestler Stats ─────────────────────────────────────────────────────────
  // Two layers: (A) affinity - your own stats boost matching moves
  //             (B) matchup - your stats vs opponent's stats
  // Hard capped so stats matter without being auto-win
  const atkStats = wrestler.stats;
  const defStats = opponent.stats;
  const se = card.scoreEffect?.type;
  let statBonus = 0;
  const STAT_CAP = 4; // tight cap - stats give an edge, never an auto-win

  if (atkStats) {
    // ── A. STAT AFFINITY - your own stats boost moves that match your style ──
    if (['takedown', 'near_fall', 'control', 'grand_amplitude'].includes(se)) {
      statBonus += (atkStats.str - 50) / 30;
    }
    if (['counter', 'escape', 'reversal'].includes(se) || SCRAMBLE_CARD_IDS.has(card.id)) {
      statBonus += (atkStats.spd - 50) / 30;
    }
    if (playerConds.some(cond => CHAIN_SEQUENCES[cond]?.has(card.id))) {
      statBonus += (atkStats.tec - 50) / 30;
    }
    if (BOTTOM_ACTION_IDS.has(card.id) && wrestler.position === POSITIONS.BOTTOM) {
      statBonus += (atkStats.grt - 50) / 30;
    }

    // ── B. STAT MATCHUP - your stats vs opponent's stats ──
    if (defStats) {
      if (['takedown', 'near_fall', 'control', 'grand_amplitude'].includes(se)) {
        statBonus += (atkStats.str - defStats.grt) / 35;
      }
      if (['counter', 'escape', 'reversal'].includes(se) || SCRAMBLE_CARD_IDS.has(card.id)) {
        statBonus += (atkStats.spd - defStats.spd) / 30;
      }
      if (BOTTOM_ACTION_IDS.has(card.id) && wrestler.position === POSITIONS.BOTTOM) {
        statBonus += (atkStats.grt - defStats.str) / 35;
      }
    }
  }

  // Apply capped stat bonus
  power += Math.max(-STAT_CAP, Math.min(STAT_CAP, statBonus));

  return power;
}

// "You" → "Your", "James" → "James's"
function possessive(name) {
  if (name.toLowerCase() === 'you') return 'Your';
  return name + "'s";
}

function buildWinResult(state, card, winner, loserCard, rng = Math.random) {
  const winnerName = state[winner].name;
  const loser = winner === 'p1' ? 'p2' : 'p1';
  const loserName = state[loser].name;
  const lc = loserCard?.name ?? '-';
  const se = card.scoreEffect;
  const scores = getScores(state.wrestlingStyle);

  if (!se) return { type: 'reset', attacker: winner, message: `${winnerName} plays ${card.name} vs ${possessive(loserName)} ${lc}.` };

  switch (se.type) {
    case 'takedown':
      return {
        type: 'takedown', attacker: winner, cardId: card.id,
        points: scores.TAKEDOWN,
        message: `${winnerName} hits ${card.name} vs ${possessive(loserName)} ${lc} - TAKEDOWN! +${scores.TAKEDOWN} pts`,
      };
    case 'escape':
      return {
        type: 'escape', attacker: winner, cardId: card.id,
        points: scores.ESCAPE,
        message: `${winnerName} escapes with ${card.name} vs ${possessive(loserName)} ${lc}! +${scores.ESCAPE} pt`,
      };
    case 'reversal':
      return {
        type: 'reversal', attacker: winner, cardId: card.id,
        points: scores.REVERSAL,
        message: `${winnerName} reverses with ${card.name} vs ${possessive(loserName)} ${lc}! +${scores.REVERSAL} pts`,
      };
    case 'near_fall': {
      const nfPoints = scores.NEAR_FALL_2 || 2;
      if (PIN_ELIGIBLE_CARDS.has(card.id)) {
        const pinChance = computePinChance(state, winner, card.id);
        const defenderKey = winner === 'p1' ? 'p2' : 'p1';
        const defPinDepth = state[defenderKey]?.pinDepth || 0;
        if (pinChance > 0.12 && defPinDepth >= 1) {
          return {
            type: 'pin_attempt_trigger',
            attacker: winner,
            cardId: card.id,
            points: nfPoints,
            pinChance,
            message: `${winnerName} drives ${card.name} vs ${possessive(loserName)} ${lc} - NEAR FALL! +${nfPoints} pts - PIN ATTEMPT!`,
          };
        }
      }
      return {
        type: 'near_fall', attacker: winner, cardId: card.id,
        points: nfPoints,
        message: `${winnerName} turns with ${card.name} vs ${possessive(loserName)} ${lc} - NEAR FALL! +${nfPoints} pts`,
      };
    }
    case 'takedown_near_fall': {
      const tdPoints = scores.TAKEDOWN;
      const nfPoints2 = scores.NEAR_FALL_2 || 2;
      const isIntl = isInternationalStyle(state.wrestlingStyle);
      const tdnfLabel = isIntl ? '4-POINT TAKEDOWN' : 'TAKEDOWN + NEAR FALL';
      if (PIN_ELIGIBLE_CARDS.has(card.id)) {
        const pinChance = computePinChance(state, winner, card.id);
        const defenderKey = winner === 'p1' ? 'p2' : 'p1';
        const defPinDepth = state[defenderKey]?.pinDepth || 0;
        if (pinChance > 0.12 && defPinDepth >= 1) {
          return {
            type: 'takedown_near_fall', subType: 'pin',
            attacker: winner, cardId: card.id,
            tdPoints, nfPoints: nfPoints2, pinChance,
            message: `${winnerName} rolls ${card.name} vs ${possessive(loserName)} ${lc} - ${tdnfLabel}! +${tdPoints + nfPoints2} pts - PIN ATTEMPT!`,
          };
        }
      }
      return {
        type: 'takedown_near_fall',
        attacker: winner, cardId: card.id,
        tdPoints, nfPoints: nfPoints2,
        message: `${winnerName} rolls ${card.name} vs ${possessive(loserName)} ${lc} - ${tdnfLabel}! +${tdPoints + nfPoints2} pts`,
      };
    }
    case 'exposure': {
      const expPoints = scores.EXPOSURE || 2;
      if (PIN_ELIGIBLE_CARDS.has(card.id) && se.pinChance) {
        const pinChance = computePinChance(state, winner, card.id);
        const defenderKey = winner === 'p1' ? 'p2' : 'p1';
        const defPinDepth = state[defenderKey]?.pinDepth || 0;
        if (pinChance > 0.12 && defPinDepth >= 1) {
          return {
            type: 'pin_attempt_trigger',
            attacker: winner,
            cardId: card.id,
            points: expPoints,
            pinChance,
            message: `${winnerName} turns with ${card.name} vs ${possessive(loserName)} ${lc} - EXPOSURE! +${expPoints} pts - PIN ATTEMPT!`,
          };
        }
      }
      return {
        type: 'exposure', attacker: winner, cardId: card.id,
        points: expPoints,
        message: `${winnerName} exposes with ${card.name} vs ${possessive(loserName)} ${lc}! +${expPoints} pts`,
      };
    }
    case 'grand_amplitude': {
      const gaPoints = scores.GRAND_AMPLITUDE || 5;
      const pinChance = computePinChance(state, winner, card.id);
      if (pinChance > 0.12 && rng() < 0.2) {
        return {
          type: 'pin_attempt_trigger',
          attacker: winner,
          cardId: card.id,
          points: gaPoints,
          pinChance,
          isGrandAmplitude: true,
          message: `${winnerName} launches ${card.name} vs ${possessive(loserName)} ${lc} - GRAND AMPLITUDE! +${gaPoints} pts - PIN ATTEMPT!`,
        };
      }
      return {
        type: 'grand_amplitude', attacker: winner, cardId: card.id,
        points: gaPoints,
        message: `${winnerName} launches ${card.name} vs ${possessive(loserName)} ${lc} - GRAND AMPLITUDE! +${gaPoints} pts`,
      };
    }
    case 'control':
      return {
        type: 'control', attacker: winner, cardId: card.id,
        setsCondition: card.scoreEffect.setsCondition,
        message: `${possessive(winnerName)} ${card.name} beats ${possessive(loserName)} ${lc} -control established.`,
      };
    case 'counter':
      return {
        type: 'counter', attacker: winner, cardId: card.id,
        message: `${winnerName} counters with ${card.name} vs ${possessive(loserName)} ${lc}! Reset to neutral.`,
      };
    case 'setup':
      return {
        type: 'setup', attacker: winner, cardId: card.id,
        setsCondition: se.setsCondition || null,
        message: `${possessive(winnerName)} ${card.name} beats ${possessive(loserName)} ${lc} -position set.`,
      };
    case 'defense':
      return {
        type: 'defense', attacker: winner, cardId: card.id,
        setsCondition: se.setsCondition || null,
        message: `${winnerName} digs in with ${card.name} vs ${possessive(loserName)} ${lc}.`,
      };
    default:
      return { type: 'reset', attacker: winner, message: `${winnerName} plays ${card.name} vs ${possessive(loserName)} ${lc}.` };
  }
}

function buildPartialResult(state, card, edgeWinner, loserCard) {
  const name = state[edgeWinner].name;
  const loser = edgeWinner === 'p1' ? 'p2' : 'p1';
  const loserName = state[loser].name;
  const se = card.scoreEffect;

  const loserIsBottom = state[loser].position === POSITIONS.BOTTOM;
  const loserConds = state[`${loser}Conditions`] || [];
  const lc = loserCard?.name ?? '-';

  if (loserIsBottom && loserConds.includes(CONDITIONS.RECOVERING) && TURN_CARD_IDS.has(card.id)) {
    return {
      type: 'stalemate', attacker: loser, cardId: card.id,
      message: `${possessive(name)} ${card.name} vs ${possessive(loserName)} ${lc} - ${loserName} fights off the turn, positions reset.`,
    };
  }

  if (se && (se.type === 'counter' || se.type === 'setup' || se.type === 'defense')) {
    return {
      type: 'stalemate', attacker: edgeWinner, cardId: card.id,
      message: `${possessive(name)} ${card.name} vs ${possessive(loserName)} ${lc} -stalemate, positions hold.`,
    };
  }

  if (loserIsBottom && se && (se.type === 'escape' || se.type === 'reversal')) {
    return {
      type: 'scramble', attacker: loser, cardId: card.id,
      message: `${possessive(loserName)} ${lc} vs ${possessive(name)} ${card.name} -nearly breaks free, ${name} barely maintains.`,
    };
  }

  // Edge win with escape/reversal from bottom → partial success = escape to neutral (1 pt)
  // Reversal *attempts* that edge-win get downgraded to escapes too. The
  // message must call this out explicitly - otherwise players read the log
  // as "Peterson Roll = 1 pt" and assume the card is miscoded as an escape.
  // The `scrambledFrom` field lets the replay system narrate the swap
  // without re-parsing the message string.
  const winnerIsBottom = state[edgeWinner].position === POSITIONS.BOTTOM;
  if (winnerIsBottom && se && (se.type === 'escape' || se.type === 'reversal')) {
    const scores = getScores(state.wrestlingStyle);
    const wasReversalAttempt = se.type === 'reversal';
    const message = wasReversalAttempt
      ? `${name} attempts ${card.name} - turns into a scramble! ${name} escapes for +${scores.ESCAPE} pt`
      : `${name} fights free with ${card.name} vs ${possessive(loserName)} ${lc}! +${scores.ESCAPE} pt`;
    return {
      type: 'escape', attacker: edgeWinner, cardId: card.id,
      points: scores.ESCAPE,
      scrambledFrom: wasReversalAttempt ? 'reversal' : undefined,
      message,
    };
  }

  // Leg attack intermediate: when a leg-based takedown attempt partially succeeds from neutral,
  // the attacker "has a leg" and needs to finish -defender fights to free it
  // Exception: fireman's carry from a collar tie (TIE_UP) is a clean setup -skips leg fight
  const attackerHasTieUp = state[`${edgeWinner}Conditions`]?.includes(CONDITIONS.TIE_UP);
  const skipLegFight = card.id === 'fireman_carry' && attackerHasTieUp;
  if (se && se.type === 'takedown' && LEG_ATTACK_CARD_IDS.has(card.id)
      && state[edgeWinner].position === POSITIONS.NEUTRAL && !skipLegFight) {
    return {
      type: 'leg_attack_secured', attacker: edgeWinner, cardId: card.id,
      message: `${name} shoots ${card.name} vs ${possessive(loserName)} ${lc} -has a leg! ${loserName} must fight free.`,
    };
  }

  return {
    type: 'scramble', attacker: edgeWinner, cardId: card.id,
    message: `${possessive(name)} ${card.name} vs ${possessive(loserName)} ${lc} -close contest, ${loserName} holds on.`,
  };
}

// ─── Apply Result to State ────────────────────────────────────────────────────

function applyResult(state, result) {
  let s = { ...state };
  const { attacker, type } = result;
  if (!attacker || !type) return s;
  const defender = attacker === 'p1' ? 'p2' : 'p1';
  const scores = getScores(s.wrestlingStyle);

  // Reset stalling counter on any active play
  if (type !== 'stalemate') {
    s.neutralStaleCount = 0;
  }

  // Auto-clear transient SCRAMBLE condition when the next result is anything but scramble
  if (type !== 'scramble') {
    s.p1Conditions = s.p1Conditions.filter(c => c !== CONDITIONS.SCRAMBLE);
    s.p2Conditions = s.p2Conditions.filter(c => c !== CONDITIONS.SCRAMBLE);
  }

  switch (type) {
    case 'takedown': {
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + (result.points || scores.TAKEDOWN),
        takedownCount: (s[attacker].takedownCount || 0) + 1,
        position: POSITIONS.TOP,
        // Attacker is now on top -clear any bottom-pressure tracking
        pinDepth: 0,
        bottomRounds: 0,
      };
      s[defender] = {
        ...s[defender],
        position: POSITIONS.BOTTOM,
        // Fresh start on bottom -no prior pin history from this position
        pinDepth: 0,
        bottomRounds: 0,
      };
      const tk = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { p1OnP2: 0, p2OnP1: 0, [tk]: 15 };
      // Bug 3 partial: Takedown grants control_established (this is correct -you earned control)
      // But period START TOP choice should NOT grant this (fixed in applyPeriodChoice)
      s[`${attacker}Conditions`] = [CONDITIONS.CONTROL_ESTABLISHED];
      s[`${defender}Conditions`] = [];
      s.initiative = attacker;
      s.momentum = attacker;
      s.chainActive = false;
      break;
    }
    case 'takedown_near_fall': {
      const tdPts = result.tdPoints || scores.TAKEDOWN;
      const nfPts = result.nfPoints || scores.NEAR_FALL_2 || 2;
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + tdPts + nfPts,
        takedownCount: (s[attacker].takedownCount || 0) + 1,
        nearFallCount: (s[attacker].nearFallCount || 0) + 1,
        position: POSITIONS.TOP,
        pinDepth: 0, bottomRounds: 0,
      };
      s[defender] = {
        ...s[defender],
        position: POSITIONS.BOTTOM,
        pinDepth: (s[defender].pinDepth || 0) + 1,
        bottomRounds: 0,
      };
      const tnk = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { p1OnP2: 0, p2OnP1: 0, [tnk]: 25 };
      s[`${attacker}Conditions`] = [CONDITIONS.CONTROL_ESTABLISHED];
      s[`${defender}Conditions`] = [CONDITIONS.RECOVERING];
      s.initiative = attacker;
      s.momentum = attacker;
      s.chainActive = false;
      s.turnHistory = { p1: {}, p2: {} };
      if (result.subType === 'pin') {
        s.phase = 'pin_attempt';
        s.pinAttempt = {
          attacker, cardId: result.cardId, pinChance: result.pinChance,
          offenseCards: Object.values(PIN_OFFENSE_CARDS),
          defenseCards: Object.values(PIN_DEFENSE_CARDS),
          stage: 1, stage1DefCard: null,
        };
      }
      break;
    }
    case 'escape': {
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + (result.points || scores.ESCAPE),
        escapeCount: (s[attacker].escapeCount || 0) + 1,
        position: POSITIONS.NEUTRAL,
        // Escaped -reset pressure tracking
        pinDepth: 0,
        bottomRounds: 0,
      };
      // Escape breaks the ride -reset former top wrestler's riding time and control streaks
      s[defender] = { ...s[defender], position: POSITIONS.NEUTRAL, rideTimeStreak: 0, controlStreak: 0 };
      s.pressure = { p1OnP2: 0, p2OnP1: 0 };
      s.p1Conditions = [];
      s.p2Conditions = [];
      s.momentum = attacker;
      s.chainActive = false;
      s.turnHistory = { p1: {}, p2: {} };
      break;
    }
    case 'reversal': {
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + (result.points || scores.REVERSAL),
        reversalCount: (s[attacker].reversalCount || 0) + 1,
        position: POSITIONS.TOP,
        // Reversed out -reset bottom pressure tracking
        pinDepth: 0,
        bottomRounds: 0,
      };
      // Reversal breaks the ride -reset former top wrestler's riding time and control streaks
      s[defender] = { ...s[defender], position: POSITIONS.BOTTOM, rideTimeStreak: 0, controlStreak: 0 };
      const rk = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { p1OnP2: 0, p2OnP1: 0, [rk]: 15 };
      s[`${attacker}Conditions`] = [CONDITIONS.CONTROL_ESTABLISHED];
      s[`${defender}Conditions`] = [];
      s.initiative = attacker;
      s.momentum = attacker;
      s.chainActive = false;
      s.turnHistory = { p1: {}, p2: {} };
      break;
    }
    case 'near_fall': {
      const nfPoints = result.points || scores.NEAR_FALL_2 || 2;
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + nfPoints,
        nearFallCount: (s[attacker].nearFallCount || 0) + 1,
        controlStreak: 0, // turn succeeded -must re-establish riding before next turn attempt
      };
      // Increment defender's pinDepth -they're being put in pin-threatening situations
      s[defender] = {
        ...s[defender],
        pinDepth: (s[defender].pinDepth || 0) + 1,
        bottomRounds: (s[defender].bottomRounds || 0) + 1,
      };
      const nfk = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { ...s.pressure, [nfk]: Math.min(100, (s.pressure[nfk] || 0) + 25) };
      if (!s[`${attacker}Conditions`].includes(CONDITIONS.CONTROL_ESTABLISHED)) {
        s[`${attacker}Conditions`] = [...s[`${attacker}Conditions`], CONDITIONS.CONTROL_ESTABLISHED];
      }
      const defConds = s[`${defender}Conditions`] || [];
      if (!defConds.includes(CONDITIONS.RECOVERING)) {
        s[`${defender}Conditions`] = [...defConds, CONDITIONS.RECOVERING];
      }
      s[`${defender}RecoveringRounds`] = 0; // reset decay counter
      s.momentum = attacker;
      // Bug 8 fix: near_fall resets turn history (prevents diminishing returns stacking into next action)
      s.turnHistory = { p1: {}, p2: {} };
      break;
    }
    case 'exposure': {
      // Freestyle exposure scoring -repeatable, no diminishing returns on points
      const expPoints = result.points || scores.EXPOSURE || 2;
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + expPoints,
        exposureCount: (s[attacker].exposureCount || 0) + 1,
        controlStreak: 0,
      };
      s[defender] = {
        ...s[defender],
        pinDepth: (s[defender].pinDepth || 0) + 1,
        bottomRounds: (s[defender].bottomRounds || 0) + 1,
      };
      const ek = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { ...s.pressure, [ek]: Math.min(100, (s.pressure[ek] || 0) + 20) };
      if (!s[`${attacker}Conditions`].includes(CONDITIONS.CONTROL_ESTABLISHED)) {
        s[`${attacker}Conditions`] = [...s[`${attacker}Conditions`], CONDITIONS.CONTROL_ESTABLISHED];
      }
      s.momentum = attacker;
      break;
    }
    case 'grand_amplitude': {
      // Grand amplitude throw -5 pts, thrower ends up on top in par terre
      const gaPoints = result.points || scores.GRAND_AMPLITUDE || 5;
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + gaPoints,
        grandAmplitudeCount: (s[attacker].grandAmplitudeCount || 0) + 1,
        position: POSITIONS.TOP,
        controlStreak: 0,
      };
      s[defender] = {
        ...s[defender],
        position: POSITIONS.BOTTOM,
        pinDepth: 0,
        bottomRounds: 0,
      };
      const gaKey = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { p1OnP2: 0, p2OnP1: 0, [gaKey]: 20 };
      s[`${attacker}Conditions`] = [CONDITIONS.CONTROL_ESTABLISHED];
      s[`${defender}Conditions`] = [];
      s.initiative = attacker;
      s.momentum = attacker;
      s.chainActive = false;
      s.turnHistory = { p1: {}, p2: {} };
      break;
    }
    case 'pin_attempt_trigger': {
      // Score the near-fall/exposure/grand_amplitude points immediately, then open the pin phase
      const triggerPoints = result.points || scores.NEAR_FALL_2 || 2;
      s[attacker] = {
        ...s[attacker],
        score: s[attacker].score + triggerPoints,
        nearFallCount: (s[attacker].nearFallCount || 0) + 1,
        controlStreak: 0, // turn triggered pin -reset streak
      };
      // For grand amplitude: attacker goes to top for pin attempt
      if (result.isGrandAmplitude) {
        s[attacker] = { ...s[attacker], position: POSITIONS.TOP, grandAmplitudeCount: (s[attacker].grandAmplitudeCount || 0) + 1 };
        s[defender] = { ...s[defender], position: POSITIONS.BOTTOM };
      }
      // Increment defender's pinDepth for surviving this
      s[defender] = {
        ...s[defender],
        pinDepth: (s[defender].pinDepth || 0) + 1,
        bottomRounds: (s[defender].bottomRounds || 0) + 1,
      };
      const ptk = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { ...s.pressure, [ptk]: Math.min(100, (s.pressure[ptk] || 0) + 25) };
      if (!s[`${attacker}Conditions`].includes(CONDITIONS.CONTROL_ESTABLISHED)) {
        s[`${attacker}Conditions`] = [...s[`${attacker}Conditions`], CONDITIONS.CONTROL_ESTABLISHED];
      }
      s.momentum = attacker;
      s.phase = 'pin_attempt';
      s.pinAttempt = {
        attacker,
        cardId: result.cardId,
        pinChance: result.pinChance,
        offenseCards: Object.values(PIN_OFFENSE_CARDS),
        defenseCards: Object.values(PIN_DEFENSE_CARDS),
        stage: 1,              // always starts at Stage 1
        burnedDefCards: [],     // defense cards burned after each stage
      };
      break;
    }
    case 'pin': {
      s[attacker] = { ...s[attacker], pinCount: (s[attacker].pinCount || 0) + 1 };
      s.winner = attacker;
      s.winMethod = 'pin';
      s.phase = 'finished';
      break;
    }
    case 'control': {
      const pKey = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { ...s.pressure, [pKey]: Math.min(100, (s.pressure[pKey] || 0) + 12) };
      if (result.setsCondition) {
        const cArr = s[`${attacker}Conditions`];
        if (!cArr.includes(result.setsCondition)) {
          s[`${attacker}Conditions`] = [...cArr, result.setsCondition];
        }
        // When attacker gains FRONT_HEADLOCK_CONTROL, defender becomes FRONT_HEADLOCK_TRAPPED
        // This restricts their card pool to FHL defense cards only (body dump, snap back, inside step)
        // Also clears any prior neutral conditions (TIE_UP, LEG_ATTACK) -you've moved into the headlock.
        // Both LEG_ATTACK_SECURED and LEG_ATTACK_TRAPPED are cleared from both sides so the FHL
        // Counter card (legDefense=true) cleanly transitions out of a leg-trapped state.
        if (result.setsCondition === CONDITIONS.FRONT_HEADLOCK_CONTROL) {
          // Clear attacker's setup conditions (TIE_UP was the entry, now replaced by FHL)
          const clearSetup = [CONDITIONS.TIE_UP, CONDITIONS.LEG_ATTACK_SECURED, CONDITIONS.LEG_ATTACK_TRAPPED, CONDITIONS.SCRAMBLE];
          s[`${attacker}Conditions`] = s[`${attacker}Conditions`].filter(c => !clearSetup.includes(c));
          // Set defender as trapped, clearing any prior neutral conditions
          const clearDef = [CONDITIONS.TIE_UP, CONDITIONS.LEG_ATTACK_TRAPPED, CONDITIONS.LEG_ATTACK_SECURED, CONDITIONS.SCRAMBLE];
          s[`${defender}Conditions`] = s[`${defender}Conditions`].filter(c => !clearDef.includes(c));
          if (!s[`${defender}Conditions`].includes(CONDITIONS.FRONT_HEADLOCK_TRAPPED)) {
            s[`${defender}Conditions`] = [...s[`${defender}Conditions`], CONDITIONS.FRONT_HEADLOCK_TRAPPED];
          }
        }
        // When attacker secures a leg attack, defender becomes LEG_ATTACK_TRAPPED
        if (result.setsCondition === CONDITIONS.LEG_ATTACK_SECURED) {
          const clearSetup = [CONDITIONS.TIE_UP, CONDITIONS.REAR_STANDING, CONDITIONS.SCRAMBLE];
          s[`${attacker}Conditions`] = s[`${attacker}Conditions`].filter(c => !clearSetup.includes(c));
          const clearDef = [CONDITIONS.TIE_UP, CONDITIONS.REAR_STANDING, CONDITIONS.SCRAMBLE];
          s[`${defender}Conditions`] = s[`${defender}Conditions`].filter(c => !clearDef.includes(c));
          if (!s[`${defender}Conditions`].includes(CONDITIONS.LEG_ATTACK_TRAPPED)) {
            s[`${defender}Conditions`] = [...s[`${defender}Conditions`], CONDITIONS.LEG_ATTACK_TRAPPED];
          }
          s.chainActive = true;
          s.initiative = attacker;
        }
      }
      s[defender] = { ...s[defender], stamina: Math.max(0, s[defender].stamina - 5) };
      // Track how long defender has been on bottom -after 2 rounds, earn baseline defensiveResistance
      // Also increment pinDepth: sustained control riding builds toward pin attempt eligibility
      if (s[defender].position === POSITIONS.BOTTOM) {
        const newBottomRounds = (s[defender].bottomRounds || 0) + 1;
        const newDefResist = newBottomRounds >= 2
          ? Math.max(s[defender].defensiveResistance || 0, 1)
          : s[defender].defensiveResistance || 0;
        const newPinDepth = (s[defender].pinDepth || 0) + 1;
        s[defender] = {
          ...s[defender],
          bottomRounds: newBottomRounds,
          defensiveResistance: newDefResist,
          pinDepth: newPinDepth,
        };
      }
      // Riding time: 3 consecutive control wins from TOP = +1 riding time bonus point
      // Only in folkstyle -international styles have no riding time incentive
      // Also increments controlStreak -used to bonus subsequent turn card attempts
      if (s[attacker].position === POSITIONS.TOP) {
        const newControlStreak = (s[attacker].controlStreak || 0) + 1;
        if (s.wrestlingStyle === 'folkstyle') {
          const newRideStreak = (s[attacker].rideTimeStreak || 0) + 1;
          if (newRideStreak >= 3) {
            s[attacker] = { ...s[attacker], score: s[attacker].score + 1, rideTimeStreak: 0, controlStreak: newControlStreak };
            const rideEntry = `Riding time! ${s[attacker].name} earns a bonus point for sustained control. +1`;
            s.log = [...s.log, { round: s.roundNumber, entry: rideEntry, type: 'ride_time' }];
          } else {
            s[attacker] = { ...s[attacker], rideTimeStreak: newRideStreak, controlStreak: newControlStreak };
          }
        } else {
          // International (freestyle/greco): no riding time, just controlStreak for turn power bonus
          s[attacker] = { ...s[attacker], controlStreak: newControlStreak };
        }
      }
      break;
    }
    case 'counter': {
      if (s.p1.position === POSITIONS.NEUTRAL && s.p2.position === POSITIONS.NEUTRAL) {
        s.pressure = { p1OnP2: 0, p2OnP1: 0 };
        s.p1Conditions = [];
        s.p2Conditions = [];
      } else {
        s.pressure = { p1OnP2: 0, p2OnP1: 0 };
        s.chainActive = false;
        // Clear FHL and leg attack conditions on counter
        const trapConds = [
          CONDITIONS.FRONT_HEADLOCK_CONTROL, CONDITIONS.FRONT_HEADLOCK_TRAPPED,
          CONDITIONS.LEG_ATTACK_SECURED, CONDITIONS.LEG_ATTACK_TRAPPED,
          CONDITIONS.LEG_RIDE_ESTABLISHED,
        ];
        s.p1Conditions = s.p1Conditions.filter(c => !trapConds.includes(c));
        s.p2Conditions = s.p2Conditions.filter(c => !trapConds.includes(c));
      }
      s.momentum = attacker;
      break;
    }
    case 'defense': {
      // Defensive positioning -set condition without granting initiative or chain
      if (result.setsCondition) {
        const cArr = s[`${attacker}Conditions`] || [];
        if (!cArr.includes(result.setsCondition)) {
          s[`${attacker}Conditions`] = [...cArr, result.setsCondition];
        }
        // SCRAMBLE from a leg-trapped state means the defender actually freed
        // the leg (limp_leg, whizzer_hop, crossface_and_circle, heavy_hips all
        // narrate this in their flavor text). Clear leg-attack conditions on
        // both sides; no-op when those conditions weren't present anyway.
        if (result.setsCondition === CONDITIONS.SCRAMBLE) {
          s[`${attacker}Conditions`] = s[`${attacker}Conditions`].filter(
            c => c !== CONDITIONS.LEG_ATTACK_TRAPPED,
          );
          s[`${defender}Conditions`] = (s[`${defender}Conditions`] || []).filter(
            c => c !== CONDITIONS.LEG_ATTACK_SECURED,
          );
        }
      }
      break;
    }
    case 'leg_attack_secured': {
      // Attacker has a leg -need to finish the takedown; defender must fight free
      s.chainActive = true;
      s.initiative = attacker;
      const atkConds = s[`${attacker}Conditions`] || [];
      if (!atkConds.includes(CONDITIONS.LEG_ATTACK_SECURED)) {
        s[`${attacker}Conditions`] = [...atkConds, CONDITIONS.LEG_ATTACK_SECURED];
      }
      const defConds = s[`${defender}Conditions`] || [];
      if (!defConds.includes(CONDITIONS.LEG_ATTACK_TRAPPED)) {
        s[`${defender}Conditions`] = [...defConds, CONDITIONS.LEG_ATTACK_TRAPPED];
      }
      const lak = attacker === 'p1' ? 'p1OnP2' : 'p2OnP1';
      s.pressure = { ...s.pressure, [lak]: Math.min(100, (s.pressure[lak] || 0) + 10) };
      break;
    }
    case 'scramble': {
      s.chainActive = true;
      s.initiative = attacker;
      // Neutral wrestler winning a scramble earns hand_fighting_control
      if (s[attacker].position === POSITIONS.NEUTRAL) {
        const scrConds = s[`${attacker}Conditions`] || [];
        if (!scrConds.includes(CONDITIONS.HAND_FIGHTING)) {
          s[`${attacker}Conditions`] = [...scrConds, CONDITIONS.HAND_FIGHTING];
        }
      }
      // Set SCRAMBLE condition on BOTH players -unlocks scramble-specific cards for one round
      if (s[attacker].position === POSITIONS.NEUTRAL && s[defender].position === POSITIONS.NEUTRAL) {
        const sConds1 = s[`${attacker}Conditions`] || [];
        if (!sConds1.includes(CONDITIONS.SCRAMBLE)) {
          s[`${attacker}Conditions`] = [...s[`${attacker}Conditions`], CONDITIONS.SCRAMBLE];
        }
        const sConds2 = s[`${defender}Conditions`] || [];
        if (!sConds2.includes(CONDITIONS.SCRAMBLE)) {
          s[`${defender}Conditions`] = [...s[`${defender}Conditions`], CONDITIONS.SCRAMBLE];
        }
      }
      break;
    }
    case 'stalemate': {
      s.initiative = attacker;
      const stalemateConds = s[`${attacker}Conditions`] || [];
      if (stalemateConds.includes(CONDITIONS.RECOVERING)) {
        s[`${attacker}Conditions`] = stalemateConds.filter(c => c !== CONDITIONS.RECOVERING);
        const pressKey = attacker === 'p1' ? 'p2OnP1' : 'p1OnP2';
        s.pressure = { ...s.pressure, [pressKey]: Math.max(0, (s.pressure[pressKey] || 0) - 20) };
      }
      // If bottom wrestler fought off a turn attempt, they earn good_base
      if (s[attacker].position === POSITIONS.BOTTOM) {
        const updatedConds = s[`${attacker}Conditions`] || [];
        if (!updatedConds.includes(CONDITIONS.GOOD_BASE)) {
          s[`${attacker}Conditions`] = [...updatedConds, CONDITIONS.GOOD_BASE];
        }
        // Also track bottom rounds for defensive resistance
        const newBottomRounds = (s[attacker].bottomRounds || 0) + 1;
        const newDefResist = newBottomRounds >= 2
          ? Math.max(s[attacker].defensiveResistance || 0, 1)
          : s[attacker].defensiveResistance || 0;
        s[attacker] = { ...s[attacker], bottomRounds: newBottomRounds, defensiveResistance: newDefResist };
      }
      s.chainActive = false;

      // Stalling referee calls -folkstyle uses neutralStaleCount, freestyle uses activityClock
      if (s.wrestlingStyle === 'folkstyle') {
        if (s.p1.position === POSITIONS.NEUTRAL && s.p2.position === POSITIONS.NEUTRAL) {
          s.neutralStaleCount = (s.neutralStaleCount || 0) + 1;
          if (s.neutralStaleCount === 3) {
            s.log = [...s.log, { round: s.roundNumber, entry: `⚠ Referee warns both wrestlers -activity required!`, type: 'stall_warning' }];
          } else if (s.neutralStaleCount >= 5) {
            // Penalty point awarded to initiative holder (the aggressive/active wrestler)
            const penalized = s.initiative === 'p1' ? 'p2' : 'p1'; // opponent of initiative = staller
            const initiativeHolder = s.initiative;
            s[initiativeHolder] = { ...s[initiativeHolder], score: s[initiativeHolder].score + 1 };
            s.log = [...s.log, { round: s.roundNumber, entry: `⚠ Stalling penalty! ${s[penalized].name} is passive - ${s[initiativeHolder].name} gets +1.`, type: 'stall_penalty' }];
            s.neutralStaleCount = 0;
          }
        }
      }
      // International stalling is handled by the activity clock in resolveRound
      break;
    }
    case 'setup': {
      s.initiative = attacker;
      s.chainActive = true;
      s[defender] = { ...s[defender], stamina: Math.max(0, s[defender].stamina - 3) };
      // Grant condition if the card specifies one (e.g. base_build → GOOD_BASE)
      if (result.setsCondition) {
        const sConds = s[`${attacker}Conditions`] || [];
        if (!sConds.includes(result.setsCondition)) {
          s[`${attacker}Conditions`] = [...sConds, result.setsCondition];
        }
        // When establishing a new neutral setup (TIE_UP), clear any prior conflicting conditions
        if (result.setsCondition === CONDITIONS.TIE_UP) {
          const clearConflicts = [CONDITIONS.LEG_ATTACK_SECURED, CONDITIONS.SCRAMBLE, CONDITIONS.REAR_STANDING];
          s[`${attacker}Conditions`] = s[`${attacker}Conditions`].filter(c => !clearConflicts.includes(c));
          s[`${defender}Conditions`] = s[`${defender}Conditions`].filter(
            c => c !== CONDITIONS.LEG_ATTACK_TRAPPED && c !== CONDITIONS.SCRAMBLE
          );
          // Both wrestlers are in the tie-up -defender also gets TIE_UP so they can peek_out
          const dConds = s[`${defender}Conditions`];
          if (!dConds.includes(CONDITIONS.TIE_UP)) {
            s[`${defender}Conditions`] = [...dConds, CONDITIONS.TIE_UP];
          }
        }
        // When going behind (REAR_STANDING), clear tie-up and leg attack states
        if (result.setsCondition === CONDITIONS.REAR_STANDING) {
          const clearConflicts = [CONDITIONS.TIE_UP, CONDITIONS.LEG_ATTACK_SECURED, CONDITIONS.SCRAMBLE];
          s[`${attacker}Conditions`] = s[`${attacker}Conditions`].filter(c => !clearConflicts.includes(c));
          s[`${defender}Conditions`] = s[`${defender}Conditions`].filter(
            c => c !== CONDITIONS.LEG_ATTACK_TRAPPED && c !== CONDITIONS.TIE_UP && c !== CONDITIONS.SCRAMBLE
          );
          s.chainActive = true;
          s.initiative = attacker;
        }
      }
      break;
    }
    case 'reset': {
      // Card played but had no scoring effect -exchange with no points
      // Still update initiative so the game progresses
      s.initiative = attacker;
      s.momentum = attacker;
      break;
    }
    default:
      break;
  }

  // Defensive phase validation -never return an invalid phase
  const validPhases = new Set(['playing', 'pin_attempt', 'period_break', 'overtime', 'finished']);
  if (!validPhases.has(s.phase)) {
    s.phase = 'playing';
  }

  return s;
}

// ─── End Condition Checks ──────────────────────────────────────────────────────

function checkEndConditions(state) {
  let s = { ...state };

  if (s.phase === 'finished') return s;
  if (s.phase === 'pin_attempt') return s; // wait for pin resolution

  if (s.winner) {
    s.phase = 'finished';
    return s;
  }

  // Tech fall threshold: 10 for international (freestyle/greco), 15 for folkstyle
  const techFallThreshold = isInternationalStyle(s.wrestlingStyle) ? 10 : 15;
  const lead = s.p1.score - s.p2.score;
  if (Math.abs(lead) >= techFallThreshold) {
    s.winner = lead > 0 ? 'p1' : 'p2';
    s.winMethod = 'tech_fall';
    s.phase = 'finished';
    const winnerName = s[s.winner].name;
    s.log = [...s.log, { round: s.roundNumber, entry: `TECHNICAL FALL - ${winnerName} wins!`, type: 'tech_fall' }];
    return s;
  }

  if (s.clock <= 0) {
    const maxPeriods = s.maxPeriods || 3;
    if (s.period < maxPeriods) {
      s.period += 1;
      s.clock = isInternationalStyle(s.wrestlingStyle) ? FREESTYLE_PERIOD_DURATION : PERIOD_DURATION;

      const endedPeriod = s.period - 1;
      const ordinal = endedPeriod === 1 ? '1st' : endedPeriod === 2 ? '2nd' : '3rd';
      const periodEndMsg = `End of ${ordinal} Period.`;

      if (isInternationalStyle(s.wrestlingStyle)) {
        // International (freestyle/greco): no period choice -auto-reset to neutral
        s.p1 = { ...s.p1, position: POSITIONS.NEUTRAL, pinDepth: 0, bottomRounds: 0, controlStreak: 0, rideTimeStreak: 0 };
        s.p2 = { ...s.p2, position: POSITIONS.NEUTRAL, pinDepth: 0, bottomRounds: 0, controlStreak: 0, rideTimeStreak: 0 };
        s.p1Conditions = [];
        s.p2Conditions = [];
        s.pressure = { p1OnP2: 0, p2OnP1: 0 };
        s.chainActive = false;
        s.boundary = false;
        s.turnHistory = { p1: {}, p2: {} };
        s.activityClock = 0;
        s.neutralStaleCount = 0;
        s.roundNumber += 1;
        const entry = `${periodEndMsg} Starting Period ${s.period}.`;
        s.log = [...s.log, { round: s.roundNumber, entry, type: 'period' }];
        s.lastResult = { type: 'period', message: entry };
      } else {
        // Folkstyle: period choice system
        s.phase = 'period_break';
        s.periodChoicePending = true;
        // Period 2: p1 gets first choice (can defer to p2)
        // Period 3: whoever DIDN'T end up choosing in period 2 gets the choice
        if (s.period === 2) {
          s.pendingChoiceFor = 'p1';
        } else {
          // period2Chooser is whoever actually made the choice in period 2 (after any defer)
          // The OTHER player gets period 3
          s.pendingChoiceFor = s.period2Chooser === 'p1' ? 'p2' : 'p1';
        }
        s.pressure = { p1OnP2: 0, p2OnP1: 0 };
        s.chainActive = false;
        s.boundary = false;
        s.turnHistory = { p1: {}, p2: {} };
        s.p1Conditions = s.p1Conditions.filter(c => c !== CONDITIONS.RECOVERING);
        s.p2Conditions = s.p2Conditions.filter(c => c !== CONDITIONS.RECOVERING);
        // Reset pin buildup and ride streak trackers at period break -fresh start
        s.p1 = { ...s.p1, pinDepth: 0, bottomRounds: 0, controlStreak: 0, rideTimeStreak: 0 };
        s.p2 = { ...s.p2, pinDepth: 0, bottomRounds: 0, controlStreak: 0, rideTimeStreak: 0 };
        s.neutralStaleCount = 0;
        // Bug 4 fix: period transition events use unique round numbers (roundNumber+1 for end, +2 for choice)
        // This prevents 3 log entries sharing the same round number as the last action
        s.roundNumber += 1;
        const entry = `${periodEndMsg} Starting Period ${s.period}.`;
        s.log = [...s.log, { round: s.roundNumber, entry, type: 'period' }];
        s.lastResult = { type: 'period', message: entry };
      }
    } else {
      // Final period ended
      const finalPeriod = s.period;
      const finalOrdinal = finalPeriod === 1 ? '1st' : finalPeriod === 2 ? '2nd' : '3rd';
      const tied = s.p1.score === s.p2.score;

      if (tied) {
        // Overtime: sudden victory -all styles
        s.phase = 'overtime';
        s.clock = isInternationalStyle(s.wrestlingStyle) ? 60 : 60; // 1 min sudden victory
        s.p1 = { ...s.p1, position: POSITIONS.NEUTRAL, pinDepth: 0, bottomRounds: 0, controlStreak: 0, rideTimeStreak: 0 };
        s.p2 = { ...s.p2, position: POSITIONS.NEUTRAL, pinDepth: 0, bottomRounds: 0, controlStreak: 0, rideTimeStreak: 0 };
        s.p1Conditions = [];
        s.p2Conditions = [];
        s.pressure = { p1OnP2: 0, p2OnP1: 0 };
        s.turnHistory = { p1: {}, p2: {} };
        s.activityClock = 0;
        s.chainActive = false;
        s.boundary = false;
        s.neutralStaleCount = 0;
        s.roundNumber += 1;
        const otMsg = `End of ${finalOrdinal} Period. Match tied! SUDDEN VICTORY -first to score wins!`;
        s.log = [...s.log, { round: s.roundNumber, entry: otMsg, type: 'overtime' }];
        s.lastResult = { type: 'overtime', message: otMsg };
      } else {
        // Not tied -match decided
        s.phase = 'finished';
        s.roundNumber += 1;
        if (s.p1.score > s.p2.score) {
          s.winner = 'p1'; s.winMethod = 'decision';
        } else {
          s.winner = 'p2'; s.winMethod = 'decision';
        }
        const decMsg = `End of ${finalOrdinal} Period. ${s[s.winner].name} wins by decision!`;
        s.log = [...s.log, { round: s.roundNumber, entry: decMsg, type: 'decision' }];
        s.lastResult = { type: 'decision', message: decMsg };
      }
    }
  }

  // Overtime clock expired without scoring -draw (extremely rare)
  if (s.phase === 'overtime' && s.clock <= 0 && !s.winner) {
    s.phase = 'finished';
    s.winner = 'draw';
    s.winMethod = 'draw';
    const drawMsg = 'Overtime expired -match ends in a draw.';
    s.log = [...s.log, { round: s.roundNumber, entry: drawMsg, type: 'draw' }];
    s.lastResult = { type: 'draw', message: drawMsg };
  }

  return s;
}

// ─── Period Choice ─────────────────────────────────────────────────────────────

export function applyPeriodChoice(state, chooser, choice) {
  // Reject if not actually in a period break, or no choice is pending,
  // or the chooser doesn't match the side we're waiting on. Drops stale /
  // replayed period_choice_made frames that would otherwise mutate an
  // active match (audit repair #2).
  if (!state || state.phase !== 'period_break') return state;
  if (!state.periodChoicePending) return state;
  if (state.pendingChoiceFor && state.pendingChoiceFor !== chooser) return state;
  if (chooser !== 'p1' && chooser !== 'p2') return state;

  const other = chooser === 'p1' ? 'p2' : 'p1';

  // Defer: route the choice to the opponent - only valid in period 2 for the initial
  // choice-holder (p1). Period 3 has no defer, and a deferred p2 cannot defer back.
  if (choice === 'defer') {
    if (state.period !== 2 || chooser !== 'p1') {
      // Invalid defer - treat as neutral to avoid a stuck state
      return applyPeriodChoice(state, chooser, 'neutral');
    }
    const s = { ...state, periodChoicePending: true, pendingChoiceFor: other };
    s.log = [...s.log, {
      round: s.roundNumber + 1,
      entry: `Period ${s.period} - ${state[chooser].name} defers. ${state[other].name} chooses.`,
      type: 'period',
    }];
    return s;
  }

  let s = { ...state, periodChoicePending: false, pendingChoiceFor: null, phase: 'playing' };

  // Track who actually made the choice in period 2 so period 3 goes to the other player
  if (s.period === 2) {
    s.period2Chooser = chooser;
  }

  if (choice === 'top') {
    s[chooser] = {
      ...s[chooser],
      position: POSITIONS.TOP,
      // Bug 3 fix: referee's position does NOT auto-grant control_established
      // Control must be earned by riding/turning, not just starting on top
      pinDepth: 0,
      bottomRounds: 0,
    };
    s[other] = {
      ...s[other],
      position: POSITIONS.BOTTOM,
      pinDepth: 0,
      bottomRounds: 0,
    };
    // No control_established -positions are clean at period start
    s[`${chooser}Conditions`] = [];
    s[`${other}Conditions`] = [];
    s.initiative = chooser;
    const pressKey = chooser === 'p1' ? 'p1OnP2' : 'p2OnP1';
    s.pressure = { p1OnP2: 0, p2OnP1: 0, [pressKey]: 10 };
  } else if (choice === 'bottom') {
    s[chooser] = {
      ...s[chooser],
      position: POSITIONS.BOTTOM,
      pinDepth: 0,
      bottomRounds: 0,
    };
    s[other] = {
      ...s[other],
      position: POSITIONS.TOP,
      pinDepth: 0,
      bottomRounds: 0,
    };
    // No control_established for top wrestler either -positions are clean at period start
    s[`${other}Conditions`] = [];
    s[`${chooser}Conditions`] = [];
    s.initiative = other;
    const pressKey = other === 'p1' ? 'p1OnP2' : 'p2OnP1';
    s.pressure = { p1OnP2: 0, p2OnP1: 0, [pressKey]: 10 };
  } else {
    s[chooser] = { ...s[chooser], position: POSITIONS.NEUTRAL, pinDepth: 0, bottomRounds: 0 };
    s[other] = { ...s[other], position: POSITIONS.NEUTRAL, pinDepth: 0, bottomRounds: 0 };
    s.p1Conditions = [];
    s.p2Conditions = [];
    s.pressure = { p1OnP2: 0, p2OnP1: 0 };
    s.initiative = chooser;
  }

  // Bug 4 fix: use roundNumber + 1 so period choice event gets a unique log entry number
  s.log = [...s.log, {
    round: s.roundNumber + 1,
    entry: `Period ${s.period} - ${s[chooser].name} chose ${choice}.`,
    type: 'period',
  }];
  return s;
}

// ─── AI Card Selection ─────────────────────────────────────────────────────────

// Per-archetype micro-mechanic skill roll for the CPU. Without this the AI
// would permanently MISS while the human pulls in PERFECTs, distorting the
// difficulty curve. Distributions match the intended skill ceiling per
// difficulty: easy CPU mostly whiffs, hard CPU lands PERFECT most of the
// time. Previous curve (10/30/60 vs 50/35/15) left easy feeling competent
// and hard feeling only mildly tougher - widened below so the ceiling
// actually separates.
export function getAISkillResult(difficulty = 'medium') {
  const r = Math.random();
  if (difficulty === 'easy') {
    if (r < 0.04) return { tier: 'PERFECT', ...SKILL_TIERS.PERFECT };
    if (r < 0.22) return { tier: 'GOOD', ...SKILL_TIERS.GOOD };
    return { tier: 'MISS', ...SKILL_TIERS.MISS };
  }
  if (difficulty === 'hard') {
    if (r < 0.70) return { tier: 'PERFECT', ...SKILL_TIERS.PERFECT };
    if (r < 0.95) return { tier: 'GOOD', ...SKILL_TIERS.GOOD };
    return { tier: 'MISS', ...SKILL_TIERS.MISS };
  }
  if (difficulty === 'expert') {
    // Reserved for top-of-state opponents - state finalists, #1-seeded rivals.
    // Only ~8 percentage points harder than 'hard' to keep the boost small;
    // we want elite opponents to feel real, not punishing.
    if (r < 0.78) return { tier: 'PERFECT', ...SKILL_TIERS.PERFECT };
    if (r < 0.97) return { tier: 'GOOD', ...SKILL_TIERS.GOOD };
    return { tier: 'MISS', ...SKILL_TIERS.MISS };
  }
  // medium (default) - keep close to parity against a skilled human.
  if (r < 0.28) return { tier: 'PERFECT', ...SKILL_TIERS.PERFECT };
  if (r < 0.68) return { tier: 'GOOD', ...SKILL_TIERS.GOOD };
  return { tier: 'MISS', ...SKILL_TIERS.MISS };
}

export function getAICard(state, aiPlayer, hand) {
  const ai = state[aiPlayer];
  const opp = aiPlayer === 'p1' ? state.p2 : state.p1;
  const aiConditions = state[`${aiPlayer}Conditions`] || [];
  const difficulty = state.aiDifficulty || 'medium';

  const valid = hand.filter(card => {
    if (card.position !== null && card.position !== ai.position) return false;
    if (card.setupRequired && card.setupRequired.length > 0) {
      return card.setupRequired.every(req => aiConditions.includes(req));
    }
    // Easy AI doesn't think about stamina efficiency
    const staminaBuffer = difficulty === 'easy' ? 15 : 5;
    return card.staminaCost <= ai.stamina + staminaBuffer;
  });

  const pool = valid.length > 0 ? valid : hand.slice(0, 3);

  const isIntl = isInternationalStyle(state.wrestlingStyle);
  const isGreco = state.wrestlingStyle === 'greco';

  // Difficulty-adjusted tecFactor: controls randomness in card selection
  // Easy = 1.3 (very random), Medium = 0.92+ (moderately random), Hard = 0.5 (precise)
  const baseTecFactor = ai.stats ? 1 - (ai.stats.tec / 400) : 1;
  const tecFactor = difficulty === 'easy' ? 1.3
    : difficulty === 'hard' ? Math.min(baseTecFactor, 0.5)
    : Math.max(baseTecFactor, 0.92);

  // Hard AI: analyze player tendencies from turnHistory
  let playerTopCategories = [];
  if (difficulty === 'hard') {
    const oppPlayer = aiPlayer === 'p1' ? 'p2' : 'p1';
    const history = state.turnHistory?.[oppPlayer] || {};
    const categoryCounts = {};
    for (const [cardId, count] of Object.entries(history)) {
      const cat = cardId.includes('takedown') || cardId.includes('shot') ? 'takedown'
        : cardId.includes('escape') || cardId.includes('stand') ? 'escape'
        : cardId.includes('turn') || cardId.includes('tilt') ? 'turn'
        : 'other';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + count;
    }
    playerTopCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(e => e[0]);
  }

  // AI style variance: randomize move-type bonuses per match to reduce predictability
  // Each AI gets a random "personality" generated once and stored on state
  if (!state._aiStyleBonuses) {
    state._aiStyleBonuses = {
      near_fall: 12 + Math.floor(Math.random() * 12),   // 12-23
      takedown:  12 + Math.floor(Math.random() * 12),    // 12-23
      reversal:  8 + Math.floor(Math.random() * 10),     // 8-17
      escape:    6 + Math.floor(Math.random() * 10),      // 6-15
    };
  }
  const styleBonuses = state._aiStyleBonuses;

  const scored = pool.map(card => {
    let score = card.basePower + Math.random() * 20 * tecFactor;
    const se = card.scoreEffect;
    if (se) {
      // Easy AI ignores strategic scoring; Medium gets partial; Hard gets full
      const strategyMult = difficulty === 'easy' ? 0 : difficulty === 'medium' ? 0.7 : 1;
      if (se.type === 'near_fall') score += styleBonuses.near_fall * strategyMult;
      else if (se.type === 'takedown') score += styleBonuses.takedown * strategyMult;
      else if (se.type === 'reversal') score += styleBonuses.reversal * strategyMult;
      else if (se.type === 'escape') score += styleBonuses.escape * strategyMult;
      else if (se.type === 'control' && se.setsCondition === 'front_headlock_control') score += 14 * strategyMult;
      // International-style AI priorities (freestyle + greco + women's freestyle)
      if (isIntl) {
        if (se.type === 'grand_amplitude') {
          score += (20 + (ai.stamina - opp.stamina > 30 ? 15 : 0)) * strategyMult;
        }
        if (se.type === 'exposure') score += 16 * strategyMult;
        if (!isGreco && (card.id === 're_shot_from_bottom' || card.id === 'roll_through_attack')) score += 14 * strategyMult;
      }
      // Women's-mode-specific AI priorities. Women's wrestling features
      // more par-terre exposure scoring than men's freestyle (per the
      // 2024 European Championships data: 28.6% gut wrench, ~3.6% leg
      // lace - the gut-wrench-to-leg-lace combo is the signature). The
      // bonuses below are additive on top of the international bonuses
      // above, so the women's AI weights its signature plays harder
      // than a men's freestyle AI of equivalent difficulty.
      if (isWomensStyle(state.wrestlingStyle)) {
        if (card.id === 'gut_wrench_to_leg_lace') score += 25 * strategyMult;
        if (card.id === 'russian_tie') score += 10 * strategyMult;
        if (card.id === 'ankle_pick') score += 15 * strategyMult;
        if (card.id === 'bridge_and_turn' || card.id === 'belly_down_defense') {
          score += 12 * strategyMult;
        }
      }
      // Greco-specific AI: pummel for inside position, then throw
      if (isGreco) {
        if (se.setsCondition === 'inside_position') score += 16 * strategyMult;
        if (card.id === 'reverse_lift') score += 18 * strategyMult;
        if (card.id === 'arm_drag_to_gut_wrench') score += 14 * strategyMult;
      }
    }
    // Easy AI ignores chain/setup/condition bonuses entirely
    if (difficulty !== 'easy') {
      if (FHL_BRANCH_IDS.has(card.id)) score += 20;
      if (LEG_FINISH_IDS.has(card.id) && aiConditions.includes(CONDITIONS.LEG_ATTACK_SECURED)) score += 18;
      if (SCRAMBLE_CARD_IDS.has(card.id) && aiConditions.includes(CONDITIONS.SCRAMBLE)) score += 12;
      if (TIE_UP_FOLLOW_IDS.has(card.id) && aiConditions.includes(CONDITIONS.TIE_UP)) score += 15;
      if ((card.id === 'collar_tie' || card.id === 'underhook_control')
          && !aiConditions.includes(CONDITIONS.HAND_FIGHTING)
          && !aiConditions.includes(CONDITIONS.TIE_UP)
          && !aiConditions.includes(CONDITIONS.INSIDE_POSITION)) {
        score += 14;
      }
    }
    if (PIN_ELIGIBLE_CARDS.has(card.id)) score += difficulty === 'hard' ? 15 : difficulty === 'medium' ? 8 : 5;
    if (GRAND_AMPLITUDE_CARDS.has(card.id)) score += 12;
    // Stamina management: Easy ignores it, Hard is more conservative
    const staminaThreshold = difficulty === 'hard' ? 60 : 40;
    if (difficulty !== 'easy' && ai.stamina < staminaThreshold) {
      score -= card.staminaCost * (difficulty === 'hard' ? 0.6 : 0.4);
    }
    // Stat-based card preference bonuses
    if (ai.stats && se) {
      if (['takedown', 'near_fall', 'grand_amplitude'].includes(se.type))
        score += (ai.stats.str - 50) / 10;
      if (['counter', 'escape', 'reversal'].includes(se.type))
        score += (ai.stats.spd - 50) / 10;
      if (['setup', 'control'].includes(se.type))
        score += (ai.stats.tec - 50) / 10;
      if (['escape', 'reversal'].includes(se.type) && ai.position === POSITIONS.BOTTOM)
        score += (ai.stats.grt - 50) / 8;
    }
    // Hard AI: bonus for countering player tendencies
    if (difficulty === 'hard' && se && card.strongAgainst) {
      const countersCat = card.strongAgainst.includes('takedown') ? 'takedown'
        : card.strongAgainst.includes('escape') ? 'escape'
        : card.strongAgainst.includes('turn') ? 'turn' : null;
      if (countersCat && playerTopCategories.includes(countersCat)) {
        score += 5;
      }
    }
    // Stalling-avoidance bias: when this AI already has 2 stalling warnings,
    // a 3rd hands the opponent a free point. Push offensive categories and
    // dampen `neutral_counter` / defensive so the AI breaks the stall.
    const stallCount = state.stallCount?.[aiPlayer] || 0;
    if (stallCount >= 2) {
      const cat = card.category;
      if (cat === 'neutral_attack' || cat === 'transition' || cat === 'throw') {
        score *= 1.5;
      } else if (cat === 'neutral_counter' || cat === 'defensive') {
        score *= 0.6;
      }
    }
    return { card, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.card || hand[0];
}

// ─── Push Pace ─────────────────────────────────────────────────────────────────

export function applyPushPace(state, player) {
  let s = { ...state };
  const opponent = player === 'p1' ? 'p2' : 'p1';
  s.initiative = player;
  s[player] = { ...s[player], stamina: Math.max(0, s[player].stamina - 5) };
  s[opponent] = { ...s[opponent], stamina: Math.max(0, s[opponent].stamina - 3) };
  s.momentum = player;
  s.chainActive = true;
  const entry = `${s[player].name} pushes the pace -initiative gained!`;
  s.log = [...s.log, { round: s.roundNumber, entry, type: 'setup' }];
  s.lastResult = { type: 'setup', message: entry };
  s.clock = Math.max(0, s.clock - 5);
  return checkEndConditions(s);
}

// ─── Cut Opponent (voluntary release from top) ───────────────────────────────

export function applyCutOpponent(state, topPlayer) {
  let s = { ...state };
  const bottomPlayer = topPlayer === 'p1' ? 'p2' : 'p1';
  const scores = getScores(s.wrestlingStyle);

  // Bottom wrestler gets escape point
  s[bottomPlayer] = {
    ...s[bottomPlayer],
    score: s[bottomPlayer].score + scores.ESCAPE,
    escapeCount: (s[bottomPlayer].escapeCount || 0) + 1,
    position: POSITIONS.NEUTRAL,
    pinDepth: 0,
    bottomRounds: 0,
  };

  // Top wrestler returns to neutral
  s[topPlayer] = {
    ...s[topPlayer],
    position: POSITIONS.NEUTRAL,
    rideTimeStreak: 0,
    controlStreak: 0,
  };

  // Reset position-dependent state
  s.pressure = { p1OnP2: 0, p2OnP1: 0 };
  s.p1Conditions = [];
  s.p2Conditions = [];
  s.chainActive = false;
  s.turnHistory = { p1: {}, p2: {} };

  const entry = `${s[topPlayer].name} cuts ${s[bottomPlayer].name} loose \u2014 escape! +${scores.ESCAPE} pt`;
  s.log = [...s.log, { round: s.roundNumber, entry, type: 'escape' }];
  s.lastResult = { type: 'escape', message: entry };

  return checkEndConditions(s);
}

// ─── AI Period Choice ──────────────────────────────────────────────────────────

export function getAIPeriodChoice(state, aiPlayer = 'p2') {
  // International styles: no period choice -always neutral (safety fallback)
  if (isInternationalStyle(state.wrestlingStyle)) return 'neutral';

  const ai = state?.[aiPlayer];
  const opp = aiPlayer === 'p2' ? state?.p1 : state?.p2;
  const lead = (ai?.score ?? 0) - (opp?.score ?? 0);
  const difficulty = state.aiDifficulty || 'medium';

  // Defer is only valid in period 2 when the AI is the initial choice-holder (p1).
  // Period 3 has no defer. If AI is the deferred-to player in period 2, no defer either.
  const canDefer = state.period === 2 && state.pendingChoiceFor === aiPlayer && aiPlayer === 'p1';

  // Easy AI: purely random period choice
  if (difficulty === 'easy') {
    const r = Math.random();
    if (r < 0.33) return 'top';
    if (r < 0.66) return 'bottom';
    return 'neutral';
  }

  // Hard AI: strategic period selection
  if (difficulty === 'hard') {
    // Defer when winning to run clock and force opponent's hand
    if (canDefer && lead >= 2 && Math.random() < 0.6) return 'defer';
    // Behind? Pick top for near-fall chances
    if (lead < 0) return Math.random() < 0.7 ? 'top' : 'neutral';
    // Ahead but close: top for riding time / control
    if (canDefer && lead > 0 && Math.random() < 0.6) return 'defer';
    if (lead > 0) return 'top';
    // Tied: balanced but slightly favor top
    const r = Math.random();
    if (r < 0.45) return 'top';
    if (r < 0.75) return 'bottom';
    return 'neutral';
  }

  // Medium AI: current behavior
  if (canDefer && lead >= 4 && Math.random() < 0.4) return 'defer';

  const r = Math.random();
  if (r < 0.5) return 'top';
  if (r < 0.8) return 'bottom';
  return 'neutral';
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export { getAvailableCards, isInternationalStyle };
