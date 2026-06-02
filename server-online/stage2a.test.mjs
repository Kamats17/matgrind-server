// Stage 2A regression tests — roomManager-level pieces that don't require the
// full index.mjs wiring: persisted initialInitiative (shim replay payload) and
// exact-socket matchmaking-queue cleanup.
//
// Run: node --test server-online/stage2a.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './roomManager.mjs';
import { resetMetrics, getCounter } from './metrics.mjs';
import { startChallenge } from './challengeEngine.mjs';
import { MECHANIC_TYPES } from '../src/lib/cardArchetypeMechanics.js';
import { makeRng } from '../src/lib/seededRng.js';

let nextUid = 0;
function fakeWs(name = 'p') {
  const sent = [];
  return {
    sent,
    _uid: `uid-${name}-${nextUid++}`,
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
  assert.equal(rm.joinRoom(guest, code, 'Bob').ok, true);
  return { rm, code, host, guest };
}

// ── 2A.10 prep: persist initialInitiative for shim replay ──────────────────

test('_startMatch persists initialInitiative on the room', () => {
  resetMetrics();
  const { rm, code } = setupRoom();
  const room = rm.rooms.get(code);
  assert.ok(room.initialInitiative === 'p1' || room.initialInitiative === 'p2',
    'initial initiative is stored so a replayed game_start carries the original payload');
});

// ── 2A.12 exact-socket matchmaking-queue cleanup ───────────────────────────

test('a superseded socket close does not evict the replacement queue entry', () => {
  resetMetrics();
  const rm = new RoomManager();
  const a = fakeWs('a');
  rm.findMatch(a, 'A', 'folkstyle');
  assert.equal(rm.getQueueSize(), 1, 'first socket queued');

  // Same uid reconnects with a newer socket → replaces the queue entry.
  const a2 = fakeWs('a2');
  a2._uid = a._uid;
  rm.findMatch(a2, 'A', 'folkstyle');
  assert.equal(rm.getQueueSize(), 1, 'same uid replaces, not duplicates');

  // The OLD socket's close arrives late. Filtering by uid would wrongly drop
  // the replacement; filtering by exact ws keeps it.
  rm.handleDisconnect(a);
  assert.equal(rm.getQueueSize(), 1, 'replacement socket stays queued');
});

// ── 2A.7 Guarded room allocator + room:${uid} quota ────────────────────────

test('room-allocation budget enforces create_room_per_min (default 10) per uid', () => {
  const rm = new RoomManager();
  for (let i = 0; i < 10; i++) assert.equal(rm._consumeRoomBudget('u'), true, `create ${i}`);
  assert.equal(rm._consumeRoomBudget('u'), false, '11th create in the window is blocked');
});

test('allocateRoom creates a room on success', () => {
  const rm = new RoomManager();
  const a = fakeWs('a');
  const r = rm.allocateRoom(a, 'Alice', 'folkstyle');
  assert.ok(r.code, 'returns a room code');
  assert.equal(rm.rooms.has(r.code), true);
});

test('allocateRoom rejects when the uid room budget is spent', () => {
  const rm = new RoomManager();
  for (let i = 0; i < 10; i++) rm._consumeRoomBudget('u'); // exhaust (uid never enters a room)
  const ws = fakeWs();
  ws._uid = 'u';
  assert.deepEqual(rm.allocateRoom(ws, 'n', 'folkstyle'), { error: 'rate_limited' });
});

test('room budget is NOT refunded on disconnect (no reset of room: keys)', () => {
  const rm = new RoomManager();
  const ws = fakeWs('a');
  ws._uid = 'u';
  rm._consumeRoomBudget('u');
  rm.handleDisconnect(ws); // a disconnect must not refund create budget
  // Drain the rest; the disconnect did not give a token back.
  for (let i = 0; i < 9; i++) assert.equal(rm._consumeRoomBudget('u'), true);
  assert.equal(rm._consumeRoomBudget('u'), false, 'still capped after a disconnect');
});

// ── 2A.9 Membership matrix ─────────────────────────────────────────────────

test('membership: allocateRoom rejects a uid already in an active room', () => {
  const rm = new RoomManager();
  const a = fakeWs('a');
  rm.allocateRoom(a, 'Alice', 'folkstyle');
  assert.deepEqual(rm.allocateRoom(a, 'Again', 'folkstyle'), { error: 'already_in_room' });
});

test('membership: joinRoom rejects a uid already in another active room', () => {
  const rm = new RoomManager();
  const a = fakeWs('a'); rm.allocateRoom(a, 'A', 'folkstyle');
  const b = fakeWs('b'); const { code: roomB } = rm.allocateRoom(b, 'B', 'folkstyle');
  assert.deepEqual(rm.joinRoom(a, roomB, 'A'), { error: 'already_in_room' });
});

test('membership: spectate rejects a uid currently playing', () => {
  const { rm, code, host } = setupRoom();
  assert.deepEqual(rm.spectateRoom(host, code), { error: 'already_in_room' });
});

test('membership: findMatch rejects a uid already in an active room', () => {
  const { rm, host } = setupRoom();
  host.sent.length = 0;
  rm.findMatch(host, 'H', 'folkstyle');
  assert.ok(host.sent.find(m => m.type === 'error' && m.code === 'already_in_room'));
});

test('membership: findMatch idempotently replaces the same uid queue entry', () => {
  const rm = new RoomManager();
  const a = fakeWs('a');
  rm.findMatch(a, 'A', 'folkstyle');
  rm.findMatch(a, 'A', 'folkstyle');
  assert.equal(rm.getQueueSize(), 1, 'same uid does not duplicate');
});

test('membership: join is rejected while the waiting host is offline in reconnect grace', () => {
  const rm = new RoomManager();
  const host = fakeWs('host');
  const code = rm.createRoom(host, 'Alice', 'folkstyle'); // waiting room
  rm.rooms.get(code).host.ws = null;                      // host dropped, in grace
  const joiner = fakeWs('joiner');
  assert.deepEqual(rm.joinRoom(joiner, code, 'Bob'), { error: 'host_unavailable' });
});

test('membership: a FINISHED room still counts as active (blocks a new room)', () => {
  const rm = new RoomManager();
  const a = fakeWs('a');
  const { code } = rm.allocateRoom(a, 'Alice', 'folkstyle');
  rm._setRoomPhase(rm.rooms.get(code), 'finished');
  assert.deepEqual(rm.allocateRoom(a, 'X', 'folkstyle'), { error: 'already_in_room' });
});

test('membership: a VOIDED-room mapping does NOT block a fresh room', () => {
  const rm = new RoomManager();
  const a = fakeWs('a');
  const { code } = rm.allocateRoom(a, 'Alice', 'folkstyle');
  rm._voidRoom(rm.rooms.get(code), 'test'); // mapping retained for late-reconnect notice
  const r = rm.allocateRoom(a, 'Alice', 'folkstyle');
  assert.ok(r.code, 'voided membership must not block a new room');
});

// ── 2A.7/A6 Matchmaking atomic two-uid budget + orphan cleanup ─────────────

test('matchmaking: requester over quota rejects only the requester; opponent stays queued and uncharged', () => {
  const rm = new RoomManager();
  const opp = fakeWs('opp');
  rm.findMatch(opp, 'Opp', 'folkstyle'); // queued
  const me = fakeWs('me');
  for (let i = 0; i < 10; i++) rm._consumeRoomBudget(me._uid); // exhaust requester
  rm.findMatch(me, 'Me', 'folkstyle');
  assert.ok(me.sent.find(m => m.type === 'error' && m.code === 'rate_limited'), 'requester rejected');
  assert.equal(rm.getQueueSize(), 1, 'innocent opponent still queued');
  for (let i = 0; i < 10; i++) assert.equal(rm._consumeRoomBudget(opp._uid), true, 'opponent not charged');
});

test('matchmaking: a successful match charges each uid exactly once', () => {
  const rm = new RoomManager();
  const opp = fakeWs('opp'); rm.findMatch(opp, 'Opp', 'folkstyle');
  const me = fakeWs('me'); rm.findMatch(me, 'Me', 'folkstyle'); // matches → room
  assert.equal(rm.getQueueSize(), 0);
  for (let i = 0; i < 9; i++) assert.equal(rm._consumeRoomBudget(me._uid), true);
  assert.equal(rm._consumeRoomBudget(me._uid), false, 'requester charged exactly once');
  for (let i = 0; i < 9; i++) assert.equal(rm._consumeRoomBudget(opp._uid), true);
  assert.equal(rm._consumeRoomBudget(opp._uid), false, 'opponent charged exactly once');
});

test('matchmaking: a failed join restores the innocent opponent unchanged and rejects only the requester', () => {
  const rm = new RoomManager();
  const opp = fakeWs('opp');
  rm.findMatch(opp, 'Opp', 'folkstyle');
  const oppEntry = rm.matchmakingQueue[0];
  const oppJoinedAt = oppEntry.joinedAt;
  const me = fakeWs('me');
  const realJoin = rm.joinRoom.bind(rm);
  rm.joinRoom = () => ({ error: 'forced failure' }); // unreachable in practice
  rm.findMatch(me, 'Me', 'folkstyle');
  rm.joinRoom = realJoin;

  assert.equal(rm.rooms.size, 0, 'orphan room destroyed');
  assert.equal(rm.getQueueSize(), 1, 'only the opponent remains queued (requester not requeued)');
  const still = rm.matchmakingQueue[0];
  assert.equal(still, oppEntry, 'same queue entry object (identity preserved)');
  assert.equal(still.ws, opp, 'same opponent websocket');
  assert.equal(still.joinedAt, oppJoinedAt, 'opponent joinedAt unchanged');
  assert.ok(me.sent.find(m => m.type === 'error' && m.code === 'matchmaking_failed'), 'requester rejected');
  for (let i = 0; i < 10; i++) assert.equal(rm._consumeRoomBudget(me._uid), true, 'requester uncharged');
  for (let i = 0; i < 10; i++) assert.equal(rm._consumeRoomBudget(opp._uid), true, 'opponent uncharged');
});

// ── 2A.9 Spectator membership ──────────────────────────────────────────────

test('membership: allocateRoom rejects a uid already spectating', () => {
  const { rm, code } = setupRoom();
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  assert.deepEqual(rm.allocateRoom(spec, 'X', 'folkstyle'), { error: 'already_spectating' });
});

test('membership: joinRoom rejects a uid already spectating', () => {
  const { rm, code } = setupRoom();
  const b = fakeWs('b'); const { code: roomB } = rm.allocateRoom(b, 'B', 'folkstyle');
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  assert.deepEqual(rm.joinRoom(spec, roomB, 'S'), { error: 'already_spectating' });
});

test('membership: spectateRoom rejects switching to a different room', () => {
  const { rm, code } = setupRoom();
  const hostB = fakeWs('hostB'); const { code: codeB } = rm.allocateRoom(hostB, 'B', 'folkstyle');
  const spec = fakeWs('spec');
  assert.equal(rm.spectateRoom(spec, code).ok, true);
  assert.deepEqual(rm.spectateRoom(spec, codeB), { error: 'already_spectating' });
});

test('membership: same-room spectator reconnect is allowed and replaces the socket', () => {
  const { rm, code } = setupRoom();
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  const spec2 = fakeWs('spec2');
  spec2._uid = spec._uid;
  assert.equal(rm.spectateRoom(spec2, code).ok, true);
  assert.equal(rm.rooms.get(code).spectators.get(spec._uid).ws, spec2, 'socket replaced on same-room reconnect');
});

test('matchmaking: a queued opponent who became a spectator is not matched', () => {
  const { rm, code } = setupRoom(); // a playing room to spectate
  const opp = fakeWs('opp');
  rm.findMatch(opp, 'Opp', 'folkstyle');   // queued
  rm.spectateRoom(opp, code);              // now also spectating → incompatible
  const me = fakeWs('me');
  rm.findMatch(me, 'Me', 'folkstyle');
  assert.ok(me.sent.find(m => m.type === 'matchmaking_queued'), 'requester queued, not matched to a spectator');
  assert.equal(rm.rooms.size, 1, 'no new match room created');
});

// ── 2A.10 Strict one-shot legacy find_match resume shim ────────────────────

function eligibleNow(code) { return { roomCode: code, expiresAt: Date.now() + 5000 }; }

test('5C: an eligible find_match replays the match one-shot (no allocation, roundSeq unchanged)', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  const seq = room.roundSeq;
  host.sent.length = 0;
  host._legacyResumeEligible = eligibleNow(code);
  rm.findMatch(host, 'Alice', 'folkstyle');
  const gs = host.sent.find(m => m.type === 'game_start');
  assert.ok(gs, 'game_start replayed');
  assert.equal(gs.initialInitiative, room.initialInitiative, 'ORIGINAL initialInitiative replayed');
  assert.equal(gs.player, 'p1', 'original role replayed');
  assert.ok(host.sent.find(m => m.type === 'state_update'), 'state replayed');
  assert.equal(room.roundSeq, seq, 'roundSeq NOT bumped by the resume');
  assert.equal(getCounter('legacy_find_match_resume_total'), 1, 'resume counted exactly once');
  assert.equal(rm.getQueueSize(), 0, 'no queue entry created');
  assert.equal(rm.rooms.size, 1, 'no room allocated');
});

