// Regression tests for the silent-send hang (Task 2a) and server-refuses-
// skillResult contract (Task 2b). Run with: node --test src/lib/networkClient.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal WebSocket double - mirrors the subset NetworkClient uses.
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor() { this.readyState = FakeWebSocket.CONNECTING; this.sent = []; }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  close() { this.readyState = FakeWebSocket.CLOSED; }
}

// NetworkClient reads `import.meta.env.VITE_ONLINE_SERVER_URL`. When run
// under plain node --test that expression is undefined - which the module
// tolerates. We dynamic-import once after setting up the global WebSocket.
globalThis.WebSocket = FakeWebSocket;
const { NetworkClient, CLIENT_PROTOCOL_VERSION } = await import('./networkClient.js');

function makeClient() {
  return new NetworkClient({
    serverIP: '127.0.0.1',
    onMessage: () => {},
    onConnect: () => {},
    onDisconnect: () => {},
    onReconnecting: () => {},
  });
}

test('sendCardPick queues when socket not OPEN and flushes on reconnect', () => {
  const client = makeClient();
  client.ws = new FakeWebSocket(); // readyState = CONNECTING

  const queued = client.sendCardPick('single-leg');
  assert.equal(queued, true, 'sendCardPick must return true when queued');
  assert.equal(client.ws.sent.length, 0, 'nothing sent yet - socket is CONNECTING');

  // Simulate connection completing.
  client.ws.readyState = FakeWebSocket.OPEN;
  client._flushQueue();

  assert.equal(client.ws.sent.length, 1, 'queued pick flushed on OPEN');
  assert.equal(client.ws.sent[0].type, 'card_pick');
  assert.equal(client.ws.sent[0].cardId, 'single-leg');
});

test('sendCardPick sends immediately when socket already OPEN', () => {
  const client = makeClient();
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;

  const ok = client.sendCardPick('sprawl');
  assert.equal(ok, true);
  assert.equal(client.ws.sent.length, 1);
  assert.equal(client.ws.sent[0].cardId, 'sprawl');
});

test('sendCardPick returns false after disconnect (disposed client)', () => {
  const client = makeClient();
  client.ws = new FakeWebSocket();
  client.disconnect();
  assert.equal(client.sendCardPick('single-leg'), false);
});

test('sendCardPick strips skillResult in online mode (server refuses it)', () => {
  const client = makeClient();
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = true;

  client.sendCardPick('single-leg', { tier: 'PERFECT', bonus: 4 });

  assert.equal(client.ws.sent.length, 1);
  assert.equal(
    client.ws.sent[0].skillResult,
    undefined,
    'online mode must not send skillResult to the server',
  );
});

test('sendCardPick preserves skillResult in LAN mode (host is authoritative)', () => {
  const client = makeClient();
  client.mode = 'lan';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;

  client.sendCardPick('single-leg', { tier: 'PERFECT', bonus: 4 });

  assert.equal(client.ws.sent.length, 1);
  assert.deepEqual(
    client.ws.sent[0].skillResult,
    { tier: 'PERFECT', bonus: 4 },
    'LAN mode must include skillResult (host uses it locally)',
  );
});

// ── Auth-gated flush (first-move-hang root cause) ────────────────────────

test('online card_pick is queued between socket OPEN and auth_success', () => {
  const client = makeClient();
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  // Socket is OPEN but we have not yet received auth_success.
  client._authReady = false;

  client.sendCardPick('single-leg');

  assert.equal(
    client.ws.sent.length, 0,
    'card_pick must NOT be on the wire before auth_success - server would reject',
  );
  assert.equal(client._sendQueue.length, 1, 'pick should be queued');
  assert.equal(client._sendQueue[0].type, 'card_pick');
});

test('auth_success flushes the queued card_pick', () => {
  const client = makeClient();
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = false;
  client.sendCardPick('single-leg');
  assert.equal(client.ws.sent.length, 0);

  // Server replies with auth_success - must drive through the RX pipeline.
  client._handleServerMessage({ type: 'auth_success', uid: 'u123' });

  assert.equal(client.ws.sent.length, 1, 'auth_success must flush the queued card_pick');
  assert.equal(client.ws.sent[0].type, 'card_pick');
  assert.equal(client._sendQueue.length, 0);
});

