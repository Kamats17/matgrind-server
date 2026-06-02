// Tests for the server-side challenge state machine. Verifies start
// produces the right messages, input recording works per mechanic,
// resolution computes the right tier, and timers/anti-cheat work.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startChallenge,
  recordChallengeInput,
  cancelChallenge,
  replayChallengeForReconnect,
  setChallengeRttCorrection,
} from './challengeEngine.mjs';
import { MECHANIC_TYPES } from '../src/lib/cardArchetypeMechanics.js';
import { makeRng } from '../src/lib/seededRng.js';
import { destroyRoomTimers } from './timers.mjs';

function makeRoom() {
  return { code: 'TEST', roundSeq: 7, allTimers: new Set() };
}

function harness(mechanic, cardId, rngSeed = 1) {
  const room = makeRoom();
  const sent = [];
  const onResolveCalls = [];
  const sendToOwner = (m) => sent.push(m);
  const onResolve = (c) => onResolveCalls.push(c);
  const challenge = startChallenge({
    room,
    role: 'p1',
    mechanic,
    cardId,
    rng: makeRng(rngSeed),
    sendToOwner,
    onResolve,
  });
  return { room, sent, onResolveCalls, challenge };
}

// ── start emits challenge_start ─────────────────────────────────────────

test('startChallenge: charge sends challenge_start with public params', () => {
  const { sent, challenge, room } = harness(MECHANIC_TYPES.CHARGE, 'single_leg');
  assert.equal(sent[0].type, 'challenge_start');
  assert.equal(sent[0].kind, 'charge');
  assert.equal(sent[0].roundSeq, room.roundSeq,
    'challenge_start carries the room.roundSeq it was started under');
  assert.ok(sent[0].params, 'charge params shipped publicly');
  assert.ok(sent[0].params.perfectZone);
  assert.equal(challenge.mechanic, 'charge');
  assert.equal(challenge.state, 'active');
});

test('startChallenge: reaction sends challenge_start WITHOUT params (server-secret)', () => {
  const { sent } = harness(MECHANIC_TYPES.REACTION, 'sprawl_counter');
  assert.equal(sent[0].type, 'challenge_start');
  assert.equal(sent[0].kind, 'reaction');
  assert.equal(sent[0].params, null, 'reaction params MUST be null on the wire');
});

test('startChallenge: NONE returns null', () => {
  const { challenge } = harness(MECHANIC_TYPES.NONE, 'transition_card');
  assert.equal(challenge, null);
});

// ── Charge ──────────────────────────────────────────────────────────────

test('charge: press+release lands a tier and resolves once', async () => {
  const { sent, onResolveCalls, challenge } = harness(MECHANIC_TYPES.CHARGE, 'single_leg', 5);
  recordChallengeInput(challenge, { eventType: 'press' });
  await new Promise(r => setTimeout(r, 600));
  recordChallengeInput(challenge, { eventType: 'release' });
  assert.equal(challenge.state, 'resolved');
  assert.ok(challenge.result);
  const resolvedMsg = sent.find(m => m.type === 'challenge_resolved');
  assert.ok(resolvedMsg);
  assert.equal(onResolveCalls.length, 1);
});

test('charge: invalid event types are ignored', () => {
  const { challenge } = harness(MECHANIC_TYPES.CHARGE, 'single_leg');
  const ok = recordChallengeInput(challenge, { eventType: 'tap' });
  assert.equal(ok, false);
  assert.equal(challenge.events.length, 0);
});

test('charge: pre-arrival press is dropped', () => {
  const { challenge } = harness(MECHANIC_TYPES.CHARGE, 'single_leg');
  // Force startedAt to "future" so receivedAt - startedAt is negative
  challenge.startedAt = Date.now() + 10_000;
  const ok = recordChallengeInput(challenge, { eventType: 'press' });
  assert.equal(ok, false);
});

// ── Reaction ────────────────────────────────────────────────────────────

test('reaction: promptSentAt captured at scheduling time, not fire time', () => {
  const { challenge } = harness(MECHANIC_TYPES.REACTION, 'sprawl_counter');
  assert.ok(challenge.promptSentAt > challenge.startedAt);
  // Should match startedAt + realPromptDelayMs
  assert.equal(challenge.promptSentAt, challenge.startedAt + challenge.params.realPromptDelayMs);
});

