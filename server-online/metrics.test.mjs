import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  incCounter, setGauge,
  getCounter, getGauge,
  resetMetrics,
  renderPrometheus, renderJson,
} from './metrics.mjs';

test('incCounter: starts at 0, increments, sums labels', () => {
  resetMetrics();
  assert.equal(getCounter('foo'), 0);
  incCounter('foo');
  incCounter('foo');
  incCounter('foo', null, 3);
  assert.equal(getCounter('foo'), 5);
});

test('incCounter: distinct label sets are tracked separately', () => {
  resetMetrics();
  incCounter('challenge_resolved', { mechanic: 'charge', tier: 'PERFECT' });
  incCounter('challenge_resolved', { mechanic: 'charge', tier: 'PERFECT' });
  incCounter('challenge_resolved', { mechanic: 'charge', tier: 'MISS' });
  assert.equal(getCounter('challenge_resolved', { mechanic: 'charge', tier: 'PERFECT' }), 2);
  assert.equal(getCounter('challenge_resolved', { mechanic: 'charge', tier: 'MISS' }), 1);
});

test('setGauge: overwrites prior value', () => {
  resetMetrics();
  setGauge('rooms_active', 10);
  setGauge('rooms_active', 7);
  assert.equal(getGauge('rooms_active'), 7);
});

test('renderPrometheus: emits TYPE lines + per-label rows', () => {
  resetMetrics();
  incCounter('hits', { route: '/health' }, 4);
  setGauge('rooms_active', 3);
  const out = renderPrometheus();
  assert.match(out, /# TYPE hits counter/);
  assert.match(out, /hits\{route="\/health"\} 4/);
  assert.match(out, /# TYPE rooms_active gauge/);
  assert.match(out, /rooms_active 3/);
});

test('renderJson: structured dump', () => {
  resetMetrics();
  incCounter('a');
  setGauge('b', 42);
  const out = renderJson();
  assert.equal(out.counters.a, 1);
  assert.equal(out.gauges.b, 42);
});

test('label-key escaping handles quotes safely', () => {
  resetMetrics();
  incCounter('weird', { msg: 'has"quote' });
  const out = renderPrometheus();
  assert.match(out, /weird\{msg="has\\"quote"\} 1/);
});
