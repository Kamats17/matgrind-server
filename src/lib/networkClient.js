// Wrestling Game - Network Client
// Supports both LAN (direct IP) and Online (room-code server) modes

export const WS_PORT = 3033;

// Client protocol version, sent in the auth frame (Stage 2B). The server uses
// it to drive evidence-based removal of the legacy find_match resume shim:
// once adoption of versions that no longer re-issue find_match on reconnect is
// high, the shim can be retired for those versions. Bump on any breaking change
// to the reconnect/resume contract.
export const CLIENT_PROTOCOL_VERSION = 1;

// `import.meta.env` is a Vite construct and is undefined under plain Node
// (the test runner). Guard so this module stays importable outside Vite.
const ONLINE_SERVER_URL =
  (typeof import.meta !== 'undefined' &&
    /** @type {any} */ (import.meta).env &&
    /** @type {any} */ (import.meta).env.VITE_ONLINE_SERVER_URL) ||
  null;

export class NetworkClient {
  constructor({ serverIP, onMessage, onConnect, onDisconnect, onReconnecting, tokenProvider }) {
    this.serverIP = serverIP;
    this.onMessage = onMessage;
    this.onConnect = onConnect;
    this.onDisconnect = onDisconnect;
    this.onReconnecting = onReconnecting || (() => {});
    /**
     * Optional async callback that returns a fresh Firebase ID token.
     * When provided, the client calls it before every auth send - including
     * reconnect paths, where the originally-passed token may have expired
     * (Firebase ID tokens live ~1h). Without this, a backgrounded app can
     * reconnect with a stale JWT and the server logs
     * "Decoding Firebase ID token failed".
     * @type {(() => Promise<string>) | null}
     */
    this.tokenProvider = tokenProvider || null;
    this.ws = null;
    this.mode = 'lan'; // 'lan' | 'online'
    /** @type {'p1' | 'p2' | null} - role assigned by the server's welcome message. */
    this._assignedPlayer = null;
    this._authToken = null;
    this._reconnecting = false;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 30; // 30 x 3s = 90s, covers 60s app-background
    this._reconnectTimer = null;
    this._pongHandler = null;
    this._disposed = false;
    /** @type {Array<object>} Game messages queued while socket is not ready to receive them. */
    this._sendQueue = [];
    /**
     * Gate flag - LAN is always true (no auth step). Online mode becomes
     * true after auth_success (or reconnected). Critical: server rejects
     * non-auth messages when !ws._authenticated, so flushing card_pick
     * between `auth` and `auth_success` gets the pick silently dropped
     * server-side. That's the first-move-hang root cause on reconnect.
     */
    this._authReady = false;
  }

  // ── LAN Connection ─────────────────────────────────────────────────────

  connect() {
    this.mode = 'lan';
    // LAN server has no auth handshake - gameplay can flow immediately.
    this._authReady = true;
    return this._connectToURL(`ws://${this.serverIP}:${WS_PORT}`);
  }

  // ── Online Connection ──────────────────────────────────────────────────

  connectOnline(authToken) {
    if (!ONLINE_SERVER_URL) {
      return Promise.reject(new Error('Online server URL not configured'));
    }
    this.mode = 'online';
    this._authToken = authToken;
    // Block game-message flushing until server confirms auth.
    this._authReady = false;
    return this._connectToURL(ONLINE_SERVER_URL);
  }

  // ── Shared Connection Logic ────────────────────────────────────────────

