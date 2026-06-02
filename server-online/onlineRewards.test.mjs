// Stage 4: server-authoritative online reward reducer.
//
// buildOnlineRewardDelta is PURE — given the server-built result record (which is
// derived solely from the engine's matchState, never client claims) and a player's
// prior online_progress doc, it produces the new authoritative counters, the XP
// earned this match, and any achievements newly unlocked.
//
// Run with: node --test server-online/onlineRewards.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOnlineRewardDelta, settleAuthoritativeMatch } from './onlineRewards.mjs';

// A result record as produced by resultLedger.buildResultRecord().record, extended
// with the server-owned per-player fields (score, takedowns, pinCount).
function rec(over = {}) {
  return {
    matchId: 'm1', roomCode: 'AAAA', style: 'folkstyle',
    winner: 'p1', winMethod: 'decision',
    p1: { uid: 'u1', name: 'Alice', score: 10, takedowns: 1, pinCount: 0 },
    p2: { uid: 'u2', name: 'Bob', score: 2, takedowns: 0, pinCount: 0 },
    finishedAt: 1000, schema: 1,
    ...over,
  };
}
const EMPTY = {};

// ── XP rules ──────────────────────────────────────────────────────────────

test('participation: every player earns the +50 base, winner adds +100', () => {
  // scores 10 vs 2 (diff 8, not close); no pin/tf; winner not shutout (p2=2).
  const loser = buildOnlineRewardDelta(rec(), 'p2', EMPTY);
  const winner = buildOnlineRewardDelta(rec(), 'p1', EMPTY);
  assert.equal(loser.xpEarned, 50, 'loser gets participation only');
  assert.equal(winner.xpEarned, 150, 'winner gets participation + win');
});

test('pin win + close match stack', () => {
  // p1 wins by pin, 6 vs 4 (diff 2 = close), p1 not shutout, p1 2 takedowns.
  const r = rec({ winMethod: 'pin', p1: { uid: 'u1', name: 'A', score: 6, takedowns: 2, pinCount: 1 }, p2: { uid: 'u2', name: 'B', score: 4, takedowns: 0, pinCount: 0 } });
  const w = buildOnlineRewardDelta(r, 'p1', EMPTY);
  // 50 + 100 + 60(pin) + 25(close) = 235
  assert.equal(w.xpEarned, 235);
});

test('tech-fall win + 3-takedown bonus', () => {
  const r = rec({ winMethod: 'tech_fall', p1: { uid: 'u1', name: 'A', score: 18, takedowns: 6, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 3, takedowns: 0, pinCount: 0 } });
  const w = buildOnlineRewardDelta(r, 'p1', EMPTY);
  // 50 + 100 + 40(tf) + 20(>=3 td) = 210 (diff 15 not close, p2=3 not shutout)
  assert.equal(w.xpEarned, 210);
});

test('shutout win bonus', () => {
  const r = rec({ p1: { uid: 'u1', name: 'A', score: 5, takedowns: 2, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 0, takedowns: 0, pinCount: 0 } });
  const w = buildOnlineRewardDelta(r, 'p1', EMPTY);
  // 50 + 100 + 30(shutout) = 180 (diff 5 not close)
  assert.equal(w.xpEarned, 180);
});

test('draw: both players get participation + draw + close (4-4)', () => {
  const r = rec({ winner: null, winMethod: 'draw', p1: { uid: 'u1', name: 'A', score: 4, takedowns: 1, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 4, takedowns: 1, pinCount: 0 } });
  const a = buildOnlineRewardDelta(r, 'p1', EMPTY);
  const b = buildOnlineRewardDelta(r, 'p2', EMPTY);
  // 50 + 30(draw) + 25(close) = 105 each, no win bonus
  assert.equal(a.xpEarned, 105);
  assert.equal(b.xpEarned, 105);
});

// ── Counters ────────────────────────────────────────────────────────────────

