// Background Online Matchmaking Queue
//
// A single-instance manager that owns the NetworkClient lifecycle for
// matchmaking across the whole app - NOT scoped to the NetworkLobby
// screen. This is what lets the user search for an opponent while
// bouncing around Profile / Leaderboard / Main Menu / a solo vs-AI match.
//
// Lifecycle:
//
//   idle → connecting → searching ─┬─▶ found  (server sent game_start)
//                                  ├─▶ timed_out (matchmaking_timeout)
//                                  ├─▶ reconnecting (socket drop, auto-retry)
//                                  └─▶ error (auth_error or terminal)
//
//   Any state → idle via cancel() or forfeitMatch().
//
// On `found`, the manager holds the NetworkClient in a buffer and waits
// for the consumer (WrestlingGame) to either call `consumeMatch()` to
// take ownership (dispatched to startNetworkGame) or `forfeitMatch()`
// to decline. The client is never both live-in-the-manager and owned
// by the match screen simultaneously.
//
// Not a React hook - pure event emitter. The React layer subscribes via
// a useEffect + forceUpdate pattern.

import { NetworkClient } from './networkClient.js';
import { auth } from './firebase.js';
import { notifyMatchFound } from './notificationService.js';
import {
  createChallenge, setChallengeRoomCode, cancelChallenge, clearChallenge,
} from './matchChallenges.js';

const LISTENERS = {
  state: new Set(),
  match: new Set(),
};

// How long the queue can survive an app-pause before we tear it down on
// resume. Lines up with the bumped client reconnect window in networkClient
// (30 attempts x 3s = 90s) and the user-stated "60 seconds to give people
// time" requirement.
const BACKGROUND_TOLERANCE_MS = 60_000;

let _state = 'idle';           // 'idle' | 'connecting' | 'searching' | 'reconnecting' | 'found' | 'timed_out' | 'error'
let _startedAt = null;          // ms epoch - when the queue began (persists across reconnects)
let _pausedAt = null;           // ms epoch - when the app went to background while queueing
let _style = 'folkstyle';
let _name = 'Player';
let _errorMessage = '';
let _client = null;
let _foundPayload = null;      // { client, networkPlayer, p1Name, p2Name, style, mode, initialInitiative }
// Post-game_start message buffer. The server flushes `game_start` and
// `state_update` (and possibly `challenge_start`) back-to-back once a
// match is matched. Without buffering, any message that arrives between
// `game_start` and `consumeMatch()` falls through `_handleServerMessage`'s
// switch-default and is silently dropped - WrestlingGame never sees the
// first state_update, currentRoundSeqRef stays at 0, the first card_pick
// goes out with no roundSeq, server returns wrong_round, match voids.
// Capturing every post-game_start message and returning it via
// consumeMatch() lets WrestlingGame replay the messages through its own
// handleNetworkMessage as the very first thing after taking ownership.
let _postGameStartBuffer = [];

// Mode flag: distinguishes a public matchmaking queue ('queue') from a
// direct friend challenge ('challenge_host' / 'challenge_guest'). Drives
// what happens on auth_success - public queue calls findMatch, host
// creates a private room, guest joins by code.
let _flow = 'queue';
let _challengeTargetUid = null;  // host: recipient uid, used to patch the Firestore doc with the room code
let _challengeRoomCode = null;   // guest: room code to join

function _emit(kind, data) {
  for (const fn of LISTENERS[kind]) {
    try { fn(data); } catch (e) { console.error('[QUEUE listener]', kind, e); }
  }
}

function _setState(next, extra = {}) {
  _state = next;
  if (extra.errorMessage !== undefined) _errorMessage = extra.errorMessage;
  _emit('state', getState());
}

export function getState() {
  return {
    status: _state,
    startedAt: _startedAt,
    elapsedMs: _startedAt ? Date.now() - _startedAt : 0,
    style: _style,
    errorMessage: _errorMessage,
  };
}

export function onState(fn) {
  LISTENERS.state.add(fn);
  return () => LISTENERS.state.delete(fn);
}

