// src/lib/cardArchetypeMechanics.js
// Maps card categories to skill mechanic types and tuning constants.
// Used by CardSkillChallenge to render the right post-selection minigame
// and by resolveRound() to apply skill bonuses.

import { scoreTrace, getReferencePolyline } from './pathPatterns.js';

// TRACE  = 2-arrow directional swipe sequence (top_turns cards).
// PATH   = polyline-follow gesture (transition cards). DIFFERENT mechanic
//          from TRACE despite both being called "trace" colloquially.
export const MECHANIC_TYPES = {
  CHARGE:   'charge',
  REACTION: 'reaction',
  TRACE:    'trace',
  BURST:    'burst',
  PATH:     'path',
  NONE:     'none',
};

// Tuning constants per mechanic. Tweak these without touching components.
export const MECHANIC_TUNING = {
  charge: {
    fillDurationMs: 1200,   // 0% → 100% fill time
    perfectZone: [0.70, 0.90],
    goodZone:    [0.55, 0.95],
    overcommitPenalty: false, // future: enable for hardcore mode
  },
  reaction: {
    promptDelayMs: [300, 600], // random jitter before prompt
    // Widened by +500ms in v5 (2026-04-30) - the user noticed the
    // perfect window felt too narrow during the green-button reaction
    // mini-game. Good window bumped by the same +500ms so the tier
    // ordering (perfect < good) stays intact and the GOOD tier remains
    // reachable above the PERFECT cutoff.
    perfectWindowMs: 750,
    goodWindowMs:    950,
    timeoutMs:       5000,
  },
  trace: {
    arrowCount: 2,          // 2 directional arrows shown
    perfectWindowMs: 900,
    goodWindowMs:    1300,
    timeoutMs:       5000,
  },
  burst: {
    windowMs: 2000,         // ~18 taps max at fast pace (~9 taps/sec)
    perfectTaps: 10,        // 10+ taps = perfect
    goodTaps:    6,         // 6-9 = good
  },
  path: {
    perfectDevPx:        18,    // average per-sample deviation cap for PERFECT
    goodDevPx:           42,    // average deviation cap for GOOD (else MISS)
    strokeTimeoutMs:     5000,  // idle/no-stroke-end timeout
    sampleHzMaxClient:   15,    // client-side sample throttle target
    spamStallAt:         2,     // folkstyle: 2nd consecutive transition = stalling
                                // warning, 3rd (+ every further) = +1 to opponent
    spamWarnAt:          3,     // 3 consecutive transitions: warning toast
    spamHalfBonusAt:     4,     // 4 consecutive: skill bonus halved
    spamZeroAndStallAt:  5,     // 5 consecutive: skill bonus zeroed (stalling via spamStallAt)
  },
};

// Bonus tiers. Same across mechanics for consistency.
// bonus = flat power addition; rngRange = ± variance ceiling.
//
// Balance invariants (BOTH must hold so the skill gate is real):
//   PERFECT floor > MISS ceiling -> PERFECT beats MISS on mirror matchup.
//   GOOD    floor > MISS ceiling -> GOOD    beats MISS on mirror matchup.
//
// The second invariant was added in v5 (2026-04-30) after a player
// reported "I lost a double-leg-vs-double-leg with +4 advantage and
// stamina edge, opponent did nothing." Trace: GOOD was [0, +10] (bonus
// 5, rng +/-5) and MISS was [-3, +3]. A low GOOD roll (0) could lose
// to a high MISS roll (+3). Tightening GOOD's variance (rng +/-2) and
// nudging the bonus up by 1 puts the floor at +4 strictly above the
// MISS ceiling.
//
//   PERFECT: bonus 10, rng +/-4 -> [+6, +14]  floor = +6
//   GOOD:    bonus  6, rng +/-2 -> [+4,  +8]  floor = +4   (was [0, +10])
//   MISS:    bonus  0, rng +/-3 -> [-3,  +3]  ceiling = +3
//
//   PERFECT floor (+6) > MISS ceiling (+3): unchanged.
//   GOOD    floor (+4) > MISS ceiling (+3): NEW guarantee.
//   PERFECT floor (+6) <= GOOD ceiling (+8): PERFECT-vs-GOOD on mirrors
//     is intentionally swingy - PERFECT averages higher (+10 vs +6) but
//     a great GOOD roll can still tie or eke out a lucky win. Reflects
//     that GOOD is "competent timing" and PERFECT is "elite timing"
//     while keeping the gap closer than PERFECT-vs-MISS.
export const SKILL_TIERS = {
  PERFECT: { bonus: 10, narrowRng: true,  rngRange: 4 },
  GOOD:    { bonus:  6, narrowRng: true,  rngRange: 2 },
  MISS:    { bonus:  0, narrowRng: false, rngRange: 3 },
};

