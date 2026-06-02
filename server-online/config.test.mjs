import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envPosInt, envBool, ADMISSION, TIMING, RATE_LIMITS } from './config.mjs';

test('envPosInt rejects non-positive and non-integer, falling back', () => {
  process.env.MM_TEST_PI = '0';    assert.equal(envPosInt('MM_TEST_PI', 7), 7, '0 rejected');
  process.env.MM_TEST_PI = '-3';   assert.equal(envPosInt('MM_TEST_PI', 7), 7, 'negative rejected');
  process.env.MM_TEST_PI = '1.5';  assert.equal(envPosInt('MM_TEST_PI', 7), 7, 'non-integer rejected');
  process.env.MM_TEST_PI = 'abc';  assert.equal(envPosInt('MM_TEST_PI', 7), 7, 'NaN rejected');
  process.env.MM_TEST_PI = '12';   assert.equal(envPosInt('MM_TEST_PI', 7), 12, 'positive int accepted');
  delete process.env.MM_TEST_PI;   assert.equal(envPosInt('MM_TEST_PI', 7), 7, 'unset → fallback');
});

test('envBool is true only for the exact string "true"', () => {
  process.env.MM_TEST_B = 'true';  assert.equal(envBool('MM_TEST_B', false), true);
  process.env.MM_TEST_B = 'TRUE';  assert.equal(envBool('MM_TEST_B', false), false, 'case-sensitive');
  process.env.MM_TEST_B = 'false'; assert.equal(envBool('MM_TEST_B', true), false);
  process.env.MM_TEST_B = '1';     assert.equal(envBool('MM_TEST_B', true), false);
  delete process.env.MM_TEST_B;    assert.equal(envBool('MM_TEST_B', true), true, 'unset → fallback');
});

test('ADMISSION exposes the approved v5 defaults', () => {
  assert.equal(ADMISSION.max_pending_per_ip, 30);
  assert.equal(ADMISSION.max_pending_total, 200);
  assert.equal(ADMISSION.max_attempts_per_min_per_ip, 60);
  assert.equal(ADMISSION.max_attempt_burst_per_ip, 60);
  assert.equal(ADMISSION.max_auth_sessions_per_ip, 100);
  assert.equal(ADMISSION.trusted_proxy, false);
});

test('TIMING exposes rate-bucket TTL + sweep defaults', () => {
  assert.equal(TIMING.rate_bucket_idle_ttl_ms, 600000);
  assert.equal(TIMING.rate_bucket_sweep_ms, 60000);
});

test('create_room_per_min guard defaults to 10 (strict positive-int parsed)', () => {
  assert.equal(RATE_LIMITS.create_room_per_min, 10);
});
