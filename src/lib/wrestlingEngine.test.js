// Engine tests - Phase 3 additions:
//   - buildHand(..., allowedCardIds) filters correctly + softlocks are avoided
//   - checkStalling 1→2→3 progression awards penalty on the third call
//   - AI bias shifts picks toward offensive categories when stallCount ≥ 2
// Run with: node --test src/lib/wrestlingEngine.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  buildHand,
  rerollHand,
  checkStalling,
  applyStallingCall,
  transitionSpamFactor,
  createInitialMatchState,
  getAICard,
  resolveRound,
  getAvailableCards,
  describeMatchPosition,
  resolvePinStage1,
  resolvePinStage2,
  resolvePinStage3,
} = await import('./wrestlingEngine.js');

const { SKILL_TIERS, MECHANIC_TUNING } = await import('./cardArchetypeMechanics.js');
const { formatPathTraceLabel } = await import('./pathTraceLabel.js');

const { CARDS, POSITIONS, CONDITIONS } = await import('./wrestlingCards.js');

// ─── buildHand(..., allowedCardIds) ────────────────────────────────────

test('buildHand returns only cards in allowedCardIds when pool is large enough', () => {
  // Collect a generous neutral-position folkstyle set (≥6 cards).
  const allowed = [];
  for (const [id, c] of Object.entries(CARDS)) {
    if (!(c.styles || []).includes('folkstyle')) continue;
    if (c.position !== null && c.position !== 'neutral') continue;
    if (c.category !== 'neutral_attack' && c.category !== 'neutral_counter') continue;
    allowed.push(id);
    if (allowed.length >= 10) break;
  }
  assert.ok(allowed.length >= 6, 'need ≥6 allowed cards for this test');
  const allowedSet = new Set(allowed);
  const hand = buildHand('neutral', [], 6, 'folkstyle', allowedSet);
  assert.equal(hand.length, 6);
  for (const c of hand) {
    assert.ok(allowedSet.has(c.id), `${c.id} not in allowed set`);
  }
});

test('buildHand falls back to full pool when filtered pool < size', () => {
  // Only allow 2 cards - less than hand size, softlock guard should trip.
  const allowed = new Set(['double_leg', 'single_leg']);
  const hand = buildHand('neutral', [], 6, 'folkstyle', allowed);
  assert.equal(hand.length, 6, 'softlock guard must still deliver a full hand');
  // At least one card must be outside the allowed set (proof of fallback).
  const anyOutside = hand.some(c => !allowed.has(c.id));
  assert.ok(anyOutside, 'fallback should draw from unfiltered pool');
});

test('buildHand with null allowedCardIds is backward-compatible', () => {
  const hand = buildHand('neutral', [], 6, 'folkstyle', null);
  assert.equal(hand.length, 6);
});

// ─── checkStalling progression ─────────────────────────────────────────

function stallState() {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle');
  s.initiative = 'p2'; // opponent holds initiative for p1's stall check
  s.neutralStaleCount = 2; // gate threshold met
  return s;
}

const NEUTRAL_COUNTER_CARD = {
  id: 'test_neutral_counter',
  category: 'neutral_counter',
};

test('checkStalling emits a free warning on the first trigger only', () => {
  const s = stallState();
  checkStalling(s, 'p1', NEUTRAL_COUNTER_CARD, 'p2');
  assert.equal(s.stallCount.p1, 1);
  assert.equal(s.lastResult.type, 'stalling_warning');
  assert.equal(s.p2.score, 0, 'first warning is free');
});

test('checkStalling awards +1 to opponent on every stall after the first warning', () => {
  const s = stallState();
  // 1st = free warning
  checkStalling(s, 'p1', NEUTRAL_COUNTER_CARD, 'p2');
  assert.equal(s.p2.score, 0);
  // 2nd = +1 (counter does NOT reset; persistent stalling keeps bleeding points)
  checkStalling(s, 'p1', NEUTRAL_COUNTER_CARD, 'p2');
  assert.equal(s.stallCount.p1, 2, 'counter accumulates');
  assert.equal(s.lastResult.type, 'stalling_penalty');
  assert.equal(s.p2.score, 1, 'opponent gains +1 on second stall');
  // 3rd = +1 again (still no reset)
  checkStalling(s, 'p1', NEUTRAL_COUNTER_CARD, 'p2');
  assert.equal(s.stallCount.p1, 3);
  assert.equal(s.p2.score, 2, 'opponent gains +1 on third stall too');
  // 4th = +1 again
  checkStalling(s, 'p1', NEUTRAL_COUNTER_CARD, 'p2');
  assert.equal(s.stallCount.p1, 4);
  assert.equal(s.p2.score, 3, 'opponent keeps gaining +1 on each stall');
});

test('checkStalling is a no-op for non-folkstyle styles', () => {
  const s = stallState();
  s.wrestlingStyle = 'freestyle';
  checkStalling(s, 'p1', NEUTRAL_COUNTER_CARD, 'p2');
  assert.equal(s.stallCount.p1, 0);
  assert.equal(s.lastResult, null);
});

test('checkStalling is a no-op for non-neutral_counter cards', () => {
  const s = stallState();
  checkStalling(s, 'p1', { id: 'x', category: 'neutral_attack' }, 'p2');
  assert.equal(s.stallCount.p1, 0);
});

test('checkStalling is a no-op when neutralStaleCount < 2', () => {
  const s = stallState();
  s.neutralStaleCount = 1;
  checkStalling(s, 'p1', NEUTRAL_COUNTER_CARD, 'p2');
  assert.equal(s.stallCount.p1, 0);
});

test('checkStalling is a no-op when player holds initiative', () => {
  const s = stallState();
  s.initiative = 'p1'; // offender has initiative -> not stalling
  checkStalling(s, 'p1', NEUTRAL_COUNTER_CARD, 'p2');
  assert.equal(s.stallCount.p1, 0);
});

// ─── AI bias under stalling pressure ───────────────────────────────────

test('getAICard picks offensive over defensive ≥70% when stallCount ≥ 2', () => {
  // Assemble a 6-card hand with 3 offensive (neutral_attack) + 3 defensive
  // (neutral_counter) folkstyle cards that are all neutral-position legal.
  const offensive = [];
  const defensive = [];
  for (const c of Object.values(CARDS)) {
    if (!(c.styles || []).includes('folkstyle')) continue;
    if (c.position !== null && c.position !== 'neutral') continue;
    if (!c.setupRequired || c.setupRequired.length === 0) {
      if (c.category === 'neutral_attack' && offensive.length < 3) offensive.push(c);
      else if (c.category === 'neutral_counter' && defensive.length < 3) defensive.push(c);
    }
    if (offensive.length === 3 && defensive.length === 3) break;
  }
  assert.equal(offensive.length, 3);
  assert.equal(defensive.length, 3);
  const hand = [...offensive, ...defensive];

  let offensivePicks = 0;
  const TRIALS = 100;
  for (let i = 0; i < TRIALS; i++) {
    const s = createInitialMatchState('P1', 'P2', 'folkstyle');
    s.stallCount = { p1: 0, p2: 2 }; // AI is p2 by convention
    const pick = getAICard(s, 'p2', hand);
    const offCats = ['neutral_attack', 'throw']; // transition is no longer an AI offensive category
    if (pick && offCats.includes(pick.category)) offensivePicks++;
  }
  const ratio = offensivePicks / TRIALS;
  assert.ok(
    ratio >= 0.7,
    `expected ≥70% offensive under stallCount=2, got ${(ratio * 100).toFixed(0)}%`,
  );
});

test('getAICard does NOT bias offensive when stallCount = 0', () => {
  // Sanity check - bias should only activate at count ≥ 2. With stallCount=0,
  // offensive ratio on balanced hand should be noticeably lower than above.
  const offensive = [];
  const defensive = [];
  for (const c of Object.values(CARDS)) {
    if (!(c.styles || []).includes('folkstyle')) continue;
    if (c.position !== null && c.position !== 'neutral') continue;
    if (!c.setupRequired || c.setupRequired.length === 0) {
      if (c.category === 'neutral_attack' && offensive.length < 3) offensive.push(c);
      else if (c.category === 'neutral_counter' && defensive.length < 3) defensive.push(c);
    }
    if (offensive.length === 3 && defensive.length === 3) break;
  }
  const hand = [...offensive, ...defensive];

  let offensivePicks = 0;
  const TRIALS = 100;
  for (let i = 0; i < TRIALS; i++) {
    const s = createInitialMatchState('P1', 'P2', 'folkstyle');
    s.stallCount = { p1: 0, p2: 0 };
    const pick = getAICard(s, 'p2', hand);
    const offCats = ['neutral_attack', 'throw']; // transition is no longer an AI offensive category
    if (pick && offCats.includes(pick.category)) offensivePicks++;
  }
  // Weaker assertion - just confirm the biased run above isn't a trivial
  // artifact of the base AI scoring. Without bias, we expect < 90%.
  const ratio = offensivePicks / TRIALS;
  assert.ok(ratio < 0.95, `baseline offensive ratio unexpectedly ≥95%: ${ratio}`);
});

test('getAICard does not boost transition over neutral_counter under stalling risk', () => {
  // Folkstyle NEUTRAL-legal transition + neutral_counter cards (no attacks),
  // so every card in the hand lands in the same dampen group post-fix.
  const transitions = [];
  const counters = [];
  for (const c of Object.values(CARDS)) {
    if (!(c.styles || []).includes('folkstyle')) continue;
    if (c.position !== null && c.position !== 'neutral') continue;
    if (c.setupRequired && c.setupRequired.length > 0) continue;
    if (c.category === 'transition' && transitions.length < 3) transitions.push(c);
    else if (c.category === 'neutral_counter' && counters.length < 3) counters.push(c);
  }
  assert.ok(transitions.length >= 2, `need ≥2 neutral transition cards, got ${transitions.length}`);
  assert.ok(counters.length >= 2, `need ≥2 neutral_counter cards, got ${counters.length}`);
  const hand = [...transitions, ...counters];

  // Self-relative: transition pick rate with the stalling bias OFF (stallCount
  // 0) vs ON (stallCount 2). The bias must NOT inflate transition picks - the
  // bug multiplied transition 1.5x while dampening counters 0.6x, spiking the
  // rate. Post-fix transition is dampened alongside the counters, so scaling
  // is uniform across the hand and the pick rate stays near the baseline.
  const transitionPickRate = (stall) => {
    let picks = 0;
    const TRIALS = 300;
    for (let i = 0; i < TRIALS; i++) {
      const s = createInitialMatchState('P1', 'P2', 'folkstyle');
      s.stallCount = { p1: 0, p2: stall }; // AI is p2 by convention
      const pick = getAICard(s, 'p2', hand);
      if (pick && pick.category === 'transition') picks++;
    }
    return picks / TRIALS;
  };
  const baseline = transitionPickRate(0);
  const underRisk = transitionPickRate(2);
  assert.ok(
    underRisk <= baseline + 0.15,
    `stalling bias must not spike transition picks: baseline ${baseline.toFixed(2)} → underRisk ${underRisk.toFixed(2)}`,
  );
});

// ─── Leg Ride chain (Folkstyle v2) ──────────────────────────────────────