const CATEGORY_TO_MECHANIC = {
  neutral_attack:  MECHANIC_TYPES.CHARGE,
  throw:           MECHANIC_TYPES.CHARGE,
  par_terre_top:   MECHANIC_TYPES.CHARGE,
  neutral_counter: MECHANIC_TYPES.REACTION,
  top_turns:       MECHANIC_TYPES.TRACE,    // 2-arrow swipe
  bottom:          MECHANIC_TYPES.BURST,
  transition:      MECHANIC_TYPES.PATH,     // polyline trace (different from TRACE)
};

export function getMechanicForCard(card) {
  if (!card?.category) return MECHANIC_TYPES.NONE;
  return CATEGORY_TO_MECHANIC[card.category] ?? MECHANIC_TYPES.NONE;
}

export function getMissResult() {
  return { tier: 'MISS', ...SKILL_TIERS.MISS };
}

// ─── Server / shared mechanic logic ──────────────────────────────────────
//
// Used by the authoritative online server to (1) generate per-challenge
// random parameters with a server-controlled rng, and (2) compute the
// tier from a captured event log + RTT compensation. Pure functions, no
// browser deps - importable by Node ESM.
//
// The components in src/components/wrestling/skillMechanics keep their
// existing inline logic for offline / vs-AI play. Online mode flows:
//   1. Server: params = generateChallengeParams(mechanic, room.challengeRngP1)
//   2. Server: ship params to the picking client (except reaction - secret)
//   3. Client: render mini-game using server params; emit input events
//   4. Server: tier = computeChallengeTier(mechanic, params, events, rtt)

// Anti-cheat floors (matches server-online/config.mjs defaults). When the
// server runs computeChallengeTier it passes `rttCorrectionMs` from its
// per-connection RTT estimator. Offline callers pass 0.
export const HUMAN_LIMITS = {
  press_min_offset_ms:      50,    // any event before this offset = pre-arrival cheat
  charge_min_held_ms:       100,   // < 100ms hold = bot
  trace_min_swipe_gap_ms:   80,    // < 80ms between swipes = bot
  burst_max_taps_per_sec:   25,    // > 25 taps/s = autoclicker
  reaction_min_ms:          150,   // sub-150ms reaction = bot or pre-tap
  path_min_samples:         8,     // fewer samples than this = tap, not trace
  path_max_samples_per_sec: 25,    // matches global RATE_LIMITS.challenge_inputs_per_sec
};

const TIER_RESULT = {
  PERFECT: { tier: 'PERFECT', ...SKILL_TIERS.PERFECT },
  GOOD:    { tier: 'GOOD',    ...SKILL_TIERS.GOOD },
  MISS:    { tier: 'MISS',    ...SKILL_TIERS.MISS },
};

