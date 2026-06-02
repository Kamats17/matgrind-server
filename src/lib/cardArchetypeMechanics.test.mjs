// Tests for the shared mechanic logic used by the authoritative online
// server. Pure functions, no React, no DOM.
//
// Run with: node --test src/lib/cardArchetypeMechanics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MECHANIC_TYPES,
  generateChallengeParams,
  computeChallengeTier,
  HUMAN_LIMITS,
} from './cardArchetypeMechanics.js';
import { makeRng } from './seededRng.js';

// ── generateChallengeParams ──────────────────────────────────────────────

test('generateChallengeParams charge: zone in [0.40, 0.78] center, width 0.20', () => {
  const rng = makeRng(123);
  for (let i = 0; i < 100; i++) {
    const p = generateChallengeParams(MECHANIC_TYPES.CHARGE, rng);
    const center = (p.perfectZone[0] + p.perfectZone[1]) / 2;
    assert.ok(center >= 0.40 && center <= 0.78, `center ${center} out of range`);
    assert.equal(+(p.perfectZone[1] - p.perfectZone[0]).toFixed(3), 0.2);
    assert.equal(p.fillDurationMs, 1200);
  }
});

test('generateChallengeParams reaction: hasFake roughly 45%, params well-formed', () => {
  const rng = makeRng(42);
  let fakes = 0;
  const N = 1000;
  for (let i = 0; i < N; i++) {
    const p = generateChallengeParams(MECHANIC_TYPES.REACTION, rng);
    if (p.hasFake) fakes++;
    if (p.hasFake) {
      assert.ok(p.fakeDelayMs >= 250 && p.fakeDelayMs <= 650);
      assert.ok(p.fakeDurationMs >= 200 && p.fakeDurationMs <= 350);
      assert.ok(p.realPromptDelayMs >= p.fakeDelayMs + p.fakeDurationMs);
    } else {
      assert.equal(p.fakeDelayMs, null);
      assert.equal(p.fakeDurationMs, null);
    }
  }
  // 45% expected, allow ±5pp band for 1000 samples
  assert.ok(Math.abs(fakes / N - 0.45) < 0.05, `fake rate ${(fakes / N).toFixed(3)}`);
});

test('generateChallengeParams trace: 2 directions from the 4-way set', () => {
  const rng = makeRng(99);
  const dirs = new Set(['up', 'right', 'down', 'left']);
  for (let i = 0; i < 50; i++) {
    const p = generateChallengeParams(MECHANIC_TYPES.TRACE, rng);
    assert.equal(p.sequence.length, 2);
    for (const d of p.sequence) assert.ok(dirs.has(d));
  }
});

test('generateChallengeParams burst: ranges respected', () => {
  const rng = makeRng(7);
  for (let i = 0; i < 100; i++) {
    const p = generateChallengeParams(MECHANIC_TYPES.BURST, rng);
    assert.ok(p.perfectTaps >= 8 && p.perfectTaps <= 12);
    assert.ok(p.goodTaps >= 5 && p.goodTaps <= 7);
    assert.ok(p.windowMs >= 1800 && p.windowMs <= 2200);
  }
});

test('generateChallengeParams none: returns null', () => {
  assert.equal(generateChallengeParams(MECHANIC_TYPES.NONE, Math.random), null);
});

test('generateChallengeParams is deterministic under a seeded rng', () => {
  const a = generateChallengeParams(MECHANIC_TYPES.CHARGE, makeRng(1234));
  const b = generateChallengeParams(MECHANIC_TYPES.CHARGE, makeRng(1234));
  assert.deepEqual(a, b);
});

// ── computeChallengeTier: Charge ─────────────────────────────────────────

test('charge: PERFECT when fill lands in perfect zone', () => {
  const params = { perfectZone: [0.4, 0.6], goodZone: [0.28, 0.72], fillDurationMs: 1000 };
  // Center hold = 500ms = fill 0.5 = inside [0.4, 0.6] -> PERFECT
  const events = [
    { type: 'press', receivedAt: 200 },
    { type: 'release', receivedAt: 700 },
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.CHARGE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'PERFECT');
});