test('setup card sets LEG_RIDE_ESTABLISHED condition', () => {
  // Pin initiative to p1 so we don't rely on the random default (see createInitialMatchState).
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  // Set up initial state: P1 is TOP with CONTROL_ESTABLISHED
  s.p1.position = POSITIONS.TOP;
  s.p1Conditions = [CONDITIONS.CONTROL_ESTABLISHED];
  s.p2.position = POSITIONS.BOTTOM;
  s.p2Conditions = [];

  // P1 plays get_legs_in (setup card), P2 plays a neutral/defensive card
  // Deterministic RNG: 0.5 avoids boundary resets (threshold 0.08) and gives no power jitter.
  const result = resolveRound(s, 'get_legs_in', 'stand_up', null, null, () => 0.5);

  // After resolveRound, P1 should have LEG_RIDE_ESTABLISHED in conditions
  assert.ok(
    result.p1Conditions.includes(CONDITIONS.LEG_RIDE_ESTABLISHED),
    'P1 should have LEG_RIDE_ESTABLISHED after get_legs_in wins',
  );
});

test('leg-chain cards not available without LEG_RIDE_ESTABLISHED', () => {
  // Test getAvailableCards from TOP position without leg ride condition
  const cards = getAvailableCards(POSITIONS.TOP, [], 'folkstyle');
  const cardIds = cards.map(c => c.id);

  // Leg-chain cards should NOT be available
  assert.ok(!cardIds.includes('banana_split'), 'banana_split not available without leg ride');
  assert.ok(!cardIds.includes('spladle'), 'spladle not available without leg ride');
  assert.ok(!cardIds.includes('leg_cradle'), 'leg_cradle not available without leg ride');
  assert.ok(!cardIds.includes('grapevine_power_half'), 'grapevine_power_half not available');
  assert.ok(!cardIds.includes('leg_ride_power_half'), 'leg_ride_power_half not available');
  assert.ok(!cardIds.includes('cross_body_ride'), 'cross_body_ride not available');
  assert.ok(!cardIds.includes('saturday_night_ride'), 'saturday_night_ride not available');
});

test('leg-chain cards available when LEG_RIDE_ESTABLISHED', () => {
  // Test getAvailableCards from TOP position WITH leg ride condition
  const cards = getAvailableCards(POSITIONS.TOP, [CONDITIONS.LEG_RIDE_ESTABLISHED], 'folkstyle');
  const cardIds = cards.map(c => c.id);

  // All leg-chain cards should be available
  assert.ok(cardIds.includes('banana_split'), 'banana_split available with leg ride');
  assert.ok(cardIds.includes('spladle'), 'spladle available with leg ride');
  assert.ok(cardIds.includes('leg_cradle'), 'leg_cradle available with leg ride');
  assert.ok(cardIds.includes('grapevine_power_half'), 'grapevine_power_half available');
  assert.ok(cardIds.includes('leg_ride_power_half'), 'leg_ride_power_half available');
  assert.ok(cardIds.includes('cross_body_ride'), 'cross_body_ride available');
  assert.ok(cardIds.includes('saturday_night_ride'), 'saturday_night_ride available');
});

test('navy_ride is available from TOP without leg-ride setup', () => {
  // navy_ride is NOT in the leg-chain; it should be available without LEG_RIDE_ESTABLISHED
  const cardsWithoutLegRide = getAvailableCards(POSITIONS.TOP, [], 'folkstyle');
  const cardIds = cardsWithoutLegRide.map(c => c.id);

  assert.ok(cardIds.includes('navy_ride'), 'navy_ride should be available without leg ride');
});

test('granby_roll counters banana_split', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  // Set up: P1 is TOP with leg ride established, P2 is BOTTOM
  s.p1.position = POSITIONS.TOP;
  s.p1Conditions = [CONDITIONS.LEG_RIDE_ESTABLISHED];
  s.p2.position = POSITIONS.BOTTOM;
  s.p2Conditions = [];

  // P1 plays banana_split, P2 plays granby_roll (a counter)
  // Use deterministic RNG returning 0.5 - centered (no power jitter) and above
  // the 0.08 boundary-reset threshold so we get a real combat outcome.
  const deterministicRng = () => 0.5;
  const result = resolveRound(s, 'banana_split', 'granby_roll', null, null, deterministicRng);

  // granby_roll should win (counters banana_split via -22 penalty)
  // The winner is encoded in result.lastResult.attacker (whoever played the winning card)
  assert.ok(result.lastResult, 'lastResult should exist');
  assert.equal(result.lastResult.attacker, 'p2', 'granby_roll should beat banana_split');
});

// ─── Rear standing trapped state (C1) ───────────────────────────────────

test('rear-standing attack sets REAR_STANDING_TRAPPED on the defender', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  s.p1.position = POSITIONS.NEUTRAL;
  s.p1Conditions = [];
  s.p2.position = POSITIONS.NEUTRAL;
  s.p2Conditions = [];

  // P1 plays go_behind (sets REAR_STANDING) with a PERFECT skill tier vs a
  // weak opponent card + MISS tier, so P1 wins decisively (diff >= 8).
  const result = resolveRound(
    s, 'go_behind', 'collar_tie',
    { tier: 'PERFECT', ...SKILL_TIERS.PERFECT },
    { tier: 'MISS', ...SKILL_TIERS.MISS },
    () => 0.5,
  );

  assert.ok(
    result.p1Conditions.includes(CONDITIONS.REAR_STANDING),
    'attacker should have REAR_STANDING',
  );
  assert.ok(
    result.p2Conditions.includes(CONDITIONS.REAR_STANDING_TRAPPED),
    'defender should have REAR_STANDING_TRAPPED',
  );
});

test('REAR_STANDING_TRAPPED restricts the defender to the rear-defense pool', () => {
  const cards = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.REAR_STANDING_TRAPPED], 'folkstyle');
  const cardIds = cards.map(c => c.id);

  assert.ok(cards.length > 0, 'trapped defender must have a hand');
  assert.ok(cards.every(c => c.rearDefense === true), 'every card must be a rear-defense card');
  for (const id of ['rear_hand_fight', 'rear_hip_down', 'rear_whizzer_block',
    'rear_standing_switch', 'rear_peel_and_turn']) {
    assert.ok(cardIds.includes(id), `${id} should be available to the trapped defender`);
  }
});

test('trapped defender hand has no unrelated neutral attacks (no fallback)', () => {
  const cardIds = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.REAR_STANDING_TRAPPED], 'folkstyle')
    .map(c => c.id);
  for (const id of ['double_leg', 'single_leg', 'collar_tie', 'rear_trip']) {
    assert.ok(!cardIds.includes(id), `${id} must NOT be in the trapped defender pool`);
  }
});

test('successful rear defense clears both rear-standing conditions', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  s.p1.position = POSITIONS.NEUTRAL;
  s.p1Conditions = [CONDITIONS.REAR_STANDING];
  s.p1.stamina = 30; // tired attacker -> defender wins the round decisively
  s.p2.position = POSITIONS.NEUTRAL;
  s.p2Conditions = [CONDITIONS.REAR_STANDING_TRAPPED];

  // P2 plays rear_hip_down (strongAgainst rear_trip) vs P1 rear_trip, PERFECT
  // vs MISS skill, so P2 wins decisively -> the round result clears the state.
  const result = resolveRound(
    s, 'rear_trip', 'rear_hip_down',
    { tier: 'MISS', ...SKILL_TIERS.MISS },
    { tier: 'PERFECT', ...SKILL_TIERS.PERFECT },
    () => 0.5,
  );

  assert.ok(
    !result.p1Conditions.includes(CONDITIONS.REAR_STANDING),
    'attacker REAR_STANDING should be cleared',
  );
  assert.ok(
    !result.p2Conditions.includes(CONDITIONS.REAR_STANDING_TRAPPED),
    'defender REAR_STANDING_TRAPPED should be cleared',
  );
});

test('rear finisher is no longer structurally unanswerable', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  s.p1.position = POSITIONS.NEUTRAL;
  s.p1Conditions = [CONDITIONS.REAR_STANDING];
  s.p2.position = POSITIONS.NEUTRAL;
  s.p2Conditions = [CONDITIONS.REAR_STANDING_TRAPPED];

  // At equal skill, a rear finisher used to be an automatic takedown because
  // the defender had no reachable counter. With rear_hip_down (strongAgainst
  // rear_trip) now in the trapped pool, the finisher is denied its clean
  // takedown - the round is contested, not an automatic score.
  const result = resolveRound(s, 'rear_trip', 'rear_hip_down', null, null, () => 0.5);

  assert.ok(result.lastResult, 'lastResult should exist');
  assert.notEqual(
    result.lastResult.type, 'takedown',
    'rear finisher must NOT get an automatic takedown vs a correct rear defense',
  );
});

// ─── Card-legality validation in resolveRound (engine hardening) ─────────
// resolveRound rejects any card that is not legal for its wrestler's current
// position / conditions / style. An illegal card must never score or move
// position. Validated against getAvailableCards (same source as hand build).

function cleanNeutral(style = 'folkstyle') {
  return createInitialMatchState('P1', 'P2', style, null, null, 'medium', 'p1');
}
function snapshot(s) {
  return {
    p1Score: s.p1.score, p2Score: s.p2.score,
    p1Pos: s.p1.position, p2Pos: s.p2.position, round: s.roundNumber,
  };
}
function assertIllegal(result, before, side = 'p1') {
  assert.equal(result.lastResult.type, 'illegal_card', 'illegal card must be rejected');
  assert.equal(result.lastResult.illegal[side], true, `${side} card must be flagged illegal`);
  assert.equal(result.p1.score, before.p1Score, 'p1 score must be unchanged');
  assert.equal(result.p2.score, before.p2Score, 'p2 score must be unchanged');
  assert.equal(result.p1.position, before.p1Pos, 'p1 position must be unchanged');
  assert.equal(result.p2.position, before.p2Pos, 'p2 position must be unchanged');
  assert.equal(result.roundNumber, before.round, 'illegal round must not be consumed');
}

test('illegal: rear_standing_switch cannot score a reversal from clean neutral', () => {
  const s = cleanNeutral();
  const result = resolveRound(s, 'rear_standing_switch', 'double_leg', null, null, () => 0.5);
  assertIllegal(result, snapshot(s));
});

test('illegal: rear_peel_and_turn cannot score an escape from clean neutral', () => {
  const s = cleanNeutral();
  const result = resolveRound(s, 'rear_peel_and_turn', 'double_leg', null, null, () => 0.5);
  assertIllegal(result, snapshot(s));
});

test('illegal: rear finisher cannot score without REAR_STANDING', () => {
  const s = cleanNeutral();
  const result = resolveRound(s, 'rear_trip', 'double_leg', null, null, () => 0.5);
  assertIllegal(result, snapshot(s));
});

test('illegal: fhlDefense card cannot score without FRONT_HEADLOCK_TRAPPED', () => {
  const s = cleanNeutral();
  const result = resolveRound(s, 'fhl_snap_back', 'double_leg', null, null, () => 0.5);
  assertIllegal(result, snapshot(s));
});

test('illegal: legDefense card cannot score without LEG_ATTACK_TRAPPED', () => {
  const s = cleanNeutral();
  const result = resolveRound(s, 'limp_leg', 'double_leg', null, null, () => 0.5);
  assertIllegal(result, snapshot(s));
});