test('5C: resume does not modify room phase or roundSeq', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  const seq = room.roundSeq;
  const phase = room.phase;
  host._legacyResumeEligible = eligibleNow(code);
  rm.findMatch(host, 'Alice', 'folkstyle');
  assert.equal(room.roundSeq, seq);
  assert.equal(room.phase, phase);
});

test('5C: the resume is one-shot — a second find_match hits normal membership rejection', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  host._legacyResumeEligible = eligibleNow(code);
  rm.findMatch(host, 'Alice', 'folkstyle'); // consumes + resumes
  host.sent.length = 0;
  rm.findMatch(host, 'Alice', 'folkstyle'); // flag gone → membership reject
  assert.ok(host.sent.find(m => m.type === 'error' && m.code === 'already_in_room'));
  assert.equal(getCounter('legacy_find_match_resume_total'), 1, 'still only one resume');
});

test('5C: an EXPIRED eligibility falls through to membership rejection', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  host.sent.length = 0;
  host._legacyResumeEligible = { roomCode: code, expiresAt: Date.now() - 1 };
  rm.findMatch(host, 'Alice', 'folkstyle');
  assert.equal(host.sent.find(m => m.type === 'game_start'), undefined, 'no replay');
  assert.ok(host.sent.find(m => m.type === 'error' && m.code === 'already_in_room'));
  assert.equal(getCounter('legacy_find_match_resume_total'), 0);
});