test('reconnected message also flushes queue (reconnect path)', () => {
  const client = makeClient();
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = false;
  client.sendCardPick('sprawl');

  client._handleServerMessage({ type: 'reconnected', roomCode: 'ABCD' });

  assert.equal(client.ws.sent.length, 1, 'reconnected must also flush (reconnect replay)');
  assert.equal(client.ws.sent[0].cardId, 'sprawl');
});

test('auth_error clears queue and keeps gate closed', () => {
  const client = makeClient();
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = false;
  client.sendCardPick('single-leg');

  client._handleServerMessage({ type: 'auth_error', message: 'Invalid token' });

  assert.equal(client._sendQueue.length, 0, 'queue cleared on auth_error');
  assert.equal(client._authReady, false, 'gate stays closed on auth_error');
  assert.equal(client.ws.sent.length, 0, 'pick must not leak onto wire');
});

test('forceReconnect preserves queued picks across the new connection', () => {
  const client = makeClient();
  client.mode = 'online';
  client._authToken = 'tok';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = true;

  // Queue a pick, then simulate socket going half-dead: queue it explicitly.
  client.sendCardPick('double-leg');
  assert.equal(client.ws.sent.length, 1);
  // Imagine the server never acks - forceReconnect is called. The caller
  // re-enqueues the pick before the close (mirrors WrestlingGame logic).
  client._sendQueue.push({ type: 'card_pick', cardId: 'double-leg' });
  client.forceReconnect('test');

  assert.equal(client._authReady, false, 'auth gate must close on force-reconnect');
  assert.equal(client._sendQueue.length, 1, 'queued pick survives the close');
});

test('ping is answered with pong via _sendRaw (bypasses auth gate)', () => {
  const client = makeClient();
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = false;

  client._handleServerMessage({ type: 'ping' });

  const pongs = client.ws.sent.filter((m) => m.type === 'pong');
  assert.equal(pongs.length, 1, 'pong must reply even when auth gate is closed');
});

// ── Phase 3: referee_call forwarding ────────────────────────────────────
//
// The networkClient is a thin relay - actual match-state mutation for
// referee_call lives in WrestlingGame.handleNetworkMessage (see Phase 3
// plan). The network-layer contract here is simpler: the message must
// reach the onMessage callback unmolested, with no auth gate or
// reconnect side-effects triggered.

test('referee_call payload is forwarded to onMessage unmodified', () => {
  const received = [];
  const client = new NetworkClient({
    serverIP: '127.0.0.1',
    onMessage: (msg) => received.push(msg),
    onConnect: () => {},
    onDisconnect: () => {},
    onReconnecting: () => {},
  });
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = true;

  const payload = {
    type: 'referee_call',
    playerKey: 'p1',
    stallCount: 3,
    penaltyAwarded: 1,
    round: 7,
  };
  client._handleServerMessage(payload);

  assert.equal(received.length, 1, 'referee_call must reach onMessage');
  assert.deepEqual(received[0], payload, 'payload must not be mutated');
});

test('referee_call does not affect auth gate or queue', () => {
  const client = makeClient();
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = false; // gate closed
  client._sendQueue.push({ type: 'card_pick', cardId: 'x' });

  client._handleServerMessage({
    type: 'referee_call',
    playerKey: 'p2',
    stallCount: 2,
    penaltyAwarded: 0,
  });

  assert.equal(client._authReady, false, 'gate must stay closed - only auth_success/reconnected open it');
  assert.equal(client._sendQueue.length, 1, 'referee_call must not flush the queue');
});

// ── Authoritative protocol: roundSeq + challenge_input ──────────────────
// In online mode the server owns matchState. Clients tag intents with the
// server-issued roundSeq so stale picks are rejected. Skill challenges
// stream input events to the server which computes the tier itself.

function openOnline() {
  const client = makeClient();
  client.mode = 'online';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client._authReady = true;
  return client;
}

test('sendCardPick: online attaches roundSeq when supplied', () => {
  const client = openOnline();
  client.sendCardPick('single-leg', null, 7);
  assert.equal(client.ws.sent[0].roundSeq, 7);
});

test('sendCardPick: online omits roundSeq when null', () => {
  const client = openOnline();
  client.sendCardPick('single-leg');
  assert.equal('roundSeq' in client.ws.sent[0], false);
});