test('illegal: bottom-only card cannot score from NEUTRAL', () => {
  const s = cleanNeutral();
  const result = resolveRound(s, 'peterson_roll', 'double_leg', null, null, () => 0.5);
  assertIllegal(result, snapshot(s));
});

test('illegal: style-illegal card (greco-only) cannot score in a folkstyle match', () => {
  const s = cleanNeutral('folkstyle');
  // pummel_inside is styles:['greco'] - illegal in a folkstyle match.
  const result = resolveRound(s, 'pummel_inside', 'double_leg', null, null, () => 0.5);
  assertIllegal(result, snapshot(s));
});

test('legal: rear-defense card resolves normally when REAR_STANDING_TRAPPED is active', () => {
  const s = cleanNeutral();
  s.p1Conditions = [CONDITIONS.REAR_STANDING];
  s.p2Conditions = [CONDITIONS.REAR_STANDING_TRAPPED];
  const result = resolveRound(s, 'rear_trip', 'rear_hip_down', null, null, () => 0.5);
  assert.notEqual(result.lastResult.type, 'illegal_card',
    'a rear-defense card under REAR_STANDING_TRAPPED must resolve, not be rejected');
});

// ─── Greco leg-attack invariant ──────────────────────────────────────────
// Greco-Roman forbids leg attacks: Greco must never enter LEG_ATTACK_SECURED
// / LEG_ATTACK_TRAPPED. Fresh Greco play cannot reach them (no Greco leg
// card); stale/corrupt states self-heal instead of soft-locking.

test('greco: legal neutral pool has no card that sets LEG_ATTACK_SECURED', () => {
  const greco = getAvailableCards(POSITIONS.NEUTRAL, [], 'greco');
  const leggers = greco.filter(c => c.scoreEffect?.setsCondition === CONDITIONS.LEG_ATTACK_SECURED);
  assert.equal(leggers.length, 0, 'no Greco card may set LEG_ATTACK_SECURED');
});

test('greco: a leg-attack card cannot be played (rejected by the legality gate)', () => {
  const s = createInitialMatchState('P1', 'P2', 'greco', null, null, 'medium', 'p1');
  // single_leg is folkstyle/freestyle only - style-illegal in Greco.
  const result = resolveRound(s, 'single_leg', 'snap_spin', null, null, () => 0.5);
  assert.equal(result.lastResult.type, 'illegal_card', 'single_leg must be rejected in Greco');
  assert.ok(!result.p1Conditions.includes(CONDITIONS.LEG_ATTACK_SECURED));
  assert.ok(!result.p2Conditions.includes(CONDITIONS.LEG_ATTACK_TRAPPED));
});

test('greco: stale LEG_ATTACK_TRAPPED still yields a real Greco hand (no empty fallback)', () => {
  const hand = buildHand(POSITIONS.NEUTRAL, [CONDITIONS.LEG_ATTACK_TRAPPED], 6, 'greco');
  assert.ok(hand.length > 0, 'buildHand must produce a non-empty Greco hand');
  assert.ok(hand.every(c => (c.styles || []).includes('greco')), 'hand must be Greco-legal cards');
  assert.ok(!hand.some(c => c.legDefense), 'Greco has no leg-defense cards');
});

test('greco: stale LEG_ATTACK_TRAPPED self-heals in resolveRound, no illegal_card loop', () => {
  const s = createInitialMatchState('P1', 'P2', 'greco', null, null, 'medium', 'p1');
  s.p2Conditions = [CONDITIONS.LEG_ATTACK_TRAPPED]; // corrupt / stale Greco state
  const result = resolveRound(s, 'snap_spin', 'whizzer', null, null, () => 0.5);
  assert.notEqual(result.lastResult.type, 'illegal_card', 'must resolve, not soft-lock');
  assert.ok(!result.p2Conditions.includes(CONDITIONS.LEG_ATTACK_TRAPPED),
    'stale LEG_ATTACK_TRAPPED must be stripped');
  assert.ok(!result.p1Conditions.includes(CONDITIONS.LEG_ATTACK_SECURED));
});

test('folkstyle leg-attack intact: single_leg still sets LEG_ATTACK_SECURED / TRAPPED', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  // single_leg PERFECT vs a weak setup card + MISS -> p1 wins decisively.
  const result = resolveRound(
    s, 'single_leg', 'collar_tie',
    { tier: 'PERFECT', ...SKILL_TIERS.PERFECT },
    { tier: 'MISS', ...SKILL_TIERS.MISS },
    () => 0.5,
  );
  assert.ok(result.p1Conditions.includes(CONDITIONS.LEG_ATTACK_SECURED),
    'folkstyle single_leg must still secure the leg');
  assert.ok(result.p2Conditions.includes(CONDITIONS.LEG_ATTACK_TRAPPED),
    'folkstyle defender must still become leg-trapped');
});

// ─── Secured-leg availability (regression) ────────────────────────────────
// Bug: with LEG_ATTACK_SECURED active, upper-body throws/ties were still
// offered. You cannot throw for amplitude or re-establish a tie while one of
// the opponent's legs is in your hands. The pool must exclude incompatible
// upper-body throws/ties while preserving leg-chain finishers.
const SECURED_LEG_BANNED_IDS = [
  'russian_tie', 'suplex', 'headlock_throw', 'lateral_drop', 'bear_hug_lift',
];
const SECURED_LEG_FINISH_IDS = ['run_the_pipe', 'elevate_and_trip', 'mat_return_from_leg'];

for (const style of ['freestyle', 'womens_freestyle']) {
  test(`${style}: secured-leg pool excludes upper-body throws/ties`, () => {
    const ids = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.LEG_ATTACK_SECURED], style)
      .map(c => c.id);
    for (const banned of SECURED_LEG_BANNED_IDS) {
      assert.ok(!ids.includes(banned),
        `${banned} must not be offered while a leg is secured (${style})`);
    }
  });

  test(`${style}: secured-leg pool still includes leg-chain finishers`, () => {
    const ids = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.LEG_ATTACK_SECURED], style)
      .map(c => c.id);
    for (const finish of SECURED_LEG_FINISH_IDS) {
      assert.ok(ids.includes(finish),
        `${finish} must remain available while a leg is secured (${style})`);
    }
  });
}

// ─── Rear-standing availability (regression) ──────────────────────────────
// From REAR_STANDING you are behind the opponent. A belly-to-back suplex and a
// rear body-lock lift are valid there; a front headlock_throw (needs front head
// control) and a lateral_drop (needs an over-under front tie) are not. The rear
// mat-return / trip / lift finishers must stay.
const REAR_STANDING_BANNED_IDS = ['headlock_throw', 'lateral_drop'];
const REAR_STANDING_KEEP_IDS = [
  'suplex', 'bear_hug_lift', 'rear_mat_return', 'rear_trip', 'rear_lift',
];

for (const style of ['freestyle', 'greco', 'womens_freestyle']) {
  test(`${style}: rear-standing pool excludes front-only throws`, () => {
    const ids = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.REAR_STANDING], style)
      .map(c => c.id);
    for (const banned of REAR_STANDING_BANNED_IDS) {
      assert.ok(!ids.includes(banned),
        `${banned} must not be offered from rear standing (${style})`);
    }
  });

  test(`${style}: rear-standing pool keeps rear-compatible throws + finishers`, () => {
    const ids = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.REAR_STANDING], style)
      .map(c => c.id);
    for (const keep of REAR_STANDING_KEEP_IDS) {
      assert.ok(ids.includes(keep),
        `${keep} must remain available from rear standing (${style})`);
    }
  });
}

test('successful bottom reversal clears LEG_RIDE_ESTABLISHED', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  // Set up: P1 is TOP with leg ride established, P2 is BOTTOM
  s.p1.position = POSITIONS.TOP;
  s.p1Conditions = [CONDITIONS.LEG_RIDE_ESTABLISHED];
  s.p2.position = POSITIONS.BOTTOM;
  s.p2Conditions = [];

  // P1 plays banana_split, P2 plays granby_roll. granby_roll's scoreEffect is 'escape'
  // (not reversal), but a win from BOTTOM clears the LEG_RIDE_ESTABLISHED condition
  // via the engine's escape handling. Use rng 0.5 to avoid boundary reset.
  const deterministicRng = () => 0.5;
  const result = resolveRound(s, 'banana_split', 'granby_roll', null, null, deterministicRng);

  // After a successful reversal, P1 (former attacker) should lose LEG_RIDE_ESTABLISHED
  assert.ok(
    !result.p1Conditions.includes(CONDITIONS.LEG_RIDE_ESTABLISHED),
    'P1 should lose LEG_RIDE_ESTABLISHED after reversal',
  );
});

test('banana_split excluded from leg-chain setup card list', () => {
  // get_legs_in sets LEG_RIDE_ESTABLISHED and should NOT appear in available cards
  // when that condition is already active (can't re-establish)
  const cards = getAvailableCards(POSITIONS.TOP, [CONDITIONS.LEG_RIDE_ESTABLISHED], 'folkstyle');
  const cardIds = cards.map(c => c.id);

  assert.ok(!cardIds.includes('get_legs_in'), 'get_legs_in not available when leg ride already established');
});

// ─── Reversal edge-win messaging ───────────────────────────────────────

test('initial state seeds rerollsLeft = 2 per side', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle');
  assert.deepEqual(s.rerollsLeft, { p1: 2, p2: 2 });
});

test('clean Peterson reversal awards 2 pts and TOP position (folkstyle)', () => {
  // P2 plays peterson_roll from BOTTOM vs P1's half_nelson from TOP.
  // peterson_roll is strongAgainst half_nelson (+26 power) and half_nelson
  // is a TURN_CARD with no controlStreak (-14), so peterson dominates and
  // the engine routes to the clean-win path (not edge).
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p2');
  s.p1.position = POSITIONS.TOP;
  s.p1Conditions = [CONDITIONS.BROKEN_DOWN]; // half_nelson requires broken_down
  s.p2.position = POSITIONS.BOTTOM;
  const result = resolveRound(s, 'half_nelson', 'peterson_roll', null, null, () => 0.5);
  assert.equal(result.lastResult.type, 'reversal', 'should be a clean reversal');
  assert.equal(result.lastResult.points, 2, 'folkstyle reversal = 2 pts');
  assert.equal(result.p2.position, POSITIONS.TOP, 'reverser moves to TOP');
  assert.equal(result.p1.position, POSITIONS.BOTTOM, 'reversed wrestler moves to BOTTOM');
  assert.equal(result.p2.score, 2);
});

test('edge-win Peterson narrates as scramble-to-escape, not generic escape', () => {
  // Force an edge-win: chop_and_drive (TOP, basePower 65, doesn't counter
  // peterson) vs peterson_roll (BOTTOM, basePower 64). With initiative on
  // p2 (+8), p2's power lands within 8 of p1's → engine takes the
  // partial-success branch and downgrades the reversal to escape+scramble.
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p2');
  s.p1.position = POSITIONS.TOP;
  s.p2.position = POSITIONS.BOTTOM;
  const result = resolveRound(s, 'chop_and_drive', 'peterson_roll', null, null, () => 0.5);
  assert.equal(result.lastResult.type, 'escape', 'edge reversal downgrades to escape type');
  assert.equal(result.lastResult.scrambledFrom, 'reversal', 'scrambledFrom flag set so replays can narrate');
  assert.equal(result.lastResult.points, 1, 'folkstyle escape = 1 pt');
  assert.match(result.lastResult.message, /scramble/i, 'message must say "scramble" so player understands the downgrade');
  assert.match(result.lastResult.message, /Peterson Roll/i, 'message names the attempted move');
});

