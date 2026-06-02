// Stage 4: server-authoritative result ledger. The outcome is built from the
// engine's matchState (the server owns it) and written idempotently keyed by
// matchId, so a replay/retry/restart can never double-count.
//
// Run: node --test server-online/resultLedger.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResultRecord, writeResultRecord } from './resultLedger.mjs';

function fakeRoom() {
  return {
    code: 'AB12',
    matchId: 'match-xyz',
    style: 'folkstyle',
    host: { uid: 'uid-p1', name: 'Alice' },
    guest: { uid: 'uid-p2', name: 'Bob' },
    matchState: { phase: 'finished', winner: 'p1', winMethod: 'decision', p1: { score: 12 }, p2: { score: 5 } },
  };
}

function fakeDb() {
  const store = new Map();
  return {
    store,
    collection: (name) => ({
      doc: (id) => ({
        create: async (data) => {
          const key = `${name}/${id}`;
          if (store.has(key)) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; }
          store.set(key, data);
          return {};
        },
      }),
    }),
  };
}

test('buildResultRecord derives the outcome from server matchState only', () => {
  const built = buildResultRecord(fakeRoom(), 1000);
  assert.equal(built.collection, 'match_results');
  assert.equal(built.matchId, 'match-xyz');
  assert.equal(built.record.matchId, 'match-xyz');
  assert.equal(built.record.winner, 'p1');
  assert.equal(built.record.winMethod, 'decision');
  assert.equal(built.record.p1.uid, 'uid-p1');
  assert.equal(built.record.p1.score, 12);
  assert.equal(built.record.p2.uid, 'uid-p2');
  assert.equal(built.record.p2.score, 5);
  assert.equal(built.record.finishedAt, 1000);
});

test('buildResultRecord ignores any client-supplied outcome field', () => {
  const room = fakeRoom();
  room.clientClaimedWinner = 'p2';                 // hostile / client-written
  room.matchState.clientResult = { winner: 'p2' }; // hostile
  const built = buildResultRecord(room, 1000);
  assert.equal(built.record.winner, 'p1', 'server winner stands; client claim ignored');
  assert.equal('clientResult' in built.record, false);
  assert.equal('clientClaimedWinner' in built.record, false);
});

test('writeResultRecord writes once and treats a replay as an idempotent duplicate', async () => {
  const db = fakeDb();
  const built = buildResultRecord(fakeRoom(), 1000);
  assert.equal(await writeResultRecord(db, built), 'written');
  assert.equal(await writeResultRecord(db, built), 'duplicate', 'replay is a no-op');
  assert.equal(db.store.size, 1, 'exactly one record stored');
  assert.equal(db.store.get('match_results/match-xyz').winner, 'p1');
});

test('writeResultRecord is a no-op when there is no Firestore handle (dev)', async () => {
  assert.equal(await writeResultRecord(null, buildResultRecord(fakeRoom(), 1000)), 'skipped');
});

test('writeResultRecord rethrows a non-already-exists error', async () => {
  const db = {
    collection: () => ({ doc: () => ({ create: async () => { const e = new Error('boom'); e.code = 13; throw e; } }) }),
  };
  await assert.rejects(() => writeResultRecord(db, buildResultRecord(fakeRoom(), 1000)), /boom/);
});

test('buildResultRecord carries server-owned takedowns and pinCount for reward settlement', () => {
  const room = fakeRoom();
  room.matchState.p1 = { score: 12, takedownCount: 4, pinCount: 0 };
  room.matchState.p2 = { score: 5, takedownCount: 1, pinCount: 1 };
  const built = buildResultRecord(room, 1000);
  assert.equal(built.record.p1.takedowns, 4, 'p1 takedowns mapped from engine takedownCount');
  assert.equal(built.record.p1.pinCount, 0);
  assert.equal(built.record.p2.takedowns, 1);
  assert.equal(built.record.p2.pinCount, 1, 'p2 pinCount carried straight from matchState');
});
