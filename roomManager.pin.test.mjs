import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './roomManager.mjs';

function fakeWs(role) {
  const sent = [];
  return {
    sent, _role: role, _roomCode: 'TEST', readyState: 1,
    send: (p) => sent.push(JSON.parse(p)), close: () => {},
  };
}

function makeRoom(host, guest) {
  return {
    code: 'TEST',
    host: { ws: host, name: 'A' }, guest: { ws: guest, name: 'B' },
    spectators: [],
    cardPicks: { p1: null, p2: null },
    cardSkills: { p1: null, p2: null },
    pinPicks: { offense: null, defense: null },
    pinAttacker: null,
    style: 'folkstyle', phase: 'playing', mode: 'online',
    lastActivity: Date.now(),
    reconnectTimers: {},
  };
}

test('server rejects pin_pick whose sender is on the wrong side', () => {
  const rm = new RoomManager();
  const host = fakeWs('p1');
  const guest = fakeWs('p2');
  rm.rooms.set('TEST', makeRoom(host, guest));

  // p1 is the attacker
  rm.handleGameMessage(host, { type: 'pin_attempt_start', attacker: 'p1' });
  // p2 (defender) tries to submit an offense pick — must be dropped.
  rm.handleGameMessage(guest, { type: 'pin_pick', role: 'offense', cardId: 'pin_finish' });
  assert.equal(rm.rooms.get('TEST').pinPicks.offense, null, 'wrong-side offense claim must not land');

  // p1 submitting offense is legit.
  rm.handleGameMessage(host, { type: 'pin_pick', role: 'offense', cardId: 'pin_finish' });
  assert.equal(rm.rooms.get('TEST').pinPicks.offense, 'pin_finish');

  // p2 submitting defense is legit — completes the round.
  rm.handleGameMessage(guest, { type: 'pin_pick', role: 'defense', cardId: 'pin_hip_switch' });
  const hostRelay = host.sent.find((m) => m.type === 'pin_picks');
  assert.ok(hostRelay, 'pin_picks relayed to host');
  assert.equal(hostRelay.offenseCardId, 'pin_finish');
  assert.equal(hostRelay.defenseCardId, 'pin_hip_switch');
  // pinAttacker clears after resolution so the next pin attempt starts fresh.
  assert.equal(rm.rooms.get('TEST').pinAttacker, null);
});

test('pin_pick falls through with no validation when pinAttacker is unset (legacy clients)', () => {
  const rm = new RoomManager();
  const host = fakeWs('p1');
  const guest = fakeWs('p2');
  rm.rooms.set('TEST', makeRoom(host, guest));

  // No pin_attempt_start sent (simulating an older client).
  // The server should still accept the picks (backward compat).
  rm.handleGameMessage(host, { type: 'pin_pick', role: 'offense', cardId: 'pin_finish' });
  rm.handleGameMessage(guest, { type: 'pin_pick', role: 'defense', cardId: 'pin_hip_switch' });
  const hostRelay = host.sent.find((m) => m.type === 'pin_picks');
  assert.ok(hostRelay, 'pin_picks still relayed even without pin_attempt_start hint');
});