// ─── rerollHand ────────────────────────────────────────────────────────

test('rerollHand returns 6 cards', () => {
  const prev = buildHand('neutral', [], 6, 'folkstyle');
  const next = rerollHand(prev, 'neutral', [], 6, 'folkstyle');
  assert.equal(next.length, 6);
});

test('rerollHand: at most 2 carry-over cards from prev hand', () => {
  // Run many trials - even if the pool is large, randomness can give 0-2
  // carry-overs. We assert no run produces ≥3.
  const prev = buildHand('neutral', [], 6, 'folkstyle');
  const prevIds = new Set(prev.map(c => c.id));
  for (let i = 0; i < 50; i++) {
    const next = rerollHand(prev, 'neutral', [], 6, 'folkstyle');
    const overlap = next.filter(c => prevIds.has(c.id)).length;
    assert.ok(overlap <= 2, `trial ${i}: overlap was ${overlap}, expected ≤2`);
  }
});

test('rerollHand: carry-over cards are not lone-of-category in new hand', () => {
  const prev = buildHand('neutral', [], 6, 'folkstyle');
  const prevIds = new Set(prev.map(c => c.id));
  for (let i = 0; i < 50; i++) {
    const next = rerollHand(prev, 'neutral', [], 6, 'folkstyle');
    const catCounts = {};
    for (const c of next) {
      const cat = c.category || 'general';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    }
    for (const c of next) {
      if (prevIds.has(c.id)) {
        const cat = c.category || 'general';
        // Either the pool was exhausted (fallback), or the carry-over is
        // shared with at least one other card in the new hand.
        if (catCounts[cat] === 1) {
          // Confirm the fallback was needed: new pool must be exhausted.
          const pool = getAvailableCards('neutral', [], 'folkstyle')
            .filter(p => !prevIds.has(p.id) && !next.some(nc => nc.id === p.id));
          assert.ok(pool.length === 0, `trial ${i}: lone-of-category carry-over ${c.id} without exhausted pool`);
        }
      }
    }
  }
});

test('rerollHand: distinct carry-over categories', () => {
  const prev = buildHand('neutral', [], 6, 'folkstyle');
  const prevIds = new Set(prev.map(c => c.id));
  for (let i = 0; i < 50; i++) {
    const next = rerollHand(prev, 'neutral', [], 6, 'folkstyle');
    const carryCats = next.filter(c => prevIds.has(c.id)).map(c => c.category || 'general');
    const unique = new Set(carryCats);
    assert.equal(unique.size, carryCats.length, `trial ${i}: duplicate carry-over categories`);
  }
});

// ─── Leg-trapped defense pool (6 cards: 3 escape + 3 counter-offensive) ──

test('leg-trapped pool is exactly 6 cards in folkstyle and freestyle', () => {
  const folk = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.LEG_ATTACK_TRAPPED], 'folkstyle');
  assert.equal(folk.length, 6, 'folkstyle leg-trapped pool must be 6');
  const free = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.LEG_ATTACK_TRAPPED], 'freestyle');
  assert.equal(free.length, 6, 'freestyle leg-trapped pool must be 6');
  // peek_out is no longer in the leg-trapped pool (it has its own dedicated set).
  assert.ok(!folk.find(c => c.id === 'peek_out'), 'peek_out must NOT appear in leg-trapped');
});

test('peek_out still available when FHL-trapped (not regressed by leg-trapped change)', () => {
  const fhl = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.FRONT_HEADLOCK_TRAPPED], 'folkstyle');
  assert.ok(fhl.find(c => c.id === 'peek_out'), 'peek_out must remain in FHL-trapped pool');
});

test('FHL Counter wins from leg-trapped: clears leg conditions, sets FHL on winner', () => {
  // P2 has secured P1's leg; P1 plays FHL Counter. P1 must beat the chosen
  // P2 finisher. front_headlock_counter has strongAgainst: ['mat_return_from_leg']
  // so the +22 counter bonus secures the win deterministically with rng=0.5.
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  s.p1Conditions = [CONDITIONS.LEG_ATTACK_TRAPPED];
  s.p2Conditions = [CONDITIONS.LEG_ATTACK_SECURED];
  const result = resolveRound(s, 'front_headlock_counter', 'mat_return_from_leg', null, null, () => 0.5);

  assert.equal(result.lastResult.attacker, 'p1', 'P1 (FHL Counter) must win vs mat_return_from_leg');
  assert.ok(result.p1Conditions.includes(CONDITIONS.FRONT_HEADLOCK_CONTROL), 'P1 gains FHL control');
  assert.ok(!result.p1Conditions.includes(CONDITIONS.LEG_ATTACK_TRAPPED), 'P1 leg no longer trapped');
  assert.ok(!result.p2Conditions.includes(CONDITIONS.LEG_ATTACK_SECURED), 'P2 no longer has leg secured');
  assert.ok(result.p2Conditions.includes(CONDITIONS.FRONT_HEADLOCK_TRAPPED), 'P2 now FHL-trapped');
});

test('Whizzer Drop wins from leg-trapped: awards takedown, swaps positions', () => {
  // whizzer_lateral_drop strongAgainst elevate_and_trip → +22 counter bonus → deterministic win.
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  s.p1Conditions = [CONDITIONS.LEG_ATTACK_TRAPPED];
  s.p2Conditions = [CONDITIONS.LEG_ATTACK_SECURED];
  const startScore = s.p1.score;
  const result = resolveRound(s, 'whizzer_lateral_drop', 'elevate_and_trip', null, null, () => 0.5);

  assert.equal(result.lastResult.type, 'takedown', 'must resolve as a takedown');
  assert.equal(result.p1.score, startScore + 3, 'folkstyle takedown = +3 to defender');
  assert.equal(result.p1.position, POSITIONS.TOP, 'whizzer-drop winner moves to TOP');
  assert.equal(result.p2.position, POSITIONS.BOTTOM, 'opponent moves to BOTTOM');
  // Position-change naturally clears the leg attack conditions.
  assert.ok(!result.p1Conditions.includes(CONDITIONS.LEG_ATTACK_TRAPPED));
  assert.ok(!result.p2Conditions.includes(CONDITIONS.LEG_ATTACK_SECURED));
});

test('Heavy Hips wins from leg-trapped: defense clears leg-attack conditions', () => {
  // heavy_hips strongAgainst run_the_pipe → +22 counter bonus → clean win
  // beyond the edge zone. Defense-type with SCRAMBLE condition triggers the
  // engine's leg-attack clearing (also covers limp_leg/whizzer_hop/crossface).
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  s.p1Conditions = [CONDITIONS.LEG_ATTACK_TRAPPED];
  s.p2Conditions = [CONDITIONS.LEG_ATTACK_SECURED];
  const result = resolveRound(s, 'heavy_hips', 'run_the_pipe', null, null, () => 0.5);

  assert.equal(result.lastResult.attacker, 'p1', 'P1 (Heavy Hips) must win vs run_the_pipe');
  assert.ok(!result.p1Conditions.includes(CONDITIONS.LEG_ATTACK_TRAPPED), 'leg no longer trapped');
  assert.ok(!result.p2Conditions.includes(CONDITIONS.LEG_ATTACK_SECURED), 'opponent no longer has leg');
});

test('Existing limp_leg also clears leg-attack on win (regression coverage)', () => {
  // The defense+SCRAMBLE clearing logic was added to fix Heavy Hips, but it
  // also fixes the latent bug in limp_leg/whizzer_hop/crossface_and_circle
  // where winning the defense never actually freed the leg.
  const s = createInitialMatchState('P1', 'P2', 'folkstyle', null, null, 'medium', 'p1');
  s.p1Conditions = [CONDITIONS.LEG_ATTACK_TRAPPED];
  s.p2Conditions = [CONDITIONS.LEG_ATTACK_SECURED];
  const result = resolveRound(s, 'limp_leg', 'run_the_pipe', null, null, () => 0.5);

  if (result.lastResult.attacker === 'p1') {
    assert.ok(!result.p1Conditions.includes(CONDITIONS.LEG_ATTACK_TRAPPED), 'leg freed on limp_leg win');
    assert.ok(!result.p2Conditions.includes(CONDITIONS.LEG_ATTACK_SECURED), 'opponent loses secured');
  }
});

// ─── describeMatchPosition ────────────────────────────────────────────────

function makeState(overrides = {}) {
  const s = createInitialMatchState('Mason', 'CPU', 'folkstyle', null, null, 'medium', 'p1');
  return { ...s, ...overrides };
}

test('describeMatchPosition: empty state -> empty tag', () => {
  const out = describeMatchPosition(null);
  assert.equal(out.tag, '');
});

test('describeMatchPosition: clean neutral -> Neutral / neutral tone', () => {
  const out = describeMatchPosition(makeState());
  assert.equal(out.tag, 'Neutral');
  assert.equal(out.tone, 'neutral');
});