export function onMatchFound(fn) {
  LISTENERS.match.add(fn);
  return () => LISTENERS.match.delete(fn);
}

/**
 * Internal: shared connection bootstrap. Opens an authenticated WS,
 * routes server messages through `_handleServerMessage`, and seeds the
 * common queue/challenge state. The `_flow` flag set BEFORE calling
 * this is what _handleServerMessage branches on.
 */
async function _bootstrapConnection() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    _setState('error', { errorMessage: 'You must be signed in to play online.' });
    return;
  }
  let token;
  try {
    token = await currentUser.getIdToken(true);
  } catch (e) {
    _setState('error', { errorMessage: 'Could not get auth token: ' + (e?.message || 'unknown') });
    return;
  }
  _setState('connecting');
  const client = new NetworkClient({
    serverIP: null,
    tokenProvider: () =>
      auth.currentUser?.getIdToken(true) ?? Promise.reject(new Error('No current user')),
    onConnect: () => { /* auth is auto-sent */ },
    onMessage: (msg) => _handleServerMessage(msg, client),
    onDisconnect: () => {
      if (_state === 'found' || _state === 'idle') return;
      _setState('error', { errorMessage: 'Disconnected from server.' });
      _client = null;
      // Clear any in-flight buffer - the consumer will never see it now.
      _postGameStartBuffer = [];
    },
    onReconnecting: () => {
      // Preserve a found match across a transient reconnect (Stage 2B): if the
      // payload is already held, flipping to 'reconnecting' would drop the
      // found banner and risk a re-queue. The buffer keeps capturing.
      if (_foundPayload) return;
      _setState('reconnecting');
    },
  });
  _client = client;
  try {
    await client.connectOnline(token);
  } catch (e) {
    _setState('error', { errorMessage: e?.message || 'Could not connect.' });
    _client = null;
  }
}

/**
 * Sender side of an in-app friend challenge. Opens a WS, creates a
 * private room, and writes the room code into the Firestore challenge
 * doc so the recipient's app can join. State transitions identically
 * to the public queue (connecting -> searching -> found) so any UI
 * subscribed to onState reads the same banner copy.
 *
 * The Firestore challenge doc must already exist (created by the
 * caller via createChallenge). This function only patches the room
 * code in once the server returns it.
 *
 * @param {{ targetUid?: string, name?: string, style?: string }} [opts]
 */
export async function startChallengeAsHost({ targetUid, name, style } = {}) {
  if (_state !== 'idle' && _state !== 'error' && _state !== 'timed_out') {
    console.warn('[QUEUE startChallengeAsHost] ignored - already', _state);
    return;
  }
  if (!targetUid) {
    _setState('error', { errorMessage: 'Missing challenge target.' });
    return;
  }
  _flow = 'challenge_host';
  _challengeTargetUid = targetUid;
  _challengeRoomCode = null;
  _name = (name || '').trim() || 'Player';
  _style = style || 'folkstyle';
  _startedAt = Date.now();
  _errorMessage = '';
  _foundPayload = null;
  await _bootstrapConnection();
}

/**
 * Recipient side. Opens a WS and joins the room identified by `code`.
 * Same state transitions as the host / queue flows so the consumer
 * pattern (onMatchFound + consumeMatch) lights up exactly the same.
 *
 * @param {{ roomCode?: string, name?: string, style?: string }} [opts]
 */
export async function acceptChallengeAsGuest({ roomCode, name, style } = {}) {
  if (_state !== 'idle' && _state !== 'error' && _state !== 'timed_out') {
    console.warn('[QUEUE acceptChallengeAsGuest] ignored - already', _state);
    return;
  }
  if (!roomCode) {
    _setState('error', { errorMessage: 'Missing room code.' });
    return;
  }
  _flow = 'challenge_guest';
  _challengeTargetUid = null;
  _challengeRoomCode = roomCode;
  _name = (name || '').trim() || 'Player';
  _style = style || 'folkstyle';
  _startedAt = Date.now();
  _errorMessage = '';
  _foundPayload = null;
  await _bootstrapConnection();
}