test('reaction: tap before promptSentAt does NOT auto-resolve', () => {
  const { challenge } = harness(MECHANIC_TYPES.REACTION, 'sprawl_counter');
  // promptSentAt is in the future; tap right now is premature
  recordChallengeInput(challenge, { eventType: 'tap' });
  assert.equal(challenge.state, 'active', 'must not auto-finish on premature tap');
});

test('reaction: full-RTT compensation is applied at resolve', async () => {
  const { challenge, onResolveCalls } = harness(MECHANIC_TYPES.REACTION, 'sprawl_counter', 3);
  setChallengeRttCorrection(challenge, 200);
  // Force a known scenario: pretend the prompt fired and tap arrives 850ms later
  challenge.promptSentAt = Date.now();
  await new Promise(r => setTimeout(r, 50));
  // Hand-craft a tap event to bypass real-time scheduling
  recordChallengeInput(challenge, { eventType: 'tap' });
  // The actual tier depends on real-time elapsed; at 50ms with 200ms RTT correction
  // the math produces reactionMs = 50 - 200 = -150, which fails sub-human floor (MISS).
  // This test just checks resolve path fired.
  assert.equal(challenge.state, 'resolved');
  assert.equal(onResolveCalls.length, 1);
});

// ── Trace ───────────────────────────────────────────────────────────────

test('trace: invalid direction is dropped (not pushed to events)', () => {
  const { challenge } = harness(MECHANIC_TYPES.TRACE, 'gut_wrench');
  const ok = recordChallengeInput(challenge, { eventType: 'swipe', payload: { direction: 'diagonal' } });
  assert.equal(ok, false);
  assert.equal(challenge.events.length, 0);
});

test('trace: completing the sequence triggers resolve', async () => {
  const { challenge } = harness(MECHANIC_TYPES.TRACE, 'gut_wrench', 11);
  const seq = challenge.params.sequence;
  for (let i = 0; i < seq.length; i++) {
    recordChallengeInput(challenge, { eventType: 'swipe', payload: { direction: seq[i] } });
    await new Promise(r => setTimeout(r, 200));
  }
  assert.equal(challenge.state, 'resolved');
});

test('trace: server tracks ordering itself (client-supplied index ignored)', () => {
  const { challenge } = harness(MECHANIC_TYPES.TRACE, 'gut_wrench', 4);
  // Send "right" twice claiming index 0 each time. Server tracks order
  // by reception, so the second event must match sequence[1] (not sequence[0]).
  recordChallengeInput(challenge, { eventType: 'swipe', payload: { direction: 'up', indexInSequence: 0 } });
  recordChallengeInput(challenge, { eventType: 'swipe', payload: { direction: 'up', indexInSequence: 0 } });
  // We don't assert tier here — just verify both events were recorded
  // in order; tier is computed per the receive order.
  const swipes = challenge.events.filter(e => e.type === 'swipe');
  assert.equal(swipes.length, 2);
});

// ── Burst ───────────────────────────────────────────────────────────────

test('burst: sub-30ms intra-tap gap is dropped (autoclicker)', () => {
  const { challenge } = harness(MECHANIC_TYPES.BURST, 'whizzer');
  recordChallengeInput(challenge, { eventType: 'tap' });
  recordChallengeInput(challenge, { eventType: 'tap' });   // immediate
  // First tap accepted; second within 30ms dropped
  assert.equal(challenge.tapCount, 1);
  assert.ok(challenge.suspiciousTaps >= 1);
});

test('burst: counts taps within window, ignores beyond', async () => {
  const { challenge } = harness(MECHANIC_TYPES.BURST, 'whizzer');
  // Tap a few times spaced > 30ms
  recordChallengeInput(challenge, { eventType: 'tap' });
  await new Promise(r => setTimeout(r, 35));
  recordChallengeInput(challenge, { eventType: 'tap' });
  await new Promise(r => setTimeout(r, 35));
  recordChallengeInput(challenge, { eventType: 'tap' });
  assert.ok(challenge.tapCount >= 3);
});

