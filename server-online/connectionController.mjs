// Connection + auth controller (Stage 2A Batch 6). Extracted from index.mjs so
// the connection lifecycle, the commit-safe auth transaction, single-socket
// authority, and the consume-first legacy-resume routing are all unit-testable
// WITHOUT importing the auto-listening index.mjs.
//
// Everything is dependency-injected (rooms, admission, rateLimiter,
// verifyToken, send, metrics, timers) so tests drive it with fakes.

const OPEN = 1; // ws.readyState OPEN

export class ConnectionController {
  constructor({
    rooms, admission, rateLimiter, verifyToken, config,
    send, metrics, now = () => Date.now(), timers,
    onPong, firstPing, authTimeoutMs = 10000,
  }) {
    this.rooms = rooms;
    this.admission = admission;
    this.rateLimiter = rateLimiter;
    this.verifyToken = verifyToken;
    this.cfg = config;                 // { RATE_LIMITS, TIMING }
    this.send = send;                  // (ws, msg) => void  (guards readyState)
    this.m = metrics || { incCounter: () => {}, logEvent: () => {} };
    this.now = now;
    // Real per-connection auth-deadline timers are injected by index.mjs, which
    // owns process-lifetime + per-connection timers and is exempt from the
    // room-timer lint (these have no room to attach to). Default is a no-op so
    // a misconfigured construction never crashes — it just means no deadline.
    this.timers = timers || { set: () => null, clear: () => {} };
    this.onPong = onPong;              // (ws, msg) => void   RTT handling (owned by index)
    this.firstPing = firstPing;        // (ws) => void
    this.authTimeoutMs = authTimeoutMs;
    this.socketByUid = new Map();       // uid -> authoritative ws
  }

  // ── Connection admission (replaces inline MAX_CONNECTIONS_PER_IP) ─────────
  onConnect(ws, req) {
    const ip = this.admission.extractIp(req);
    const res = this.admission.admitPending(ip, this.now());
    if (!res.ok) {
      // admission already counted the rejection (connections_rejected_total).
      if (ws.close) ws.close(1008, 'Too many connections');
      return false;
    }
    ws._ip = ip;
    ws._pendingLease = res.lease;
    ws._authenticated = false;
    ws._authState = 'pending';        // pending → authenticating → authenticated → released
    ws._uid = null;
    ws._roomCode = null;
    ws._superseded = false;
    this.m.incCounter('connections_total');
    ws._authTimer = this.timers.set(() => {
      if (!ws._authenticated) {
        this._releasePending(ws);
        ws._authState = 'released';
        this.send(ws, { type: 'error', code: 'auth_timeout', message: 'Auth timeout' });
        if (ws.close) ws.close();
      }
    }, this.authTimeoutMs);
    return true;
  }

  _clearAuthTimer(ws) {
    if (ws._authTimer) { this.timers.clear(ws._authTimer); ws._authTimer = null; }
  }

  _releasePending(ws) {
    if (ws._pendingLease) { this.admission.releasePending(ws._pendingLease); ws._pendingLease = null; }
  }

  // ── Message routing ──────────────────────────────────────────────────────
  onMessage(ws, msg) {
    if (ws._superseded) return;                       // reject stale inbound frames
    // Validate shape BEFORE reading msg.type. Null / arrays / primitives /
    // missing or non-string type are dropped cheaply (bounded work for
    // malformed floods, no response). A malformed FIRST non-pong app frame
    // must still consume any legacy-resume eligibility (strict one-shot).
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') {
      if (ws._authenticated && ws._legacyResumeEligible) this.rooms.consumeLegacyResume(ws, '__malformed__');
      return;
    }
    if (msg.type === 'auth') return this.handleAuth(ws, msg.token);
    if (!ws._authenticated) {
      this.send(ws, { type: 'error', code: 'not_authenticated', message: 'Not authenticated' });
      return;
    }
    if (msg.type === 'pong') { if (this.onPong) this.onPong(ws, msg); return; }

