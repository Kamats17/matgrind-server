// Stage 4 client reconciliation: pure helpers for applying the server's trusted
// match_settled receipt. The authoritative online counters live server-side in
// online_progress/{uid}; the client only displays/submits them, never claims them.
//
// Run: node --test src/lib/onlineProgress.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldApplySettlement, trustedOnlineWins, resolveAchievementObjects } from './onlineProgress.js';

test('shouldApplySettlement applies a given matchId at most once', () => {
  const seen = new Set();
  assert.equal(shouldApplySettlement(seen, 'm1'), true, 'first settlement for a match applies');
  seen.add('m1');
  assert.equal(shouldApplySettlement(seen, 'm1'), false, 'a duplicate/late settlement is ignored');
  assert.equal(shouldApplySettlement(seen, 'm2'), true, 'a different match still applies');
});

test('shouldApplySettlement ignores a missing matchId', () => {
  assert.equal(shouldApplySettlement(new Set(), undefined), false);
  assert.equal(shouldApplySettlement(new Set(), null), false);
  assert.equal(shouldApplySettlement(new Set(), ''), false);
});

test('trustedOnlineWins reads the server wins count and never trusts a missing source', () => {
  assert.equal(trustedOnlineWins({ wins: 7 }), 7);
  assert.equal(trustedOnlineWins({ wins: '12' }), 12, 'coerces a numeric string');
  assert.equal(trustedOnlineWins(null), 0);
  assert.equal(trustedOnlineWins(undefined), 0);
  assert.equal(trustedOnlineWins({}), 0, 'absent wins is treated as zero, not NaN');
});

test('resolveAchievementObjects maps server achievement ids to registry entries, skipping unknown', () => {
  const registry = [
    { id: 'first_win', name: 'First Blood' },
    { id: 'online_wins_5', name: 'Road Warrior' },
  ];
  const out = resolveAchievementObjects(['online_wins_5', 'not_in_registry', 'first_win'], registry);
  assert.deepEqual(out.map((a) => a.id), ['online_wins_5', 'first_win'], 'known ids resolve in order, unknown skipped');
  assert.equal(resolveAchievementObjects(null, registry).length, 0, 'no ids -> empty');
  assert.equal(resolveAchievementObjects(['first_win'], null).length, 0, 'no registry -> empty');
});