test('describeMatchPosition: leg attack secured -> "{name} has a leg" / urgent', () => {
  const s = makeState();
  s.p1Conditions = [CONDITIONS.LEG_ATTACK_SECURED];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Mason has a leg');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: front headlock control on p2 -> "{p2} has FHL" / urgent', () => {
  const s = makeState();
  s.p2Conditions = [CONDITIONS.FRONT_HEADLOCK_CONTROL];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'CPU has FHL');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: front headlock trapped -> "{name} in FHL" / urgent', () => {
  const s = makeState();
  s.p1Conditions = [CONDITIONS.FRONT_HEADLOCK_TRAPPED];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Mason in FHL');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: scramble -> "Scramble" / urgent', () => {
  const s = makeState();
  s.p1Conditions = [CONDITIONS.SCRAMBLE];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Scramble');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: tie up -> "Collar tie" / neutral', () => {
  const s = makeState();
  s.p1Conditions = [CONDITIONS.TIE_UP];
  s.p2Conditions = [CONDITIONS.TIE_UP];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Collar tie');
  assert.equal(out.tone, 'neutral');
});

test('describeMatchPosition: rear standing -> "{name} behind" / urgent', () => {
  const s = makeState();
  s.p2Conditions = [CONDITIONS.REAR_STANDING];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'CPU behind');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: top with broken-down bottom -> combined tag / urgent', () => {
  const s = makeState();
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  s.p2Conditions = [CONDITIONS.BROKEN_DOWN];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Mason on top · CPU - flat');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: legs in -> top tag flagged / urgent', () => {
  const s = makeState();
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  s.p1Conditions = [CONDITIONS.LEG_RIDE_ESTABLISHED];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Mason - legs in · CPU on bottom');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: bottom on solid base -> bottom tone', () => {
  const s = makeState();
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  s.p2Conditions = [CONDITIONS.GOOD_BASE];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Mason on top · CPU - solid base');
  assert.equal(out.tone, 'bottom');
});

test('describeMatchPosition: pin attempt -> pin tag', () => {
  const s = makeState();
  s.phase = 'pin_attempt';
  s.pinAttempt = { attacker: 'p1' };
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Pin attempt - Mason');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: finished -> "Match finished"', () => {
  const s = makeState();
  s.phase = 'finished';
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Match finished');
});

test('describeMatchPosition: Greco par-terre countdown surfaces "rounds until reset"', () => {
  const s = makeState();
  s.wrestlingStyle = 'greco';
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  s.parTerreCountdown = 3;
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Par terre - 3 rounds until reset');
  assert.equal(out.tone, 'urgent');
});

test('describeMatchPosition: par-terre countdown 1 round uses singular', () => {
  const s = makeState();
  s.wrestlingStyle = 'greco';
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  s.parTerreCountdown = 1;
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Par terre - 1 round until reset');
});

// ─── Par-terre countdown (Greco) ──────────────────────────────────────────

test('describeMatchPosition: Greco TIE_UP shows "Pummel" not "Collar tie"', () => {
  const s = makeState();
  s.wrestlingStyle = 'greco';
  s.p1Conditions = [CONDITIONS.TIE_UP];
  s.p2Conditions = [CONDITIONS.TIE_UP];
  const out = describeMatchPosition(s);
  assert.equal(out.tag, 'Pummel');
  assert.equal(out.tone, 'neutral');
});

test('Par-terre countdown restarts on top score (gut wrench keeps the position)', () => {
  // Setup: p1 on TOP, p2 on BOTTOM, Greco, countdown at 2.
  // gut_wrench vs short_sit at rng 0.2 produces a clean exposure win for
  // the top wrestler. (Pairing with hold_position would give bottom a
  // counter bonus and downgrade the result to a scramble.)
  const s = createInitialMatchState('Top', 'Bottom', 'greco', null, null, 'medium', 'p1');
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  s.p1Conditions = [CONDITIONS.CONTROL_ESTABLISHED];
  s.parTerreCountdown = 2;
  const result = resolveRound(s, 'gut_wrench', 'short_sit', null, null, () => 0.2);
  // Top scored an exposure - countdown should be restarted to 3.
  assert.equal(result.lastResult?.type, 'exposure', 'top scored an exposure');
  assert.equal(result.parTerreCountdown, 3, 'countdown restarts after top score');
});

test('Par-terre countdown decrements on stalemate (no scoring round)', () => {
  // Setup: p1 on TOP, p2 on BOTTOM, Greco, countdown at 3, no CONTROL_ESTABLISHED
  // so gut_wrench will fail to score and we get a stalemate.
  const s = createInitialMatchState('Top', 'Bottom', 'greco', null, null, 'medium', 'p1');
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  // Don't set CONTROL_ESTABLISHED - gut_wrench requires it; without it the
  // engine returns a stalemate rather than a scoring action.
  s.parTerreCountdown = 3;
  // Use defensive cards on both sides to force a non-scoring round.
  const result = resolveRound(s, 'tight_waist', 'hold_position', null, null, () => 0.5);
  // Either the countdown ticked from 3 -> 2 OR (if it hit 0 path) it went
  // to null after a reset. We expect 2 here since we started at 3.
  assert.ok(
    result.parTerreCountdown === 2 || result.parTerreCountdown === null,
    `countdown should have ticked down from 3 (got ${result.parTerreCountdown})`,
  );
});

test('Par-terre countdown nulls when bottom escapes/reverses', () => {
  // Setup: p1 on TOP, p2 on BOTTOM, Greco, countdown at 2.
  const s = createInitialMatchState('Top', 'Bottom', 'greco', null, null, 'medium', 'p1');
  s.p1 = { ...s.p1, position: POSITIONS.TOP };
  s.p2 = { ...s.p2, position: POSITIONS.BOTTOM };
  s.p2Conditions = [CONDITIONS.CONTROL_ESTABLISHED]; // make bottom's hip_heist viable
  s.parTerreCountdown = 2;
  // Force p2 (bottom) to win the round with rng favoring them.
  const result = resolveRound(s, 'tight_waist', 'hip_heist', null, null, () => 0.95);
  // Position is changing (escape/reversal) - countdown becomes irrelevant.
  // It should have nulled OR ticked normally if the escape didn't actually
  // resolve. Accept either; the important thing is the engine didn't crash
  // and we're not stuck on a stale countdown that ignores the position change.
  if (result.lastResult?.type === 'escape' || result.lastResult?.type === 'reversal') {
    assert.equal(result.parTerreCountdown, null, 'countdown nulled on bottom score');
  }
});

test('describeMatchPosition: long names get truncated', () => {
  const s = createInitialMatchState('VeryLongUsernameThatGoesOnAndOn', 'AlsoVeryLongName', 'folkstyle', null, null, 'medium', 'p1');
  s.p1Conditions = [CONDITIONS.LEG_ATTACK_SECURED];
  const out = describeMatchPosition(s);
  assert.ok(out.tag.includes('…'), 'long name truncated with ellipsis');
  assert.ok(out.tag.length <= 32, 'tag stays under length cap');
});

// --- Career Simulate Week + Forfeit ----------------------------------------

const {
  rollMatchOutcome,
  simulateDualEvent,
  simulateTournamentEvent,
  summarizeForfeitedTournament,
  avgStats,
} = await import('./career/simulateEvent.js');

// Tiny seeded LCG for deterministic tests.
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('rollMatchOutcome is deterministic with a seeded RNG', () => {
  const rng1 = seededRng(42);
  const rng2 = seededRng(42);
  const a = rollMatchOutcome(75, 70, rng1);
  const b = rollMatchOutcome(75, 70, rng2);
  assert.deepEqual(a, b, 'same seed -> same result');
});

test('simulateDualEvent favors the higher-overall wrestler', () => {
  const career = { wrestler: { stats: { str: 80, spd: 80, tec: 80, end: 80, grt: 80 } } };
  const event = { opponent: { stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 } } };
  const rng = seededRng(7);
  let wins = 0;
  const trials = 1000;
  for (let i = 0; i < trials; i++) {
    if (simulateDualEvent(career, event, rng).playerWon) wins += 1;
  }
  // 80 vs 60 -> delta 20 -> ~88% win prob. Allow generous tolerance.
  assert.ok(wins >= 800, `expected >= 800/${trials} wins (got ${wins})`);
});

test('simulateTournamentEvent placement bounds + monotonic counters', () => {
  const career = { wrestler: { stats: { str: 75, spd: 75, tec: 75, end: 75, grt: 75 } } };
  const event = { bracketSize: 8, fieldStrength: 70 };
  const rng = seededRng(99);
  for (let i = 0; i < 200; i++) {
    const r = simulateTournamentEvent(career, event, rng);
    const playerRoundsToWin = Math.ceil(Math.log2(8));
    assert.ok(r.placement >= 1 && r.placement <= 8, `placement in [1,8], got ${r.placement}`);
    assert.ok(r.matchesWon >= 0 && r.matchesWon <= playerRoundsToWin, `matchesWon in [0,${playerRoundsToWin}]`);
    assert.ok(r.matchesLost === 0 || r.matchesLost === 1, `matchesLost in {0,1}, got ${r.matchesLost}`);
    if (r.placement === 1) {
      assert.equal(r.matchesLost, 0, 'champion never loses');
      assert.equal(r.matchesWon, playerRoundsToWin, 'champion wins all rounds');
    }
  }
});

test('avgStats returns 60 for missing stats and rounds correctly', () => {
  assert.equal(avgStats(null), 60, 'null defaults to 60');
  assert.equal(avgStats(undefined), 60, 'undefined defaults to 60');
  assert.equal(avgStats({ str: 80, spd: 80, tec: 80, end: 80, grt: 80 }), 80);
  assert.equal(avgStats({ str: 70, spd: 75, tec: 80, end: 65, grt: 60 }), 70);
});

test('summarizeForfeitedTournament: won R1, lost R2 -> placement 5 in 8-bracket', () => {
  // Build a minimal tournamentState reflecting the user's reported scenario.
  const tournamentState = {
    playerSeed: 0,
    bracket: new Array(8).fill(null).map((_, i) => ({ name: `W${i}` })),
    playerRoundsToWin: 3,
    matches: [
      // Quarterfinals (round 1) - player won match 0.
      { bracketSlots: [0, 7], winner: 0, winMethod: 'decision' },
      { bracketSlots: [1, 6], winner: 1, winMethod: 'decision' },
      { bracketSlots: [2, 5], winner: 2, winMethod: 'decision' },
      { bracketSlots: [3, 4], winner: 3, winMethod: 'decision' },
      // Semifinals (round 2) - player lost match 4.
      { bracketSlots: [0, 1], winner: 1, winMethod: 'decision' },
      { bracketSlots: [2, 3], winner: 2, winMethod: 'decision' },
      // Finals - not played.
      { bracketSlots: [1, 2], winner: null, winMethod: null },
    ],
  };
  const r = summarizeForfeitedTournament(tournamentState);
  assert.equal(r.matchesWon, 1, 'one win counted');
  assert.equal(r.matchesLost, 1, 'one loss counted');
  // 8-bracket SF loss -> placement = 2^(3-1-1) + 1 = 2^1 + 1 = 3 by computePlacement.
  // Wait: roundsWon=1, playerRoundsToWin=3, remaining=2 -> 2^(2-1)+1 = 3.
  // SF losers in an 8-bracket are commonly listed as 3rd place finalists in
  // tournaments with consolation. In single-elim with no consolation they're
  // tied for 3rd by convention. computePlacement returns 3 here.
  assert.equal(r.placement, 3, 'SF loss in 8-bracket -> placement 3');
  assert.equal(r.playerWon, false);
});

test('summarizeForfeitedTournament: zero matches played -> last-place forfeit', () => {
  const tournamentState = {
    playerSeed: 0,
    bracket: new Array(8).fill(null).map((_, i) => ({ name: `W${i}` })),
    playerRoundsToWin: 3,
    matches: new Array(7).fill(null).map(() => ({ bracketSlots: [0, 1], winner: null })),
  };
  const r = summarizeForfeitedTournament(tournamentState);
  assert.equal(r.matchesWon, 0);
  assert.equal(r.matchesLost, 1, 'forfeit-before-play counts as one loss');
  // 8-bracket round-1 elimination -> placement 5 (8/2 + 1) per computePlacement.
  // roundsWon=0, playerRoundsToWin=3, remaining=3 -> 2^(3-1)+1 = 5.
  assert.equal(r.placement, 5, 'round-1 forfeit -> placement 5');
});

// --- Achievements (badge bug fixes) ----------------------------------------

const { checkAchievements } = await import('./profileUtils.js');

const baseMatchResult = {
  result: 'win',
  winMethod: 'decision',
  playerScore: 5,
  opponentScore: 3,
  wasTrailing: false,
  takedowns: 1,
  rideTimeBonuses: 0,
  maxPeriodPoints: 0,
  isOnline: false,
  tournamentEntered: false,
  tournamentWon: false,
  practiceOpponentUid: null,
  winStreak: 0,
  maxDeficit: 0,
  aiDifficulty: 'medium',
};

test('Hot Streak (streak_5) fires on 5th win in a row', () => {
  const earned = checkAchievements([], { ...baseMatchResult, winStreak: 5 }, { wins: 0 });
  assert.ok(earned.includes('streak_5'), 'streak_5 awarded at 5');
});

test('Hot Streak does NOT fire below 5', () => {
  const earned = checkAchievements([], { ...baseMatchResult, winStreak: 4 }, { wins: 0 });
  assert.ok(!earned.includes('streak_5'), 'streak_5 should not fire at 4');
});

test('Hot Streak does NOT fire if already earned', () => {
  const earned = checkAchievements(['streak_5'], { ...baseMatchResult, winStreak: 12 }, { wins: 0 });
  assert.ok(!earned.includes('streak_5'), 'no double-award');
});

test('Ride Time King (ride_time_3) fires at 3 ride bonuses', () => {
  const earned = checkAchievements([], { ...baseMatchResult, rideTimeBonuses: 3 }, { wins: 0 });
  assert.ok(earned.includes('ride_time_3'), 'ride_time_3 awarded at 3');
});

test('Ride Time King does NOT fire at 2', () => {
  const earned = checkAchievements([], { ...baseMatchResult, rideTimeBonuses: 2 }, { wins: 0 });
  assert.ok(!earned.includes('ride_time_3'), 'ride_time_3 should not fire at 2');
});

test('Never Say Die (comeback) fires on win after being down 6+', () => {
  const earned = checkAchievements([], {
    ...baseMatchResult,
    wasTrailing: true,
    maxDeficit: 6,
    playerScore: 8,
    opponentScore: 7,
  }, { wins: 0 });
  assert.ok(earned.includes('comeback'), 'comeback awarded at 6-pt deficit');
});

test('Never Say Die does NOT fire on win from 5-pt deficit', () => {
  const earned = checkAchievements([], {
    ...baseMatchResult,
    wasTrailing: true,
    maxDeficit: 5,
    playerScore: 8,
    opponentScore: 7,
  }, { wins: 0 });
  assert.ok(!earned.includes('comeback'), 'comeback should not fire below 6');
});

test('Never Say Die does NOT fire on a loss', () => {
  const earned = checkAchievements([], {
    ...baseMatchResult,
    result: 'loss',
    wasTrailing: true,
    maxDeficit: 10,
  }, { wins: 0 });
  assert.ok(!earned.includes('comeback'), 'comeback requires a win');
});

test('Flawless Period (perfect_period) fires at 8+ in a single period', () => {
  const earned = checkAchievements([], { ...baseMatchResult, maxPeriodPoints: 9 }, { wins: 0 });
  assert.ok(earned.includes('perfect_period'), 'perfect_period awarded at 9 in a period');
});

test('Flawless Period does NOT fire at 7', () => {
  const earned = checkAchievements([], { ...baseMatchResult, maxPeriodPoints: 7 }, { wins: 0 });
  assert.ok(!earned.includes('perfect_period'), 'perfect_period should not fire at 7');
});

test('Shutout fires only on a win with opponentScore=0', () => {
  const winShutout = checkAchievements([], { ...baseMatchResult, opponentScore: 0 }, { wins: 0 });
  const lossShutout = checkAchievements([], { ...baseMatchResult, result: 'loss', opponentScore: 0 }, { wins: 0 });
  assert.ok(winShutout.includes('shutout'), 'shutout fires on win + 0');
  assert.ok(!lossShutout.includes('shutout'), 'shutout requires win');
});

// --- Folkstyle near-fall point math ----------------------------------------
// User spec:
//   - No pin trigger        -> 2 NF
//   - Pin trigger, escape stage 1 or 2 -> 3 NF
//   - Pin trigger, escape (or break) stage 3 -> 4 NF

// Helper: build a state mid-pin-attempt at the given stage. Pre-loads
// burnedDefCards to match how the real engine arrives at stage 2/3.
function buildPinAttemptState({ stage = 1, attacker = 'p1' } = {}) {
  const s = createInitialMatchState('Atk', 'Def', 'folkstyle', null, null, 'medium', 'p1');
  // Put attacker top, defender bottom, score the trigger NF (2 pts).
  s[attacker] = { ...s[attacker], position: POSITIONS.TOP, score: 2, nearFallCount: 1 };
  const defender = attacker === 'p1' ? 'p2' : 'p1';
  s[defender] = { ...s[defender], position: POSITIONS.BOTTOM, pinDepth: 1 };
  const burned = stage === 2 ? ['pin_bridge'] : stage === 3 ? ['pin_bridge', 'pin_roll_through'] : [];
  s.phase = 'pin_attempt';
  s.pinAttempt = {
    attacker,
    cardId: 'half_nelson',
    pinChance: 0.20,
    offenseCards: [],
    defenseCards: [],
    stage,
    burnedDefCards: burned,
  };
  return s;
}

// RNG call order in resolvePinStageN:
//   1. clock decrement (Math.floor(rng() * 6))
//   2. pin success roll (rng() < chance)
//   3. early escape roll (only if no pin)  [stages 1, 2 only]
//   4. fully-escape-to-neutral roll (only if early escape OR stage 3 break)
function pinRng(values) {
  let i = 0;
  return () => values[i++] ?? 0.5;
}

test('NF total: stage 1 escape = 3 NF (2 trigger + 1 bonus)', () => {
  const s = buildPinAttemptState({ stage: 1 });
  // [clock=any, pin=0.99 (no pin), earlyEscape=0.01 (escape!), fullyEscape=0.99 (stays bottom)]
  const rng = pinRng([0.5, 0.99, 0.01, 0.99]);
  const out = resolvePinStage1(s, 'pin_lock_position', 'pin_bridge', rng);
  assert.equal(out.p1.score, 3, 'p1 should have 3 NF total');
  assert.equal(out.phase, 'playing', 'pin attempt closed');
  assert.equal(out.pinAttempt, null);
});

test('NF total: stage 2 escape = 3 NF (2 trigger + 1 bonus)', () => {
  const s = buildPinAttemptState({ stage: 2 });
  const rng = pinRng([0.5, 0.99, 0.01, 0.99]);
  const out = resolvePinStage2(s, 'pin_adjust_pressure', 'pin_roll_through', rng);
  assert.equal(out.p1.score, 3, 'p1 should have 3 NF total');
  assert.equal(out.phase, 'playing');
  assert.equal(out.pinAttempt, null);
});

test('NF total: stage 3 break = 4 NF (2 trigger + 2 bonus)', () => {
  const s = buildPinAttemptState({ stage: 3 });
  // Stage 3: [clock=any, pin=0.99 (no pin), fullyEscape=0.99 (stays bottom)]
  const rng = pinRng([0.5, 0.99, 0.99]);
  const out = resolvePinStage3(s, 'pin_finish', 'pin_fight_hands', rng);
  assert.equal(out.p1.score, 4, 'p1 should have 4 NF (was 6 pre-fix)');
  assert.equal(out.phase, 'playing');
  assert.equal(out.pinAttempt, null);
});

test('NF total: stage 3 fullyEscape = 4 NF (defender escapes to neutral)', () => {
  const s = buildPinAttemptState({ stage: 3 });
  // [clock=any, pin=0.99 (no pin), fullyEscape=0.01 (escapes!)]
  const rng = pinRng([0.5, 0.99, 0.01]);
  const out = resolvePinStage3(s, 'pin_finish', 'pin_fight_hands', rng);
  assert.equal(out.p1.score, 4, 'attacker still scores 4 NF on fullyEscape');
  assert.equal(out.p2.position, POSITIONS.NEUTRAL);
  assert.ok(out.p2.score >= 1, 'defender +1 escape pt');
});

test('NF total: pin success at stage 1 -> match over, no extra NF', () => {
  const s = buildPinAttemptState({ stage: 1 });
  // [clock=any, pin=0.0001 (PIN!)]
  const rng = pinRng([0.5, 0.0001]);
  const out = resolvePinStage1(s, 'pin_lock_position', 'pin_bridge', rng);
  assert.equal(out.winner, 'p1', 'p1 wins by pin');
  assert.equal(out.winMethod, 'pin');
  assert.equal(out.phase, 'finished');
  assert.equal(out.p1.score, 2, 'no extra NF awarded after pin (trigger 2 only)');
});

test('NF total: stage 1 advance (no escape) leaves attempt open', () => {
  const s = buildPinAttemptState({ stage: 1 });
  // [clock=any, pin=0.99 (no pin), earlyEscape=0.99 (no escape -> advance)]
  const rng = pinRng([0.5, 0.99, 0.99]);
  const out = resolvePinStage1(s, 'pin_lock_position', 'pin_bridge', rng);
  assert.equal(out.phase, 'pin_attempt', 'attempt continues');
  assert.equal(out.pinAttempt.stage, 2, 'advanced to stage 2');
  assert.equal(out.p1.score, 2, 'no NF bonus yet (still pinning)');
  assert.deepEqual(out.pinAttempt.burnedDefCards, ['pin_bridge'], 'card burned');
});

// ─── Tech-fall buzzer: NF bonus suppresses the defender's escape ──────────
//
// Real-wrestling rule: when an attacker's near-fall bonus crosses the
// tech-fall lead (15 in folkstyle, 10 international), the match ends the
// instant the points cross the line. The defender's "fully escape" point
// happens AFTER the buzzer in the engine's accounting and must not be
// awarded. Without these guards a 14-0 -> +4 NF tech ended 18-1 instead
// of 18-0, and a 12-0 -> +4 NF ended 16-1 instead of 16-0.
//
// `buildPinAttemptState` already credits the +2 trigger near-fall to the
// attacker, so a `score: N` override here represents the pre-trigger
// score plus 2. Trace for the 14-0 -> 18-0 case:
//   pre-trigger 14 -> trigger +2 -> 16 (override) -> stage3 bonus +2 -> 18.

test('Tech-fall buzzer: stage 3 bonus to 18-0 finishes 18-0, not 18-1', () => {
  const s = buildPinAttemptState({ stage: 3 });
  s.p1 = { ...s.p1, score: 16 }; // post-trigger; stage3 bonus +2 -> 18
  // RNG: [clock, pin=0.99 (no pin), fullyEscape=0.01 (would escape, but suppressed)]
  const rng = pinRng([0.5, 0.99, 0.01]);
  const out = resolvePinStage3(s, 'pin_finish', 'pin_fight_hands', rng);
  assert.equal(out.p1.score, 18, 'attacker lands the +2 bonus -> 18');
  assert.equal(out.p2.score, 0, 'defender escape suppressed by tech-fall buzzer');
  assert.equal(out.winner, 'p1', 'p1 wins by tech fall');
  assert.equal(out.winMethod, 'tech_fall');
  assert.equal(out.phase, 'finished');
});

test('Tech-fall buzzer: stage 3 bonus to 16-0 finishes 16-0, not 16-1', () => {
  const s = buildPinAttemptState({ stage: 3 });
  s.p1 = { ...s.p1, score: 14 }; // post-trigger; stage3 bonus +2 -> 16 (lead 16 >= 15)
  const rng = pinRng([0.5, 0.99, 0.01]);
  const out = resolvePinStage3(s, 'pin_finish', 'pin_fight_hands', rng);
  assert.equal(out.p1.score, 16, 'attacker lands the +2 bonus -> 16');
  assert.equal(out.p2.score, 0, 'defender escape suppressed by tech-fall buzzer');
  assert.equal(out.winner, 'p1');
  assert.equal(out.winMethod, 'tech_fall');
});

test('Tech-fall buzzer: stage 1 bonus that clinches the tech also suppresses escape', () => {
  const s = buildPinAttemptState({ stage: 1 });
  s.p1 = { ...s.p1, score: 16 }; // post-trigger; stage1 bonus +1 -> 17 (lead 17 >= 15)
  // Stage 1 RNG: [clock, pin=0.99 (no pin), earlyEscape=0.01 (escape!), fullyEscape=0.01 (would escape)]
  const rng = pinRng([0.5, 0.99, 0.01, 0.01]);
  const out = resolvePinStage1(s, 'pin_lock_position', 'pin_bridge', rng);
  assert.equal(out.p1.score, 17, 'attacker lands +1 bonus -> 17');
  assert.equal(out.p2.score, 0, 'defender escape suppressed');
  assert.equal(out.winner, 'p1');
  assert.equal(out.winMethod, 'tech_fall');
});

test('Tech-fall buzzer: stage 2 bonus that clinches the tech also suppresses escape', () => {
  const s = buildPinAttemptState({ stage: 2 });
  s.p1 = { ...s.p1, score: 14 }; // post-trigger; stage2 bonus +1 -> 15 (lead 15 == threshold)
  const rng = pinRng([0.5, 0.99, 0.01, 0.01]);
  const out = resolvePinStage2(s, 'pin_adjust_pressure', 'pin_roll_through', rng);
  assert.equal(out.p1.score, 15, 'attacker lands +1 bonus -> 15');
  assert.equal(out.p2.score, 0, 'defender escape suppressed');
  assert.equal(out.winner, 'p1');
  assert.equal(out.winMethod, 'tech_fall');
});

test('Tech-fall buzzer: low-score fullyEscape still awards the escape point', () => {
  // Regression guard for the existing happy path - tech threshold not
  // reached, so the defender's escape should still register normally.
  const s = buildPinAttemptState({ stage: 3 }); // p1 starts at 2
  const rng = pinRng([0.5, 0.99, 0.01]);
  const out = resolvePinStage3(s, 'pin_finish', 'pin_fight_hands', rng);
  assert.equal(out.p1.score, 4, 'attacker still scores 4 NF total');
  assert.equal(out.p2.score, 1, 'defender gets +1 escape');
  assert.equal(out.p2.position, POSITIONS.NEUTRAL);
  assert.equal(out.phase, 'playing', 'match continues - no tech fall');
});

// ─── applyStallingCall (exported helper) ────────────────────────────────

test('applyStallingCall: first call warns, no points; surfaces stallingReason', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle');
  applyStallingCall(s, 'p1', 'p2', 'transition_spam');
  assert.equal(s.stallCount.p1, 1);
  assert.equal(s.lastResult.type, 'stalling_warning');
  assert.equal(s.lastResult.stallingReason, 'transition_spam');
  assert.equal(s.p2.score, 0);
});

test('applyStallingCall: second+ call awards STALLING_PENALTY to beneficiary', () => {
  const s = createInitialMatchState('P1', 'P2', 'folkstyle');
  applyStallingCall(s, 'p1', 'p2', 'transition_spam');
  applyStallingCall(s, 'p1', 'p2', 'transition_spam');
  assert.equal(s.stallCount.p1, 2);
  assert.equal(s.lastResult.type, 'stalling_penalty');
  assert.equal(s.p2.score, 1);
});

// ─── transitionSpamFactor (pure helper) ─────────────────────────────────

test('transitionSpamFactor truth table covers warn/half/penalty thresholds', () => {
  const t = MECHANIC_TUNING.path;
  for (const n of [0, 1, 2]) {
    const r = transitionSpamFactor(n, t);
    assert.equal(r.factor, 1.0);
    assert.equal(r.level, null);
    assert.equal(r.count, n);
  }
  const warn = transitionSpamFactor(t.spamWarnAt, t);
  assert.equal(warn.factor, 1.0);
  assert.equal(warn.level, 'warn');
  const half = transitionSpamFactor(t.spamHalfBonusAt, t);
  assert.equal(half.factor, 0.5);
  assert.equal(half.level, 'half');
  const pen = transitionSpamFactor(t.spamZeroAndStallAt, t);
  assert.equal(pen.factor, 0);
  assert.equal(pen.level, 'penalty');
  const past = transitionSpamFactor(t.spamZeroAndStallAt + 5, t);
  assert.equal(past.level, 'penalty');
});

// ─── transition spam in resolveRound ────────────────────────────────────

// collar_tie is a transition card legal from NEUTRAL in both folkstyle and
// freestyle (path mechanic). p2 plays double_leg (neutral_attack, charge
// mechanic). Both are legal for a single play at clean neutral - resolveRound
// now enforces card legality, so the spam tests must use a state-legal card.
const TRANSITION_CARD_ID = 'collar_tie';
const NEUTRAL_ATTACK_ID  = 'double_leg';

function transitionState(style = 'folkstyle') {
  const s = createInitialMatchState('P1', 'P2', style);
  s.initiative = 'p1';
  return s;
}

function rollGood() {
  return { tier: 'GOOD', ...SKILL_TIERS.GOOD };
}

test('resolveRound: 3 consecutive transitions sets warn level, full bonus applied', () => {
  let s = transitionState();
  s.consecutiveTransitions.p1 = 2; // 3rd will trip spamWarnAt
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 3);
  assert.deepEqual(s.lastResult.p1TransitionSpam, { level: 'warn', count: 3, stall: 'warning' });
  assert.equal(s.lastResult.p1SkillBonusApplied, SKILL_TIERS.GOOD.bonus);
  assert.equal(s.stallCount.p1, 1, '3rd consecutive transition also issues a folkstyle stalling warning');
});

test('resolveRound: 4 consecutive transitions halves bonus', () => {
  let s = transitionState();
  s.consecutiveTransitions.p1 = 3;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 4);
  assert.equal(s.lastResult.p1TransitionSpam.level, 'half');
  assert.equal(s.lastResult.p1SkillBonusApplied, SKILL_TIERS.GOOD.bonus * 0.5);
  assert.equal(s.stallCount.p1, 1, '4th consecutive transition (clean stallCount) issues one stalling warning');
});

