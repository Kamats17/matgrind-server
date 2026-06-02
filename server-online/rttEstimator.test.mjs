import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RttEstimator, PingTracker } from './rttEstimator.mjs';

test('RttEstimator: first sample replaces initial estimate', () => {
  const r = new RttEstimator(100);
  r.update(250);
  assert.equal(r.smoothedMs, 250);
  assert.equal(r.samples, 1);
});

test('RttEstimator: subsequent samples smoothed via EWMA (alpha=0.125)', () => {
  const r = new RttEstimator();
  r.update(200); // first
  // smoothed = 200; sample 2 = 100 -> 200 + 0.125*(100-200) = 187.5
  r.update(100);
  assert.equal(r.smoothedMs, 187.5);
});

test('RttEstimator: rejects non-finite or negative samples', () => {
  const r = new RttEstimator();
  r.update(150);
  r.update(NaN);
  r.update(-50);
  r.update(Infinity);
  assert.equal(r.smoothedMs, 150);
  assert.equal(r.samples, 1);
});

test('RttEstimator: NO artificial cap (high RTT users get accurate estimates)', () => {
  const r = new RttEstimator();
  r.update(400);
  assert.equal(r.smoothedMs, 400, '400ms RTT must NOT be capped to 150ms');
});

test('PingTracker: roundtrip via id', () => {
  const t = new PingTracker();
  const id = t.startPing();
  // simulate latency
  const start = Date.now();
  while (Date.now() - start < 5) {} // busy-wait ~5ms
  const rtt = t.resolvePong(id);
  assert.ok(rtt >= 0, `rtt should be measurable; got ${rtt}`);
  assert.equal(t.pending.size, 0, 'resolved pong removes pending entry');
});

test('PingTracker: unknown id returns null', () => {
  const t = new PingTracker();
  assert.equal(t.resolvePong(999), null);
});

test('PingTracker: pending map caps at 8 entries', () => {
  const t = new PingTracker();
  for (let i = 0; i < 20; i++) t.startPing();
  assert.ok(t.pending.size <= 8, `pending grew to ${t.pending.size}`);
});

test('PingTracker: each ping gets a unique id', () => {
  const t = new PingTracker();
  const ids = new Set();
  for (let i = 0; i < 5; i++) ids.add(t.startPing());
  assert.equal(ids.size, 5);
});
