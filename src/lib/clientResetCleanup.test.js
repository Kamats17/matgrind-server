import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runTransientStateCleanup,
  runOneTimeBootCleanup,
  runServerTriggeredReset,
  ONE_TIME_CLEANUP_FLAG,
} from './clientResetCleanup.js';

// Lightweight Storage stub. Matches enough of the Web Storage API for
// the cleanup helpers (length, key, getItem, setItem, removeItem). No
// quota simulation - that path is exercised by browsers, not tests.
function makeStorage(initial = {}) {
  /** @type {Record<string, string>} */
  const map = { ...initial };
  return {
    get length() { return Object.keys(map).length; },
    key(i) { return Object.keys(map)[i] ?? null; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem(k, v) { map[k] = String(v); },
    removeItem(k) { delete map[k]; },
    clear() { for (const k of Object.keys(map)) delete map[k]; },
    _map: () => map,
  };
}

describe('runTransientStateCleanup', () => {
  test('removes pinned_match_state when present', () => {
    const s = makeStorage({ pinned_match_state: '{"matchState":{}}' });
    const { keysCleared } = runTransientStateCleanup(s);
    assert.deepEqual(keysCleared.sort(), ['pinned_match_state']);
    assert.equal(s.getItem('pinned_match_state'), null);
  });

  test('skips pinned_match_state when absent', () => {
    const s = makeStorage({});
    const { keysCleared } = runTransientStateCleanup(s);
    assert.deepEqual(keysCleared, []);
  });

  test('removes all matgrind.dual.* keys', () => {
    const s = makeStorage({
      'matgrind.dual.x': 'a',
      'matgrind.dual.y': 'b',
      'unrelated.key': 'c',
    });
    runTransientStateCleanup(s);
    assert.equal(s.getItem('matgrind.dual.x'), null);
    assert.equal(s.getItem('matgrind.dual.y'), null);
    assert.equal(s.getItem('unrelated.key'), 'c');
  });

  test('removes per-career tournament caches across all users', () => {
    const s = makeStorage({
      'matgrind.career.uidA.tournament.career_1': 'a',
      'matgrind.career.uidB.tournament.career_2': 'b',
      'matgrind.career.uidA': 'profile-mirror', // active career mirror, must survive
      'matgrind.career.uidB': 'profile-mirror',
    });
    const { keysCleared } = runTransientStateCleanup(s);
    assert.ok(keysCleared.includes('matgrind.career.uidA.tournament.career_1'));
    assert.ok(keysCleared.includes('matgrind.career.uidB.tournament.career_2'));
    assert.equal(s.getItem('matgrind.career.uidA'), 'profile-mirror');
    assert.equal(s.getItem('matgrind.career.uidB'), 'profile-mirror');
  });

  test('preserves auth + settings keys', () => {
    const s = makeStorage({
      'pinned_match_state': '{}',
      'firebase:authUser:abc': 'token',
      'matgrind.sound.enabled': 'true',
      'matgrind.colorblind': 'false',
      'matgrind.dailyGoal': '{"day":"2026-05-01"}',
    });
    runTransientStateCleanup(s);
    assert.equal(s.getItem('pinned_match_state'), null);
    assert.equal(s.getItem('firebase:authUser:abc'), 'token');
    assert.equal(s.getItem('matgrind.sound.enabled'), 'true');
    assert.equal(s.getItem('matgrind.colorblind'), 'false');
    assert.equal(s.getItem('matgrind.dailyGoal'), '{"day":"2026-05-01"}');
  });

  test('returns empty when storage is null', () => {
    // @ts-expect-error - testing the fallback path
    const result = runTransientStateCleanup(null);
    assert.deepEqual(result.keysCleared, []);
  });
});

describe('runOneTimeBootCleanup', () => {
  test('runs on first call when flag absent', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    const r = runOneTimeBootCleanup(s);
    assert.equal(r.ranNow, true);
    assert.deepEqual(r.keysCleared, ['pinned_match_state']);
    assert.ok(s.getItem(ONE_TIME_CLEANUP_FLAG), 'flag should be stamped');
  });

  test('skips on second call when flag present', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    runOneTimeBootCleanup(s); // first call
    const r = runOneTimeBootCleanup(s); // second call
    assert.equal(r.ranNow, false);
    assert.deepEqual(r.keysCleared, []);
  });

  test('preserves auth keys even on first run', () => {
    const s = makeStorage({
      'firebase:authUser:abc': 'token',
      'pinned_match_state': '{}',
    });
    runOneTimeBootCleanup(s);
    assert.equal(s.getItem('firebase:authUser:abc'), 'token');
  });

  test('idempotent: third call still no-op', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    runOneTimeBootCleanup(s);
    runOneTimeBootCleanup(s);
    const r = runOneTimeBootCleanup(s);
    assert.equal(r.ranNow, false);
  });

  test('skips with no storage', () => {
    // @ts-expect-error - testing the fallback path
    const r = runOneTimeBootCleanup(null);
    assert.equal(r.ranNow, false);
  });
});

