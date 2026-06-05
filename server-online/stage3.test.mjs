// Stage 3: explicit client accept signal + honest disconnect classification.
// With match_accept the server can tell a true no-show (never accepted the
// match) from a player who engaged and then dropped — the gap Stage 1 left
// open ("server can't honestly say no_show without a client accept signal").
//
// Run: node --test server-online/stage3.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './roomManager.mjs';
import { resetMetrics, getCounter } from './metrics.mjs';

let nextUid = 0;
function fakeWs(name = 'p') {
  const sent = [];
  return { sent, _uid: `uid-${name}-${nextUid++}`, readyState: 1, send: (p) => sent.push(JSON.parse(p)), close() {}, ping() {} };
}
function setupRoom() {
  const rm = new RoomManager();
  const host = fakeWs('host');
  const guest = fakeWs('guest');
  const code = rm.createRoom(host, 'Alice', 'folkstyle');
  assert.equal(rm.joinRoom(guest, code, 'Bob').ok, true);
  return { rm, code, host, guest };
}

test('match_accept sets the per-role accepted flag', () => {
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  rm.handleGameMessage(host, { type: 'match_accept' });
  assert.equal(room.matchAccepted.p1, true, 'dropper-side accept recorded');
  assert.equal(room.matchAccepted.p2, false, 'opponent untouched');
});

test('disconnect-timeout void: a never-accepted dropper is a no_show', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  rm.handleDisconnect(host);
  rm._onReconnectGraceExpired(room, 'p1');
  assert.equal(getCounter('matches_voided_total', { reason: 'no_show_disconnect', phase: 'playing' }), 1,
    'never accepted + never played = no_show');
});

test('disconnect-timeout: an accepted (match_accept) dropper forfeits a started match', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  rm.handleGameMessage(host, { type: 'match_accept' }); // accepted, no gameplay yet
  rm.handleDisconnect(host);
  rm._onReconnectGraceExpired(room, 'p1');
  // Accepting the match counts as engaged: abandoning a started match forfeits
  // (opponent wins) rather than voiding.
  assert.equal(getCounter('matches_forfeited_total', { abandoner: 'p1' }), 1,
    'accepting the match counts as engaged even before any gameplay frame');
  assert.equal(room.matchState.winner, 'p2');
  assert.equal(room.matchState.winMethod, 'forfeit');
});

test('disconnect-timeout: a player who produced gameplay intent forfeits', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  const card = room.hands.p1[0];
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: room.roundSeq, cardId: card.id });
  rm.handleDisconnect(host);
  rm._onReconnectGraceExpired(room, 'p1');
  assert.equal(getCounter('matches_forfeited_total', { abandoner: 'p1' }), 1);
  assert.equal(room.matchState.winner, 'p2');
  assert.equal(room.matchState.winMethod, 'forfeit');
});

test('rematch reset clears matchAccepted', () => {
  const { rm, code } = setupRoom();
  const room = rm.rooms.get(code);
  room.matchAccepted = { p1: true, p2: true };
  rm._resetRoomForRematch(room);
  assert.deepEqual(room.matchAccepted, { p1: false, p2: false }, 'a fresh match starts unaccepted');
});