test('charge: GOOD when fill in padded zone but not perfect', () => {
  const params = { perfectZone: [0.4, 0.6], goodZone: [0.28, 0.72], fillDurationMs: 1000 };
  // 350ms hold = fill 0.35 = in good zone but not perfect
  const events = [
    { type: 'press', receivedAt: 200 },
    { type: 'release', receivedAt: 550 },
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.CHARGE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'GOOD');
});

test('charge: MISS when held too long', () => {
  const params = { perfectZone: [0.4, 0.6], goodZone: [0.28, 0.72], fillDurationMs: 1000 };
  const events = [
    { type: 'press', receivedAt: 200 },
    { type: 'release', receivedAt: 1500 },  // fill 1.3, way past good
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.CHARGE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('charge: MISS when bot fires instant press+release (< 100ms held)', () => {
  const params = { perfectZone: [0.4, 0.6], goodZone: [0.28, 0.72], fillDurationMs: 1000 };
  const events = [
    { type: 'press', receivedAt: 200 },
    { type: 'release', receivedAt: 250 },  // 50ms hold, below floor
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.CHARGE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS', 'sub-100ms hold = bot');
});

test('charge: MISS when no press', () => {
  const params = { perfectZone: [0.4, 0.6], goodZone: [0.28, 0.72], fillDurationMs: 1000 };
  const events = [{ type: 'release', receivedAt: 500 }];
  const r = computeChallengeTier(MECHANIC_TYPES.CHARGE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('charge: MISS when duplicate press/release events (suspicious)', () => {
  const params = { perfectZone: [0.4, 0.6], goodZone: [0.28, 0.72], fillDurationMs: 1000 };
  const events = [
    { type: 'press', receivedAt: 200 },
    { type: 'press', receivedAt: 300 },
    { type: 'release', receivedAt: 700 },
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.CHARGE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('charge: MISS when press is pre-startedAt (cheat)', () => {
  const params = { perfectZone: [0.4, 0.6], goodZone: [0.28, 0.72], fillDurationMs: 1000 };
  // press received at startedAt+10ms, below the 50ms floor
  const events = [
    { type: 'press', receivedAt: 10 },
    { type: 'release', receivedAt: 510 },
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.CHARGE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

// ── computeChallengeTier: Reaction ───────────────────────────────────────

function reactionParams(extra = {}) {
  return {
    hasFake: false,
    fakeDelayMs: null,
    fakeDurationMs: null,
    realPromptDelayMs: 500,
    perfectWindowMs: 750,
    goodWindowMs: 950,
    ...extra,
  };
}

test('reaction: PERFECT when reactionMs <= 750', () => {
  const params = reactionParams();
  const startedAt = 0;
  const promptSentAt = 500;
  // tap arrives 200ms after promptSentAt (with 0 RTT) -> 200ms reaction = PERFECT
  const events = [{ type: 'tap', receivedAt: 700 }];
  const r = computeChallengeTier(MECHANIC_TYPES.REACTION, params, {
    events, startedAt, promptSentAt, rttCorrectionMs: 0,
  });
  assert.equal(r.tier, 'PERFECT');
});

test('reaction: full-RTT compensation pulls a borderline GOOD into PERFECT', () => {
  const params = reactionParams();
  const startedAt = 0;
  const promptSentAt = 500;
  // tap arrives 850ms after prompt, with 200ms RTT compensation -> 650ms reaction = PERFECT
  const events = [{ type: 'tap', receivedAt: 1350 }];
  const r = computeChallengeTier(MECHANIC_TYPES.REACTION, params, {
    events, startedAt, promptSentAt, rttCorrectionMs: 200,
  });
  assert.equal(r.tier, 'PERFECT');
});

test('reaction: sub-150ms reactionMs is MISS (bot floor)', () => {
  const params = reactionParams();
  const startedAt = 0;
  const promptSentAt = 500;
  const events = [{ type: 'tap', receivedAt: 600 }];  // 100ms reaction
  const r = computeChallengeTier(MECHANIC_TYPES.REACTION, params, {
    events, startedAt, promptSentAt, rttCorrectionMs: 0,
  });
  assert.equal(r.tier, 'MISS');
});

test('reaction: tap before promptSentAt is MISS (premature)', () => {
  const params = reactionParams();
  const events = [{ type: 'tap', receivedAt: 400 }];  // before prompt at 500
  const r = computeChallengeTier(MECHANIC_TYPES.REACTION, params, {
    events, startedAt: 0, promptSentAt: 500, rttCorrectionMs: 0,
  });
  assert.equal(r.tier, 'MISS');
});

test('reaction: tap inside fake window is MISS (server-determined fake-out)', () => {
  const params = reactionParams({
    hasFake: true,
    fakeDelayMs: 300,
    fakeDurationMs: 250,
    realPromptDelayMs: 800,  // fake at [300, 550], real at 800
  });
  const events = [{ type: 'tap', receivedAt: 400 }];  // mid-fake
  const r = computeChallengeTier(MECHANIC_TYPES.REACTION, params, {
    events, startedAt: 0, promptSentAt: 800, rttCorrectionMs: 0,
  });
  assert.equal(r.tier, 'MISS');
});

test('reaction: no taps -> MISS (timeout)', () => {
  const params = reactionParams();
  const r = computeChallengeTier(MECHANIC_TYPES.REACTION, params, {
    events: [], startedAt: 0, promptSentAt: 500, rttCorrectionMs: 0,
  });
  assert.equal(r.tier, 'MISS');
});

// ── computeChallengeTier: Trace ──────────────────────────────────────────

test('trace: PERFECT when sequence matches and elapsed in perfect window', () => {
  const params = { sequence: ['up', 'right'], perfectWindowMs: 900, goodWindowMs: 1300 };
  const events = [
    { type: 'swipe', receivedAt: 100, payload: { direction: 'up' } },
    { type: 'swipe', receivedAt: 600, payload: { direction: 'right' } },
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.TRACE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'PERFECT');
});

test('trace: MISS when wrong direction', () => {
  const params = { sequence: ['up', 'right'], perfectWindowMs: 900, goodWindowMs: 1300 };
  const events = [
    { type: 'swipe', receivedAt: 100, payload: { direction: 'up' } },
    { type: 'swipe', receivedAt: 400, payload: { direction: 'down' } },  // wrong
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.TRACE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('trace: MISS when client tries to spoof index by sending duplicate dir', () => {
  // Server tracks ordering itself. The Nth received swipe must match
  // params.sequence[N], regardless of any payload index claim.
  const params = { sequence: ['up', 'right'], perfectWindowMs: 900, goodWindowMs: 1300 };
  const events = [
    { type: 'swipe', receivedAt: 100, payload: { direction: 'up', indexInSequence: 0 } },
    { type: 'swipe', receivedAt: 200, payload: { direction: 'up', indexInSequence: 0 } },  // tries to repeat slot 0
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.TRACE, params, { events, startedAt: 0 });
  // Second swipe direction 'up' must match sequence[1] which is 'right' -> MISS
  assert.equal(r.tier, 'MISS');
});

test('trace: MISS when bot fires both swipes back-to-back (< 80ms gap)', () => {
  const params = { sequence: ['up', 'right'], perfectWindowMs: 900, goodWindowMs: 1300 };
  const events = [
    { type: 'swipe', receivedAt: 100, payload: { direction: 'up' } },
    { type: 'swipe', receivedAt: 130, payload: { direction: 'right' } },  // 30ms gap
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.TRACE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('trace: MISS when too few swipes', () => {
  const params = { sequence: ['up', 'right'], perfectWindowMs: 900, goodWindowMs: 1300 };
  const events = [{ type: 'swipe', receivedAt: 100, payload: { direction: 'up' } }];
  const r = computeChallengeTier(MECHANIC_TYPES.TRACE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('trace: MISS when invalid direction enum', () => {
  const params = { sequence: ['up', 'right'], perfectWindowMs: 900, goodWindowMs: 1300 };
  const events = [
    { type: 'swipe', receivedAt: 100, payload: { direction: 'diagonal' } },
    { type: 'swipe', receivedAt: 600, payload: { direction: 'right' } },
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.TRACE, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

// ── computeChallengeTier: Burst ──────────────────────────────────────────

test('burst: PERFECT when tapsInWindow >= perfectTaps', () => {
  const params = { perfectTaps: 10, goodTaps: 6, windowMs: 2000 };
  const events = [];
  for (let i = 0; i < 10; i++) events.push({ type: 'tap', receivedAt: i * 100 });
  const r = computeChallengeTier(MECHANIC_TYPES.BURST, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'PERFECT');
});

test('burst: GOOD when tapsInWindow between good and perfect', () => {
  const params = { perfectTaps: 10, goodTaps: 6, windowMs: 2000 };
  const events = [];
  for (let i = 0; i < 7; i++) events.push({ type: 'tap', receivedAt: i * 200 });
  const r = computeChallengeTier(MECHANIC_TYPES.BURST, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'GOOD');
});

test('burst: MISS when no taps', () => {
  const params = { perfectTaps: 10, goodTaps: 6, windowMs: 2000 };
  const r = computeChallengeTier(MECHANIC_TYPES.BURST, params, { events: [], startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('burst: MISS when autoclicker exceeds 25 taps/sec', () => {
  const params = { perfectTaps: 10, goodTaps: 6, windowMs: 2000 };
  const events = [];
  // Fire 30 taps in 500ms = 60 taps/sec, all in same 1s window
  for (let i = 0; i < 30; i++) events.push({ type: 'tap', receivedAt: i * 16 });
  const r = computeChallengeTier(MECHANIC_TYPES.BURST, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('burst: only counts taps within windowMs from first tap', () => {
  const params = { perfectTaps: 10, goodTaps: 6, windowMs: 1000 };
  const events = [
    // 10 taps spread over 600ms (PERFECT)
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'tap', receivedAt: i * 60 })),
    // 5 more taps after window closes - shouldn't count
    ...Array.from({ length: 5 }, (_, i) => ({ type: 'tap', receivedAt: 1500 + i * 60 })),
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.BURST, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'PERFECT');
});

// ── computeChallengeTier: None ──────────────────────────────────────────

test('none mechanic always returns MISS', () => {
  const r = computeChallengeTier(MECHANIC_TYPES.NONE, null, { events: [], startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

// ── path mechanic ───────────────────────────────────────────────────────

test('generateChallengeParams path: patternIndex in [0,5], rotation in {0,90,180,270}', () => {
  const rng = makeRng(2026);
  const seenIdx = new Set();
  const seenRot = new Set();
  for (let i = 0; i < 100; i++) {
    const p = generateChallengeParams(MECHANIC_TYPES.PATH, rng);
    assert.ok(p.patternIndex >= 0 && p.patternIndex <= 5, `patternIndex ${p.patternIndex}`);
    assert.ok([0, 90, 180, 270].includes(p.rotationDeg), `rotation ${p.rotationDeg}`);
    assert.equal(p.sizePx, 320);
    assert.equal(p.insetPx, 36);
    assert.equal(p.perfectDevPx, 18);
    assert.equal(p.goodDevPx, 42);
    assert.equal(p.strokeTimeoutMs, 5000);
    seenIdx.add(p.patternIndex);
    seenRot.add(p.rotationDeg);
  }
  assert.equal(seenIdx.size, 6, `expected all 6 pattern indexes, saw ${[...seenIdx]}`);
  assert.equal(seenRot.size, 4, `expected all 4 rotations, saw ${[...seenRot]}`);
});

test('generateChallengeParams path: deterministic for same seed', () => {
  const a = generateChallengeParams(MECHANIC_TYPES.PATH, makeRng(7));
  const b = generateChallengeParams(MECHANIC_TYPES.PATH, makeRng(7));
  assert.deepEqual(a, b);
});

// Helper: build a synthetic on-line trace from a reference polyline.
async function importPathPatterns() {
  return await import('./pathPatterns.js');
}

test('computeChallengeTier path: MISS when no stroke_end event', async () => {
  const { getReferencePolyline, polylineLength } = await importPathPatterns();
  const params = generateChallengeParams(MECHANIC_TYPES.PATH, makeRng(1));
  const ref = getReferencePolyline(params.patternIndex, params.rotationDeg, params.sizePx, params.insetPx);
  const refLen = polylineLength(ref);
  const events = [];
  // 30 on-line samples - but no stroke_end
  for (let i = 0; i < 30; i++) {
    const t = i / 29;
    const target = t * refLen;
    let segIdx = 0;
    let acc = 0;
    while (segIdx < ref.length - 2) {
      const a = ref[segIdx];
      const b = ref[segIdx + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + segLen >= target) break;
      acc += segLen;
      segIdx++;
    }
    const a = ref[segIdx];
    const b = ref[segIdx + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const tt = segLen === 0 ? 0 : (target - acc) / segLen;
    events.push({
      type: 'sample',
      receivedAt: 100 + i * 50,
      payload: { x: a.x + tt * (b.x - a.x), y: a.y + tt * (b.y - a.y), t: i },
    });
  }
  const r = computeChallengeTier(MECHANIC_TYPES.PATH, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('computeChallengeTier path: PERFECT with on-line samples + stroke_end', async () => {
  const { getReferencePolyline, polylineLength } = await importPathPatterns();
  const params = generateChallengeParams(MECHANIC_TYPES.PATH, makeRng(2));
  const ref = getReferencePolyline(params.patternIndex, params.rotationDeg, params.sizePx, params.insetPx);
  const refLen = polylineLength(ref);
  const events = [];
  for (let i = 0; i < 30; i++) {
    const tFrac = i / 29;
    const target = tFrac * refLen;
    let segIdx = 0;
    let acc = 0;
    while (segIdx < ref.length - 2) {
      const a = ref[segIdx];
      const b = ref[segIdx + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (acc + segLen >= target) break;
      acc += segLen;
      segIdx++;
    }
    const a = ref[segIdx];
    const b = ref[segIdx + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const tt = segLen === 0 ? 0 : (target - acc) / segLen;
    events.push({
      type: 'sample',
      receivedAt: 100 + i * 70,
      payload: { x: a.x + tt * (b.x - a.x), y: a.y + tt * (b.y - a.y), t: i },
    });
  }
  events.push({ type: 'stroke_end', receivedAt: 100 + 30 * 70 });
  const r = computeChallengeTier(MECHANIC_TYPES.PATH, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'PERFECT');
});

test('computeChallengeTier path: MISS when sample rate exceeds path_max_samples_per_sec', async () => {
  const { getReferencePolyline } = await importPathPatterns();
  const params = generateChallengeParams(MECHANIC_TYPES.PATH, makeRng(3));
  const ref = getReferencePolyline(params.patternIndex, params.rotationDeg, params.sizePx, params.insetPx);
  const events = [];
  // Pack 30 samples into 500 ms (60 samples/sec, > 25 cap).
  for (let i = 0; i < 30; i++) {
    events.push({
      type: 'sample',
      receivedAt: 1000 + i * 16, // ~60 Hz
      payload: { x: ref[0].x, y: ref[0].y },
    });
  }
  events.push({ type: 'stroke_end', receivedAt: 1500 });
  const r = computeChallengeTier(MECHANIC_TYPES.PATH, params, { events, startedAt: 0 });
  assert.equal(r.tier, 'MISS');
});

test('computeChallengeTier path: invalid sample payloads dropped silently', async () => {
  const { getReferencePolyline } = await importPathPatterns();
  const params = generateChallengeParams(MECHANIC_TYPES.PATH, makeRng(4));
  const ref = getReferencePolyline(params.patternIndex, params.rotationDeg, params.sizePx, params.insetPx);
  const events = [
    { type: 'sample', receivedAt: 100, payload: null },
    { type: 'sample', receivedAt: 200, payload: { x: NaN, y: 50 } },
    { type: 'sample', receivedAt: 300, payload: { x: 50, y: 'oops' } },
    { type: 'sample', receivedAt: 400, payload: { x: ref[0].x, y: ref[0].y } },
    { type: 'stroke_end', receivedAt: 500 },
  ];
  const r = computeChallengeTier(MECHANIC_TYPES.PATH, params, { events, startedAt: 0 });
  // Only one valid sample after dropping invalid - below path_min_samples = MISS.
  assert.equal(r.tier, 'MISS');
});

test('HUMAN_LIMITS exposes path floors that match server config defaults', () => {
  assert.equal(HUMAN_LIMITS.path_min_samples, 8);
  assert.equal(HUMAN_LIMITS.path_max_samples_per_sec, 25);
});
