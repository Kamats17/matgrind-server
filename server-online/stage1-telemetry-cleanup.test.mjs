// Stage 1 (telemetry + cleanup) regression tests.
// Covers: conditional playerRooms cleanup, idle-cleanup gauge sync,
// centralized phase gauges, correct void phase label, split terminal sweep,
// disconnect telemetry, and isolated metric snapshots.
//
// Run with: node --test server-online/stage1-telemetry-cleanup.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './roomManager.mjs';
import { resetMetrics, getGauge, getCounter } from './metrics.mjs';
import { TIMING } from './config.mjs';
import { startChallenge } from './challengeEngine.mjs';
import { MECHANIC_TYPES } from '../src/lib/cardArchetypeMechanics.js';
import { makeRng } from '../src/lib/seededRng.js';

let nextUid = 0;
function fakeWs(name = 'p') {
  const sent = [];
  const uid = `uid-${name}-${nextUid++}`;
  return {
    sent,
    _uid: uid,
    readyState: 1,
    send: (p) => sent.push(JSON.parse(p)),
    close: () => {},
    ping: () => {},
  };
}

function setupRoom() {
  const rm = new RoomManager();
  const host = fakeWs('host');
  const guest = fakeWs('guest');
  const code = rm.createRoom(host, 'Alice', 'folkstyle');
  const result = rm.joinRoom(guest, code, 'Bob');
  assert.equal(result.ok, true);
  return { rm, code, host, guest };
}

// ── 1.2 Conditional playerRooms cleanup ────────────────────────────────────

test('destroyRoom clears playerRooms only when the mapping still points at it', () => {
  resetMetrics();
  const rm = new RoomManager();
  const host = fakeWs('h');
  const older = rm.createRoom(host, 'A', 'folkstyle');
  const newer = rm.createRoom(host, 'B', 'folkstyle'); // overwrites playerRooms[uid] -> newer
  rm.destroyRoom(older);
  assert.equal(
    rm.playerRooms.get(host._uid), newer,
    'destroying the older room must not erase the newer mapping',
  );
});

// ── 1.1 Idle cleanup keeps gauges in sync ──────────────────────────────────

test('cleanupIdleRooms updates room gauges (routes through destroyRoom)', () => {
  resetMetrics();
  const rm = new RoomManager();
  const host = fakeWs('h');
  const code = rm.createRoom(host, 'A', 'folkstyle');
  rm.rooms.get(code).lastActivity = Date.now() - (TIMING.room_idle_timeout_ms + 1000);
  rm.cleanupIdleRooms();
  assert.equal(rm.rooms.size, 0, 'idle room removed');
  assert.equal(getGauge('rooms_resident'), 0, 'resident gauge synced after idle cleanup');
  assert.equal(getGauge('rooms_active'), 0, 'active gauge synced after idle cleanup');
});

// ── 1.6 Centralized phase gauges ───────────────────────────────────────────

test('phase gauges reflect a single playing match', () => {
  resetMetrics();
  setupRoom();
  assert.equal(getGauge('rooms_by_phase', { phase: 'playing' }), 1, 'one playing room');
  assert.equal(getGauge('rooms_by_phase', { phase: 'waiting' }), 0, 'no waiting rooms');
  assert.equal(getGauge('rooms_active'), 1, 'active = waiting + playing');
  assert.equal(getGauge('rooms_resident'), 1, 'one resident room');
});

// ── 1.4 Void metric records the pre-void phase ─────────────────────────────

test('void records the phase the room was in before voiding (not "voided")', () => {
  resetMetrics();
  const { rm, code } = setupRoom();
  const room = rm.rooms.get(code);
  assert.equal(room.phase, 'playing', 'precondition: room is playing');
  rm._voidRoom(room, 'opponent_disconnect_timeout');
  assert.equal(
    getCounter('matches_voided_total', { reason: 'opponent_disconnect_timeout', phase: 'playing' }), 1,
    'void counter is labeled with the prior phase (playing)',
  );
  assert.equal(
    getCounter('matches_voided_total', { reason: 'opponent_disconnect_timeout', phase: 'voided' }), 0,
    'must NOT be labeled "voided"',
  );
});

// ── 1.3 Split terminal-room sweep ──────────────────────────────────────────

test('terminalAt is stamped on void and cleared when a room returns to playing', () => {
  resetMetrics();
  const { rm, code } = setupRoom();
  const room = rm.rooms.get(code);
  rm._setRoomPhase(room, 'finished');
  assert.ok(room.terminalAt != null, 'finished stamps terminalAt');
  rm._setRoomPhase(room, 'playing'); // rematch
  assert.equal(room.terminalAt, null, 'returning to playing clears terminalAt (rematch-safe)');
});

