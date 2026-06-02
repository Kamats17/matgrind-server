// Regression tests for the post-game_start buffering invariant in
// queueManager. The live first-deploy of the authoritative server failed
// because back-to-back `game_start` + `state_update` messages from the
// server arrived at the queueManager (which only handles game_start) and
// the state_update fell through the switch default, silently dropped.
// Result: `currentRoundSeqRef.current` stayed at 0 in WrestlingGame, and
// the user's first card_pick went out with no roundSeq, server returned
// `wrong_round`, match voided.
//
// These tests lock the contract: any messages that arrive between
// `game_start` and `consumeMatch()` must be captured and replayed
// through the consumer's handler.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetForTests,
  __handleServerMessageForTest,
  consumeMatch,
} from './queueManager.js';

function makeFakeClient() {
  // Minimal NetworkClient surface that _handleServerMessage touches.
  return {
    onMessage: () => {},
    onConnect: () => {},
    onDisconnect: () => {},
    onReconnecting: () => {},
    _assignedPlayer: null,
    findMatch: () => {},
    disconnect: () => {},
    cancelMatchmaking: () => {},
  };
}

function gameStartMsg(player = 'p1') {
  return {
    type: 'game_start',
    player,
    p1Name: 'Alice',
    p2Name: 'Bob',
    style: 'folkstyle',
    initialInitiative: 'p1',
  };
}

function stateUpdateMsg(roundSeq = 1) {
  return {
    type: 'state_update',
    roundSeq,
    state: { phase: 'playing', roundNumber: 0 },
    hand: [{ id: 'arm_drag' }, { id: 'single_leg' }],
    preGeneratedChallenges: {},
  };
}

test('buffer: state_update arriving after game_start is captured in consumeMatch payload', () => {
  __resetForTests();
  const client = makeFakeClient();

  // Simulate the server flush: game_start, then state_update before the
  // consumer (WrestlingGame) has been wired in. With the bug present,
  // consumeMatch returns a payload WITHOUT the state_update - it was
  // dropped at the switch default.
  __handleServerMessageForTest(gameStartMsg('p1'), client);
  __handleServerMessageForTest(stateUpdateMsg(1), client);

  const payload = consumeMatch();
  assert.ok(payload, 'consumeMatch must return payload after game_start');
  assert.ok(
    Array.isArray(payload.bufferedMessages),
    'payload must include a bufferedMessages array (post-game_start capture)',
  );
  assert.equal(
    payload.bufferedMessages.length, 1,
    'the single state_update must be buffered',
  );
  assert.equal(payload.bufferedMessages[0].type, 'state_update');
  assert.equal(payload.bufferedMessages[0].roundSeq, 1,
    'buffered state_update must carry roundSeq=1');
});

test('buffer: multiple post-game_start messages preserved in arrival order', () => {
  __resetForTests();
  const client = makeFakeClient();

  __handleServerMessageForTest(gameStartMsg('p1'), client);
  __handleServerMessageForTest(stateUpdateMsg(1), client);
  __handleServerMessageForTest({
    type: 'challenge_start',
    challengeId: 'cha-1',
    kind: 'charge',
    cardId: 'arm_drag',
    roundSeq: 1,
    params: { perfectZone: 0.6 },
  }, client);

  const payload = consumeMatch();
  assert.equal(payload.bufferedMessages.length, 2, 'both messages buffered');
  assert.equal(payload.bufferedMessages[0].type, 'state_update');
  assert.equal(payload.bufferedMessages[1].type, 'challenge_start',
    'arrival order preserved');
});

test('buffer: empty when no messages arrive between game_start and consumeMatch', () => {
  __resetForTests();
  const client = makeFakeClient();
  __handleServerMessageForTest(gameStartMsg('p2'), client);
  const payload = consumeMatch();
  assert.ok(Array.isArray(payload.bufferedMessages));
  assert.equal(payload.bufferedMessages.length, 0,
    'no messages -> empty buffer (not undefined)');
});

test('buffer: cleared on __resetForTests so a stale buffer cannot replay into a future match', () => {
  __resetForTests();
  const client = makeFakeClient();
  __handleServerMessageForTest(gameStartMsg('p1'), client);
  __handleServerMessageForTest(stateUpdateMsg(1), client);
  // Don\'t consume - simulate a forfeit / reset path.
  __resetForTests();

  // Now run a fresh match.
  const client2 = makeFakeClient();
  __handleServerMessageForTest(gameStartMsg('p1'), client2);
  const payload = consumeMatch();
  assert.equal(payload.bufferedMessages.length, 0,
    'fresh match must not see the prior buffer');
});

test('buffer: consumeMatch can only return the buffer once (subsequent calls return null)', () => {
  __resetForTests();
  const client = makeFakeClient();
  __handleServerMessageForTest(gameStartMsg('p1'), client);
  __handleServerMessageForTest(stateUpdateMsg(1), client);

  const first = consumeMatch();
  assert.ok(first?.bufferedMessages?.length === 1,
    'first consumeMatch returns the buffer');
  const second = consumeMatch();
  assert.equal(second, null,
    'second consumeMatch must return null - state already transferred');
});

// ── Stage 2B: reconnect compatibility (no find_match retry loop) ────────────

test('2B: reconnected after a found match re-asserts found and does NOT re-queue', () => {
  __resetForTests();
  let findMatchCalls = 0;
  const client = makeFakeClient();
  client.findMatch = () => { findMatchCalls++; };
  __handleServerMessageForTest(gameStartMsg('p1'), client); // found, _foundPayload set
  // Socket dropped + reconnected: the server replays state via 'reconnected'.
  __handleServerMessageForTest({ type: 'reconnected', roomCode: 'ABCD' }, client);
  assert.equal(findMatchCalls, 0, 'must NOT re-issue find_match after a found match');
  const payload = consumeMatch();
  assert.ok(payload, 'the found match is preserved + consumable');
});

test('2B: reconnected during an active search DOES re-issue find_match', () => {
  __resetForTests();
  let findMatchCalls = 0;
  const client = makeFakeClient();
  client.findMatch = () => { findMatchCalls++; };
  __handleServerMessageForTest({ type: 'auth_success', uid: 'u1' }, client); // queue flow → findMatch + searching
  findMatchCalls = 0; // ignore the auth_success findMatch
  __handleServerMessageForTest({ type: 'reconnected' }, client);
  assert.equal(findMatchCalls, 1, 'a mid-search reconnect re-queues');
});

test('2B: a buffer-type message after a reconnect (found re-asserted) is still captured', () => {
  __resetForTests();
  const client = makeFakeClient();
  __handleServerMessageForTest(gameStartMsg('p1'), client);      // found
  __handleServerMessageForTest({ type: 'reconnected' }, client); // re-assert found, no re-queue
  __handleServerMessageForTest(stateUpdateMsg(3), client);       // must buffer (keyed on _foundPayload)
  const payload = consumeMatch();
  assert.equal(payload.bufferedMessages.length, 1, 'post-reconnect state_update buffered');
  assert.equal(payload.bufferedMessages[0].roundSeq, 3);
});

// ── Stage 3: consumeMatch sends the explicit accept signal ──────────────────

test('3: consumeMatch signals match_accept to the server', () => {
  __resetForTests();
  let accepted = 0;
  const client = makeFakeClient();
  client.sendMatchAccept = () => { accepted++; };
  __handleServerMessageForTest(gameStartMsg('p1'), client); // found
  const payload = consumeMatch();
  assert.ok(payload, 'match consumed');
  assert.equal(accepted, 1, 'consuming the match signals acceptance to the server');
});