    // Consume-first legacy resume (2A.10 / correction 1): runs BEFORE the
    // rate-limit, so a rate-limited / unknown / invalid first frame still
    // consumes eligibility (never preserved for a later find_match), and a
    // VALID eligible find_match resumes even when the message bucket is spent.
    if (this.rooms.consumeLegacyResume(ws, msg.type)) return;

    const isCha = msg.type === 'challenge_input';
    const key = isCha ? `cha:${ws._uid}` : `msg:${ws._uid}`;
    const refill = isCha ? this.cfg.RATE_LIMITS.challenge_inputs_per_sec : this.cfg.RATE_LIMITS.msgs_per_sec;
    const burst = isCha ? this.cfg.RATE_LIMITS.challenge_inputs_burst : this.cfg.RATE_LIMITS.msgs_burst;
    if (!this.rateLimiter.consume(key, refill, burst)) {
      this.send(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' });
      return;
    }
    this._route(ws, msg);
  }

  _route(ws, msg) {
    switch (msg.type) {
      case 'create_room': return this._handleCreateRoom(ws, msg);
      case 'join_room': return this._handleJoinRoom(ws, msg);
      case 'spectate_room': return this._handleSpectateRoom(ws, msg);
      case 'find_match': return this.rooms.findMatch(ws, msg.name, msg.style);
      case 'cancel_matchmaking': return this.rooms.cancelMatchmaking(ws);
      case 'card_pick':
      case 'pin_pick':
      case 'period_choice':
      case 'request_reroll':
      case 'challenge_input':
      case 'match_accept':
      case 'rematch':
      case 'rematch_decline':
      case 'config':
        return this.rooms.handleGameMessage(ws, msg);
      default:
        this.send(ws, { type: 'error', code: 'unknown_message_type', message: `Unknown type: ${msg.type}` });
    }
  }

  _handleCreateRoom(ws, msg) {
    const r = this.rooms.allocateRoom(ws, msg.name, msg.style);
    if (r.error) { this.send(ws, { type: 'error', code: 'create_failed', message: r.error }); return; }
    this.rooms.attachRttEstimator(r.code, ws._uid);
    this.send(ws, { type: 'room_created', code: r.code });
  }

  _handleJoinRoom(ws, msg) {
    const r = this.rooms.joinRoom(ws, msg.code, msg.name);
    if (r.error) { this.send(ws, { type: 'error', code: 'join_failed', message: r.error }); return; }
    this.rooms.attachRttEstimator(ws._roomCode, ws._uid);
  }

  _handleSpectateRoom(ws, msg) {
    const r = this.rooms.spectateRoom(ws, msg.code);
    if (r.error) this.send(ws, { type: 'error', code: 'spectate_failed', message: r.error });
  }