test('voided room is swept after the reconnect window + margin (sooner than idle timeout)', () => {
  resetMetrics();
  const { rm, code } = setupRoom();
  const room = rm.rooms.get(code);
  rm._voidRoom(room, 'opponent_disconnect_timeout');
  room.terminalAt = Date.now() - (3 * 60 * 1000); // 180s ago > 150s threshold
  room.lastActivity = Date.now();                 // recent: old idle policy would NOT sweep
  rm.cleanupIdleRooms();
  assert.equal(rm.rooms.has(code), false, 'voided room swept after the window');
});

test('finished room is swept after margin once both players disconnect', () => {
  resetMetrics();
  const { rm, code } = setupRoom();
  const room = rm.rooms.get(code);
  rm._setRoomPhase(room, 'finished');
  room.host.ws = null;
  room.guest.ws = null;
  room.terminalAt = Date.now() - (2 * 60 * 1000); // 120s > 60s margin
  room.lastActivity = Date.now();
  rm.cleanupIdleRooms();
  assert.equal(rm.rooms.has(code), false, 'finished + both-disconnected swept');
});

test('finished room with a still-connected player is NOT swept early', () => {
  resetMetrics();
  const { rm, code } = setupRoom();
  const room = rm.rooms.get(code);
  rm._setRoomPhase(room, 'finished');
  room.host.ws = null;            // one left
  // guest still connected (result screen)
  room.terminalAt = Date.now() - (5 * 60 * 1000);
  room.lastActivity = Date.now();
  rm.cleanupIdleRooms();
  assert.ok(rm.rooms.has(code), 'connected finished room retained until normal idle timeout');
});

// ── 1.5 Disconnect telemetry (additive observation) ────────────────────────

test('disconnect from a playing room increments disconnect_total{phase:playing}', () => {
  resetMetrics();
  const { rm, host } = setupRoom();
  rm.handleDisconnect(host);
  assert.equal(getCounter('disconnect_total', { phase: 'playing' }), 1);
});

test('a stale (superseded) socket close is counted separately, not as a disconnect', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  const newer = fakeWs('host2');
  newer._uid = host._uid;
  room.host.ws = newer; // a newer socket is now the installed one for p1
  rm.handleDisconnect(host); // the old socket's close arrives late → stale
  assert.equal(getCounter('stale_socket_close_total'), 1, 'stale close counted separately');
  assert.equal(getCounter('disconnect_total', { phase: 'playing' }), 0, 'not a real disconnect');
});

// ── 1.5 Per-role accepted-intent flags ─────────────────────────────────────

test('a valid card_pick marks acceptedIntent for that role only', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  const card = room.hands.p1[0];
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: room.roundSeq, cardId: card.id });
  assert.equal(room.acceptedIntent.p1, true, 'dropper-side intent recorded');
  assert.equal(room.acceptedIntent.p2, false, 'opponent intent untouched');
});

test('a rejected card_pick does NOT mark acceptedIntent', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  // Wrong roundSeq → sendError before any state change.
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: room.roundSeq + 99, cardId: room.hands.p1[0].id });
  assert.equal(room.acceptedIntent.p1, false, 'a rejected frame is not intent');
});

test('challenge_input with no active challenge does NOT mark intent', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  // No challenge launched → recordChallengeInput is never reached / returns false.
  rm.handleGameMessage(host, { type: 'challenge_input', eventType: 'press' });
  assert.equal(room.acceptedIntent.p1, false, 'dropped challenge input is not intent');
});

test('rematch reset clears acceptedIntent flags', () => {
  resetMetrics();
  const { rm, code } = setupRoom();
  const room = rm.rooms.get(code);
  room.acceptedIntent = { p1: true, p2: true };
  rm._resetRoomForRematch(room);
  assert.deepEqual(room.acceptedIntent, { p1: false, p2: false }, 'fresh match starts pre-intent');
});

// ── 1.5 Intent-aware disconnect-timeout void labels ────────────────────────

test('disconnect-timeout void is labeled no_show when the dropper never engaged', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  room.acceptedIntent.p1 = false; // never produced a gameplay frame...
  room.matchAccepted.p1 = false;  // ...and never accepted the match (Stage 3)
  rm.handleDisconnect(host);
  rm._onReconnectGraceExpired(room, 'p1'); // simulate grace timer firing
  assert.equal(
    getCounter('matches_voided_total', { reason: 'no_show_disconnect', phase: 'playing' }), 1,
    'never-engaged drop is an honest no_show',
  );
});