/**
 * Sender bails on a pending challenge before the recipient accepts.
 * Updates the Firestore doc to status='cancelled' so the recipient's
 * modal disappears, then tears down the WS.
 */
export function cancelChallengeAsHost() {
  if (_flow !== 'challenge_host') { cancelQueue(); return; }
  if (_challengeTargetUid) cancelChallenge(_challengeTargetUid).catch(() => {});
  cancelQueue();
}

/**
 * Kick off a new search. Silently no-ops if already active.
 * @param {{ name?: string, style?: string }} [opts]
 * @returns {Promise<void>} resolves when the auth handshake is in flight.
 */
export async function startQueue({ name, style } = {}) {
  if (_state !== 'idle' && _state !== 'error' && _state !== 'timed_out') {
    console.warn('[QUEUE start] ignored - already', _state);
    return;
  }
  _flow = 'queue';
  _challengeTargetUid = null;
  _challengeRoomCode = null;
  _name = (name || '').trim() || 'Player';
  _style = style || 'folkstyle';
  _startedAt = Date.now();
  _errorMessage = '';
  _foundPayload = null;
  await _bootstrapConnection();
}

// Allowlist of post-game_start protocol messages that should be replayed
// to WrestlingGame after consumeMatch. Terminal messages (error,
// match_voided, room_expired) deliberately fall through to the switch
// below so queueManager state can transition correctly. Pong is handled
// inside NetworkClient and never reaches here.
const POST_GAME_START_BUFFER_TYPES = new Set([
  'state_update',
  'challenge_start',
  'challenge_prompt',
  'challenge_resolved',
  'pick_acknowledged',
  'opponent_disconnected',
  'opponent_reconnected',
  'reroll_granted',
  'opponent_rerolled',
  'period_choice_timeout',
]);

