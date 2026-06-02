// Stage 1 (§1.7) — durable metrics snapshot builder.
// Deterministic minute-bucket doc IDs namespaced by release + process start
// so cumulative counters are only ever compared within one process start.
//
// Run with: node --test server-online/metricsSnapshot.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot } from './metricsSnapshot.mjs';

test('deterministic minute-bucket id namespaced by release + process start', () => {
  const s1 = buildSnapshot({
    json: { counters: { a: 1 }, gauges: {} },
    releaseId: 'v1', processStartTimeMs: 1000, nowMs: 5 * 60000 + 123,
  });
  const s2 = buildSnapshot({
    json: { counters: { a: 9 }, gauges: {} },
    releaseId: 'v1', processStartTimeMs: 1000, nowMs: 5 * 60000 + 999,
  });
  assert.equal(s1.collection, 'server_metrics');
  assert.equal(s1.docId, 'v1__1000__5', 'minute bucket 5');
  assert.equal(s1.docId, s2.docId, 'same minute → same doc (idempotent overwrite)');
});

test('carries provenance + retention + metric payload', () => {
  const s = buildSnapshot({
    json: { counters: { x: 2 }, gauges: { g: 3 } },
    releaseId: 'rel', processStartTimeMs: 42, nowMs: 60000, retentionDays: 30,
  });
  assert.equal(s.data.releaseId, 'rel');
  assert.equal(s.data.processStartTimeMs, 42);
  assert.equal(s.data.capturedAtMs, 60000);
  assert.equal(s.data.retentionDays, 30);
  assert.deepEqual(s.data.counters, { x: 2 });
  assert.deepEqual(s.data.gauges, { g: 3 });
});

test('includes a Firestore-TTL expireAt timestamp = capturedAt + retention', () => {
  const day = 86400000;
  const s = buildSnapshot({
    json: { counters: {}, gauges: {} },
    releaseId: 'v1', processStartTimeMs: 1, nowMs: 1000, retentionDays: 30,
  });
  assert.ok(s.data.expireAt instanceof Date, 'expireAt is a Date (→ Firestore Timestamp for TTL)');
  assert.equal(s.data.expireAt.getTime(), 1000 + 30 * day, 'expireAt = capturedAt + retentionDays');
});

test('different process start → different doc namespace (no cross-restart delta mixing)', () => {
  const a = buildSnapshot({ json: { counters: {}, gauges: {} }, releaseId: 'v1', processStartTimeMs: 1000, nowMs: 60000 });
  const b = buildSnapshot({ json: { counters: {}, gauges: {} }, releaseId: 'v1', processStartTimeMs: 2000, nowMs: 60000 });
  assert.notEqual(a.docId, b.docId);
});