test('disconnect-timeout on a started match forfeits the dropper (opponent wins)', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  room.acceptedIntent.p1 = true; // engaged in a live match
  rm.handleDisconnect(host);
  rm._onReconnectGraceExpired(room, 'p1');
  // New policy (2026-06): a started match abandoned past the grace is a FORFEIT
  // (opponent wins), not a silent void - refreshing no longer dodges the loss.
  assert.equal(
    getCounter('matches_forfeited_total', { abandoner: 'p1' }), 1,
    'mid-match abandonment forfeits',
  );
  assert.equal(room.matchState.winner, 'p2');
  assert.equal(room.matchState.winMethod, 'forfeit');
  assert.equal(room.phase, 'finished');
});

// ── 1.5 Reconnect-outcome counters ─────────────────────────────────────────

test('disconnect during an active challenge increments disconnect_during_challenge_total', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  room.challenges.p1 = startChallenge({
    room, role: 'p1', mechanic: MECHANIC_TYPES.CHARGE, cardId: 'test-card',
    rng: makeRng(1), sendToOwner: () => {}, onResolve: () => {},
  });
  assert.ok(room.challenges.p1, 'precondition: a challenge is active');
  rm.handleDisconnect(host);
  assert.equal(getCounter('disconnect_during_challenge_total', { phase: 'playing' }), 1);
});

test('grace-timeout void increments reconnect_timeout_total', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  rm.handleDisconnect(host);
  rm._onReconnectGraceExpired(room, 'p1');
  assert.equal(getCounter('reconnect_timeout_total', { phase: 'playing' }), 1);
  assert.equal(room.phase, 'voided', 'timeout voids the room');
});

test('successful reconnect increments reconnect_success_total and a latency bucket', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  rm.handleDisconnect(host);
  const newer = fakeWs('host2');
  newer._uid = host._uid;
  const ok = rm.handleReconnect(newer, host._uid);
  assert.equal(ok, true, 'reconnect succeeds');
  assert.equal(getCounter('reconnect_success_total'), 1);
  // Reconnect is immediate in-test (<1s) → lands in the 1s bucket.
  assert.equal(getCounter('reconnect_latency_bucket', { le: '1' }), 1);
});

test('reconnect latency buckets are cumulative, always including +Inf', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  rm.handleDisconnect(host);
  // Backdate the drop stamp to simulate a 7s gap (deterministic).
  room.host.disconnectedAt = Date.now() - 7000;
  const newer = fakeWs('host2');
  newer._uid = host._uid;
  rm.handleReconnect(newer, host._uid);
  // 7s is above the 1s/5s bounds, at or below 15s/30s/45s, and +Inf always.
  assert.equal(getCounter('reconnect_latency_bucket', { le: '1' }), 0, '7s not <= 1s');
  assert.equal(getCounter('reconnect_latency_bucket', { le: '5' }), 0, '7s not <= 5s');
  assert.equal(getCounter('reconnect_latency_bucket', { le: '15' }), 1, '7s <= 15s');
  assert.equal(getCounter('reconnect_latency_bucket', { le: '30' }), 1, '7s <= 30s');
  assert.equal(getCounter('reconnect_latency_bucket', { le: '45' }), 1, '7s <= 45s');
  assert.equal(getCounter('reconnect_latency_bucket', { le: '+Inf' }), 1, '+Inf always counts');
});

// ── 1.5 Intent gating runs through recordChallengeInput (active challenge) ──

function launchChargeChallenge(rm, code, role = 'p1') {
  const room = rm.rooms.get(code);
  room.challenges[role] = startChallenge({
    room, role, mechanic: MECHANIC_TYPES.CHARGE, cardId: 'test-card',
    rng: makeRng(1), sendToOwner: () => {}, onResolve: () => {},
  });
  assert.ok(room.challenges[role], 'precondition: a challenge is active');
  return room;
}

test('an accepted active challenge input marks acceptedIntent', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = launchChargeChallenge(rm, code, 'p1');
  // 'release' is a valid charge event → recordChallengeInput returns true.
  rm.handleGameMessage(host, { type: 'challenge_input', eventType: 'release' });
  assert.equal(room.acceptedIntent.p1, true, 'engine-accepted input is intent');
});

test('a rejected active challenge input does NOT mark acceptedIntent', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = launchChargeChallenge(rm, code, 'p1');
  // Bogus eventType → recordChallengeInput returns false (engine drops it).
  rm.handleGameMessage(host, { type: 'challenge_input', eventType: 'not-a-real-event' });
  assert.equal(room.acceptedIntent.p1, false, 'engine-dropped input is not intent');
});
