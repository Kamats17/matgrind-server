// Authoritative challenge state machine for the online server. One
// ChallengeInstance per (room, role) at a time. The server picks all
// random parameters (with a per-role rng) and measures all timing in
// its own clock. Tier computation lives in
// src/lib/cardArchetypeMechanics.js so the math is shared with the
// offline path.
//
// Key invariants:
//   - Reaction params are NEVER shipped to the client. Server schedules
//     prompt timers and the client receives `challenge_prompt` messages
//     when red/green visuals should appear.
//   - All timers go through scheduleTimer / clearScheduled so they're
//     auto-drained on room destroy.
//   - Every challenge resolves exactly once via `onResolve`. Multiple
//     paths (input sufficient, deadline fired, opponent disconnect)
//     converge through `_finish`.

import crypto from 'node:crypto';
import {
  MECHANIC_TYPES,
  generateChallengeParams,
  computeChallengeTier,
} from '../src/lib/cardArchetypeMechanics.js';
import { scheduleTimer, clearScheduled } from './timers.mjs';
import { TIMING, HUMAN_LIMITS } from './config.mjs';
import { incCounter } from './metrics.mjs';

/**
 * @typedef {Object} ChallengeInstance
 * @property {string} id
 * @property {string} roomCode
 * @property {'p1'|'p2'} ownerRole
 * @property {string} cardId
 * @property {string} mechanic
 * @property {object} params               // mechanic-specific
 * @property {'pending'|'active'|'resolved'} state
 * @property {number} startedAt            // server ms
 * @property {number} deadline             // server ms
 * @property {Array<{type, receivedAt, payload?}>} events
 * @property {object|null} result          // {tier, bonus, narrowRng, rngRange}
 * @property {number|null} promptSentAt    // reaction-only; captured at scheduling time
 * @property {Array<{kind, sentAt}>} promptsSent  // for reconnect replay
 * @property {object|null} timeoutHandle
 * @property {Array<object>} promptHandles
 * @property {Function} onResolve
 * @property {number|null} firstTapAt      // burst
 * @property {number} tapCount             // burst counter (not array)
 * @property {Array<number>} tapWindow     // burst sliding-window
 * @property {number|null} lastTapAt       // burst intra-arrival drop
 * @property {number} suspiciousTaps       // metrics
 */

/**
 * Start a new challenge. Returns the instance (also stored at
 * room.challenges[role] by the caller).
 *
 * @param {object} args
 * @param {object} args.room
 * @param {'p1'|'p2'} args.role
 * @param {string} args.mechanic - one of MECHANIC_TYPES
 * @param {string} args.cardId
 * @param {() => number} [args.rng] - per-role challengeRng (only used when
 *   no preGenParams supplied; current code path always supplies them)
 * @param {object} [args.preGenParams] - the params already generated and
 *   shipped to the client via state_update.preGeneratedChallenges. When
 *   supplied, used VERBATIM so the client renders the exact mini-game the
 *   server grades against. This is the canonical path; rng-based generation
 *   is a legacy fallback for code that hasn't been migrated.
 * @param {(msg: object) => void} args.sendToOwner - sender for private messages
 * @param {(challenge: ChallengeInstance) => void} args.onResolve - called once
 *   when tier is final (input or timeout)
 * @returns {ChallengeInstance|null} null if mechanic is NONE
 */
export function startChallenge({ room, role, mechanic, cardId, rng, preGenParams, sendToOwner, onResolve }) {
  if (mechanic === MECHANIC_TYPES.NONE) {
    return null;
  }
  // Use the pre-generated params if supplied (canonical: client and server
  // grade against the same shape). Fall back to fresh generation only when
  // a caller hasn't migrated.
  const params = preGenParams || generateChallengeParams(mechanic, rng);
  const startedAt = Date.now();

  const challenge = {
    id: 'cha-' + crypto.randomUUID(),
    roomCode: room.code,
    room,                               // kept so _finish can clearScheduled(room, handle)
    ownerRole: role,
    cardId,
    mechanic,
    params,
    state: 'active',
    startedAt,
    deadline: computeDeadline(mechanic, startedAt, params),
    events: [],
    result: null,
    promptSentAt: null,
    promptsSent: [],
    timeoutHandle: null,
    promptHandles: [],
    onResolve,
    sendToOwner,
    // Burst state
    firstTapAt: null,
    tapCount: 0,
    tapWindow: [],
    lastTapAt: null,
    suspiciousTaps: 0,
  };

  // Public params shipped to client EXCEPT for reaction (server-secret).
  const publicParams = mechanic === MECHANIC_TYPES.REACTION ? null : params;
  sendToOwner({
    type: 'challenge_start',
    challengeId: challenge.id,
    kind: mechanic,
    cardId,                          // (Codex P1) durable card identity so
                                     // reconnect/remount can rebuild the
                                     // mini-game UI even when the client's
                                     // lastPickedCardRef is no longer set.
    roundSeq: room.roundSeq,
    params: publicParams,
    deadline: challenge.deadline,
  });

  // Reaction: schedule prompts server-side, capture promptSentAt at
  // scheduling time (not fire time) to avoid event-loop ordering races.
  if (mechanic === MECHANIC_TYPES.REACTION) {
    if (params.hasFake) {
      const fakeShowAt = startedAt + params.fakeDelayMs;
      const fakeHideAt = startedAt + params.fakeDelayMs + params.fakeDurationMs;
      const showHandle = scheduleTimer(room,
        () => _firePrompt(challenge, 'reaction_fake_show', fakeShowAt),
        params.fakeDelayMs);
      const hideHandle = scheduleTimer(room,
        () => _firePrompt(challenge, 'reaction_fake_hide', fakeHideAt),
        params.fakeDelayMs + params.fakeDurationMs);
      challenge.promptHandles.push(showHandle, hideHandle);
    }
    // Capture promptSentAt at scheduling time. Any tap arriving before
    // this scheduled fire time is treated as "before the go" (MISS).
    challenge.promptSentAt = startedAt + params.realPromptDelayMs;
    const goHandle = scheduleTimer(room,
      () => _firePrompt(challenge, 'reaction_go', challenge.promptSentAt),
      params.realPromptDelayMs);
    challenge.promptHandles.push(goHandle);
  }

  challenge.timeoutHandle = scheduleTimer(room,
    () => _timeoutChallenge(challenge),
    challenge.deadline - startedAt);

  return challenge;
}