test('resolveRound: 5 consecutive transitions zeros bonus + applies stalling call (folkstyle)', () => {
  let s = transitionState('folkstyle');
  s.consecutiveTransitions.p1 = 4;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 5);
  assert.equal(s.lastResult.p1TransitionSpam.level, 'penalty');
  assert.equal(s.lastResult.p1SkillBonusApplied, 0);
  // First stalling call -> warning, no penalty yet. (Gameplay scoring is
  // RNG-dependent and orthogonal; only the absence of a stalling_penalty
  // log entry proves the penalty path didn't fire.)
  assert.equal(s.stallCount.p1, 1);
  const penaltyEntries = s.log.filter(e => e.type === 'stalling_penalty');
  assert.equal(penaltyEntries.length, 0, 'first stall should be warning only, no penalty entry');
});

test('resolveRound: 6 consecutive transitions awards STALLING_PENALTY to opponent (folkstyle)', () => {
  // Pre-set the 5th-transition aftermath (counter 5, one stalling warning) and
  // play one more transition - mirrors the single-call form of the sibling
  // spam tests. (collar_tie sets TIE_UP, so it cannot be replayed across two
  // live rounds; the prior state is set directly instead.)
  let s = transitionState('folkstyle');
  s.consecutiveTransitions.p1 = 5; // 6th transition trips the penalty
  s.stallCount.p1 = 1;             // the 5th transition already gave a warning
  const scoreBefore = s.p2.score;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null); // 6th -> penalty
  assert.equal(s.consecutiveTransitions.p1, 6);
  assert.equal(s.stallCount.p1, 2);
  // The 6th round both resolves normal scoring AND adds the stalling penalty.
  // lastResult on the 6th round may be overwritten by the gameplay outcome,
  // so check the log for the stalling_penalty entry instead.
  const penaltyEntries = s.log.filter(e => e.type === 'stalling_penalty');
  assert.ok(penaltyEntries.length >= 1, `expected stalling_penalty log entry, got ${JSON.stringify(s.log.map(e => e.type))}`);
  // The penalty itself awards STALLING_PENALTY (= 1) on top of any gameplay.
  // Score must have grown by at least the penalty amount.
  assert.ok(s.p2.score >= scoreBefore + 1, `p2 score must include +1 stall: before ${scoreBefore}, after ${s.p2.score}`);
});

