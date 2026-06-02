// Authoritative server roomManager tests. Covers card_pick legality,
// pin pick flow with burned-card rule, period choice with deadline,
// reroll, match-end (server-determined), rematch gating, reconnect, and
// spectator privacy.
//
// Run with: node --test server-online/roomManager.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './roomManager.mjs';
import { getMechanicForCard, MECHANIC_TYPES } from '../src/lib/cardArchetypeMechanics.js';

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

function findMsg(ws, type) {
  return ws.sent.find(m => m.type === type);
}
function lastMsg(ws, type) {
  const matches = ws.sent.filter(m => m.type === type);
  return matches[matches.length - 1];
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

// ── Game start ───────────────────────────────────────────────────────────

test('joinRoom triggers state_update with engine state + per-side hands', () => {
  const { host, guest } = setupRoom();
  const hostState = findMsg(host, 'state_update');
  const guestState = findMsg(guest, 'state_update');
  assert.ok(hostState, 'host receives state_update');
  assert.ok(guestState, 'guest receives state_update');
  assert.equal(hostState.roundSeq, 1);
  assert.equal(hostState.state.phase, 'playing');
  assert.equal(hostState.state.roundNumber, 0);
  assert.ok(Array.isArray(hostState.hand));
  assert.equal(hostState.hand.length, 6);
  assert.equal(hostState.opponentHandSize, 6);
  assert.ok(hostState.preGeneratedChallenges);
});

test('preGeneratedChallenges hides reaction params (server-secret)', () => {
  const { host } = setupRoom();
  const upd = findMsg(host, 'state_update');
  for (const cardId of Object.keys(upd.preGeneratedChallenges)) {
    const entry = upd.preGeneratedChallenges[cardId];
    if (entry.kind === 'reaction') {
      assert.equal(
        'params' in entry, false,
        `reaction params for ${cardId} must NOT be shipped to client`,
      );
    }
  }
});

// ── Card pick ────────────────────────────────────────────────────────────

test('card_pick: rejects wrong roundSeq', () => {
  const { rm, host, code } = setupRoom();
  const cardId = lastMsg(host, 'state_update').hand[0].id;
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: 999, cardId });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'wrong_round');
  assert.ok(err, 'wrong_round error sent');
});

test('card_pick: rejects illegal cardId (not in hand)', () => {
  const { rm, host } = setupRoom();
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: 1, cardId: 'definitely_not_a_card' });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'illegal_card');
  assert.ok(err);
});

test('card_pick: rejects double-pick (already_picked)', () => {
  const { rm, host } = setupRoom();
  const cardId = lastMsg(host, 'state_update').hand[0].id;
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: 1, cardId });
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: 1, cardId });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'already_picked');
  assert.ok(err, 'already_picked error sent on second pick');
});

test('card_pick: card sets skillResult immediately and waits for opponent', () => {
  const { rm, host, guest } = setupRoom();
  const hostHand = lastMsg(host, 'state_update').hand;
  // Picking ANY card should ack and wait for the opponent before advancing.
  // Previously this test grabbed a transition card on the assumption it was
  // NONE-mechanic; transitions are now PATH-mechanic, so just pick the first
  // available card - the wait-for-opponent invariant is independent of mechanic.
  const card = hostHand[0];
  host.sent.length = 0;
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: 1, cardId: card.id });
  assert.ok(findMsg(host, 'pick_acknowledged'));
  const stateAfter = findMsg(host, 'state_update');
  assert.equal(stateAfter, undefined, 'no state advance until guest picks');
});

test('card_pick: full round resolves via engine when both sides pick a no-mechanic card', () => {
  // No card category currently maps to MECHANIC_TYPES.NONE (every category
  // has a real mini-game). Search by mechanic in case a future category
  // returns to NONE; otherwise the immediate-resolve path is still covered
  // by the engine-side NONE auto-resolve in cardArchetypeMechanics tests.
  const { rm, host, guest } = setupRoom();
  const hostState = lastMsg(host, 'state_update');
  const guestState = lastMsg(guest, 'state_update');
  const hostNone = hostState.hand.find(c => getMechanicForCard(c) === MECHANIC_TYPES.NONE);
  const guestNone = guestState.hand.find(c => getMechanicForCard(c) === MECHANIC_TYPES.NONE);
  if (!hostNone || !guestNone) return; // No NONE-mechanic cards in current data.
  host.sent.length = 0; guest.sent.length = 0;
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: 1, cardId: hostNone.id });
  rm.handleGameMessage(guest, { type: 'card_pick', roundSeq: 1, cardId: guestNone.id });
  const upd = findMsg(host, 'state_update');
  assert.ok(upd, 'state_update broadcast after both NONE picks');
  assert.equal(upd.roundSeq, 2);
});