function computeDeadline(mechanic, startedAt, params) {
  switch (mechanic) {
    case MECHANIC_TYPES.CHARGE:
      return startedAt + TIMING.charge_deadline_ms;
    case MECHANIC_TYPES.REACTION:
      return startedAt + params.realPromptDelayMs + TIMING.reaction_grace_ms;
    case MECHANIC_TYPES.TRACE:
      return startedAt + TIMING.trace_deadline_ms;
    case MECHANIC_TYPES.BURST:
      return startedAt + params.windowMs + TIMING.burst_grace_ms;
    default:
      return startedAt + 5000;
  }
}

function _firePrompt(challenge, kind, scheduledFor) {
  if (challenge.state !== 'active') return;
  challenge.promptsSent.push({ kind, sentAt: Date.now() });
  challenge.sendToOwner({
    type: 'challenge_prompt',
    challengeId: challenge.id,
    kind,
  });
}

/**
 * Record a client input event. May resolve the challenge synchronously
 * if the event completes the input (e.g., release for charge).
 *
 * @param {ChallengeInstance} challenge
 * @param {{eventType: string, payload?: object}} input
 * @returns {boolean} true if accepted, false if dropped (rate limit / state)
 */
export function recordChallengeInput(challenge, input) {
  if (challenge.state !== 'active') return false;
  const eventType = String(input?.eventType || '');
  if (!eventType) return false;
  const receivedAt = Date.now();

  // Per-mechanic input validation + early resolution paths.
  switch (challenge.mechanic) {
    case MECHANIC_TYPES.CHARGE: {
      if (eventType !== 'press' && eventType !== 'release') return false;
      // Pre-arrival cheat: drop and don't record.
      if (eventType === 'press' && (receivedAt - challenge.startedAt) < HUMAN_LIMITS.press_min_offset_ms) {
        return false;
      }
      challenge.events.push({ type: eventType, receivedAt });
      // Resolve as soon as we have a release matched to a press.
      if (eventType === 'release') {
        _finish(challenge);
      }
      return true;
    }
    case MECHANIC_TYPES.REACTION: {
      if (eventType !== 'tap') return false;
      challenge.events.push({ type: 'tap', receivedAt });
      // Tier computation happens at finish; for early resolution we
      // call _finish IF the tap arrives at or after promptSentAt and
      // outside any fake window. Otherwise we keep the challenge open —
      // a fake-window tap is a MISS but we let the deadline fire so we
      // have full event log if multiple taps come in.
      const after = challenge.promptSentAt && receivedAt >= challenge.promptSentAt;
      if (after) {
        _finish(challenge);
      }
      return true;
    }
    case MECHANIC_TYPES.TRACE: {
      if (eventType !== 'swipe') return false;
      const direction = input?.payload?.direction;
      if (!['up', 'right', 'down', 'left'].includes(direction)) return false;
      challenge.events.push({ type: 'swipe', receivedAt, payload: { direction } });
      // Resolve once we have enough swipes for the sequence.
      const swipes = challenge.events.filter(e => e.type === 'swipe');
      if (swipes.length >= challenge.params.sequence.length) {
        _finish(challenge);
      }
      return true;
    }
    case MECHANIC_TYPES.BURST: {
      if (eventType !== 'tap') return false;
      // Per-tap intra-arrival drop < 30ms BEFORE any allocation
      if (challenge.lastTapAt && (receivedAt - challenge.lastTapAt) < 30) {
        challenge.suspiciousTaps += 1;
        return false;
      }
      challenge.lastTapAt = receivedAt;

      // Sliding-window cap with hard pre-truncation. Keep the array
      // bounded so a flood doesn't grow it unboundedly before shift trims.
      const win = challenge.tapWindow;
      if (win.length >= HUMAN_LIMITS.burst_max_taps_per_sec + 5) {
        win.length = HUMAN_LIMITS.burst_max_taps_per_sec;
      }
      win.push(receivedAt);
      while (win.length > 0 && receivedAt - win[0] > 1000) win.shift();
      if (win.length > HUMAN_LIMITS.burst_max_taps_per_sec) {
        challenge.suspiciousTaps += 1;
        return false;
      }

      if (challenge.firstTapAt === null) challenge.firstTapAt = receivedAt;
      // Outside window? don't count.
      if (receivedAt - challenge.firstTapAt > challenge.params.windowMs) return true;

      // Cap counter — beyond perfectTaps + 2 is wasted work.
      if (challenge.tapCount < challenge.params.perfectTaps + 2) {
        challenge.tapCount += 1;
        // Also push to events array for tier-computation reuse, capped.
        challenge.events.push({ type: 'tap', receivedAt });
      }

      // Don't auto-finish on Burst — let the deadline drive resolution
      // so we count every tap in the window.
      return true;
    }
  }
  return false;
}