function _handleServerMessage(msg, client) {
  // Once we've stashed _foundPayload, capture protocol messages destined
  // for the consumer (WrestlingGame). See _postGameStartBuffer for why.
  // Terminal/control messages (error, match_voided, room_expired) are
  // NOT buffered - they need the switch below to update queue state.
  if (_foundPayload && POST_GAME_START_BUFFER_TYPES.has(msg.type)) {
    _postGameStartBuffer.push(msg);
    return;
  }
  switch (msg.type) {
    case 'auth_success':
      // Branch on the active flow: public queue, host-of-challenge, or
      // guest-joining-challenge. Each kicks off a different server
      // message right after auth lands.
      if (_flow === 'challenge_host') {
        client.createRoom(_name, _style);
        _setState('searching');
      } else if (_flow === 'challenge_guest') {
        client.joinRoom(_challengeRoomCode, _name);
        _setState('searching');
      } else {
        client.findMatch(_name, _style);
        _setState('searching');
      }
      break;
    case 'auth_error':
      _setState('error', { errorMessage: msg.message || 'Authentication failed.' });
      client.disconnect();
      _client = null;
      break;
    case 'matchmaking_queued':
      _setState('searching');
      break;
    case 'room_created':
      // Host flow: server returned the private room code. Patch the
      // Firestore challenge doc so the recipient's listener can surface
      // the Accept button.
      if (_flow === 'challenge_host' && _challengeTargetUid && msg.code) {
        _challengeRoomCode = msg.code;
        setChallengeRoomCode(_challengeTargetUid, msg.code).catch((e) => {
          console.warn('[QUEUE challenge] failed to patch room code:', e?.message);
        });
      }
      break;
    case 'reconnected':
      if (_flow === 'challenge_host' || _flow === 'challenge_guest') {
        // For challenges we don't auto-recreate / re-join on reconnect -
        // the room and Firestore state may have moved on. Surface as an
        // error so the UI can prompt the user to retry.
        _setState('error', { errorMessage: 'Connection lost. Please try again.' });
      } else if (_foundPayload) {
        // Stage 2B: a match was already found. The server's reconnect replays
        // state (and, for legacy builds, the resume shim replays game_start).
        // Re-issuing find_match here would re-queue the player and lose the
        // found match. Re-assert 'found' and keep buffering.
        _setState('found');
      } else {
        client.findMatch(_name, _style);
        _setState('searching');
      }
      break;
    case 'matchmaking_timeout':
      _setState('timed_out', { errorMessage: msg.message || 'No opponent found.' });
      try { client.disconnect(); } catch { /* ignore */ }
      _client = null;
      break;
    case 'matchmaking_cancelled':
      // Server ack for our cancel - finalise teardown.
      _resetToIdle();
      break;
    case 'opponent_joined':
      // Transient - server stashes opponent then emits game_start.
      client._assignedPlayer = msg.player;
      break;
    case 'game_start':
      _foundPayload = {
        client,
        networkPlayer: msg.player,
        p1Name: msg.p1Name,
        p2Name: msg.p2Name,
        style: msg.style,
        mode: 'online',
        initialInitiative: msg.initialInitiative || null,
      };
      _setState('found');
      _emit('match', _foundPayload);
      // Clean up the Firestore challenge doc once the match is live;
      // both sides have the WS connection now and the doc has served
      // its purpose. Host owns the cleanup; the guest side has no doc
      // reference handy and the host's delete propagates via listener.
      if (_flow === 'challenge_host' && _challengeTargetUid) {
        clearChallenge(_challengeTargetUid).catch(() => { /* not fatal */ });
      }
      // Fire a local notification if the app is backgrounded. The match is
      // held in `_foundPayload` until the consumer (WrestlingGame) calls
      // consumeMatch(), so the user has time to return to the app and pick
      // up. No-op on web.
      if (_pausedAt !== null || (typeof document !== 'undefined' && document.hidden)) {
        notifyMatchFound().catch(() => { /* notification failure is not fatal */ });
      }
      break;
    case 'error':
      _setState('error', { errorMessage: msg.message || 'Server error.' });
      try { client.disconnect(); } catch { /* ignore */ }
      _client = null;
      // Clear any partial buffer - the consumer will never claim it now.
      _postGameStartBuffer = [];
      break;
  }
}

/**
 * Consumer (WrestlingGame) takes ownership of the match client. The
 * queue manager releases its reference so teardown in `cancel()` can no
 * longer disconnect the live match. Returns the payload or null.
 */
export function consumeMatch() {
  if (_state !== 'found' || !_foundPayload) return null;
  const payload = _foundPayload;
  _foundPayload = null;

  // Hand the post-game_start buffer to the consumer. WrestlingGame replays
  // these messages through its own handleNetworkMessage AFTER patching
  // client.onMessage and AFTER running the online-mode reset. Drain order
  // is critical (see startNetworkGame for the contract).
  payload.bufferedMessages = _postGameStartBuffer;
  _postGameStartBuffer = [];

  // CRITICAL: detach our callbacks from the NetworkClient before handing
  // ownership to WrestlingGame. If we leave them attached, an in-match WS
  // reconnect (mobile background, network switch) re-fires onReconnecting
  // which sets queueManager state to 'reconnecting' (banner appears mid
  // match), then auth_success -> _handleServerMessage calls
  // client.findMatch() which silently re-queues the player and flips state
  // to 'searching'. WrestlingGame patches onMessage in startNetworkGame
  // but never the other three callbacks; scrubbing here closes the gap.
  const c = payload.client;
  if (c) {
    // Stage 3: signal explicit acceptance so the server classifies any later
    // drop as a started-match disconnect, not a no-show. Sent while the socket
    // is still live and our callbacks are attached, before we detach below.
    try { c.sendMatchAccept?.(); } catch { /* not fatal */ }
    c.onMessage = () => {};
    c.onConnect = () => {};
    c.onDisconnect = () => {};
    c.onReconnecting = () => {};
  }

  _client = null; // ownership transferred
  _state = 'idle';
  _startedAt = null;
  _emit('state', getState());
  return payload;
}