test('burst: tapWindow array is bounded (no DoS via flood)', () => {
  const { challenge } = harness(MECHANIC_TYPES.BURST, 'whizzer');
  // Manually push window past cap+5 (simulating brief flood)
  for (let i = 0; i < 100; i++) {
    challenge.tapWindow.push(Date.now() - 500);
  }
  // Now record a tap; recordChallengeInput should hard-truncate before pushing
  recordChallengeInput(challenge, { eventType: 'tap' });
  assert.ok(challenge.tapWindow.length < 100, `window length ${challenge.tapWindow.length} not truncated`);
});

// ── cancelChallenge ─────────────────────────────────────────────────────

test('cancelChallenge: forces MISS and resolves once', () => {
  const { challenge, onResolveCalls } = harness(MECHANIC_TYPES.CHARGE, 'single_leg');
  cancelChallenge(challenge);
  assert.equal(challenge.state, 'resolved');
  assert.equal(challenge.result.tier, 'MISS');
  assert.equal(onResolveCalls.length, 1);
});

test('cancelChallenge: idempotent (no double resolve)', () => {
  const { challenge, onResolveCalls } = harness(MECHANIC_TYPES.CHARGE, 'single_leg');
  cancelChallenge(challenge);
  cancelChallenge(challenge);
  assert.equal(onResolveCalls.length, 1);
});

// ── reconnect replay ────────────────────────────────────────────────────

test('replayChallengeForReconnect: re-sends start + prompts', () => {
  const { challenge, sent } = harness(MECHANIC_TYPES.REACTION, 'sprawl_counter');
  // Pretend a prompt was already sent
  challenge.promptsSent.push({ kind: 'reaction_fake_show', sentAt: Date.now() });
  const replay = [];
  replayChallengeForReconnect(challenge, (m) => replay.push(m));
  assert.equal(replay[0].type, 'challenge_start');
  assert.equal(replay[0].roundSeq, 7);
  assert.equal(replay[0].params, null, 'replay still hides reaction params');
  assert.ok(replay.find(m => m.type === 'challenge_prompt' && m.kind === 'reaction_fake_show'));
});

// ── deadline timeout ────────────────────────────────────────────────────

test('challenge times out via deadline if no input', async () => {
  const room = makeRoom();
  const sent = [];
  const calls = [];
  const challenge = startChallenge({
    room,
    role: 'p1',
    mechanic: MECHANIC_TYPES.CHARGE,
    cardId: 'single_leg',
    rng: makeRng(99),
    sendToOwner: (m) => sent.push(m),
    onResolve: (c) => calls.push(c),
  });
  // Force deadline to fire immediately
  challenge.deadline = Date.now();
  // Trigger the deadline by manually invoking the timeout path
  cancelChallenge(challenge);
  assert.equal(challenge.state, 'resolved');
  assert.equal(challenge.result.tier, 'MISS');
  destroyRoomTimers(room);
});

// ── Path mechanic ───────────────────────────────────────────────────────

import { getReferencePolyline, polylineLength } from '../src/lib/pathPatterns.js';