test('5C: a WRONG-ROOM eligibility falls through to membership rejection', () => {
  resetMetrics();
  const { rm, host } = setupRoom();
  host.sent.length = 0;
  host._legacyResumeEligible = { roomCode: 'ZZZZ', expiresAt: Date.now() + 5000 };
  rm.findMatch(host, 'Alice', 'folkstyle');
  assert.equal(host.sent.find(m => m.type === 'game_start'), undefined);
  assert.ok(host.sent.find(m => m.type === 'error' && m.code === 'already_in_room'));
});

test('5C: the first non-find application frame (incl. unknown) consumes eligibility, no replay', () => {
  resetMetrics();
  const rm = new RoomManager();
  for (const t of ['create_room', 'join_room', 'spectate_room', 'cancel_matchmaking', 'card_pick', 'rematch', 'config', 'bogus_unknown']) {
    const ws = fakeWs();
    ws._legacyResumeEligible = { roomCode: 'X', expiresAt: Date.now() + 5000 };
    const handled = rm.consumeLegacyResume(ws, t);
    assert.equal(handled, false, `${t} is not a resume`);
    assert.equal(ws._legacyResumeEligible, null, `${t} consumes (clears) eligibility`);
  }
  assert.equal(getCounter('legacy_find_match_resume_total'), 0, 'no replays from non-find frames');
});