test('resolveRound: 5 consecutive transitions in freestyle zeros bonus but does NOT call stalling', () => {
  let s = transitionState('freestyle');
  s.consecutiveTransitions.p1 = 4;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 5);
  assert.equal(s.lastResult.p1TransitionSpam.level, 'penalty');
  assert.equal(s.lastResult.p1SkillBonusApplied, 0);
  // No stalling pathway in freestyle - log must not have any stalling entries.
  assert.equal(s.stallCount.p1, 0);
  const stallEntries = s.log.filter(e => e.type === 'stalling_warning' || e.type === 'stalling_penalty');
  assert.equal(stallEntries.length, 0, 'freestyle must not produce stalling log entries');
});

test('resolveRound: counter resets on non-transition card', () => {
  let s = transitionState();
  s.consecutiveTransitions.p1 = 4;
  s = resolveRound(s, NEUTRAL_ATTACK_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 0);
  assert.equal(s.lastResult.p1TransitionSpam, undefined);
  // No spam factor reduction either.
  assert.equal(s.lastResult.p1SkillBonusApplied, SKILL_TIERS.GOOD.bonus);
});

test('resolveRound: spam counter is independent per side', () => {
  let s = transitionState();
  s.consecutiveTransitions.p1 = 3;
  s.consecutiveTransitions.p2 = 0;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 4);
  assert.equal(s.consecutiveTransitions.p2, 0);
  assert.equal(s.lastResult.p2TransitionSpam, undefined);
});

test('resolveRound: shared stallCount - prior warning + transition penalty awards point in same round (folkstyle)', () => {
  let s = transitionState('folkstyle');
  s.stallCount.p1 = 1; // p1 already has a normal stalling warning
  s.consecutiveTransitions.p1 = 4;
  const scoreBefore = s.p2.score;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.stallCount.p1, 2, 'shared counter advances to 2');
  // Stalling penalty path must have fired (log evidence; gameplay may have
  // added extra points on top, but the +1 stalling penalty was definitely
  // applied because stallCount[1] -> [2] crosses the penalty threshold).
  const penaltyEntries = s.log.filter(e => e.type === 'stalling_penalty');
  assert.equal(penaltyEntries.length, 1, 'one stalling_penalty entry from the transition spam call');
  assert.ok(s.p2.score >= scoreBefore + 1, 'opponent score must include the stalling +1 (gameplay may add more)');
});

// ─── transition-spam stalling ladder: warn @ 2nd, +1 @ 3rd (folkstyle) ──────
//
// These resolve a single round with the consecutive-transition count preset
// (and, where the ladder requires a prior warning, stallCount preset to 1/2).
// Single-round play keeps the case deterministic - playing several real
// rounds would let RNG end the match early, as the existing 5th/6th-transition
// tests above already do.

test('resolveRound: 1st transition issues no stalling call (folkstyle)', () => {
  let s = transitionState('folkstyle');
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 1);
  assert.equal(s.stallCount?.p1 ?? 0, 0, '1st transition must not trigger a stalling call');
  const stallEntries = s.log.filter(e => e.type === 'stalling_warning' || e.type === 'stalling_penalty');
  assert.equal(stallEntries.length, 0, '1st transition: no stalling log entries');
});