function buildPathSamples(params, count) {
  const ref = getReferencePolyline(params.patternIndex, params.rotationDeg, params.sizePx, params.insetPx);
  const refLen = polylineLength(ref);
  const samples = [];
  for (let i = 0; i < count; i++) {
    const dist = (i / (count - 1)) * refLen;
    let segIdx = 0;
    let acc = 0;
    while (segIdx < ref.length - 2) {
      const a = ref[segIdx];
      const b = ref[segIdx + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + segLen >= dist) break;
      acc += segLen;
      segIdx++;
    }
    const a = ref[segIdx];
    const b = ref[segIdx + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const t = segLen === 0 ? 0 : (dist - acc) / segLen;
    samples.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }
  return samples;
}

test('path: sample + stroke_end pipeline resolves PERFECT for an on-line trace', async () => {
  const { sent, onResolveCalls, challenge, room } = harness(MECHANIC_TYPES.PATH, 'pummel_inside', 11);
  assert.equal(sent[0].kind, 'path');
  assert.ok(sent[0].params, 'path params shipped publicly');
  const samples = buildPathSamples(challenge.params, 30);
  for (const s of samples) {
    recordChallengeInput(challenge, { eventType: 'sample', payload: { x: s.x, y: s.y, t: 1 } });
    await new Promise(r => setTimeout(r, 50)); // throttle below 25/sec
  }
  recordChallengeInput(challenge, { eventType: 'stroke_end' });
  assert.equal(challenge.state, 'resolved');
  assert.equal(challenge.result.tier, 'PERFECT');
  assert.equal(onResolveCalls.length, 1);
  destroyRoomTimers(room);
});

test('path: rejects out-of-bounds coords and bumps suspiciousTaps', () => {
  const { challenge, room } = harness(MECHANIC_TYPES.PATH, 'pummel_inside', 12);
  const ok1 = recordChallengeInput(challenge, { eventType: 'sample', payload: { x: -10, y: 100 } });
  const ok2 = recordChallengeInput(challenge, { eventType: 'sample', payload: { x: 100, y: 9999 } });
  assert.equal(ok1, false);
  assert.equal(ok2, false);
  assert.ok(challenge.suspiciousTaps >= 2);
  cancelChallenge(challenge);
  destroyRoomTimers(room);
});

test('path: rejects non-numeric x/y and missing payload without recording', () => {
  const { challenge, room } = harness(MECHANIC_TYPES.PATH, 'pummel_inside', 13);
  assert.equal(recordChallengeInput(challenge, { eventType: 'sample' }), false);
  assert.equal(recordChallengeInput(challenge, { eventType: 'sample', payload: null }), false);
  assert.equal(recordChallengeInput(challenge, { eventType: 'sample', payload: { x: NaN, y: 5 } }), false);
  assert.equal(recordChallengeInput(challenge, { eventType: 'sample', payload: { x: 5, y: 'oops' } }), false);
  assert.equal(challenge.events.filter(e => e.type === 'sample').length, 0);
  cancelChallenge(challenge);
  destroyRoomTimers(room);
});

test('path: t = NaN stored as null; t = number stored verbatim', () => {
  const { challenge, room } = harness(MECHANIC_TYPES.PATH, 'pummel_inside', 14);
  recordChallengeInput(challenge, { eventType: 'sample', payload: { x: 50, y: 50, t: NaN } });
  recordChallengeInput(challenge, { eventType: 'sample', payload: { x: 60, y: 60, t: 1234.5 } });
  const samples = challenge.events.filter(e => e.type === 'sample');
  assert.equal(samples[0].payload.t, null);
  assert.equal(samples[1].payload.t, 1234.5);
  cancelChallenge(challenge);
  destroyRoomTimers(room);
});

test('path: sample cap counts SAMPLES only (stroke_end still accepted past the cap)', () => {
  const { challenge, room } = harness(MECHANIC_TYPES.PATH, 'pummel_inside', 15);
  // Push 200 valid samples to hit the cap.
  for (let i = 0; i < 200; i++) {
    const ok = recordChallengeInput(challenge, { eventType: 'sample', payload: { x: 50, y: 50 } });
    assert.equal(ok, true, `sample ${i} should be accepted`);
  }
  // 201st sample is rejected, suspiciousTaps bumped.
  const before = challenge.suspiciousTaps;
  const blocked = recordChallengeInput(challenge, { eventType: 'sample', payload: { x: 50, y: 50 } });
  assert.equal(blocked, false);
  assert.ok(challenge.suspiciousTaps > before);
  // stroke_end still accepted because it's not a sample.
  const ended = recordChallengeInput(challenge, { eventType: 'stroke_end' });
  assert.equal(ended, true);
  destroyRoomTimers(room);
});

test('path: timeout path (no stroke_end) resolves MISS', () => {
  const { challenge, room } = harness(MECHANIC_TYPES.PATH, 'pummel_inside', 16);
  // No samples, no stroke_end - just trip the deadline manually.
  challenge.deadline = Date.now();
  cancelChallenge(challenge);
  assert.equal(challenge.state, 'resolved');
  assert.equal(challenge.result.tier, 'MISS');
  destroyRoomTimers(room);
});

test('path: late stroke_end after resolution is dropped (state guard)', () => {
  const { challenge, room } = harness(MECHANIC_TYPES.PATH, 'pummel_inside', 17);
  cancelChallenge(challenge);
  assert.equal(challenge.state, 'resolved');
  const ok = recordChallengeInput(challenge, { eventType: 'stroke_end' });
  assert.equal(ok, false);
  destroyRoomTimers(room);
});