  _connectToURL(url) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        reject(new Error(`Could not connect to ${url}`));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Connection timed out'));
        this.ws?.close();
      }, 8000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this._reconnecting = false;
        this._reconnectAttempts = 0;
        console.log('[NET OPEN]', { mode: this.mode, queued: this._sendQueue.length });

        // Online mode: send auth token immediately. Do NOT flush the queue
        // yet - game messages must wait for `auth_success` or the server
        // drops them with "Not authenticated" during the verifyToken await.
        if (this.mode === 'online') {
          this._sendAuth().catch((e) =>
            console.error('[NET AUTH FETCH FAILED]', e?.message),
          );
        } else if (this.mode === 'lan') {
          // LAN has no auth - safe to flush.
          this._flushQueue();
        }

        if (this.onConnect) this.onConnect();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleServerMessage(msg);
        } catch (e) {
          // bad message
        }
      };

      this.ws.onclose = () => {
        // Explicit disconnect() must not trigger a reconnect loop. Previously
        // this branch only checked `_authToken || tokenProvider` - but
        // tokenProvider is always truthy for online mode, so cancelling a
        // quick-match search entered an infinite reconnect attempt and the
        // UI ended up on a blank `reconnecting` state the lobby didn't
        // render, forcing a page refresh.
        if (this._disposed) {
          if (this.onDisconnect) this.onDisconnect();
          return;
        }
        if (this.mode === 'online' && !this._reconnecting && (this._authToken || this.tokenProvider)) {
          this._tryReconnect();
        } else {
          if (this.onDisconnect) this.onDisconnect();
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        if (!this._reconnecting) {
          reject(new Error(`WebSocket error connecting to ${url}`));
        }
      };
    });
  }

  _tryReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this._reconnecting = false;
      if (this.onDisconnect) this.onDisconnect();
      return;
    }

    this._reconnecting = true;
    this._reconnectAttempts++;
    this.onReconnecting(this._reconnectAttempts, this._maxReconnectAttempts);

    this._reconnectTimer = setTimeout(() => {
      if (!ONLINE_SERVER_URL) return;
      try {
        this.ws = new WebSocket(ONLINE_SERVER_URL);

        this.ws.onopen = () => {
          this._reconnecting = false;
          this._reconnectAttempts = 0;
          // Re-auth required - gate the queue again until auth_success /
          // reconnected arrives.
          this._authReady = false;
          console.log('[NET REOPEN]', { queued: this._sendQueue.length });
          this._sendAuth().catch((e) =>
            console.error('[NET AUTH FETCH FAILED]', e?.message),
          );
          if (this.onConnect) this.onConnect();
          // NOTE: queue flush happens in _handleServerMessage when
          // auth_success / reconnected arrives - NOT here.
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this._handleServerMessage(msg);
          } catch (e) {}
        };

        this.ws.onclose = () => {
          // Same _disposed guard as the primary onclose - prevents reconnect
          // storm after explicit disconnect() during a reconnect attempt.
          if (this._disposed) {
            if (this.onDisconnect) this.onDisconnect();
            return;
          }
          if (this._reconnecting || (this._authToken || this.tokenProvider)) {
            this._tryReconnect();
          } else {
            if (this.onDisconnect) this.onDisconnect();
          }
        };

        this.ws.onerror = () => {
          // Will trigger onclose → retry
        };
      } catch (e) {
        this._tryReconnect();
      }
    }, 3000);
  }

  // ── Receive Pipeline ───────────────────────────────────────────────────

  /**
   * Single entry-point for every inbound server message. Watches for the
   * auth-gate signals (`auth_success`, `reconnected`) and flushes the
   * queued game messages once it's safe. Ping/pong is still handled here
   * so it never interferes with queue state.
   */
  _handleServerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') {
      // Echo serverPingId back so the authoritative server can measure
      // RTT for skill-challenge timing compensation. Older servers send
      // ping without an id; client replies pong without one.
      const pong = { type: 'pong' };
      if (Number.isInteger(msg.serverPingId)) pong.serverPingId = msg.serverPingId;
      this._sendRaw(pong);
      return;
    }
    // Surface server-supplied error text so a `[NET RX] error` in a user's
    // browser log is actually diagnosable instead of a mystery beacon.
    if (msg.type === 'error' || msg.type === 'auth_error') {
      console.log('[NET RX]', msg.type, msg.message || '(no message)');
    } else {
      console.log('[NET RX]', msg.type);
    }
    if (msg.type === 'auth_success' || msg.type === 'reconnected') {
      this._authReady = true;
      // Server-assigned UID is useful for reconnect path tracking.
      if (msg.uid) this._uid = msg.uid;
      this._flushQueue();
    }
    if (msg.type === 'auth_error') {
      // Hard-stop - the server rejected this token. Further reconnects
      // would just loop forever (AUTH → error → REOPEN → AUTH → …) and
      // spam the console. Tear down the client; the caller can create a
      // fresh one with a fresh token if it wants to retry.
      console.error('[NET AUTH ERROR]', msg.message);
      this._sendQueue = [];
      this._authReady = false;
      this._stopReconnecting();
    }
    if (msg.type === 'match_voided' || msg.type === 'room_expired') {
      // Server has declared the match over (opponent never reconnected,
      // or the room was reaped). There's no value in auto-reconnecting
      // after this - it produces the infinite AUTH/error loop seen in
      // the Chrome bug report. Let the UI handle navigation; we just
      // stop retrying.
      this._stopReconnecting();
    }
    if (this.onMessage) this.onMessage(msg);
  }

  /**
   * Cancel any pending reconnect attempt and prevent future ones. The
   * socket itself may still be open - we only flip flags so ws.onclose
   * doesn't schedule another retry. Used when the server has declared
   * the session terminal (auth_error, match_voided, room_expired).
   */
  _stopReconnecting() {
    this._reconnecting = false;
    this._reconnectAttempts = this._maxReconnectAttempts;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    // Null the token so ws.onclose's `_authToken || tokenProvider` guard
    // won't re-enter _tryReconnect after this point.
    this._authToken = null;
    this.tokenProvider = null;
  }

  // ── Auth Send ──────────────────────────────────────────────────────────

  /**
   * Fetch a fresh token (if a provider is configured) and send the auth
   * frame. Logs payload shape so we can see, in prod diagnostics, whether
   * the wire value looks like a Firebase ID token (`eyJ…`, ~900-1400 chars)
   * or something malformed.
   */
  async _sendAuth() {
    let token = this._authToken;
    if (this.tokenProvider) {
      try {
        token = await this.tokenProvider();
        this._authToken = token;
      } catch (e) {
        // Without surfacing this, _authReady stays false forever, the
        // send queue never flushes, and any subsequent ws.onclose just
        // re-runs the throwing path. Route through _handleServerMessage
        // as a synthetic auth_error so the existing terminal-state
        // handling clears the queue, stops reconnecting, and notifies
        // onMessage exactly once.
        console.error('[NET AUTH] tokenProvider threw:', e?.message);
        this._handleServerMessage({
          type: 'auth_error',
          message: 'token_provider_failed: ' + (e?.message || 'unknown'),
        });
        return;
      }
    }
    console.log('[NET AUTH SEND]', {
      typeofToken: typeof token,
      length: typeof token === 'string' ? token.length : null,
      prefix: typeof token === 'string' ? token.slice(0, 10) : null,
      looksLikeJwt: typeof token === 'string' && token.startsWith('eyJ'),
    });
    this._sendRaw({ type: 'auth', token, protocolVersion: CLIENT_PROTOCOL_VERSION });
  }

  // ── Send Messages ──────────────────────────────────────────────────────

  /**
   * Send a raw control message directly (bypasses the auth-ready queue).
   * Only used internally for `auth` and `pong` - never for game messages.
   * Returns true if placed on wire, false if disposed or socket unusable.
   */
  _sendRaw(msg) {
    if (this._disposed || !this.ws) return false;
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (e) {
      console.error('[NET RAW SEND FAILED]', msg?.type, e);
      return false;
    }
  }

  /**
   * Enqueue a game-layer message. Sent immediately if the socket is OPEN
   * AND auth is complete; otherwise queued until both conditions hold
   * (`auth_success` / `reconnected` arrives). Returns true unless the
   * client has been explicitly disposed.
   *
   * The auth gate exists because the server rejects any non-auth message
   * while `verifyToken` is still awaiting - flushing too early silently
   * drops the pick and the client hangs waiting for a pick_acknowledged
   * that never comes. That is the TestFlight first-move-hang root cause.
   *
   * @param {object} msg
   * @returns {boolean}
   */
  _send(msg) {
    if (this._disposed || !this.ws) {
      console.error('[NET SEND DROPPED] client disposed', msg?.type);
      return false;
    }
    // LAN has no auth step - the gate only applies to online mode.
    const gatePassed = this.mode === 'online' ? this._authReady : true;
    const canSendNow = this.ws.readyState === WebSocket.OPEN && gatePassed;
    if (canSendNow) {
      this.ws.send(JSON.stringify(msg));
      console.log('[NET TX]', msg?.type);
      return true;
    }
    // Not ready - queue. (CONNECTING, mid-auth, CLOSING, CLOSED.)
    this._sendQueue.push(msg);
    console.warn('[NET SEND QUEUED]', {
      type: msg?.type,
      readyState: this.ws.readyState,
      authReady: this._authReady,
      depth: this._sendQueue.length,
    });
    return true;
  }

  /**
   * Drain the pending game-message queue. Called from _handleServerMessage
   * when auth_success / reconnected arrives. A failed send during flush
   * re-queues the remainder for the next auth cycle.
   */
  _flushQueue() {
    if (!this._sendQueue.length) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.mode === 'online' && !this._authReady) return;
    const pending = this._sendQueue;
    this._sendQueue = [];
    for (let i = 0; i < pending.length; i++) {
      const msg = pending[i];
      try {
        this.ws.send(JSON.stringify(msg));
        console.log('[NET TX flushed]', msg?.type);
      } catch (e) {
        console.error('[NET FLUSH FAILED]', msg?.type, e);
        this._sendQueue.push(msg, ...pending.slice(i + 1));
        return;
      }
    }
    console.log('[NET FLUSHED]', pending.length, 'queued message(s)');
  }

  /**
   * Force a reconnect without losing the queued picks. Called from
   * WrestlingGame when an in-flight pick appears stuck (socket OPEN, no
   * ack). Closes the socket so onclose → _tryReconnect fires; the pending
   * queue survives and replays after auth_success on the new socket.
   */
  forceReconnect(reason = 'stuck_pick') {
    if (this._disposed) return;
    if (this.mode !== 'online') return;
    console.warn('[NET FORCE RECONNECT]', reason, { queued: this._sendQueue.length });
    this._authReady = false;
    try { this.ws?.close(4001, reason); } catch { /* ignore */ }
  }

  /**
   * Send a card pick.
   *
   * Online mode (authoritative): server runs the engine, validates legality,
   * and computes the skill tier from challenge inputs. The client never
   * supplies a skillResult on the wire. `roundSeq` ties the pick to the
   * server's current state so stale picks are rejected with `wrong_round`.
   *
   * LAN mode: the host runs the engine locally and consumes the skillResult
   * itself. Preserve the payload in that case. (LAN keeps the relay pattern.)
   *
   * @param {string} cardId
   * @param {object | null} [skillResult] - LAN only
   * @param {number | null} [roundSeq] - server-issued monotonic round counter
   * @returns {boolean} true if sent or queued, false if client disposed.
   */
  sendCardPick(cardId, skillResult = null, roundSeq = null) {
    const payload = { type: 'card_pick', cardId };
    if (skillResult && this.mode === 'lan') payload.skillResult = skillResult;
    if (this.mode === 'online' && Number.isInteger(roundSeq)) payload.roundSeq = roundSeq;
    return this._send(payload);
  }

  sendPeriodChoice(choice, roundSeq = null) {
    const payload = { type: 'period_choice', choice };
    if (this.mode === 'online' && Number.isInteger(roundSeq)) payload.roundSeq = roundSeq;
    this._send(payload);
  }

  sendPinPick(cardId, role, roundSeq = null) {
    const payload = { type: 'pin_pick', cardId, role };
    if (this.mode === 'online' && Number.isInteger(roundSeq)) payload.roundSeq = roundSeq;
    this._send(payload);
  }

  /**
   * Stream input events for the active skill challenge to the server.
   * The server measures all timing and computes the tier authoritatively.
   * Client-supplied timestamps are advisory only; server uses receivedAt.
   *
   * @param {string} eventType - 'press' | 'release' | 'tap' | 'swipe'
   * @param {object} [payload] - mechanic-specific extras (e.g. swipe direction)
   * @param {string} [challengeId] - optional cross-check; server routes by uid
   */
  sendChallengeInput(eventType, payload = null, challengeId = null) {
    const msg = { type: 'challenge_input', eventType };
    if (payload && typeof payload === 'object') msg.payload = payload;
    if (typeof challengeId === 'string') msg.challengeId = challengeId;
    this._send(msg);
  }

  /**
   * Ask the server for a hand reroll. Server validates this side's
   * `rerollsLeft > 0`, decrements, and replies with `reroll_granted`
   * (to us) + `opponent_rerolled` (to the other side). The actual hand
   * contents stay client-local - each client rebuilds via rerollHand
   * with its own RNG. Older servers without this handler ignore the
   * message; the UI stays unblocked because no state changes locally
   * until reroll_granted arrives.
   */
  sendRerollRequest(roundSeq = null) {
    const payload = { type: 'request_reroll' };
    if (this.mode === 'online' && Number.isInteger(roundSeq)) payload.roundSeq = roundSeq;
    this._send(payload);
  }

  sendConfig(name, style) {
    this._send({ type: 'config', name, style });
  }

  /**
   * Signal explicit acceptance of a found match (Stage 3). Sent when the
   * player commits to the match (consumeMatch), before any gameplay frame, so
   * the server classifies a later drop as a started-match disconnect rather
   * than a no-show. Older servers ignore the unknown type harmlessly.
   */
  sendMatchAccept() {
    this._send({ type: 'match_accept' });
  }

  sendRematch() {
    this._send({ type: 'rematch' });
  }

  sendRematchDecline() {
    this._send({ type: 'rematch_decline' });
  }

  // ── Online Room Operations ─────────────────────────────────────────────

  createRoom(name, style) {
    this._send({ type: 'create_room', name, style });
  }

  joinRoom(code, name) {
    this._send({ type: 'join_room', code, name });
  }

  spectateRoom(code) {
    this._send({ type: 'spectate_room', code });
  }

  findMatch(name, style) {
    this._send({ type: 'find_match', name, style });
  }

  cancelMatchmaking() {
    this._send({ type: 'cancel_matchmaking' });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────

  disconnect() {
    this._disposed = true;
    this._reconnecting = false;
    this._authToken = null;
    this._authReady = false;
    this._sendQueue = [];
    clearTimeout(this._reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