test('sendCardPick: online never includes skillResult on the wire', () => {
  const client = openOnline();
  client.sendCardPick('single-leg', { tier: 'PERFECT', bonus: 4 }, 3);
  assert.equal('skillResult' in client.ws.sent[0], false);
  assert.equal(client.ws.sent[0].roundSeq, 3);
});

test('sendCardPick: LAN preserves skillResult and ignores roundSeq', () => {
  const client = makeClient();
  client.mode = 'lan';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  client.sendCardPick('single-leg', { tier: 'PERFECT', bonus: 4 }, 3);
  const m = client.ws.sent[0];
  assert.deepEqual(m.skillResult, { tier: 'PERFECT', bonus: 4 });
  // LAN doesn't send roundSeq (it's an online-only concept)
  assert.equal('roundSeq' in m, false);
});

test('sendPinPick: online attaches roundSeq', () => {
  const client = openOnline();
  client.sendPinPick('pin_lock_position', 'offense', 5);
  assert.equal(client.ws.sent[0].roundSeq, 5);
  assert.equal(client.ws.sent[0].role, 'offense');
});

test('sendPinPick: omits roundSeq when null', () => {
  const client = openOnline();
  client.sendPinPick('pin_bridge', 'defense');
  assert.equal('roundSeq' in client.ws.sent[0], false);
});

test('sendPeriodChoice: online attaches roundSeq', () => {
  const client = openOnline();
  client.sendPeriodChoice('top', 4);
  assert.deepEqual(client.ws.sent[0], { type: 'period_choice', choice: 'top', roundSeq: 4 });
});

test('sendRerollRequest: online attaches roundSeq', () => {
  const client = openOnline();
  client.sendRerollRequest(2);
  assert.deepEqual(client.ws.sent[0], { type: 'request_reroll', roundSeq: 2 });
});

test('sendChallengeInput: simple eventType', () => {
  const client = openOnline();
  client.sendChallengeInput('press');
  assert.deepEqual(client.ws.sent[0], { type: 'challenge_input', eventType: 'press' });
});

test('sendChallengeInput: with payload (swipe direction)', () => {
  const client = openOnline();
  client.sendChallengeInput('swipe', { direction: 'up' });
  assert.deepEqual(client.ws.sent[0], {
    type: 'challenge_input',
    eventType: 'swipe',
    payload: { direction: 'up' },
  });
});

test('sendChallengeInput: optional challengeId for cross-check', () => {
  const client = openOnline();
  client.sendChallengeInput('tap', null, 'cha-abc123');
  assert.equal(client.ws.sent[0].challengeId, 'cha-abc123');
});

test('ping with serverPingId: client echoes pong with same id', () => {
  const client = openOnline();
  client._handleServerMessage({ type: 'ping', serverPingId: 42 });
  const pong = client.ws.sent.find((m) => m.type === 'pong');
  assert.ok(pong, 'pong sent');
  assert.equal(pong.serverPingId, 42);
});

test('ping without id: client echoes plain pong', () => {
  const client = openOnline();
  client._handleServerMessage({ type: 'ping' });
  const pong = client.ws.sent.find((m) => m.type === 'pong');
  assert.ok(pong);
  assert.equal('serverPingId' in pong, false);
});

// ── Stage 2B: client protocol version in the auth frame ─────────────────────

test('CLIENT_PROTOCOL_VERSION is a positive integer', () => {
  assert.equal(Number.isInteger(CLIENT_PROTOCOL_VERSION), true);
  assert.ok(CLIENT_PROTOCOL_VERSION >= 1);
});

test('auth frame carries token + the client protocol version', async () => {
  const client = makeClient();
  client.mode = 'online';
  client._authToken = 'tok-123';
  client.ws = new FakeWebSocket();
  client.ws.readyState = FakeWebSocket.OPEN;
  await client._sendAuth();
  const auth = client.ws.sent.find((m) => m.type === 'auth');
  assert.ok(auth, 'auth frame sent');
  assert.equal(auth.token, 'tok-123');
  assert.equal(auth.protocolVersion, CLIENT_PROTOCOL_VERSION,
    'server uses protocolVersion to retire the legacy shim for new clients');
});

// ── Stage 3: explicit match-accept signal ───────────────────────────────────

test('sendMatchAccept sends a match_accept frame (online engagement signal)', () => {
  const client = openOnline();
  client.sendMatchAccept();
  assert.deepEqual(client.ws.sent[0], { type: 'match_accept' });
});