test('counters accumulate from prior; win increments wins/streak/points', () => {
  const prior = { matches: 20, wins: 9, losses: 8, draws: 3, xp: 1000, pins: 2, techFalls: 1, points: 200, streakCurrent: 4, streakBest: 7, achievementIds: ['first_win'] };
  const r = rec({ p1: { uid: 'u1', name: 'A', score: 5, takedowns: 1, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 1, takedowns: 0, pinCount: 0 } });
  const { next } = buildOnlineRewardDelta(r, 'p1', prior);
  assert.equal(next.matches, 21);
  assert.equal(next.wins, 10);
  assert.equal(next.losses, 8, 'a win does not touch losses');
  assert.equal(next.points, 205, 'this match score is added to points');
  assert.equal(next.streakCurrent, 5, 'win extends the streak');
  assert.equal(next.streakBest, 7, 'streakBest holds when current is still below it');
});

test('a loss resets the current streak and increments losses', () => {
  const prior = { matches: 5, wins: 3, losses: 1, draws: 0, xp: 300, pins: 0, techFalls: 0, points: 40, streakCurrent: 3, streakBest: 3, achievementIds: [] };
  const r = rec(); // p1 wins -> from p2's perspective this is a loss
  const { next } = buildOnlineRewardDelta(r, 'p2', prior);
  assert.equal(next.losses, 2);
  assert.equal(next.wins, 3, 'a loss does not touch wins');
  assert.equal(next.streakCurrent, 0, 'a loss breaks the streak');
  assert.equal(next.streakBest, 3, 'streakBest is preserved');
});

test('a draw increments draws and breaks the streak', () => {
  const prior = { matches: 5, wins: 3, losses: 1, draws: 1, xp: 300, pins: 0, techFalls: 0, points: 40, streakCurrent: 3, streakBest: 5, achievementIds: [] };
  const r = rec({ winner: null, winMethod: 'draw', p1: { uid: 'u1', name: 'A', score: 4, takedowns: 0, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 4, takedowns: 0, pinCount: 0 } });
  const { next } = buildOnlineRewardDelta(r, 'p1', prior);
  assert.equal(next.draws, 2);
  assert.equal(next.streakCurrent, 0);
});

test('pins and techFalls counters track method wins', () => {
  const pinR = rec({ winMethod: 'pin', p1: { uid: 'u1', name: 'A', score: 6, takedowns: 0, pinCount: 1 }, p2: { uid: 'u2', name: 'B', score: 0, takedowns: 0, pinCount: 0 } });
  const tfR = rec({ winMethod: 'tech_fall', p1: { uid: 'u1', name: 'A', score: 16, takedowns: 0, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 1, takedowns: 0, pinCount: 0 } });
  assert.equal(buildOnlineRewardDelta(pinR, 'p1', EMPTY).next.pins, 1, 'pin win counts a pin');
  assert.equal(buildOnlineRewardDelta(tfR, 'p1', EMPTY).next.techFalls, 1, 'tech-fall win counts a tech fall');
});

// ── Achievements ──────────────────────────────────────────────────────────

test('first online win unlocks first_win and online milestone checks fire once', () => {
  const { next, earnedAchievementIds } = buildOnlineRewardDelta(rec(), 'p1', EMPTY);
  assert.ok(earnedAchievementIds.includes('first_win'), 'first_win earned');
  assert.ok(next.achievementIds.includes('first_win'), 'cumulative list carries it');
  assert.ok(!earnedAchievementIds.includes('online_wins_5'), 'not 5 wins yet');
});

test('milestone achievements unlock when their threshold is newly crossed', () => {
  const prior = { matches: 9, wins: 9, losses: 0, draws: 0, xp: 0, pins: 0, techFalls: 0, points: 0, streakCurrent: 4, streakBest: 4, achievementIds: ['first_win', 'online_wins_5'] };
  const r = rec({ p1: { uid: 'u1', name: 'A', score: 5, takedowns: 0, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 1, takedowns: 0, pinCount: 0 } });
  const { earnedAchievementIds } = buildOnlineRewardDelta(r, 'p1', prior);
  // wins 9 -> 10 (win_10 new), streak 4 -> 5 (streak_5 new). first_win/online_wins_5 already held.
  assert.ok(earnedAchievementIds.includes('win_10'), 'win_10 newly crossed');
  assert.ok(earnedAchievementIds.includes('streak_5'), 'streak_5 newly crossed');
  assert.ok(!earnedAchievementIds.includes('first_win'), 'already-held achievement is not re-earned');
  assert.ok(!earnedAchievementIds.includes('online_wins_5'), 'already-held milestone is not re-earned');
});