test('5C: an active-challenge resume replays game_start, state_update (no roundSeq bump), then challenge', () => {
  resetMetrics();
  const { rm, code, host } = setupRoom();
  const room = rm.rooms.get(code);
  room.challenges.p1 = startChallenge({
    room, role: 'p1', mechanic: MECHANIC_TYPES.CHARGE, cardId: 'test-card',
    rng: makeRng(1), sendToOwner: () => {}, onResolve: () => {},
  });
  const seq = room.roundSeq;
  host.sent.length = 0;
  host._legacyResumeEligible = eligibleNow(code);
  rm.findMatch(host, 'Alice', 'folkstyle');
  const types = host.sent.map(m => m.type);
  const gs = types.indexOf('game_start');
  const su = types.indexOf('state_update');
  const cs = types.indexOf('challenge_start');
  assert.ok(gs >= 0, 'game_start sent');
  assert.ok(su > gs, 'state_update after game_start');
  assert.ok(cs > su, 'active challenge replayed after state_update');
  assert.equal(room.roundSeq, seq, 'roundSeq unchanged by the handoff');
});

test('inspectSession returns none / active / terminal', () => {
  const { rm, code, host, guest } = setupRoom();
  assert.equal(rm.inspectSession('nobody').status, 'none');
  const act = rm.inspectSession(host._uid);
  assert.equal(act.status, 'active');
  assert.equal(act.roomCode, code);
  // Spectator counts as active membership too.
  const spec = fakeWs('spec'); rm.spectateRoom(spec, code);
  assert.equal(rm.inspectSession(spec._uid).status, 'active');
  // Void → terminal.
  rm._voidRoom(rm.rooms.get(code), 'test');
  const term = rm.inspectSession(guest._uid);
  assert.equal(term.status, 'terminal');
  assert.equal(term.roomCode, code);
});