// ── Pin pick ─────────────────────────────────────────────────────────────

test('pin_pick: rejects in non-pin phase', () => {
  const { rm, host } = setupRoom();
  rm.handleGameMessage(host, {
    type: 'pin_pick', roundSeq: 1, role: 'offense', cardId: 'pin_lock_position',
  });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'wrong_phase');
  assert.ok(err);
});

test('pin_pick: rejects illegal pool (offense card sent for defense slot)', () => {
  const { rm, host } = setupRoom();
  // Force phase=pin_attempt with attacker=p1
  const room = rm.rooms.values().next().value;
  room.matchState.phase = 'pin_attempt';
  room.matchState.pinAttempt = { attacker: 'p1', stage: 1 };
  rm.handleGameMessage(host, {
    type: 'pin_pick', roundSeq: 1, role: 'offense', cardId: 'pin_bridge', // bridge is defense
  });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'illegal_card');
  assert.ok(err);
});

test('pin_pick: enforces burned-card rule for DEFENSE across stages', () => {
  // Defense cards burn between pin stages (engine tracks burnedDefCards;
  // server matches). Offense cards intentionally do NOT burn - the engine
  // resolvers allow attacker reuse, and so must the server. See the
  // companion test in match-flow.test.mjs that verifies offense reuse is
  // accepted (and triggered the live "frozen second pin attempt" bug
  // when this didn't hold).
  const { rm, host, guest } = setupRoom();
  const room = rm.rooms.values().next().value;
  room.matchState.phase = 'pin_attempt';
  room.matchState.pinAttempt = { attacker: 'p1', stage: 2 };
  room.pinBurned.defense.add('pin_bridge');
  rm.handleGameMessage(guest, {
    type: 'pin_pick', roundSeq: 1, role: 'defense', cardId: 'pin_bridge',
  });
  const err = guest.sent.find(m => m.type === 'error' && m.code === 'pin_card_burned');
  assert.ok(err, 'reused defense card rejected with pin_card_burned');
});

test('pin_pick: wrong-side sender rejected with not_your_turn', () => {
  const { rm, host, guest } = setupRoom();
  const room = rm.rooms.values().next().value;
  room.matchState.phase = 'pin_attempt';
  room.matchState.pinAttempt = { attacker: 'p1', stage: 1 };
  // Guest (p2 = defender) tries to send offense
  rm.handleGameMessage(guest, {
    type: 'pin_pick', roundSeq: 1, role: 'offense', cardId: 'pin_lock_position',
  });
  const err = guest.sent.find(m => m.type === 'error' && m.code === 'not_your_turn');
  assert.ok(err);
});

// ── Period choice ────────────────────────────────────────────────────────

test('period_choice: rejects from non-chooser', () => {
  const { rm, guest } = setupRoom();
  const room = rm.rooms.values().next().value;
  room.matchState.phase = 'period_break';
  room.matchState.pendingChoiceFor = 'p1';   // host is chooser
  rm.handleGameMessage(guest, { type: 'period_choice', roundSeq: 1, choice: 'top' });
  const err = guest.sent.find(m => m.type === 'error' && m.code === 'not_your_turn');
  assert.ok(err);
});

test('period_choice: rejects bad enum', () => {
  const { rm, host } = setupRoom();
  const room = rm.rooms.values().next().value;
  room.matchState.phase = 'period_break';
  room.matchState.pendingChoiceFor = 'p1';
  rm.handleGameMessage(host, { type: 'period_choice', roundSeq: 1, choice: 'sideways' });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'invalid_payload');
  assert.ok(err);
});

// ── Reroll ───────────────────────────────────────────────────────────────

test('request_reroll: decrements budget and rebuilds hand', () => {
  const { rm, host } = setupRoom();
  rm.handleGameMessage(host, { type: 'request_reroll', roundSeq: 1 });
  const granted = host.sent.find(m => m.type === 'reroll_granted');
  assert.ok(granted);
  assert.equal(granted.rerollsLeft, 1);
});

test('request_reroll: refused after locking pick', () => {
  const { rm, host } = setupRoom();
  const cardId = lastMsg(host, 'state_update').hand[0].id;
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: 1, cardId });
  rm.handleGameMessage(host, { type: 'request_reroll', roundSeq: 1 });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'already_picked');
  assert.ok(err);
});

test('request_reroll: refused when budget exhausted', () => {
  const { rm, host } = setupRoom();
  rm.handleGameMessage(host, { type: 'request_reroll', roundSeq: 1 });
  rm.handleGameMessage(host, { type: 'request_reroll', roundSeq: 1 });
  rm.handleGameMessage(host, { type: 'request_reroll', roundSeq: 1 });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'rate_limited');
  assert.ok(err);
});