function rngInt(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * Generate per-challenge random parameters.
 * @param {string} mechanic - one of MECHANIC_TYPES
 * @param {() => number} rng - 0-1 random source (Math.random or seeded)
 * @returns {object} mechanic-specific params
 */
export function generateChallengeParams(mechanic, rng = Math.random) {
  switch (mechanic) {
    case MECHANIC_TYPES.CHARGE: {
      // Mirrors ChargeMechanic.jsx: center in [0.40, 0.78], width 0.20.
      const center = 0.40 + rng() * 0.38;
      const pLo = +(center - 0.10).toFixed(3);
      const pHi = +(center + 0.10).toFixed(3);
      return {
        perfectZone: [pLo, pHi],
        goodZone:    [Math.max(0, pLo - 0.12), Math.min(1, pHi + 0.12)],
        fillDurationMs: MECHANIC_TUNING.charge.fillDurationMs,
      };
    }
    case MECHANIC_TYPES.REACTION: {
      // Mirrors ReactionMechanic.jsx randomization. NEVER ship these to
      // the client over the network - server keeps them secret so a
      // modified client can't predict the prompt time.
      const hasFake = rng() < 0.45;
      const fakeDelayMs = hasFake ? 250 + Math.floor(rng() * 400) : null;
      const fakeDurationMs = hasFake ? 200 + Math.floor(rng() * 150) : null;
      const realExtraDelayMs = hasFake ? 200 + Math.floor(rng() * 300) : null;
      // Base delay used when there is no fake.
      const [lo, hi] = MECHANIC_TUNING.reaction.promptDelayMs;
      const baseDelayMs = lo + Math.floor(rng() * (hi - lo + 1));
      // realPromptDelayMs is server-side time-from-startedAt to fire 'reaction_go'.
      const realPromptDelayMs = hasFake
        ? fakeDelayMs + fakeDurationMs + realExtraDelayMs
        : baseDelayMs;
      return {
        hasFake,
        fakeDelayMs,
        fakeDurationMs,
        realExtraDelayMs,
        baseDelayMs,
        realPromptDelayMs,
        perfectWindowMs: MECHANIC_TUNING.reaction.perfectWindowMs,
        goodWindowMs:    MECHANIC_TUNING.reaction.goodWindowMs,
      };
    }
    case MECHANIC_TYPES.TRACE: {
      const dirs = ['up', 'right', 'down', 'left'];
      const count = MECHANIC_TUNING.trace.arrowCount;
      const sequence = Array.from({ length: count }, () => dirs[Math.floor(rng() * 4)]);
      return {
        sequence,
        perfectWindowMs: MECHANIC_TUNING.trace.perfectWindowMs,
        goodWindowMs:    MECHANIC_TUNING.trace.goodWindowMs,
      };
    }
    case MECHANIC_TYPES.BURST: {
      return {
        perfectTaps: rngInt(rng, 8, 12),
        goodTaps:    rngInt(rng, 5, 7),
        windowMs:    rngInt(rng, 1800, 2200),
      };
    }
    case MECHANIC_TYPES.PATH: {
      return {
        patternIndex:    rngInt(rng, 0, 5),
        rotationDeg:     rngInt(rng, 0, 3) * 90,
        sizePx:          320,
        insetPx:         36,
        perfectDevPx:    MECHANIC_TUNING.path.perfectDevPx,
        goodDevPx:       MECHANIC_TUNING.path.goodDevPx,
        strokeTimeoutMs: MECHANIC_TUNING.path.strokeTimeoutMs,
      };
    }
    case MECHANIC_TYPES.NONE:
    default:
      return null;
  }
}

/**
 * Compute the tier from captured events + params.
 * @param {string} mechanic
 * @param {object} params - from generateChallengeParams (with reaction's
 *   secret fields populated server-side)
 * @param {object} ctx - { events, startedAt, promptSentAt?, rttCorrectionMs? }
 *   - events: [{ type, receivedAt, payload? }]
 *   - startedAt: server ms when challenge started
 *   - promptSentAt: server-scheduled time of reaction_go (reaction only)
 *   - rttCorrectionMs: smoothed RTT for compensation (reaction only); 0 offline
 * @returns {{tier, bonus, narrowRng, rngRange}}
 */
export function computeChallengeTier(mechanic, params, ctx) {
  const events = ctx?.events || [];
  const startedAt = ctx?.startedAt ?? 0;
  const rttCorrectionMs = ctx?.rttCorrectionMs ?? 0;

  switch (mechanic) {
    case MECHANIC_TYPES.CHARGE: {
      const presses = events.filter(e =>
        e.type === 'press' &&
        (e.receivedAt - startedAt) >= HUMAN_LIMITS.press_min_offset_ms,
      );
      const releases = events.filter(e => e.type === 'release');
      if (presses.length === 0 || releases.length === 0) return TIER_RESULT.MISS;
      if (presses.length > 1 || releases.length > 1) return TIER_RESULT.MISS;
      const press = presses[0].receivedAt;
      const release = releases[0].receivedAt;
      if (release < press) return TIER_RESULT.MISS;
      const heldMs = release - press; // RTT cancels: both client→server one-way
      if (heldMs < HUMAN_LIMITS.charge_min_held_ms) return TIER_RESULT.MISS;
      const fill = Math.max(0, Math.min(1.5, heldMs / params.fillDurationMs));
      const [pLo, pHi] = params.perfectZone;
      const [gLo, gHi] = params.goodZone;
      if (fill >= pLo && fill <= pHi) return TIER_RESULT.PERFECT;
      if (fill >= gLo && fill <= gHi) return TIER_RESULT.GOOD;
      return TIER_RESULT.MISS;
    }
    case MECHANIC_TYPES.REACTION: {
      const taps = events.filter(e => e.type === 'tap');
      if (!taps.length) return TIER_RESULT.MISS;
      const promptSentAt = ctx?.promptSentAt ?? Infinity;
      // Pre-arrival or in-fake-window taps fail.
      for (const t of taps) {
        if (t.receivedAt < startedAt + HUMAN_LIMITS.press_min_offset_ms) return TIER_RESULT.MISS;
        if (params.hasFake) {
          const fakeStart = startedAt + params.fakeDelayMs;
          const fakeEnd = fakeStart + params.fakeDurationMs;
          if (t.receivedAt >= fakeStart && t.receivedAt <= fakeEnd) return TIER_RESULT.MISS;
        }
        if (t.receivedAt < promptSentAt) return TIER_RESULT.MISS; // tapped before real go
      }
      const realTap = taps.find(t => t.receivedAt >= promptSentAt);
      if (!realTap) return TIER_RESULT.MISS;
      // Full-RTT compensation: prompt traversed server→client (halfRTT),
      // tap traversed client→server (halfRTT). User's true reaction =
      // (received - sent) - both halves = - full RTT.
      const reactionMs = realTap.receivedAt - promptSentAt - rttCorrectionMs;
      if (reactionMs < HUMAN_LIMITS.reaction_min_ms) return TIER_RESULT.MISS;
      if (reactionMs <= params.perfectWindowMs) return TIER_RESULT.PERFECT;
      if (reactionMs <= params.goodWindowMs) return TIER_RESULT.GOOD;
      return TIER_RESULT.MISS;
    }
    case MECHANIC_TYPES.TRACE: {
      const swipes = events.filter(e => e.type === 'swipe');
      if (swipes.length < params.sequence.length) return TIER_RESULT.MISS;
      const dirs = ['up', 'right', 'down', 'left'];
      // Server-tracked ordering: the Nth swipe must match params.sequence[N].
      for (let i = 0; i < params.sequence.length; i++) {
        const e = swipes[i];
        if (!dirs.includes(e.payload?.direction)) return TIER_RESULT.MISS;
        if (e.payload.direction !== params.sequence[i]) return TIER_RESULT.MISS;
      }
      // Anti-bot: gap between swipes must exceed a human floor.
      for (let i = 1; i < params.sequence.length; i++) {
        const gap = swipes[i].receivedAt - swipes[i - 1].receivedAt;
        if (gap < HUMAN_LIMITS.trace_min_swipe_gap_ms) return TIER_RESULT.MISS;
      }
      const elapsed =
        swipes[params.sequence.length - 1].receivedAt - swipes[0].receivedAt;
      if (elapsed <= params.perfectWindowMs) return TIER_RESULT.PERFECT;
      if (elapsed <= params.goodWindowMs) return TIER_RESULT.GOOD;
      return TIER_RESULT.MISS;
    }
    case MECHANIC_TYPES.BURST: {
      const taps = events.filter(e => e.type === 'tap');
      if (!taps.length) return TIER_RESULT.MISS;
      const first = taps[0].receivedAt;
      const inWindow = taps.filter(t => t.receivedAt - first <= params.windowMs);
      // Anti-flood: server enforces tap-rate ceiling; if any 1s sliding
      // window has more taps than the limit, treat as MISS (caller should
      // also drop suspicious taps before they reach this function).
      let suspicious = false;
      for (let i = 0; i < inWindow.length; i++) {
        const t0 = inWindow[i].receivedAt;
        let count = 0;
        for (let j = i; j < inWindow.length; j++) {
          if (inWindow[j].receivedAt - t0 <= 1000) count++;
          else break;
        }
        if (count > HUMAN_LIMITS.burst_max_taps_per_sec) {
          suspicious = true;
          break;
        }
      }
      if (suspicious) return TIER_RESULT.MISS;
      const tapsInWindow = inWindow.length;
      if (tapsInWindow >= params.perfectTaps) return TIER_RESULT.PERFECT;
      if (tapsInWindow >= params.goodTaps) return TIER_RESULT.GOOD;
      return TIER_RESULT.MISS;
    }
    case MECHANIC_TYPES.PATH: {
      // 1) Require an explicit stroke_end. Timeout path => no stroke_end => MISS.
      if (!events.some(e => e.type === 'stroke_end')) return TIER_RESULT.MISS;

      // 2) Filter + validate sample events. Drop invalid silently.
      const samples = [];
      for (const e of events) {
        if (e.type !== 'sample') continue;
        const p = e.payload;
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        samples.push({ x: p.x, y: p.y, t: Number.isFinite(p.t) ? p.t : null });
      }

      // 3) Floor on sample count.
      if (samples.length < HUMAN_LIMITS.path_min_samples) return TIER_RESULT.MISS;

      // 4) Sliding 1s window: > path_max_samples_per_sec = bot.
      // receivedAt-bearing events live in `events`; samples we extracted lose
      // it. Re-derive against the filtered sequence so the rate check sees the
      // actual server-receive cadence.
      const sampleArrivals = events
        .filter(e => e.type === 'sample' && e.payload && Number.isFinite(e.payload.x) && Number.isFinite(e.payload.y))
        .map(e => e.receivedAt)
        .sort((a, b) => a - b);
      for (let i = 0; i < sampleArrivals.length; i++) {
        let count = 0;
        for (let j = i; j < sampleArrivals.length; j++) {
          if (sampleArrivals[j] - sampleArrivals[i] <= 1000) count++;
          else break;
        }
        if (count > HUMAN_LIMITS.path_max_samples_per_sec) return TIER_RESULT.MISS;
      }

      // 5) Reconstruct deterministic reference polyline.
      const reference = getReferencePolyline(
        params.patternIndex,
        params.rotationDeg,
        params.sizePx,
        params.insetPx,
      );

      // 6) Score.
      const result = scoreTrace(samples, reference, {
        perfectDevPx: params.perfectDevPx,
        goodDevPx:    params.goodDevPx,
      });
      // 7) Map tier to TIER_RESULT (drops `reason` deliberately - reason
      //    is for client/test debugging via scoreTrace directly).
      return TIER_RESULT[result.tier] || TIER_RESULT.MISS;
    }
    case MECHANIC_TYPES.NONE:
    default:
      return TIER_RESULT.MISS;
  }
}