test('inspectSession classifies a spectator of a VOIDED room as terminal', () => {
  const { rm, code } = setupRoom();
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  rm._voidRoom(rm.rooms.get(code), 'test'); // room retained for late notice
  const r = rm.inspectSession(spec._uid);
  assert.equal(r.status, 'terminal', 'a spectator in a voided room is terminal, not active');
  assert.equal(r.roomCode, code);
});

test('handleReconnect of a voided-room spectator sends match_voided, removes mapping, returns false', () => {
  const { rm, code } = setupRoom();
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  rm._voidRoom(rm.rooms.get(code), 'test');
  const spec2 = fakeWs('spec2');
  spec2._uid = spec._uid;
  const ok = rm.handleReconnect(spec2, spec._uid);
  assert.equal(ok, false, 'terminal spectator reconnect returns false');
  assert.ok(spec2.sent.find(m => m.type === 'match_voided'), 'match_voided sent');
  assert.equal(spec2.sent.find(m => m.type === 'reconnected'), undefined, 'no reconnected');
  assert.equal(spec2.sent.find(m => m.type === 'state_update'), undefined, 'no state replay');
  assert.equal(rm.rooms.get(code).spectators.has(spec._uid), false, 'spectator mapping removed');
});

test('5C: pong never consumes; an invalid find_match consumes but does not replay', () => {
  resetMetrics();
  const rm = new RoomManager();
  const a = fakeWs();
  a._legacyResumeEligible = { roomCode: 'X', expiresAt: Date.now() + 5000 };
  assert.equal(rm.consumeLegacyResume(a, 'pong'), false);
  assert.ok(a._legacyResumeEligible, 'pong never consumes eligibility');
  // Wrong-room (ws is in no room) → invalid → consumed, not replayed.
  assert.equal(rm.consumeLegacyResume(a, 'find_match'), false, 'invalid find_match not handled');
  assert.equal(a._legacyResumeEligible, null, 'consumed');
  assert.equal(getCounter('legacy_find_match_resume_total'), 0, 'no replay');
});

test('5C: an active PLAYER reconnect sets one-shot eligibility', () => {
  const { rm, code, guest } = setupRoom();
  rm.handleDisconnect(guest);
  const ng = fakeWs('reconn');
  ng._uid = guest._uid;
  rm.handleReconnect(ng, guest._uid);
  assert.ok(ng._legacyResumeEligible, 'eligibility set on active player reconnect');
  assert.equal(ng._legacyResumeEligible.roomCode, code);
});

test('5C: a SPECTATOR reconnect gets NO eligibility', () => {
  const { rm, code } = setupRoom();
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  rm.handleDisconnect(spec);
  const sp2 = fakeWs('spec2');
  sp2._uid = spec._uid;
  rm.handleReconnect(sp2, spec._uid);
  assert.equal(sp2._legacyResumeEligible, undefined, 'spectators never get resume eligibility');
});

test('5C: a TERMINAL (voided) reconnect gets NO eligibility', () => {
  const { rm, code, host } = setupRoom();
  rm._voidRoom(rm.rooms.get(code), 'test');
  const h2 = fakeWs('h2');
  h2._uid = host._uid;
  rm.handleReconnect(h2, host._uid);
  assert.equal(h2._legacyResumeEligible, undefined);
});

// ── 2A.11 Stale spectator close guard ──────────────────────────────────────

test('stale spectator close (after same-room reconnect) is skipped, not logged as a disconnect', () => {
  resetMetrics();
  const { rm, code } = setupRoom();
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  const spec2 = fakeWs('spec2');
  spec2._uid = spec._uid;
  rm.spectateRoom(spec2, code); // reconnect replaces the installed socket
  assert.equal(rm.rooms.get(code).spectators.get(spec._uid).ws, spec2, 'precondition: new socket installed');

  rm.handleDisconnect(spec); // old socket's close fires late
  assert.equal(getCounter('stale_socket_close_total'), 1, 'stale spectator close counted as stale');
  assert.equal(getCounter('disconnect_total', { phase: 'playing' }), 0, 'not a real disconnect');
  assert.equal(rm.rooms.get(code).spectators.get(spec._uid).ws, spec2, 'new spectator socket untouched');
});