function _timeoutChallenge(challenge) {
  if (challenge.state !== 'active') return;
  _finish(challenge);
}

function _finish(challenge) {
  if (challenge.state !== 'active') return;
  challenge.state = 'resolved';
  // Cancel timers AND remove their handles from room.allTimers so the
  // Set doesn't grow with dead entries across a long match.
  if (challenge.timeoutHandle) {
    clearScheduled(challenge.room, challenge.timeoutHandle);
  }
  for (const h of challenge.promptHandles) {
    clearScheduled(challenge.room, h);
  }
  challenge.timeoutHandle = null;
  challenge.promptHandles = [];

  challenge.result = computeChallengeTier(
    challenge.mechanic,
    challenge.params,
    {
      events: challenge.events,
      startedAt: challenge.startedAt,
      promptSentAt: challenge.promptSentAt ?? undefined,
      // RTT correction is supplied by the caller via the closure; we
      // attach it via the `rttCorrectionMs` property on the challenge
      // when reactions need it. Default 0.
      rttCorrectionMs: challenge.rttCorrectionMs ?? 0,
    },
  );

  // Telemetry: tier rate per mechanic + suspicious-floor counter for
  // future bot pattern detection.
  incCounter('challenge_resolved', {
    mechanic: challenge.mechanic,
    tier: challenge.result.tier,
  });
  if (challenge.suspiciousTaps > 0) {
    incCounter('challenge_suspicious_taps', { mechanic: challenge.mechanic });
  }

  challenge.sendToOwner({
    type: 'challenge_resolved',
    challengeId: challenge.id,
    tier: challenge.result.tier,
  });

  challenge.onResolve(challenge);
}

/**
 * Cancel a challenge (e.g., on disconnect / opponent gives up). Resolves
 * as MISS. Safe to call multiple times.
 */
export function cancelChallenge(challenge) {
  if (challenge.state !== 'active') return;
  // Force tier to MISS by clearing events so computeChallengeTier returns MISS.
  challenge.events = [];
  challenge.params = challenge.params || {};
  _finish(challenge);
}

/**
 * On reconnect mid-challenge, replay challenge_start + any prompts
 * already sent so the client can re-render the correct visual state.
 * Does NOT reset the deadline (the lenient extension is the room layer's
 * concern).
 */
export function replayChallengeForReconnect(challenge, sendToOwner) {
  if (challenge.state !== 'active') return;
  const publicParams = challenge.mechanic === MECHANIC_TYPES.REACTION ? null : challenge.params;
  sendToOwner({
    type: 'challenge_start',
    challengeId: challenge.id,
    kind: challenge.mechanic,
    cardId: challenge.cardId,        // (Codex P1) needed for reconnect remount
    roundSeq: challenge.room?.roundSeq,
    params: publicParams,
    deadline: challenge.deadline,
  });
  // Replay only the LATEST prompt - that's the current visual state
  // (e.g. 'reaction_go' if go has fired, or 'reaction_fake_show' if
  // the fake is still up). Earlier prompts were intermediate states
  // the user already lived through; replaying them all would fire
  // spurious haptics on reconnect for transitions they already felt.
  if (challenge.promptsSent.length > 0) {
    const latest = challenge.promptsSent[challenge.promptsSent.length - 1];
    sendToOwner({
      type: 'challenge_prompt',
      challengeId: challenge.id,
      kind: latest.kind,
    });
  }
  // Update sender so future prompts go to the new ws.
  challenge.sendToOwner = sendToOwner;
}

/**
 * Set the RTT correction ms on a challenge (called by room layer at
 * start time using the player's RttEstimator).
 */
export function setChallengeRttCorrection(challenge, ms) {
  challenge.rttCorrectionMs = ms;
}
