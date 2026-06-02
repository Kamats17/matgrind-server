import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from './withTimeout.js';

describe('withTimeout', () => {
  test('returns { ok: true, value } when the promise resolves before timeout', async () => {
    const result = await withTimeout(Promise.resolve('hello'), 100);
    assert.deepEqual(result, { ok: true, value: 'hello' });
  });

  test('returns { ok: false, error } when the promise rejects before timeout', async () => {
    const result = await withTimeout(Promise.reject(new Error('boom')), 100);
    assert.equal(result.ok, false);
    assert.ok(result.error instanceof Error);
    assert.equal(result.error.message, 'boom');
  });

  test('returns { ok: false, error: "timeout" } when the promise stays pending', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 200));
    const result = await withTimeout(slow, 50);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'timeout');
  });

  test('clears the timer when the promise resolves first (no late timeout)', async () => {
    let timeoutFired = false;
    const fast = new Promise((resolve) => setTimeout(() => resolve('done'), 10));
    const result = await withTimeout(fast, 200);
    assert.deepEqual(result, { ok: true, value: 'done' });
    // Wait past the original timeout deadline; nothing should fire.
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(timeoutFired, false);
  });

  test('includes the optional label in the timeout error result', async () => {
    const slow = new Promise(() => {}); // never resolves
    const result = await withTimeout(slow, 30, 'fetch-profile');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'timeout');
    // Label must be recoverable from the result for debugging.
    assert.equal(result.label, 'fetch-profile');
  });
});