describe('runServerTriggeredReset', () => {
  const UID = 'NXqy8kqcFaPXKmCFjBEFCQv4UMD3';

  test('runs when serverTs > localTs (no prior reset)', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    const r = runServerTriggeredReset({ uid: UID, serverTs: 1000 }, s);
    assert.equal(r.ranNow, true);
    assert.equal(s.getItem(`matgrind.lastClientReset.${UID}`), '1000');
  });

  test('skips when serverTs <= localTs', () => {
    const s = makeStorage({
      [`matgrind.lastClientReset.${UID}`]: '2000',
      'pinned_match_state': 'x',
    });
    const r = runServerTriggeredReset({ uid: UID, serverTs: 1500 }, s);
    assert.equal(r.ranNow, false);
    assert.equal(s.getItem('pinned_match_state'), 'x', 'data should NOT be wiped');
  });

  test('skips when serverTs equal to localTs', () => {
    const s = makeStorage({
      [`matgrind.lastClientReset.${UID}`]: '1500',
    });
    const r = runServerTriggeredReset({ uid: UID, serverTs: 1500 }, s);
    assert.equal(r.ranNow, false);
  });

  test('skips when serverTs is 0/missing', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    const r = runServerTriggeredReset({ uid: UID, serverTs: 0 }, s);
    assert.equal(r.ranNow, false);
    assert.equal(s.getItem('pinned_match_state'), 'x');
  });

  test('skips when uid missing', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    const r = runServerTriggeredReset({ uid: '', serverTs: 1000 }, s);
    assert.equal(r.ranNow, false);
  });

  test('idempotent: second call with same serverTs is a no-op', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    runServerTriggeredReset({ uid: UID, serverTs: 1000 }, s);
    s.setItem('pinned_match_state', 'y'); // user wrote new state after reset
    const r = runServerTriggeredReset({ uid: UID, serverTs: 1000 }, s);
    assert.equal(r.ranNow, false);
    assert.equal(s.getItem('pinned_match_state'), 'y', 'subsequent state must NOT be wiped');
  });

  test('fires again when serverTs advances', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    runServerTriggeredReset({ uid: UID, serverTs: 1000 }, s);
    s.setItem('pinned_match_state', 'y');
    const r = runServerTriggeredReset({ uid: UID, serverTs: 2000 }, s);
    assert.equal(r.ranNow, true);
    assert.equal(s.getItem('pinned_match_state'), null);
    assert.equal(s.getItem(`matgrind.lastClientReset.${UID}`), '2000');
  });

  test('different uids are independently tracked', () => {
    const s = makeStorage({ pinned_match_state: 'x' });
    runServerTriggeredReset({ uid: 'userA', serverTs: 1000 }, s);
    s.setItem('pinned_match_state', 'y');
    const r = runServerTriggeredReset({ uid: 'userB', serverTs: 1000 }, s);
    assert.equal(r.ranNow, true, 'userB should fire even though userA already did');
  });
});