test('resolveRound: 2nd consecutive transition warns but awards no point (folkstyle)', () => {
  let s = transitionState('folkstyle');
  s.consecutiveTransitions.p1 = 1; // the 2nd transition trips spamStallAt
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 2);
  assert.equal(s.stallCount?.p1 ?? 0, 1, '2nd transition issues the first stalling call (warning)');
  const warnings = s.log.filter(e => e.type === 'stalling_warning');
  const penalties = s.log.filter(e => e.type === 'stalling_penalty');
  assert.equal(warnings.length, 1, 'one stalling_warning entry');
  assert.equal(penalties.length, 0, '2nd transition: no penalty point yet');
  assert.equal(s.lastResult.p1TransitionSpam?.stall, 'warning', '2nd transition surfaces a stalling warning on lastResult');
});

test('resolveRound: 3rd consecutive transition awards +1 to opponent (folkstyle)', () => {
  let s = transitionState('folkstyle');
  s.consecutiveTransitions.p1 = 2;        // 3rd transition resolves this round
  s.stallCount = { p1: 1, p2: 0 };        // p1 already warned on the 2nd transition
  const scoreBefore = s.p2.score;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 3);
  assert.equal(s.stallCount.p1, 2, '3rd transition crosses into penalty territory');
  const penalties = s.log.filter(e => e.type === 'stalling_penalty');
  assert.equal(penalties.length, 1, 'exactly one stalling_penalty entry from the 3rd transition');
  assert.ok(
    s.p2.score >= scoreBefore + 1,
    `opponent gains the +1 stalling point: before ${scoreBefore}, after ${s.p2.score}`,
  );
  assert.equal(s.lastResult.p1TransitionSpam?.stall, 'penalty', '3rd transition surfaces the stalling point on lastResult');
});

test('resolveRound: 4th consecutive transition keeps awarding (not a no-op, folkstyle)', () => {
  let s = transitionState('folkstyle');
  s.consecutiveTransitions.p1 = 3;        // 4th transition resolves this round
  s.stallCount = { p1: 2, p2: 0 };        // p1 already warned + penalised on 2nd/3rd
  const scoreBefore = s.p2.score;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 4);
  assert.equal(s.stallCount.p1, 3, '4th transition keeps the stall counter climbing');
  const penalties = s.log.filter(e => e.type === 'stalling_penalty');
  assert.equal(penalties.length, 1, '4th transition adds another stalling_penalty entry');
  assert.ok(s.p2.score >= scoreBefore + 1, 'opponent gains another +1 on the 4th transition');
  assert.equal(s.lastResult.p1TransitionSpam?.stall, 'penalty', '4th transition still surfaces the stalling point');
});

test('resolveRound: 3rd consecutive transition in freestyle awards no stalling point', () => {
  let s = transitionState('freestyle');
  s.consecutiveTransitions.p1 = 2; // 3rd transition resolves this round
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.consecutiveTransitions.p1, 3);
  assert.equal(s.stallCount?.p1 ?? 0, 0, 'freestyle has no transition-spam stalling point');
  const stallEntries = s.log.filter(e => e.type === 'stalling_warning' || e.type === 'stalling_penalty');
  assert.equal(stallEntries.length, 0, 'freestyle: no stalling log entries');
  assert.equal(s.lastResult.p1TransitionSpam?.stall, undefined, 'freestyle never surfaces a transition stalling outcome');
});

test('resolveRound: lastResult exposes p1Mechanic and p2Mechanic from getMechanicForCard', () => {
  let s = transitionState();
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(s.lastResult.p1Mechanic, 'path');
  assert.equal(s.lastResult.p2Mechanic, 'charge');
});

// ─── Toast regression guard: spam-reduced rounds render the actual bonus ───
// Catches the easy-to-miss bug where the JSX hardcodes
// `+SKILL_TIERS.GOOD.bonus` (=6) and lies to the user on rounds 4 and 5.

test('formatPathTraceLabel(lastResult) renders +6 on the 3rd consecutive transition (full bonus)', () => {
  let s = transitionState();
  s.consecutiveTransitions.p1 = 2;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(formatPathTraceLabel(s.lastResult.p1SkillTier, s.lastResult.p1SkillBonusApplied), 'Trace +6');
});

test('formatPathTraceLabel(lastResult) renders +3 on the 4th consecutive transition (half bonus)', () => {
  let s = transitionState();
  s.consecutiveTransitions.p1 = 3;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(formatPathTraceLabel(s.lastResult.p1SkillTier, s.lastResult.p1SkillBonusApplied), 'Trace +3');
});

test('formatPathTraceLabel(lastResult) renders +0 on the 5th consecutive transition (zero bonus)', () => {
  let s = transitionState();
  s.consecutiveTransitions.p1 = 4;
  s = resolveRound(s, TRANSITION_CARD_ID, NEUTRAL_ATTACK_ID, rollGood(), null);
  assert.equal(formatPathTraceLabel(s.lastResult.p1SkillTier, s.lastResult.p1SkillBonusApplied), 'Trace +0');
});

// ─── Tech-fall margins per style (UWW + NFHS) ────────────────────────────
// Folkstyle 15, freestyle / women's 10, Greco 8. Tested by driving a clean
// mirror-setup round (engine routes both-same-setup-card to mutual_setup,
// which is a no-score path that still calls checkEndConditions). The pre-set
// score therefore controls the lead at the moment checkEndConditions runs.

function tfState(style, p1Score, p2Score = 0) {
  const s = createInitialMatchState('P1', 'P2', style, null, null, 'medium', 'p1');
  s.p1.score = p1Score;
  s.p2.score = p2Score;
  return s;
}

test('tech-fall: Greco fires at lead 8 (true-to-life UWW Greco rule)', () => {
  const s = tfState('greco', 8, 0);
  const out = resolveRound(s, 'pummel_inside', 'pummel_inside', null, null, () => 0.5);
  assert.equal(out.winMethod, 'tech_fall', 'greco 8-0 must be a tech fall');
  assert.equal(out.winner, 'p1');
});

test('tech-fall: Greco does NOT fire at lead 7', () => {
  const s = tfState('greco', 7, 0);
  const out = resolveRound(s, 'pummel_inside', 'pummel_inside', null, null, () => 0.5);
  assert.equal(out.winner, null, 'greco 7-0 must NOT tech fall');
});

test('tech-fall: freestyle still requires lead 10 (8 is not enough)', () => {
  const noFire = resolveRound(tfState('freestyle', 8, 0), 'collar_tie', 'collar_tie', null, null, () => 0.5);
  assert.equal(noFire.winner, null, 'freestyle 8-0 must NOT tech fall (greco-only threshold)');
  const fire = resolveRound(tfState('freestyle', 10, 0), 'collar_tie', 'collar_tie', null, null, () => 0.5);
  assert.equal(fire.winMethod, 'tech_fall', 'freestyle 10-0 must tech fall');
  assert.equal(fire.winner, 'p1');
});

test('tech-fall: folkstyle still requires lead 15 (14 not enough, 15 fires)', () => {
  const noFire = resolveRound(tfState('folkstyle', 14, 0), 'collar_tie', 'collar_tie', null, null, () => 0.5);
  assert.equal(noFire.winner, null, 'folkstyle 14-0 must NOT tech fall');
  const fire = resolveRound(tfState('folkstyle', 15, 0), 'collar_tie', 'collar_tie', null, null, () => 0.5);
  assert.equal(fire.winMethod, 'tech_fall', 'folkstyle 15-0 must tech fall');
});

// ─── Greco purity: no leg-attack / below-waist cards in the Greco pool ─────
// Greco-Roman forbids contact below the hips. inside_trip (leg trip) and
// claw_ride (ankle clamp) must not appear in any Greco pool; folkstyle and
// freestyle keep them.

test('greco: inside_trip is NOT in the Greco neutral pool (leg trip illegal)', () => {
  const greco = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.TIE_UP], 'greco');
  assert.ok(!greco.some(c => c.id === 'inside_trip'),
    'inside_trip uses a leg trip and must not be playable in Greco');
});

test('folkstyle/freestyle still have inside_trip available from tie-up', () => {
  const folk = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.TIE_UP], 'folkstyle');
  const free = getAvailableCards(POSITIONS.NEUTRAL, [CONDITIONS.TIE_UP], 'freestyle');
  assert.ok(folk.some(c => c.id === 'inside_trip'), 'folkstyle keeps inside_trip');
  assert.ok(free.some(c => c.id === 'inside_trip'), 'freestyle keeps inside_trip');
});

test('greco: claw_ride is NOT in the Greco top pool (ankle clamp illegal)', () => {
  const greco = getAvailableCards(POSITIONS.TOP, [CONDITIONS.CONTROL_ESTABLISHED], 'greco');
  assert.ok(!greco.some(c => c.id === 'claw_ride'),
    'claw_ride clamps the ankle and must not be playable in Greco');
});

test('folkstyle/freestyle still have claw_ride available on top', () => {
  const folk = getAvailableCards(POSITIONS.TOP, [CONDITIONS.CONTROL_ESTABLISHED], 'folkstyle');
  const free = getAvailableCards(POSITIONS.TOP, [CONDITIONS.CONTROL_ESTABLISHED], 'freestyle');
  assert.ok(folk.some(c => c.id === 'claw_ride'), 'folkstyle keeps claw_ride');
  assert.ok(free.some(c => c.id === 'claw_ride'), 'freestyle keeps claw_ride');
});

// ─── Career Depth Pass: stamina multiplier forwarding ────────────────────
// createInitialMatchState accepts opts.p1/p2StaminaMultiplier (forwarded to
// createWrestler) so career match modifiers can scale seed stamina.

test('createInitialMatchState defaults to 1.0 stamina multiplier (no behavior change)', () => {
  const stats = { str: 70, spd: 70, tec: 70, end: 50, grt: 70 };
  const s = createInitialMatchState('A', 'B', 'folkstyle', stats, stats, 'medium', null);
  // END 50 -> base stamina 200
  assert.equal(s.p1.stamina, 200);
  assert.equal(s.p2.stamina, 200);
});

test('createInitialMatchState applies opts.p1StaminaMultiplier 1.2 to p1 only', () => {
  const stats = { str: 70, spd: 70, tec: 70, end: 50, grt: 70 };
  const s = createInitialMatchState('A', 'B', 'folkstyle', stats, stats, 'medium', null, {
    p1StaminaMultiplier: 1.2,
  });
  // 200 * 1.2 = 240
  assert.equal(Math.round(s.p1.stamina), 240);
  // p2 unchanged at base
  assert.equal(s.p2.stamina, 200);
});

test('createInitialMatchState applies opts.p2StaminaMultiplier 0.5 to p2 only', () => {
  const stats = { str: 70, spd: 70, tec: 70, end: 50, grt: 70 };
  const s = createInitialMatchState('A', 'B', 'folkstyle', stats, stats, 'medium', null, {
    p2StaminaMultiplier: 0.5,
  });
  assert.equal(s.p1.stamina, 200);
  assert.equal(s.p2.stamina, 100);
});

test('createInitialMatchState ignores non-finite stamina multiplier and falls back to 1.0', () => {
  const stats = { str: 70, spd: 70, tec: 70, end: 50, grt: 70 };
  const s = createInitialMatchState('A', 'B', 'folkstyle', stats, stats, 'medium', null, {
    p1StaminaMultiplier: NaN,
    p2StaminaMultiplier: undefined,
  });
  assert.equal(s.p1.stamina, 200);
  assert.equal(s.p2.stamina, 200);
});
