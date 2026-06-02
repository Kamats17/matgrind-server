// Tests for path-trace geometry + scoring. Pure module - no DOM.
// Run with: node --test src/lib/pathPatterns.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PATH_PATTERNS,
  getReferencePolyline,
  polylineLength,
  distToSegment,
  nearestSegmentDist,
  scoreTrace,
  SCORE_TRACE_CONSTANTS,
} from './pathPatterns.js';

const TUNING = { perfectDevPx: 18, goodDevPx: 42 };

// Walk a polyline emitting samples at uniform arc-length steps.
function samplePolyline(polyline, count, offsetPx = 0) {
  const refLen = polylineLength(polyline);
  const cumLen = [0];
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    cumLen.push(cumLen[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const samples = [];
  for (let s = 0; s < count; s++) {
    const dist = (s / (count - 1)) * refLen;
    let segIdx = 0;
    while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < dist) segIdx++;
    const segLen = cumLen[segIdx + 1] - cumLen[segIdx];
    const t = segLen === 0 ? 0 : (dist - cumLen[segIdx]) / segLen;
    const a = polyline[segIdx];
    const b = polyline[segIdx + 1];
    let x = a.x + t * (b.x - a.x);
    let y = a.y + t * (b.y - a.y);
    if (offsetPx !== 0) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      x += nx * offsetPx;
      y += ny * offsetPx;
    }
    samples.push({ x, y, t: s });
  }
  return samples;
}

test('PATH_PATTERNS has 6 entries with at least 3 waypoints each', () => {
  assert.equal(PATH_PATTERNS.length, 6);
  for (const p of PATH_PATTERNS) {
    assert.ok(p.length >= 3, `pattern only has ${p.length} waypoints`);
    for (const pt of p) {
      assert.ok(pt.x >= 0 && pt.x <= 1, `x ${pt.x} out of [0,1]`);
      assert.ok(pt.y >= 0 && pt.y <= 1, `y ${pt.y} out of [0,1]`);
    }
  }
});

test('getReferencePolyline is deterministic for the same inputs', () => {
  const a = getReferencePolyline(0, 0, 320, 36);
  const b = getReferencePolyline(0, 0, 320, 36);
  assert.deepEqual(a, b);
});

test('getReferencePolyline maps into [insetPx, sizePx-insetPx]', () => {
  const sizePx = 320;
  const insetPx = 36;
  for (let idx = 0; idx < PATH_PATTERNS.length; idx++) {
    for (const deg of [0, 90, 180, 270]) {
      const poly = getReferencePolyline(idx, deg, sizePx, insetPx);
      for (const p of poly) {
        assert.ok(p.x >= insetPx - 1e-6 && p.x <= sizePx - insetPx + 1e-6, `x ${p.x} out of range`);
        assert.ok(p.y >= insetPx - 1e-6 && p.y <= sizePx - insetPx + 1e-6, `y ${p.y} out of range`);
      }
    }
  }
});

test('getReferencePolyline rotation 90deg rotates points around canvas center', () => {
  const sizePx = 320;
  const insetPx = 36;
  const center = sizePx / 2;
  const base = getReferencePolyline(0, 0, sizePx, insetPx);
  const rot  = getReferencePolyline(0, 90, sizePx, insetPx);
  for (let i = 0; i < base.length; i++) {
    const expectedX = center - (base[i].y - center);
    const expectedY = center + (base[i].x - center);
    assert.ok(Math.abs(rot[i].x - expectedX) < 1e-6, `idx ${i} x ${rot[i].x} expected ${expectedX}`);
    assert.ok(Math.abs(rot[i].y - expectedY) < 1e-6, `idx ${i} y ${rot[i].y} expected ${expectedY}`);
  }
});

test('getReferencePolyline accepts out-of-range patternIndex via modulo', () => {
  const direct = getReferencePolyline(0, 0);
  const wrap   = getReferencePolyline(6, 0);
  assert.deepEqual(direct, wrap);
});

test('distToSegment returns 0 on the segment, perpendicular for off-line', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  assert.equal(distToSegment({ x: 50, y: 0 }, a, b), 0);
  assert.equal(distToSegment({ x: 50, y: 30 }, a, b), 30);
  assert.equal(distToSegment({ x: -10, y: 0 }, a, b), 10);
  assert.equal(distToSegment({ x: 110, y: 0 }, a, b), 10);
});

test('polylineLength sums segment distances', () => {
  const poly = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 9 }];
  assert.equal(polylineLength(poly), 5 + 5);
});

test('nearestSegmentDist picks the closest of multiple segments', () => {
  const poly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  assert.equal(nearestSegmentDist({ x: 50, y: 5 }, poly), 5);
  assert.equal(nearestSegmentDist({ x: 95, y: 50 }, poly), 5);
});

test('scoreTrace returns PERFECT on samples taken directly from reference', () => {
  const ref = getReferencePolyline(0, 0);
  const samples = samplePolyline(ref, 30, 0);
  const result = scoreTrace(samples, ref, TUNING);
  assert.equal(result.tier, 'PERFECT', `dev ${result.dev}, accuracy ${result.accuracy}`);
});

