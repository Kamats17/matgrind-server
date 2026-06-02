import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket, RateLimiter } from './rateLimiter.mjs';

test('TokenBucket allows up to burst then rejects', () => {
  const b = new TokenBucket(10, 5);
  for (let i = 0; i < 5; i++) assert.equal(b.consume(), true, `consume ${i}`);
  assert.equal(b.consume(), false, 'over burst');
});

test('TokenBucket refills over time', async () => {
  const b = new TokenBucket(50, 5); // 50 tokens/sec
  for (let i = 0; i < 5; i++) b.consume();
  assert.equal(b.consume(), false);
  await new Promise(r => setTimeout(r, 60)); // 50/s * 0.06s = 3 tokens
  assert.equal(b.consume(), true);
  assert.equal(b.consume(), true);
  // ~1 left should be a coin flip - be lenient
});

test('RateLimiter creates per-key buckets', () => {
  const rl = new RateLimiter();
  for (let i = 0; i < 3; i++) assert.equal(rl.consume('uid-a', 10, 3), true);
  assert.equal(rl.consume('uid-a', 10, 3), false, 'uid-a exhausted');
  // uid-b has its own bucket
  assert.equal(rl.consume('uid-b', 10, 3), true);
});

test('RateLimiter.reset drops ONLY the exact key (no prefix collision)', () => {
  const rl = new RateLimiter();
  rl.consume('msg:uid-a', 10, 3);
  rl.consume('msg:uid-ab', 10, 3);   // shares the "msg:uid-a" prefix
  rl.consume('cha:uid-a', 10, 3);
  rl.reset('msg:uid-a');
  assert.equal(rl.buckets.has('msg:uid-a'), false, 'exact key removed');
  assert.equal(rl.buckets.has('msg:uid-ab'), true, 'prefix-sharing uid must survive');
  assert.equal(rl.buckets.has('cha:uid-a'), true, 'other category survives');
});

test('RateLimiter.sweep evicts idle buckets past the TTL', () => {
  const rl = new RateLimiter();
  const t0 = 1_000_000;
  rl.consume('msg:uid-a', 10, 3, t0);
  rl.consume('msg:uid-b', 10, 3, t0 + 50_000);
  // Sweep at t0+60s with a 30s TTL: uid-a (idle 60s) evicted, uid-b (idle 10s) kept.
  const removed = rl.sweep(30_000, t0 + 60_000);
  assert.equal(removed, 1, 'one idle bucket evicted');
  assert.equal(rl.buckets.has('msg:uid-a'), false);
  assert.equal(rl.buckets.has('msg:uid-b'), true);
});

test('canConsume is a non-destructive peek', () => {
  const rl = new RateLimiter();
  assert.equal(rl.canConsume('room:a', 10, 1), true);
  assert.equal(rl.canConsume('room:a', 10, 1), true, 'peek does not consume');
  assert.equal(rl.consume('room:a', 10, 1), true);
  assert.equal(rl.canConsume('room:a', 10, 1), false, 'now spent');
});

test('tryConsumeMany charges every key atomically when all have tokens', () => {
  const rl = new RateLimiter();
  assert.equal(rl.tryConsumeMany(['room:a', 'room:b'], 10, 1), true);
  assert.equal(rl.canConsume('room:a', 10, 1), false, 'a charged');
  assert.equal(rl.canConsume('room:b', 10, 1), false, 'b charged');
});

test('tryConsumeMany charges NOBODY when any key lacks a token', () => {
  const rl = new RateLimiter();
  rl.consume('room:a', 10, 1); // a exhausted
  assert.equal(rl.tryConsumeMany(['room:a', 'room:b'], 10, 1), false);
  assert.equal(rl.canConsume('room:b', 10, 1), true, 'innocent key b not charged');
});