test('takedown_5 unlocks on 5+ takedowns in a single match', () => {
  const r = rec({ p1: { uid: 'u1', name: 'A', score: 12, takedowns: 5, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 4, takedowns: 0, pinCount: 0 } });
  assert.ok(buildOnlineRewardDelta(r, 'p1', EMPTY).earnedAchievementIds.includes('takedown_5'));
  const r4 = rec({ p1: { uid: 'u1', name: 'A', score: 12, takedowns: 4, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 4, takedowns: 0, pinCount: 0 } });
  assert.ok(!buildOnlineRewardDelta(r4, 'p1', EMPTY).earnedAchievementIds.includes('takedown_5'), '4 takedowns is not enough');
});

test('reducer trusts only the server record — extraneous client fields are ignored', () => {
  const hostile = rec({ clientClaimedXp: 99999, p1: { uid: 'u1', name: 'A', score: 5, takedowns: 1, pinCount: 0, claimedBonus: 9999 }, p2: { uid: 'u2', name: 'B', score: 1, takedowns: 0, pinCount: 0 } });
  const { xpEarned } = buildOnlineRewardDelta(hostile, 'p1', EMPTY);
  // 50 + 100 = 150 (diff 4 not close, no method/shutout/td bonus). Hostile fields ignored.
  assert.equal(xpEarned, 150);
});

// ── settleAuthoritativeMatch (transaction) ──────────────────────────────────

// Faithful in-memory stand-in for the admin Firestore transaction surface used by
// settleAuthoritativeMatch: collection().doc(), runTransaction(), tx.get/create/set.
function fakeDb() {
  const store = new Map();
  const key = (ref) => `${ref._coll}/${ref._id}`;
  return {
    store,
    collection: (name) => ({ doc: (id) => ({ _coll: name, _id: id }) }),
    async runTransaction(fn) {
      let wrote = false;
      const tx = {
        async get(ref) {
          if (wrote) throw new Error('Firestore: reads must come before writes');
          const k = key(ref);
          return { exists: store.has(k), data: () => store.get(k) };
        },
        create(ref, data) {
          wrote = true;
          const k = key(ref);
          if (store.has(k)) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; }
          store.set(k, data);
        },
        set(ref, data, opts) {
          wrote = true;
          const k = key(ref);
          if (opts && opts.merge && store.has(k)) store.set(k, { ...store.get(k), ...data });
          else store.set(k, data);
        },
      };
      return fn(tx);
    },
  };
}

test('settleAuthoritativeMatch creates the ledger and writes both online_progress docs', async () => {
  const db = fakeDb();
  const built = { collection: 'match_results', matchId: 'm-1', record: rec({ matchId: 'm-1' }) };
  const { receipts, settled } = await settleAuthoritativeMatch(db, built);
  assert.equal(settled, true);
  assert.ok(db.store.has('match_results/m-1'), 'ledger record created in the same txn');
  assert.ok(db.store.has('online_progress/u1') && db.store.has('online_progress/u2'), 'both progress docs written');
  assert.equal(receipts.length, 2);
  const r1 = receipts.find((r) => r.uid === 'u1');
  assert.equal(r1.matchId, 'm-1');
  assert.equal(r1.onlineProgress.wins, 1, 'winner credited a win');
  assert.equal(r1.xpEarned, 150);
  const r2 = receipts.find((r) => r.uid === 'u2');
  assert.equal(r2.onlineProgress.losses, 1, 'loser credited a loss');
  assert.equal(r2.xpEarned, 50);
});