test('scoreTrace never reaches PERFECT when samples are 30 px off the line', () => {
  const ref = getReferencePolyline(0, 0);
  const samples = samplePolyline(ref, 30, 30);
  const result = scoreTrace(samples, ref, TUNING);
  assert.notEqual(result.tier, 'PERFECT');
});

test('scoreTrace returns MISS too_short when projection coverage < 85% of reference length', () => {
  // Triangle is a closed shape: ref[0] === ref[len-1]. Sampling near that
  // shared vertex satisfies both endpoint gates while maxProgress stays small,
  // so the coverage gate is the one that fires.
  const ref = getReferencePolyline(2, 0);
  const start = ref[0];
  const samples = [];
  for (let i = 0; i < 12; i++) {
    samples.push({ x: start.x + (i % 2 === 0 ? 3 : -3), y: start.y + (i % 2 === 0 ? 2 : -2), t: i });
  }
  const result = scoreTrace(samples, ref, TUNING);
  assert.equal(result.tier, 'MISS');
  assert.equal(result.reason, 'too_short');
});

test('scoreTrace returns MISS too_few_samples when fewer than MIN_SAMPLES', () => {
  const ref = getReferencePolyline(0, 0);
  const tiny = samplePolyline(ref, 7, 0);
  const result = scoreTrace(tiny, ref, TUNING);
  assert.equal(result.tier, 'MISS');
  assert.equal(result.reason, 'too_few_samples');
});

test('scoreTrace returns MISS wrong_start when first sample is too far from reference[0]', () => {
  const ref = getReferencePolyline(0, 0);
  const samples = samplePolyline(ref, 30, 0);
  samples[0] = { x: samples[0].x + 200, y: samples[0].y + 200, t: 0 };
  const result = scoreTrace(samples, ref, TUNING);
  assert.equal(result.tier, 'MISS');
  assert.equal(result.reason, 'wrong_start');
});

test('scoreTrace returns MISS wrong_end when last sample is too far from reference end', () => {
  const ref = getReferencePolyline(0, 0);
  const samples = samplePolyline(ref, 30, 0);
  const last = samples[samples.length - 1];
  samples[samples.length - 1] = { x: last.x + 200, y: last.y + 200, t: 0 };
  const result = scoreTrace(samples, ref, TUNING);
  assert.equal(result.tier, 'MISS');
  assert.equal(result.reason, 'wrong_end');
});

test('scoreTrace projection coverage: samples missing the middle segments still fail too_short', () => {
  // Triangle pattern: 3 segments. Cover only the first segment (start to apex)
  // then teleport back to start. Both endpoint gates pass (closed loop), but
  // maxProgress stops at the apex (~33% of refLen).
  const ref = getReferencePolyline(2, 0);
  const refLen = polylineLength(ref);
  const samples = [];
  // Walk start -> apex
  for (let s = 0; s < 10; s++) {
    const t = s / 9;
    samples.push({
      x: ref[0].x + t * (ref[1].x - ref[0].x),
      y: ref[0].y + t * (ref[1].y - ref[0].y),
      t: s,
    });
  }
  // Snap back to start to satisfy wrong_end (closed loop: ref[0] === ref[len-1])
  samples.push({ x: ref[0].x, y: ref[0].y, t: 11 });
  const result = scoreTrace(samples, ref, TUNING);
  assert.equal(result.tier, 'MISS');
  assert.equal(result.reason, 'too_short');
  assert.ok(result.refProgress < 0.85, `refProgress ${result.refProgress} (refLen ${refLen})`);
});

test('SCORE_TRACE_CONSTANTS exposes coverage gates', () => {
  assert.equal(SCORE_TRACE_CONSTANTS.MIN_SAMPLES, 8);
  assert.equal(SCORE_TRACE_CONSTANTS.COVERAGE_FRACTION, 0.70);
  assert.equal(SCORE_TRACE_CONSTANTS.ENDPOINT_TOLERANCE, 60);
  assert.equal(SCORE_TRACE_CONSTANTS.PERFECT_DIST_PX, 14);
  assert.equal(SCORE_TRACE_CONSTANTS.N_BUCKETS, 10);
});

test('scoreTrace returns refProgress (bucket coverage) >= 0.7 on success', () => {
  const ref = getReferencePolyline(4, 90);
  const samples = samplePolyline(ref, 30, 0);
  const result = scoreTrace(samples, ref, TUNING);
  assert.equal(result.tier, 'PERFECT');
  assert.ok(result.refProgress >= 0.7 && result.refProgress <= 1.0001, `refProgress ${result.refProgress}`);
});

test('scoreTrace catches scribble cheese: cluster near start + single jump to end', () => {
  // Open polyline (Wave). Many samples cluster near ref[0]; one final jump
  // to ref[len-1] satisfies the wrong_end gate but bucket coverage stays low.
  const ref = getReferencePolyline(4, 0);
  const samples = [];
  for (let i = 0; i < 20; i++) {
    samples.push({ x: ref[0].x + (i % 2 ? 3 : -3), y: ref[0].y + 2, t: i });
  }
  samples.push({ x: ref[ref.length - 1].x, y: ref[ref.length - 1].y, t: 21 });
  const result = scoreTrace(samples, ref, TUNING);
  assert.equal(result.tier, 'MISS');
  assert.equal(result.reason, 'too_short');
});