  // ── Auth as a commit-safe transaction (2A.2 / 2A.3 / 2A.6) ───────────────
  async handleAuth(ws, token) {
    if (ws._authState !== 'pending') {                 // duplicate auth frame
      this.send(ws, { type: 'auth_error', message: 'Already authenticating' });
      return;
    }
    ws._authState = 'authenticating';
    let uid = null;
    try { uid = await this.verifyToken(token); } catch { uid = null; }
    // Clear the deadline ONLY after verifyToken (a slow verify must not be
    // killed mid-flight).
    this._clearAuthTimer(ws);
    // Liveness: the socket may have closed or been superseded during verify.
    if (ws.readyState !== OPEN || ws._authState !== 'authenticating' || ws._superseded) return;
    if (!uid) {
      this.m.incCounter('auth_failures_total');
      this._releasePending(ws);
      ws._authState = 'released';
      this.send(ws, { type: 'auth_error', message: 'Invalid token' });
      if (ws.close) ws.close();
      return;
    }

    // Pure 3-state inspect BEFORE reserving anything.
    const plan = this.rooms.inspectSession(uid);
    if (plan.status === 'terminal') {
      // Guardrail 1: terminal reconnects never adopt the socket, reserve a
      // session, or write socketByUid. Notify + release pending + close.
      this.rooms.handleReconnect(ws, uid);   // sends match_voided + clears mapping; returns false
      this._releasePending(ws);
      ws._authState = 'released';
      if (ws.close) ws.close();
      return;
    }

    // Reserve / transfer the authed-IP session. On reject the prior session is
    // left intact (ConnectionAdmission is atomic), so a full-IP reconnect from
    // a new IP cannot knock out the working session.
    const reservation = this.admission.reserveSession(uid, ws._ip);
    if (!reservation.ok) {
      this.m.incCounter('auth_failures_total', { reason: reservation.reason });
      this._releasePending(ws);
      ws._authState = 'released';
      this.send(ws, { type: 'auth_error', message: 'Too many sessions' });
      if (ws.close) ws.close();
      return;
    }

    // COMMIT. The throwable steps (recover + emit the single outcome) run
    // FIRST; only after they succeed do we take irreversible authority
    // (register socketByUid + supersede the old socket). So a mid-commit
    // failure rolls back THIS socket without ever touching the established old
    // one (Correction 4).
    try {
      ws._authenticated = true;
      ws._uid = uid;
      ws._authState = 'authenticated';
      this._releasePending(ws);

      // Recover + emit EXACTLY ONE outcome: active → 'reconnected' (suppress
      // auth_success); none → 'auth_success'.
      const recovered = this.rooms.handleReconnect(ws, uid);
      if (recovered) {
        this.rooms.attachRttEstimator(ws._roomCode, uid);
      } else {
        this.send(ws, { type: 'auth_success', uid });
      }

      // Irreversible authority — nothing past this point may fail. Supersede
      // the old socket only now, so a failure above never destroys it.
      const oldWs = this.socketByUid.get(uid);
      this.socketByUid.set(uid, ws);
      if (oldWs && oldWs !== ws) {
        oldWs._superseded = true;
        // Isolated: superseding the old socket runs AFTER authority is taken,
        // so a synchronous close() failure must never re-enter rollback and
        // destroy the committed replacement.
        try {
          this.send(oldWs, { type: 'auth_error', code: 'session_superseded' });
          if (oldWs.close) oldWs.close();
        } catch { /* old-socket cleanup failure cannot affect the new auth */ }
      }
      this.m.incCounter('auth_success_total');
    } catch (err) {
      // Commit failed BEFORE taking authority → the established old socket is
      // untouched. Roll back only this socket's reservation.
      this.admission.rollbackReservation(uid, reservation.priorIp);
      ws._authenticated = false;
      ws._authState = 'released';
      this.send(ws, { type: 'auth_error', message: 'Auth failed' });
      if (ws.close) ws.close();
      return;
    }

    // POST-COMMIT hooks — isolated. A failure here NEVER rolls back a committed
    // auth, removes authority, or emits a second outcome.
    try { this.m.logEvent('auth_success', { uid: uid?.slice(0, 8) || null }); } catch { /* telemetry isolated */ }
    try { if (this.firstPing) this.firstPing(ws); } catch { /* auth already committed */ }
  }

  // ── Close ────────────────────────────────────────────────────────────────
  onClose(ws) {
    this._clearAuthTimer(ws);
    this._releasePending(ws);
    const uid = ws._uid;
    // Conditional authoritative cleanup: only when THIS ws is still the
    // authoritative socket. A superseded socket's late close must NOT delete
    // the replacement, release its session, or reset its buckets.
    if (uid && this.socketByUid.get(uid) === ws) {
      this.socketByUid.delete(uid);
      this.admission.releaseSession(uid);
      this.rateLimiter.reset(`msg:${uid}`);
      this.rateLimiter.reset(`cha:${uid}`);
    }
    // handleDisconnect's own stale-close guards protect room state from a
    // superseded socket (it counts stale_socket_close_total and returns).
    this.rooms.handleDisconnect(ws);
  }

  // ── Periodic sweep (2A.8) ────────────────────────────────────────────────
  sweep(now = this.now()) {
    const ttl = this.cfg.TIMING.rate_bucket_idle_ttl_ms;
    this.rateLimiter.sweep(ttl, now);
    this.admission.sweepAttempts(ttl, now);
    this.rooms.sweepRoomBudgets(ttl, now);
  }
}