test('a duplicate matchId aborts settlement — counters apply exactly once', async () => {
  const db = fakeDb();
  const built = { collection: 'match_results', matchId: 'm-2', record: rec({ matchId: 'm-2' }) };
  await settleAuthoritativeMatch(db, built);
  const winsAfterFirst = db.store.get('online_progress/u1').wins;
  const second = await settleAuthoritativeMatch(db, built);
  assert.equal(second.settled, false, 'a replay is not settled again');
  assert.equal(second.receipts.length, 0);
  assert.equal(db.store.get('online_progress/u1').wins, winsAfterFirst, 'wins are not double-counted');
});

test('dev mode (no db handle) is a safe no-op', async () => {
  const out = await settleAuthoritativeMatch(null, { collection: 'match_results', matchId: 'm', record: rec() });
  assert.deepEqual(out, { receipts: [], settled: false });
});

test('a recorded draw (winner === "draw") is scored as a draw, not a loss', () => {
  // The engine emits winner: 'draw' (wrestlingEngine.js), not null, on an
  // overtime-expired draw. The reducer must treat that as a draw.
  const r = rec({ winner: 'draw', winMethod: 'draw', p1: { uid: 'u1', name: 'A', score: 4, takedowns: 0, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 4, takedowns: 0, pinCount: 0 } });
  const a = buildOnlineRewardDelta(r, 'p1', EMPTY);
  assert.equal(a.next.draws, 1, 'counts a draw');
  assert.equal(a.next.losses, 0, 'a draw is NOT a loss');
  assert.equal(a.next.wins, 0);
  assert.equal(a.xpEarned, 105, '50 participation + 30 draw + 25 close (4-4)');
});

test('settleAuthoritativeMatch retries a transient transaction failure', async () => {
  const base = fakeDb();
  let calls = 0;
  const flaky = {
    store: base.store,
    collection: base.collection,
    async runTransaction(fn) {
      calls++;
      if (calls === 1) throw new Error('UNAVAILABLE: transient blip');
      return base.runTransaction(fn);
    },
  };
  const built = { collection: 'match_results', matchId: 'm-retry', record: rec({ matchId: 'm-retry' }) };
  const { settled, receipts } = await settleAuthoritativeMatch(flaky, built, { attempts: 3 });
  assert.equal(settled, true, 'the second attempt settles');
  assert.equal(calls, 2, 'retried exactly once after the transient failure');
  assert.equal(receipts.length, 2);
  assert.equal(flaky.store.get('online_progress/u1').wins, 1, 'counters applied exactly once across the retry');
});

test('settleAuthoritativeMatch rethrows after exhausting all attempts', async () => {
  const flaky = { collection: () => ({ doc: () => ({}) }), async runTransaction() { throw new Error('UNAVAILABLE: persistent'); } };
  const built = { collection: 'match_results', matchId: 'm-fail', record: rec({ matchId: 'm-fail' }) };
  await assert.rejects(() => settleAuthoritativeMatch(flaky, built, { attempts: 3 }), /persistent/);
});

test('a returning player accumulates onto prior online_progress', async () => {
  const db = fakeDb();
  db.store.set('online_progress/u1', { matches: 4, wins: 4, losses: 0, draws: 0, xp: 600, pins: 0, techFalls: 0, points: 50, streakCurrent: 4, streakBest: 4, achievementIds: ['first_win', 'online_wins_5'] });
  const built = { collection: 'match_results', matchId: 'm-4', record: rec({ matchId: 'm-4', p1: { uid: 'u1', name: 'A', score: 5, takedowns: 0, pinCount: 0 }, p2: { uid: 'u2', name: 'B', score: 1, takedowns: 0, pinCount: 0 } }) };
  const { receipts } = await settleAuthoritativeMatch(db, built);
  const r1 = receipts.find((r) => r.uid === 'u1');
  assert.equal(r1.onlineProgress.wins, 5);
  assert.equal(r1.onlineProgress.streakCurrent, 5);
  assert.ok(r1.achievementIds.includes('streak_5'), 'newly crossed streak_5 reported in the receipt');
  assert.ok(!r1.achievementIds.includes('first_win'), 'already-held achievement is not re-reported');
});
