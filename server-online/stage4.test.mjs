// Stage 4 (roomManager integration): a finished match emits one server-built
// result record. The outcome comes from the engine matchState; the client
// cannot mutate it; a duplicate finish does not re-emit (process-level
// idempotency complements the Firestore create-keyed-by-matchId guard).
//
// Run: node --test server-online/stage4.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './roomManager.mjs';

let nextUid = 0;
function fakeWs(name = 'p') {
  const sent = [];
  return { sent, _uid: `uid-${name}-${nextUid++}`, readyState: 1, send: (p) => sent.push(JSON.parse(p)), close() {}, ping() {} };
}
function setup(onMatchResult) {
  const rm = new RoomManager({ onMatchResult });
  const host = fakeWs('host');
  const guest = fakeWs('guest');
  const code = rm.createRoom(host, 'Alice', 'folkstyle');
  assert.equal(rm.joinRoom(guest, code, 'Bob').ok, true);
  return { rm, code, host, guest, room: rm.rooms.get(code) };
}

test('a matchId is assigned at match start', () => {
  const { room } = setup(() => {});
  assert.ok(room.matchId, 'matchId set');
  assert.equal(room.ledgerWritten, false, 'ledger not yet written');
});

test('a finished match emits a server-built result record exactly once', () => {
  const built = [];
  const { rm, room, host } = setup((b) => built.push(b));
  room.matchState = { ...room.matchState, phase: 'finished', winner: 'p1', winMethod: 'decision', p1: { score: 12 }, p2: { score: 5 } };
  rm._postResolveRound(room);
  assert.equal(built.length, 1, 'one record on finish');
  assert.equal(built[0].matchId, room.matchId);
  assert.equal(built[0].record.winner, 'p1', 'winner from server matchState');
  assert.equal(built[0].record.p1.uid, host._uid);
  rm._postResolveRound(room); // duplicate finish
  assert.equal(built.length, 1, 'no duplicate emit (ledgerWritten guard)');
});

test('pin-induced finish also emits the result record', () => {
  const built = [];
  const { rm, room } = setup((b) => built.push(b));
  room.matchState = { ...room.matchState, phase: 'finished', winner: 'p2', winMethod: 'pin' };
  rm._postResolvePin(room);
  assert.equal(built.length, 1);
  assert.equal(built[0].record.winner, 'p2');
  assert.equal(built[0].record.winMethod, 'pin');
});

test('the outcome is taken from server matchState, never a client field', () => {
  const built = [];
  const { rm, room } = setup((b) => built.push(b));
  room.clientClaimedWinner = 'p2'; // hostile client-style field on the room
  room.matchState = { ...room.matchState, phase: 'finished', winner: 'p1', winMethod: 'decision' };
  rm._postResolveRound(room);
  assert.equal(built[0].record.winner, 'p1', 'server winner used; client claim ignored');
});

test('a rematch starts a fresh matchId and re-arms the ledger', () => {
  const built = [];
  const { rm, room } = setup((b) => built.push(b));
  const firstId = room.matchId;
  room.matchState = { ...room.matchState, phase: 'finished', winner: 'p1' };
  rm._postResolveRound(room);
  rm._resetRoomForRematch(room);
  rm._startMatch(room);
  assert.notEqual(room.matchId, firstId, 'rematch gets a new matchId');
  assert.equal(room.ledgerWritten, false, 'ledger re-armed for the new match');
});

// ── Stage 4: match_settled push (connected-socket-only delivery) ────────────

test('match_settled is pushed to each connected player with their trusted receipt', async () => {
  const { rm, room, host, guest } = setup((b) => ({
    receipts: [
      { uid: host._uid, matchId: b.matchId, onlineProgress: { wins: 1, xp: 150 }, xpEarned: 150, achievementIds: ['first_win'] },
      { uid: guest._uid, matchId: b.matchId, onlineProgress: { losses: 1, xp: 50 }, xpEarned: 50, achievementIds: [] },
    ],
  }));
  room.matchState = { ...room.matchState, phase: 'finished', winner: 'p1', winMethod: 'decision', p1: { score: 12 }, p2: { score: 5 } };
  rm._postResolveRound(room);
  await Promise.resolve(); await Promise.resolve(); // let the settlement promise resolve

  const hostMsg = host.sent.find((m) => m.type === 'match_settled');
  const guestMsg = guest.sent.find((m) => m.type === 'match_settled');
  assert.ok(hostMsg, 'host receives match_settled');
  assert.equal(hostMsg.matchId, room.matchId);
  assert.equal(hostMsg.xpEarned, 150);
  assert.deepEqual(hostMsg.achievementIds, ['first_win']);
  assert.equal(hostMsg.onlineProgress.wins, 1);
  assert.ok(guestMsg, 'guest receives match_settled');
  assert.equal(guestMsg.xpEarned, 50);
});

test('a disconnected player is NOT pushed match_settled (relies on the Firestore fallback)', async () => {
  const { rm, room, host, guest } = setup((b) => ({
    receipts: [
      { uid: host._uid, matchId: b.matchId, onlineProgress: {}, xpEarned: 50, achievementIds: [] },
      { uid: guest._uid, matchId: b.matchId, onlineProgress: {}, xpEarned: 50, achievementIds: [] },
    ],
  }));
  room.guest.ws = null; // guest dropped before settlement
  room.matchState = { ...room.matchState, phase: 'finished', winner: 'p1' };
  rm._postResolveRound(room);
  await Promise.resolve(); await Promise.resolve();

  assert.ok(host.sent.find((m) => m.type === 'match_settled'), 'connected host is pushed');
  assert.equal(guest.sent.find((m) => m.type === 'match_settled'), undefined, 'disconnected guest is not pushed');
});