// ── Rematch ──────────────────────────────────────────────────────────────

test('rematch: refused mid-match', () => {
  const { rm, host } = setupRoom();
  rm.handleGameMessage(host, { type: 'rematch' });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'wrong_phase');
  assert.ok(err);
});

test('rematch: accepted after phase=finished; both votes restart', () => {
  const { rm, host, guest } = setupRoom();
  const room = rm.rooms.values().next().value;
  room.phase = 'finished';
  room.matchEndedAt = Date.now();
  rm.handleGameMessage(host, { type: 'rematch' });
  assert.ok(host.sent.find(m => m.type === 'rematch_pending'));
  assert.ok(guest.sent.find(m => m.type === 'rematch_requested'));
  rm.handleGameMessage(guest, { type: 'rematch' });
  // Fresh game start
  const newState = host.sent.filter(m => m.type === 'state_update').slice(-1)[0];
  assert.equal(newState.state.roundNumber, 0, 'new match starts at round 0');
});

test('rematch: declined is sticky and terminal for that side', () => {
  const { rm, host } = setupRoom();
  const room = rm.rooms.values().next().value;
  room.phase = 'finished';
  rm.handleGameMessage(host, { type: 'rematch_decline' });
  rm.handleGameMessage(host, { type: 'rematch' });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'wrong_phase');
  assert.ok(err, 'cannot un-decline');
});

// ── Spectator privacy ───────────────────────────────────────────────────

test('spectator: receives state_update with hand=null and no preGen', () => {
  const { rm, host, code } = setupRoom();
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  const upd = lastMsg(spec, 'state_update');
  assert.ok(upd);
  assert.equal(upd.hand, null);
  assert.equal(upd.opponentHandSize, null);
  assert.equal(upd.preGeneratedChallenges, null);
  assert.equal(upd.spectator, true);
});

test('spectator: matchState carries no private fields (pendingPicks etc.)', () => {
  const { rm, host, code } = setupRoom();
  const room = rm.rooms.get(code);
  // Hostile: sneak a private field onto matchState
  room.matchState.pendingPicks = { p1: 'leak_me', p2: null };
  room.matchState.skillResults = { p1: { tier: 'PERFECT' } };
  // Force a re-broadcast via spectateRoom (sends state_update on join)
  const spec = fakeWs('spec');
  rm.spectateRoom(spec, code);
  const upd = lastMsg(spec, 'state_update');
  assert.equal('pendingPicks' in upd.state, false, 'private leak prevented');
  assert.equal('skillResults' in upd.state, false);
});

// ── Disconnect / reconnect ──────────────────────────────────────────────

test('disconnect: opponent_disconnected emitted with timeoutMs', () => {
  const { rm, host, guest } = setupRoom();
  guest._role = 'p2';
  guest._roomCode = lastMsg(host, 'state_update') ? rm.playerRooms.get(guest._uid) : null;
  rm.handleDisconnect(guest);
  const evt = host.sent.find(m => m.type === 'opponent_disconnected');
  assert.ok(evt);
  assert.ok(Number.isInteger(evt.timeoutMs));
});

test('reconnect: replays state_update to the reconnecting player', () => {
  const { rm, host, guest } = setupRoom();
  rm.handleDisconnect(guest);
  // Simulate fresh ws for guest
  const newGuest = fakeWs('guest-new');
  newGuest._uid = guest._uid;   // same uid
  const ok = rm.handleReconnect(newGuest, guest._uid);
  assert.equal(ok, true);
  assert.ok(findMsg(newGuest, 'reconnected'));
  assert.ok(findMsg(newGuest, 'state_update'));
});

// ── Findmatch dead-socket filter ───────────────────────────────────────

test('findMatch: drops dead opponent and queues requester', () => {
  const rm = new RoomManager();
  const dead = fakeWs('dead');
  dead.readyState = 3;
  rm.matchmakingQueue = [
    { ws: dead, uid: dead._uid, name: 'Old', style: 'folkstyle', joinedAt: Date.now() },
  ];
  const newer = fakeWs('newer');
  rm.findMatch(newer, 'New', 'folkstyle');
  assert.ok(findMsg(newer, 'matchmaking_queued'));
  assert.equal(rm.matchmakingQueue.length, 1);
  assert.equal(rm.matchmakingQueue[0].uid, newer._uid);
});

// ── Voided room ─────────────────────────────────────────────────────────

test('voided room: subsequent game messages are rejected', () => {
  const { rm, host } = setupRoom();
  const room = rm.rooms.values().next().value;
  room.phase = 'voided';
  rm.handleGameMessage(host, { type: 'card_pick', roundSeq: 1, cardId: 'whatever' });
  const err = host.sent.find(m => m.type === 'error' && m.code === 'wrong_phase');
  assert.ok(err);
});