/**
 * Decline a found match. Disconnects the match socket (server will
 * treat us as a no-show), optionally re-queues us automatically.
 */
export function forfeitMatch({ requeue = true } = {}) {
  if (_state !== 'found' || !_foundPayload) return;
  const { client } = _foundPayload;
  _foundPayload = null;
  try { client.disconnect(); } catch { /* ignore */ }
  _client = null;
  _resetToIdle();
  if (requeue) {
    // Fire-and-forget; caller already knows we were searching.
    startQueue({ name: _name, style: _style }).catch(() => {});
  }
}

/** User-initiated cancel from the pill / lobby. Safe to call from any state. */
export function cancelQueue() {
  if (_state === 'found' && _foundPayload) {
    // Treat as forfeit without re-queue.
    forfeitMatch({ requeue: false });
    return;
  }
  if (_client) {
    try { _client.cancelMatchmaking(); } catch { /* ignore */ }
    try { _client.disconnect(); } catch { /* ignore */ }
    _client = null;
  }
  _resetToIdle();
}

function _resetToIdle() {
  _state = 'idle';
  _startedAt = null;
  _pausedAt = null;
  _errorMessage = '';
  _foundPayload = null;
  _postGameStartBuffer = [];
  _flow = 'queue';
  _challengeTargetUid = null;
  _challengeRoomCode = null;
  _emit('state', getState());
}

/**
 * Capacitor App.pause hook. Marks when the app went to background so resume
 * can decide whether to keep the queue alive or tear it down. The WebSocket
 * itself is left as-is - its own reconnect logic handles transient drops.
 */
export function handleAppPause() {
  if (_state === 'searching' || _state === 'reconnecting' || _state === 'connecting') {
    _pausedAt = Date.now();
  }
}

/**
 * Capacitor App.resume hook. Within BACKGROUND_TOLERANCE_MS we let the
 * existing reconnect/keepalive flow restore the queue silently. Past that
 * window we tear down so the user gets an honest "queue dropped" toast and
 * can re-tap Find Match. If a match was found while we were paused, the
 * 'found' state survives unconditionally and the consumer picks it up.
 */
export function handleAppResume() {
  const pausedAt = _pausedAt;
  _pausedAt = null;
  if (pausedAt === null) return;
  if (_state === 'found') return; // match found while paused - keep it
  const elapsed = Date.now() - pausedAt;
  if (elapsed > BACKGROUND_TOLERANCE_MS && (_state === 'searching' || _state === 'reconnecting')) {
    _setState('error', { errorMessage: 'Queue dropped after 60s background. Tap to search again.' });
    if (_client) {
      try { _client.disconnect(); } catch { /* ignore */ }
      _client = null;
    }
  }
  // For shorter backgrounding, do nothing - the WebSocket reconnect logic
  // (already triggered by the OS resuming network IO) handles it. If the
  // socket is still alive, no action needed at all.
}

/**
 * Used by the UI to surface the "interrupt mid-match" flag. Defaults to
 * false - set by WrestlingGame via the exported setter whenever the app
 * is on a screen that would be disruptive to swap out of (live vs-AI bout,
 * tournament, dual).
 */
let _interruptHostile = false;
export function setInterruptHostile(flag) { _interruptHostile = !!flag; }
export function isInterruptHostile() { return _interruptHostile; }

/** Test-only hook - never call from app code. */
export function __resetForTests() {
  if (_client) { try { _client.disconnect(); } catch { /* ignore */ } }
  _client = null;
  _resetToIdle();
  LISTENERS.state.clear();
  LISTENERS.match.clear();
  _interruptHostile = false;
}

/**
 * Test-only hook - drives a server message through `_handleServerMessage`
 * with a caller-supplied fake client. Used to verify the post-game_start
 * buffering invariant without standing up a real WebSocket. Never call
 * from app code.
 */
export function __handleServerMessageForTest(msg, client) {
  return _handleServerMessage(msg, client);
}
