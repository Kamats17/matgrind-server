// Stage 1 (§1.8) — ops endpoint lockdown, fail-closed.
// /health and /queue-size stay public; /metrics*, /debug/* require a bearer
// token AND are inaccessible when no token is configured (fail closed).
//
// Run with: node --test server-online/httpRoutes.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeHttp } from './httpRoutes.mjs';

const deps = {
  activeCount: () => 3,
  queueSize: () => 1,
  metricsToken: 'secret-token',
  renderPrometheus: () => 'metrics_text',
  renderJson: () => ({ counters: {}, gauges: {} }),
  recentEvents: () => [],
};
const noTokenDeps = { ...deps, metricsToken: '' };

test('/health is public regardless of token config', () => {
  const r = routeHttp({ url: '/health', headers: {} }, noTokenDeps);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).status, 'ok');
});

test('/queue-size is public', () => {
  const r = routeHttp({ url: '/queue-size', headers: {} }, noTokenDeps);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).size, 1);
});

test('/metrics fails closed when no token is configured', () => {
  const r = routeHttp({ url: '/metrics', headers: {} }, noTokenDeps);
  assert.notEqual(r.status, 200, 'must not serve metrics without a configured token');
  assert.ok(r.status === 503 || r.status === 404, 'inaccessible (503/404)');
});

test('/metrics rejects a missing/wrong bearer token', () => {
  assert.equal(routeHttp({ url: '/metrics', headers: {} }, deps).status, 401);
  assert.equal(
    routeHttp({ url: '/metrics', headers: { authorization: 'Bearer nope' } }, deps).status, 401,
  );
});

test('/metrics serves with the correct bearer token', () => {
  const r = routeHttp({ url: '/metrics', headers: { authorization: 'Bearer secret-token' } }, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body, 'metrics_text');
});

test('/debug/recent is gated the same way', () => {
  assert.equal(routeHttp({ url: '/debug/recent?n=5', headers: {} }, deps).status, 401);
  assert.equal(routeHttp({ url: '/debug/recent?n=5', headers: {} }, noTokenDeps).status === 200, false);
  const ok = routeHttp({ url: '/debug/recent?n=5', headers: { authorization: 'Bearer secret-token' } }, deps);
  assert.equal(ok.status, 200);
});
