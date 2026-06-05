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

// ── Started-match abandonment forfeits (not a silent void) ──────────────────

test('grace-expiry on an ENGAGED match forfeits: opponent wins, result emitted', async () => {
  const built = [];
  const { rm, room, host, guest } = setup((b) => {
    built.push(b);
    return { receipts: [
      { uid: host._uid, matchId: b.matchId, onlineProgress: { wins: 1 }, xpEarned: 100, achievementIds: [] },
      { uid: guest._uid, matchId: b.matchId, onlineProgress: { losses: 1 }, xpEarned: 25, achievementIds: [] },
    ] };
  });
  // Both engaged in a live match; guest then drops and never reconnects.
  room.phase = 'playing';
  room.acceptedIntent = { p1: true, p2: true };
  room.guest.ws = null;
  host.sent.length = 0;

  rm._onReconnectGraceExpired(room, 'p2'); // guest's grace elapses
  await Promise.resolve(); await Promise.resolve(); // let the settlement promise resolve

  // Authoritative result: the connected opponent (p1/host) wins by forfeit.
  assert.equal(built.length, 1, 'a result record is emitted (not a silent void)');
  assert.equal(built[0].record.winner, 'p1');
  assert.equal(built[0].record.winMethod, 'forfeit');
  assert.equal(room.matchState.phase, 'finished');
  assert.equal(room.matchState.winner, 'p1');
  assert.equal(room.matchState.winMethod, 'forfeit');
  assert.equal(room.phase, 'finished');
  // The connected opponent gets a TERMINAL state_update + their settlement;
  // never a void.
  const term = host.sent.filter((m) => m.type === 'state_update').pop();
  assert.ok(term, 'a terminal state_update is broadcast to the connected opponent');
  assert.equal(term.state.phase, 'finished');
  assert.ok(host.sent.find((m) => m.type === 'match_settled'), 'opponent receives match_settled');
  assert.equal(host.sent.find((m) => m.type === 'match_voided'), undefined, 'no void on a forfeit');
});

test('grace-expiry on a NEVER-ENGAGED no-show still voids (no unearned win)', () => {
  const built = [];
  const { rm, room, host } = setup((b) => { built.push(b); });
  room.phase = 'playing';
  room.acceptedIntent = { p1: false, p2: false };
  room.matchAccepted = { p1: false, p2: false };
  room.guest.ws = null;
  host.sent.length = 0;

  rm._onReconnectGraceExpired(room, 'p2');

  assert.equal(built.length, 0, 'no result emitted for a no-show');
  assert.equal(room.phase, 'voided');
  assert.ok(host.sent.find((m) => m.type === 'match_voided'), 'opponent gets a void notice');
});

test('grace-expiry with BOTH players disconnected voids (no forfeit win to an absent opponent)', () => {
  const built = [];
  const { rm, room } = setup((b) => { built.push(b); });
  room.phase = 'playing';
  room.acceptedIntent = { p1: true, p2: true }; // both engaged, then both dropped
  room.host.ws = null;
  room.guest.ws = null;

  rm._onReconnectGraceExpired(room, 'p1'); // first grace timer to fire

  assert.equal(built.length, 0, 'no result emitted when both players abandoned');
  assert.equal(room.matchState.winner ?? null, null, 'no winner awarded to an absent opponent');
  assert.notEqual(room.matchState.winMethod, 'forfeit');
  assert.equal(room.phase, 'voided');
});

test('grace-expiry is a no-op once the match is already terminal (stale second timer)', () => {
  const built = [];
  const { rm, room } = setup((b) => { built.push(b); });
  // Simulate the match already finished (e.g. the first side resolved it).
  room.matchState = { ...room.matchState, phase: 'finished', winner: 'p1', winMethod: 'forfeit' };
  rm._setRoomPhase(room, 'finished');
  room.guest.ws = null;

  rm._onReconnectGraceExpired(room, 'p2'); // a stale grace timer fires late

  assert.equal(built.length, 0, 'no second result');
  assert.equal(room.phase, 'finished', 'a finished room is not voided by a stale timer');
  assert.equal(room.matchState.winner, 'p1', 'the original result is untouched');
});
