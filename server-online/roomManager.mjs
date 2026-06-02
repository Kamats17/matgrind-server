// Authoritative online server: room manager.
//
// The server owns matchState, hands, RNGs, and challenge state. Clients
// are renderers + intent producers. Every state change runs through the
// engine on the server exactly once and is broadcast as state_update
// (privacy-scrubbed per recipient). Old "relay" semantics (round_picks,
// pin_picks, period_choice_made, match_ended) are gone.

import crypto from 'node:crypto';
import {
  createInitialMatchState,
  buildHand,
  rerollHand,
  resolveRound,
  resolvePinStage1,
  resolvePinStage2,
  resolvePinStage3,
  applyPeriodChoice,
  PIN_OFFENSE_CARDS,
  PIN_DEFENSE_CARDS,
} from '../src/lib/wrestlingEngine.js';
import { CARDS } from '../src/lib/wrestlingCards.js';
import {
  MECHANIC_TYPES,
  getMechanicForCard,
  getMissResult,
  generateChallengeParams,
} from '../src/lib/cardArchetypeMechanics.js';
import { makeRng } from '../src/lib/seededRng.js';
import { serializeStateForRecipient, redactCrashDump } from './privacy.mjs';
import {
  startChallenge,
  recordChallengeInput,
  replayChallengeForReconnect,
  setChallengeRttCorrection,
} from './challengeEngine.mjs';
import { RttEstimator } from './rttEstimator.mjs';
import { buildResultRecord } from './resultLedger.mjs';
import { scheduleTimer, clearScheduled, destroyRoomTimers } from './timers.mjs';
import { RateLimiter } from './rateLimiter.mjs';
import { TIMING, HAND_SIZE, RATE_LIMITS } from './config.mjs';
import { incCounter, setGauge, logEvent } from './metrics.mjs';

const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function send(ws, msg) {
  // Non-throwing: a socket can flip to CLOSING between the readyState check and
  // ws.send during a race, which would otherwise throw into a caller mid-commit.
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket race during close */ }
  }
}

function sendError(ws, code, message) {
  send(ws, { type: 'error', code, message });
  // Diagnostic: per-error counter so /metrics.json shows what's failing,
  // plus a logEvent so /debug/recent shows the offending message context.
  incCounter('client_errors_total', { code });
  logEvent('client_error', {
    code,
    message,
    role: ws?._role || null,
    room: ws?._roomCode || null,
    uid: ws?._uid?.slice(0, 8) || null,
  });
}

function rngU32() {
  return crypto.randomBytes(4).readUInt32BE();
}

export class RoomManager {
  constructor({ roomLimiter, onMatchResult } = {}) {
    this.rooms = new Map();        // code → room
    this.playerRooms = new Map();  // uid → code
    this.matchmakingQueue = [];    // [{ ws, uid, name, style, joinedAt }]
    // room:${uid} create-rate budget (2A.7). Separate limiter from the index
    // msg:/cha: one; room: keys are aged out by TTL only, never reset on
    // disconnect (a drop must not refund the create budget).
    this.roomLimiter = roomLimiter || new RateLimiter();
    // Stage 4: invoked once per finished match with the server-built result
    // record. index.mjs wires it to the idempotent Firestore write; default
    // no-op keeps RoomManager I/O-free + unit-testable.
    this.onMatchResult = onMatchResult || (() => {});
  }

  activeCount() {
    return this.rooms.size;
  }

  // Recompute room gauges from current state. Recompute (not increment) so
  // the gauges cannot drift when a deletion path is missed. `rooms_active`
  // counts only non-terminal rooms (waiting|playing); `rooms_resident`
  // counts everything still in the map (incl. retained terminal rooms).
  _refreshRoomGauges() {
    let resident = 0, active = 0;
    const byPhase = { waiting: 0, playing: 0, finished: 0, voided: 0 };
    for (const room of this.rooms.values()) {
      resident++;
      if (byPhase[room.phase] !== undefined) byPhase[room.phase]++;
      if (room.phase === 'waiting' || room.phase === 'playing') active++;
    }
    setGauge('rooms_resident', resident);
    setGauge('rooms_active', active);
    for (const p of ['waiting', 'playing', 'finished', 'voided']) {
      setGauge('rooms_by_phase', byPhase[p], { phase: p });
    }
  }

  // Single choke point for every room phase transition so the phase gauges
  // stay accurate (start, finish, void, rematch reset). Also stamps/clears
  // `terminalAt` so the sweep policy can retain terminal rooms long enough
  // for late reconnect notices, then clean them up — and a rematch (return
  // to a live phase) clears the stamp so the room is not swept mid-rematch.
  _setRoomPhase(room, nextPhase) {
    room.phase = nextPhase;
    if (nextPhase === 'finished' || nextPhase === 'voided') {
      if (room.terminalAt == null) room.terminalAt = Date.now();
    } else {
      room.terminalAt = null;
    }
    this._refreshRoomGauges();
  }

  // ── Room lifecycle ────────────────────────────────────────────────────

  // Consume one unit of the per-uid room-creation budget. Returns false when
  // the uid is over create_room_per_min. Used by the single guarded allocator
  // so manual, matchmaking, and friend-challenge creation share one quota.
  _consumeRoomBudget(uid) {
    return this.roomLimiter.consume(
      `room:${uid}`,
      RATE_LIMITS.create_room_per_min / 60,
      RATE_LIMITS.create_room_per_min,
    );
  }

  // Periodic eviction of idle room: budgets (wired into index's sweep interval
  // in Batch 6). room: keys are aged out ONLY here — never on disconnect, so a
  // drop cannot refund the create budget.
  sweepRoomBudgets(idleMs, now = Date.now()) {
    return this.roomLimiter.sweep(idleMs, now);
  }

  // The code of an ACTIVE room the uid is a player in (host/guest), or null.
  // A voided room does NOT count — its mapping is retained only so a late
  // reconnect can be told 'match_voided', and must never block a fresh room.
  // A finished room DOES count (a player sitting on the result screen is still
  // in it until the room is deliberately closed).
  _activeRoomCodeOf(uid) {
    const code = this.playerRooms.get(uid);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    if (room.phase === 'voided') return null;
    return code;
  }

  // The code of a room this uid is spectating, or null. Returns the code (not
  // a boolean) so spectateRoom can distinguish a same-room reconnect (allowed,
  // replaces the socket) from a switch to a different room (rejected).
  _spectatorRoomCodeOf(uid) {
    for (const room of this.rooms.values()) {
      if (room.spectators.has(uid)) return room.code;
    }
    return null;
  }

  // Single guarded room allocator (2A.7). The ONLY entry production message
  // handlers should use to create a room — manual rooms AND friend challenges
  // both arrive as create_room and route here. Matchmaking charges both uids
  // itself (see findMatch) and calls the internal createRoom directly.
  // Enforces membership, then the per-uid room budget.
  allocateRoom(ws, playerName, style) {
    if (this._activeRoomCodeOf(ws._uid)) return { error: 'already_in_room' };
    if (this._spectatorRoomCodeOf(ws._uid)) return { error: 'already_spectating' };
    if (!this._consumeRoomBudget(ws._uid)) return { error: 'rate_limited' };
    const code = this.createRoom(ws, playerName, style);
    return { code };
  }

  // INTERNAL low-level room creation. Bypasses the budget + membership guard,
  // so production handlers must go through allocateRoom (or matchmaking, which
  // validates both budgets first). Tests may call it directly.
  createRoom(ws, playerName, style) {
    let code;
    do { code = generateCode(); } while (this.rooms.has(code));
    const room = this._makeRoom(code, style);
    room.host = { ws, uid: ws._uid, name: playerName || 'Player 1' };
    this.rooms.set(code, room);
    this.playerRooms.set(ws._uid, code);
    ws._roomCode = code;
    ws._role = 'p1';
    incCounter('rooms_total');
    this._refreshRoomGauges();
    logEvent('room_created', {
      room: code, hostUid: ws._uid?.slice(0, 8), style,
    });
    return code;
  }

  joinRoom(ws, code, playerName) {
    code = (code || '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.guest) return { error: 'Room is full' };
    if (room.host.uid === ws._uid) return { error: 'Cannot join your own room' };
    // Membership (2A.9): can't join while already a player in another active
    // room, nor while spectating (leave spectate first).
    const mine = this._activeRoomCodeOf(ws._uid);
    if (mine && mine !== code) return { error: 'already_in_room' };
    if (this._spectatorRoomCodeOf(ws._uid)) return { error: 'already_spectating' };
    // The waiting host dropped and is in reconnect grace — reject the join
    // until they return rather than starting a match against an absent host.
    if (!room.host.ws) return { error: 'host_unavailable' };

    room.guest = { ws, uid: ws._uid, name: playerName || 'Player 2' };
    room.lastActivity = Date.now();
    this.playerRooms.set(ws._uid, code);
    ws._roomCode = code;
    ws._role = 'p2';

    logEvent('room_joined', {
      room: code, guestUid: ws._uid?.slice(0, 8),
    });
    // Notify both players, then start the match.
    send(room.host.ws, { type: 'opponent_joined', opponent: room.guest.name, player: 'p1' });
    send(room.guest.ws, { type: 'opponent_joined', opponent: room.host.name, player: 'p2' });
    this._startMatch(room);

    return { ok: true };
  }

  spectateRoom(ws, code) {
    code = (code || '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    // Membership (2A.9): can't spectate a match you are a player in.
    if (this._activeRoomCodeOf(ws._uid)) return { error: 'already_in_room' };
    // A same-room reconnect is fine (replaces the socket below); spectating a
    // DIFFERENT room while already spectating is rejected.
    const specCode = this._spectatorRoomCodeOf(ws._uid);
    if (specCode && specCode !== code) return { error: 'already_spectating' };

    // Spectators keyed by uid so reconnect can find existing slot.
    if (!room.spectators.has(ws._uid)) {
      room.spectators.set(ws._uid, { ws, uid: ws._uid });
    } else {
      // Reconnect: replace ws.
      room.spectators.get(ws._uid).ws = ws;
    }
    ws._roomCode = code;
    ws._role = 'spectator';

    // Send current state immediately.
    send(ws, {
      type: 'spectate_joined',
      p1Name: room.host?.name || 'Player 1',
      p2Name: room.guest?.name || 'Player 2',
      style: room.style,
      phase: room.phase,
    });
    if (room.matchState) {
      this._sendStateUpdateTo(room, ws, 'spectator', null);
    }
    return { ok: true };
  }

  // ── Matchmaking ───────────────────────────────────────────────────────

  // Consume-first one-shot resume (2A.10 / correction 1). Called for EVERY
  // routed non-pong app frame BEFORE the message rate-limit, so a rate-limited,
  // unknown, invalid, or wrong-room first frame still consumes eligibility — it
  // can never be preserved for a LATER find_match. Returns true ONLY when this
  // was a valid eligible find_match that was fully replayed; the caller then
  // returns without rate-limiting or further routing (the resume is a
  // legitimate reconnect action, not subject to the message rate limit). pong
  // never consumes.
  consumeLegacyResume(ws, type) {
    if (type === 'pong') return false;
    const elig = ws._legacyResumeEligible;
    if (!elig) return false;
    ws._legacyResumeEligible = null;            // first non-pong frame consumes, always
    if (type === 'find_match' && this._legacyResumeValid(ws, elig)) {
      this._resumeLegacyMatchHandoff(ws, elig.roomCode);
      return true;
    }
    return false;
  }

  // True only if the eligibility is unexpired AND ws is still the installed
  // player socket of the SAME, still-playing room. Guards against a stray or
  // hostile find_match replaying game_start (which the client reads as a
  // rematch reset — Addendum A1).
  _legacyResumeValid(ws, elig) {
    if (!elig || Date.now() > elig.expiresAt) return false;
    const code = this._activeRoomCodeOf(ws._uid);
    if (!code || code !== elig.roomCode) return false;
    const room = this.rooms.get(code);
    if (!room || room.phase !== 'playing') return false;
    const installed = room.host?.uid === ws._uid ? room.host.ws
      : room.guest?.uid === ws._uid ? room.guest.ws : null;
    return installed === ws;
  }

  // Replay the active match to a reconnecting legacy client that re-sent
  // find_match. Does NOT allocate, queue, or mutate room state — pure replay:
  //   1. game_start with the ORIGINAL initialInitiative + names/style/role
  //   2. targeted state_update WITHOUT bumping roundSeq
  //   3. active challenge replay if one is in flight
  _resumeLegacyMatchHandoff(ws, code) {
    const room = this.rooms.get(code);
    if (!room) return;
    const role = room.host?.uid === ws._uid ? 'p1'
      : room.guest?.uid === ws._uid ? 'p2' : null;
    if (!role) return;
    send(ws, {
      type: 'game_start',
      player: role,
      p1Name: room.host?.name,
      p2Name: room.guest?.name,
      style: room.style,
      initialInitiative: room.initialInitiative,
    });
    if (room.matchState) this._sendStateUpdateTo(room, ws, role, ws._uid);
    const ch = room.challenges[role];
    if (ch) replayChallengeForReconnect(ch, (m) => send(ws, m));
    incCounter('legacy_find_match_resume_total');
  }

  findMatch(ws, playerName, style) {
    // Legacy one-shot resume (2A.10): handled here for direct callers; via the
    // controller the same consume already ran before the rate-limit. A valid
    // eligible resume returns true (already replayed) and we stop.
    if (this.consumeLegacyResume(ws, 'find_match')) return;

    // Membership (2A.9): a player already in an active room — or spectating —
    // cannot queue.
    if (this._activeRoomCodeOf(ws._uid)) return sendError(ws, 'already_in_room', 'Already in a match');
    if (this._spectatorRoomCodeOf(ws._uid)) return sendError(ws, 'already_spectating', 'Leave spectate first');

    const requestedStyle = style || 'folkstyle';
    const enqueue = () => {
      this.matchmakingQueue.push({
        ws, uid: ws._uid, name: playerName || 'Player',
        style: requestedStyle, joinedAt: Date.now(),
      });
      send(ws, { type: 'matchmaking_queued', position: this.matchmakingQueue.length });
    };

    // Idempotent queue replacement for this uid + drop dead sockets.
    this.matchmakingQueue = this.matchmakingQueue.filter(
      e => e.uid !== ws._uid && e.ws.readyState === 1,
    );
    const matchIndex = this.matchmakingQueue.findIndex(
      e => e.style === requestedStyle && e.ws.readyState === 1,
    );
    if (matchIndex < 0) return enqueue();

    const opponent = this.matchmakingQueue[matchIndex];
    // Opponent must still be matchable: not in a room AND not spectating. If
    // they became incompatible while queued, drop the stale entry and queue
    // the requester instead.
    if (this._activeRoomCodeOf(opponent.uid) || this._spectatorRoomCodeOf(opponent.uid)) {
      this.matchmakingQueue.splice(matchIndex, 1);
      return enqueue();
    }

    // Validate BOTH room budgets WITHOUT consuming (Guardrail 7). If the
    // requester is over quota, reject ONLY them; leave the opponent queued.
    const refill = RATE_LIMITS.create_room_per_min / 60;
    const burst = RATE_LIMITS.create_room_per_min;
    if (!this.roomLimiter.canConsume(`room:${ws._uid}`, refill, burst)) {
      return sendError(ws, 'rate_limited', 'Too many rooms, slow down');
    }
    if (!this.roomLimiter.canConsume(`room:${opponent.uid}`, refill, burst)) {
      // Opponent over quota: drop them (notify) and queue the requester so a
      // healthy opponent can still match.
      this.matchmakingQueue.splice(matchIndex, 1);
      sendError(opponent.ws, 'rate_limited', 'Too many rooms, slow down');
      return enqueue();
    }

    // Both have budget. Create + join; the opponent is removed from the queue
    // ONLY after a successful join, so a failed join leaves the INNOCENT
    // opponent queued exactly as-is (same entry, ws, joinedAt) and charges
    // nobody (A6 / Guardrail 7). Only the requester is rejected.
    const code = this.createRoom(opponent.ws, opponent.name, opponent.style);
    const result = this.joinRoom(ws, code, playerName || 'Player');
    if (result.error) {
      this.destroyRoom(code);                  // orphan cleanup (2A.9)
      opponent.ws._roomCode = null;            // undo createRoom side-effects
      opponent.ws._role = null;
      return sendError(ws, 'matchmaking_failed', result.error);
    }
    this.matchmakingQueue.splice(matchIndex, 1);
    this.roomLimiter.tryConsumeMany([`room:${ws._uid}`, `room:${opponent.uid}`], refill, burst);
  }

  cancelMatchmaking(ws) {
    this.matchmakingQueue = this.matchmakingQueue.filter(e => e.uid !== ws._uid);
    send(ws, { type: 'matchmaking_cancelled' });
  }

  getQueueSize() { return this.matchmakingQueue.length; }

  cleanupMatchmakingQueue() {
    const now = Date.now();
    const TIMEOUT = 600000;
    this.matchmakingQueue = this.matchmakingQueue.filter(e => {
      if (now - e.joinedAt > TIMEOUT) {
        send(e.ws, { type: 'matchmaking_timeout', message: 'No opponent found. Try again.' });
        return false;
      }
      if (e.ws.readyState !== 1) return false;
      return true;
    });
  }

  // ── Game messages ─────────────────────────────────────────────────────

  handleGameMessage(ws, msg) {
    const code = ws._roomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    room.lastActivity = Date.now();

    const role = ws._role;
    if (role === 'spectator') return; // spectators never send game messages
    if (role !== 'p1' && role !== 'p2') return;

    if (room.phase === 'voided') {
      sendError(ws, 'wrong_phase', 'Match has been voided');
      return;
    }

    switch (msg?.type) {
      case 'card_pick':         return this._handleCardPick(room, role, ws, msg);
      case 'pin_pick':          return this._handlePinPick(room, role, ws, msg);
      case 'period_choice':     return this._handlePeriodChoice(room, role, ws, msg);
      case 'request_reroll':    return this._handleRequestReroll(room, role, ws, msg);
      case 'challenge_input':   return this._handleChallengeInput(room, role, ws, msg);
      case 'match_accept':      return this._handleMatchAccept(room, role);
      case 'rematch':           return this._handleRematch(room, role, ws);
      case 'rematch_decline':   return this._handleRematchDecline(room, role, ws);
      case 'config':            return this._handleConfig(room, role, ws, msg);
      default:
        sendError(ws, 'unknown_message_type', `Unknown type: ${msg?.type}`);
    }
  }

  // ── Match start / state update broadcast ──────────────────────────────

  _makeRoom(code, style) {
    return {
      code,
      style: style || 'folkstyle',
      phase: 'waiting',                 // waiting | playing | finished | voided
      host: null,
      guest: null,
      spectators: new Map(),            // uid -> { ws, uid }
      // RNGs
      seed: 0,
      engineRng: null,
      challengeRngP1: null,
      challengeRngP2: null,
      // Engine state
      matchState: null,
      roundSeq: 0,
      hands: { p1: [], p2: [] },
      preGeneratedChallenges: { p1: {}, p2: {} },
      // Per-role accepted-intent: flipped true the first time a validated
      // gameplay frame lands (card/pin/period/reroll/challenge input). Reset
      // on rematch.
      acceptedIntent: { p1: false, p2: false },
      // Per-role explicit match-accept (Stage 3): set when the client sends
      // match_accept (the player committed to the found match). Lets the server
      // honestly classify a no-show (never accepted) vs a started-match drop,
      // even before any gameplay frame. Reset on rematch.
      matchAccepted: { p1: false, p2: false },
      // Pending input
      pendingPicks: { p1: null, p2: null },
      pendingPinPicks: { offense: null, defense: null },
      pinBurned: { offense: new Set(), defense: new Set() },
      // Active challenges + their resolved skill results
      challenges: { p1: null, p2: null },
      skillResults: { p1: null, p2: null },
      // Disconnect-cancel notices are replayed on reconnect even if the
      // opponent resolved the round while this player was offline.
      cancelledChallengeNotices: { p1: null, p2: null },
      // Budgets
      rerollsLeft: { p1: 2, p2: 2 },
      // Match end / rematch
      rematchVotes: { p1: null, p2: null },  // null | true | false
      matchEndedAt: null,
      terminalAt: null,                 // set when phase -> finished|voided
      initialInitiative: null,          // stored at _startMatch for shim replay
      matchId: null,                    // Stage 4: stable id per match (set at _startMatch)
      ledgerWritten: false,             // Stage 4: result emitted once per match

      // Networking
      rttEstimators: new Map(),         // uid -> RttEstimator
      reconnectTimers: { p1: null, p2: null },
      periodChoiceDeadlineTimer: null,
      allTimers: new Set(),
      lastActivity: Date.now(),
      createdAt: Date.now(),
    };
  }

  _startMatch(room) {
    // Stage 4: a fresh, stable id per match (a rematch is a new match) and a
    // re-armed ledger so the next finish writes its own authoritative record.
    room.matchId = crypto.randomUUID();
    room.ledgerWritten = false;
    this._setRoomPhase(room, 'playing');
    room.seed = rngU32();
    room.engineRng = makeRng(room.seed);
    room.challengeRngP1 = makeRng(rngU32());   // independent, prevents RNG-state-reverse attacks
    room.challengeRngP2 = makeRng(rngU32());
    const initialInitiative = room.engineRng() < 0.5 ? 'p1' : 'p2';
    // Persist so the legacy-resume shim (2A.10) can replay the ORIGINAL
    // game_start payload instead of re-rolling a fresh initiative.
    room.initialInitiative = initialInitiative;
    room.matchState = createInitialMatchState(
      room.host.name, room.guest.name, room.style,
      null, null, 'medium', initialInitiative,
    );
    this._dealHands(room);
    room.roundSeq = 0;

    // game_start parity message (clients listen for this in lobby)
    const startMsg = (player) => ({
      type: 'game_start',
      player,
      p1Name: room.host.name,
      p2Name: room.guest.name,
      style: room.style,
      initialInitiative,
    });
    send(room.host.ws, startMsg('p1'));
    send(room.guest.ws, startMsg('p2'));
    for (const s of room.spectators.values()) send(s.ws, startMsg('spectator'));

    this._broadcastStateUpdate(room);
  }

  _dealHands(room) {
    const s = room.matchState;
    room.hands.p1 = buildHand(s.p1.position, s.p1Conditions, HAND_SIZE, s.wrestlingStyle);
    room.hands.p2 = buildHand(s.p2.position, s.p2Conditions, HAND_SIZE, s.wrestlingStyle);
    room.preGeneratedChallenges.p1 = this._preGenerate(room.hands.p1, room.challengeRngP1);
    room.preGeneratedChallenges.p2 = this._preGenerate(room.hands.p2, room.challengeRngP2);
  }

  _preGenerate(hand, rng) {
    // For each card in the hand with a non-NONE mechanic, generate
    // params now so the client renders the mini-game without round-trip
    // latency. Reaction params are stripped on send (server-secret).
    const out = {};
    for (const card of hand) {
      const mechanic = getMechanicForCard(card);
      if (mechanic === MECHANIC_TYPES.NONE) {
        out[card.id] = { kind: mechanic };
      } else {
        const params = generateChallengeParams(mechanic, rng);
        out[card.id] = { kind: mechanic, params };
      }
    }
    return out;
  }

  /** Strip reaction params from a side's preGen entries before sending. */
  _publicPreGen(preGen) {
    const out = {};
    for (const cardId of Object.keys(preGen)) {
      const entry = preGen[cardId];
      if (entry.kind === MECHANIC_TYPES.REACTION) {
        out[cardId] = { kind: entry.kind };   // params hidden
      } else {
        out[cardId] = entry;
      }
    }
    return out;
  }

  _broadcastStateUpdate(room) {
    room.roundSeq += 1;
    if (room.host?.ws) this._sendStateUpdateTo(room, room.host.ws, 'p1', room.host.uid);
    if (room.guest?.ws) this._sendStateUpdateTo(room, room.guest.ws, 'p2', room.guest.uid);
    for (const s of room.spectators.values()) {
      this._sendStateUpdateTo(room, s.ws, 'spectator', s.uid);
    }
  }

  _sendStateUpdateTo(room, ws, role, _uid) {
    if (!room.matchState) return;
    const handForRole = role === 'spectator' ? null
      : role === 'p1' ? room.hands.p1
      : room.hands.p2;
    const opponentHandSize = role === 'spectator' ? null
      : role === 'p1' ? room.hands.p2.length
      : room.hands.p1.length;
    const preGen = role === 'spectator' ? null
      : this._publicPreGen(role === 'p1' ? room.preGeneratedChallenges.p1 : room.preGeneratedChallenges.p2);
    send(ws, {
      type: 'state_update',
      roundSeq: room.roundSeq,
      state: serializeStateForRecipient(room.matchState, role),
      hand: handForRole,
      opponentHandSize,
      preGeneratedChallenges: preGen,
      spectator: role === 'spectator' ? true : undefined,
      matchEndedAt: room.matchEndedAt,
    });
  }

  // ── Card pick ─────────────────────────────────────────────────────────

  _handleCardPick(room, role, ws, msg) {
    if (!Number.isInteger(msg.roundSeq) || msg.roundSeq !== room.roundSeq) {
      return sendError(ws, 'wrong_round', `Expected roundSeq=${room.roundSeq}`);
    }
    if (typeof msg.cardId !== 'string' || msg.cardId.length === 0 || msg.cardId.length > 64) {
      return sendError(ws, 'invalid_payload', 'Bad cardId');
    }
    if (room.pendingPicks[role] !== null) {
      return sendError(ws, 'already_picked', 'Already submitted a card this round');
    }
    const phase = room.matchState?.phase;
    if (phase !== 'playing' && phase !== 'overtime') {
      return sendError(ws, 'wrong_phase', `Cannot card_pick in phase ${phase}`);
    }
    const hand = room.hands[role];
    const card = hand.find(c => c.id === msg.cardId);
    if (!card) {
      return sendError(ws, 'illegal_card', `Card ${msg.cardId} not in hand`);
    }

    room.pendingPicks[role] = msg.cardId;
    room.acceptedIntent[role] = true; // validated gameplay intent
    send(ws, { type: 'pick_acknowledged', roundSeq: room.roundSeq });

    const mechanic = getMechanicForCard(card);
    logEvent('card_pick', {
      room: room.code, role, cardId: msg.cardId, mechanic,
      roundSeq: room.roundSeq,
    });
    if (mechanic === MECHANIC_TYPES.NONE) {
      room.skillResults[role] = getMissResult();
      this._maybeResolveRound(room);
    } else {
      this._launchChallenge(room, role, card, mechanic);
    }
  }

  _launchChallenge(room, role, card, mechanic) {
    const ws = role === 'p1' ? room.host.ws : room.guest.ws;
    const uid = role === 'p1' ? room.host.uid : room.guest.uid;
    // Single source of truth: use the params already shipped to the client
    // via state_update.preGeneratedChallenges. Generating fresh params here
    // would diverge from what the client renders (Codex review #2).
    const preGen = room.preGeneratedChallenges[role]?.[card.id];
    const preGenParams = preGen?.params || null;
    const challenge = startChallenge({
      room,
      role,
      mechanic,
      cardId: card.id,
      preGenParams,
      sendToOwner: (m) => send(ws, m),
      onResolve: (c) => this._onChallengeResolved(room, role, c),
    });
    if (challenge) {
      // Wire RTT correction (used by reaction tier math).
      const rtt = room.rttEstimators.get(uid);
      if (rtt) setChallengeRttCorrection(challenge, rtt.smoothedMs);
      room.challenges[role] = challenge;
      logEvent('challenge_start', {
        room: room.code, role, cardId: card.id, mechanic,
        challengeId: challenge.id, deadline: challenge.deadline - Date.now(),
      });
    } else {
      logEvent('challenge_start_null', {
        room: room.code, role, cardId: card.id, mechanic,
      });
    }
  }

  _onChallengeResolved(room, role, challenge) {
    room.skillResults[role] = challenge.result;
    room.challenges[role] = null;
    // Stage 3.2: if the owner was offline when their challenge resolved
    // naturally, the live challenge_resolved never reached them. Stash the
    // genuine tier so reconnect replays the real result instead of a forced
    // MISS (reuses the cancelledChallengeNotices replay path).
    const member = role === 'p1' ? room.host : room.guest;
    if (member && member.ws === null) {
      room.cancelledChallengeNotices[role] = {
        roundSeq: room.roundSeq,
        tier: challenge.result?.tier || 'MISS',
      };
    }
    logEvent('challenge_resolved', {
      room: room.code, role,
      tier: challenge.result?.tier,
      challengeId: challenge.id,
    });
    this._maybeResolveRound(room);
  }

  _maybeResolveRound(room) {
    if (room.skillResults.p1 === null || room.skillResults.p2 === null) return;
    const p1Card = room.pendingPicks.p1;
    const p2Card = room.pendingPicks.p2;
    let next;
    try {
      next = resolveRound(
        room.matchState,
        p1Card, p2Card,
        room.skillResults.p1, room.skillResults.p2,
        room.engineRng,
      );
    } catch (err) {
      this._engineThrow(room, err, { p1Card, p2Card });
      return;
    }
    room.matchState = next;
    this._postResolveRound(room);
  }

  _postResolveRound(room) {
    // Clear per-round state.
    room.pendingPicks = { p1: null, p2: null };
    room.skillResults = { p1: null, p2: null };
    room.challenges = { p1: null, p2: null };

    const phase = room.matchState.phase;
    if (phase === 'pin_attempt') {
      // Entering pin: reset burned cards and pendingPinPicks.
      room.pinBurned = { offense: new Set(), defense: new Set() };
      room.pendingPinPicks = { offense: null, defense: null };
      // Hands are not used during pin; broadcast empty? Keep last hand.
    } else if (phase === 'period_break') {
      this._startPeriodChoiceDeadline(room);
    } else if (phase === 'finished') {
      // Sync room lifecycle phase with engine phase so rematch unlocks.
      // Without this the rematch handler reads room.phase='playing' and
      // rejects the request even though the match is genuinely over.
      this._setRoomPhase(room, 'finished');
      room.matchEndedAt = Date.now();
      this._emitMatchResult(room);
    }

    if (phase === 'playing' || phase === 'overtime') {
      this._dealHands(room);
    }
    this._broadcastStateUpdate(room);
  }

  // ── Pin pick ─────────────────────────────────────────────────────────

  _handlePinPick(room, role, ws, msg) {
    if (!Number.isInteger(msg.roundSeq) || msg.roundSeq !== room.roundSeq) {
      return sendError(ws, 'wrong_round');
    }
    if (room.matchState?.phase !== 'pin_attempt') {
      return sendError(ws, 'wrong_phase', 'Not in pin attempt');
    }
    const side = msg.role;
    if (side !== 'offense' && side !== 'defense') {
      return sendError(ws, 'invalid_payload', 'role must be offense or defense');
    }
    if (typeof msg.cardId !== 'string' || msg.cardId.length === 0 || msg.cardId.length > 64) {
      return sendError(ws, 'invalid_payload', 'Bad cardId');
    }
    if (room.pendingPinPicks[side] !== null) {
      return sendError(ws, 'already_picked', 'Already submitted pin pick');
    }

    const attacker = room.matchState.pinAttempt?.attacker;
    if (!attacker) return sendError(ws, 'wrong_phase', 'No attacker assigned');
    const expectedRole = side === 'offense' ? attacker : (attacker === 'p1' ? 'p2' : 'p1');
    if (role !== expectedRole) {
      return sendError(ws, 'not_your_turn', `Cannot pin_pick ${side}`);
    }

    const pool = side === 'offense' ? PIN_OFFENSE_CARDS : PIN_DEFENSE_CARDS;
    if (!pool[msg.cardId]) {
      return sendError(ws, 'illegal_card', `Not a ${side} card`);
    }
    // Only DEFENSE cards burn across stages - the engine
    // (resolvePinStage2 / resolvePinStage3) tracks burnedDefCards and
    // rejects re-use, but it intentionally does NOT track burned offense
    // cards. The attacker can pin_lock_position at stage 1 AND stage 2.
    // Burning offense server-side would freeze any round where the
    // attacker happens to repeat a card (the client UI doesn't gray out
    // burned offense cards either, so the user picks one and gets stuck
    // when the server rejects).
    if (side === 'defense' && room.pinBurned.defense.has(msg.cardId)) {
      return sendError(ws, 'pin_card_burned', `Card ${msg.cardId} was used in a prior stage`);
    }

    if (side === 'defense') room.pinBurned.defense.add(msg.cardId);
    room.pendingPinPicks[side] = msg.cardId;
    room.acceptedIntent[role] = true; // validated gameplay intent
    send(ws, { type: 'pick_acknowledged', roundSeq: room.roundSeq });
    logEvent('pin_pick', {
      room: room.code, role, side, cardId: msg.cardId,
      stage: room.matchState.pinAttempt?.stage,
      roundSeq: room.roundSeq,
      bothReady: !!(room.pendingPinPicks.offense && room.pendingPinPicks.defense),
    });

    if (room.pendingPinPicks.offense && room.pendingPinPicks.defense) {
      const stage = room.matchState.pinAttempt.stage ?? 1;
      const off = room.pendingPinPicks.offense;
      const def = room.pendingPinPicks.defense;
      let next;
      try {
        const resolver = stage === 1 ? resolvePinStage1
          : stage === 2 ? resolvePinStage2
          : resolvePinStage3;
        next = resolver(room.matchState, off, def, room.engineRng);
      } catch (err) {
        this._engineThrow(room, err, { off, def, stage });
        return;
      }
      logEvent('pin_resolved', {
        room: room.code, stage, off, def,
        nextPhase: next?.phase,
        nextStage: next?.pinAttempt?.stage ?? null,
        winner: next?.winner ?? null,
      });
      room.matchState = next;
      this._postResolvePin(room);
    }
  }

  _postResolvePin(room) {
    room.pendingPinPicks = { offense: null, defense: null };
    const phase = room.matchState.phase;
    if (phase !== 'pin_attempt') {
      // Pin ended (escape, pin, or clock-driven period break) - reset burned.
      room.pinBurned = { offense: new Set(), defense: new Set() };
      if (phase === 'playing' || phase === 'overtime') {
        this._dealHands(room);
      } else if (phase === 'period_break') {
        // (Codex P2) Pin clock can expire mid-pin and dump us into a
        // period break. Mirror _postResolveRound's deadline so the
        // 30s AFK default-pick still fires here.
        this._startPeriodChoiceDeadline(room);
      } else if (phase === 'finished') {
        // Sync room.phase with engine phase so rematch unlocks (Codex #4).
        this._setRoomPhase(room, 'finished');
        room.matchEndedAt = Date.now();
        this._emitMatchResult(room);
      }
    }
    this._broadcastStateUpdate(room);
  }

  // ── Period choice ────────────────────────────────────────────────────

  _handlePeriodChoice(room, role, ws, msg) {
    if (!Number.isInteger(msg.roundSeq) || msg.roundSeq !== room.roundSeq) {
      return sendError(ws, 'wrong_round');
    }
    if (room.matchState?.phase !== 'period_break') {
      return sendError(ws, 'wrong_phase', 'Not in period break');
    }
    if (room.matchState.pendingChoiceFor !== role) {
      return sendError(ws, 'not_your_turn');
    }
    const choice = msg.choice;
    if (!['top', 'bottom', 'neutral', 'defer'].includes(choice)) {
      return sendError(ws, 'invalid_payload', 'Bad choice');
    }
    room.acceptedIntent[role] = true; // validated gameplay intent
    this._cancelPeriodChoiceDeadline(room);
    this._applyPeriodChoiceAndBroadcast(room, role, choice);
  }

  _applyPeriodChoiceAndBroadcast(room, chooser, choice) {
    let next;
    try {
      next = applyPeriodChoice(room.matchState, chooser, choice);
    } catch (err) {
      this._engineThrow(room, err, { chooser, choice });
      return;
    }
    room.matchState = next;
    if (room.matchState.phase === 'period_break') {
      // applyPeriodChoice may set state up for the OTHER side to choose
      // (defer path). Restart the deadline.
      this._startPeriodChoiceDeadline(room);
    } else if (room.matchState.phase === 'playing' || room.matchState.phase === 'overtime') {
      this._dealHands(room);
    }
    this._broadcastStateUpdate(room);
  }

  _startPeriodChoiceDeadline(room) {
    this._cancelPeriodChoiceDeadline(room);
    room.periodChoiceDeadlineTimer = scheduleTimer(room, () => {
      const chooser = room.matchState?.pendingChoiceFor;
      if (!chooser) return;
      // Default: 'neutral' is a safe rules-default.
      const defaulted = 'neutral';
      send(room.host?.ws, { type: 'period_choice_timeout', defaultedTo: defaulted });
      send(room.guest?.ws, { type: 'period_choice_timeout', defaultedTo: defaulted });
      this._applyPeriodChoiceAndBroadcast(room, chooser, defaulted);
    }, TIMING.period_choice_deadline_ms);
  }

  _cancelPeriodChoiceDeadline(room) {
    if (room.periodChoiceDeadlineTimer) {
      clearScheduled(room, room.periodChoiceDeadlineTimer);
      room.periodChoiceDeadlineTimer = null;
    }
  }

  // ── Reroll ───────────────────────────────────────────────────────────

  _handleRequestReroll(room, role, ws, msg) {
    if (!Number.isInteger(msg.roundSeq) || msg.roundSeq !== room.roundSeq) {
      return sendError(ws, 'wrong_round');
    }
    const phase = room.matchState?.phase;
    if (phase !== 'playing' && phase !== 'overtime') {
      return sendError(ws, 'wrong_phase');
    }
    if (room.pendingPicks[role]) {
      return sendError(ws, 'already_picked', 'Cannot reroll after locking pick');
    }
    if (room.challenges[role]) {
      // Challenge in progress for this role
      return sendError(ws, 'wrong_phase', 'Cannot reroll mid-challenge');
    }
    const left = room.rerollsLeft[role];
    if (left <= 0) return sendError(ws, 'rate_limited', 'No rerolls remaining');

    room.rerollsLeft[role] = left - 1;
    room.acceptedIntent[role] = true; // validated gameplay intent
    // Server-authoritative hand rebuild.
    const s = room.matchState;
    const wrestler = role === 'p1' ? s.p1 : s.p2;
    const conditions = role === 'p1' ? s.p1Conditions : s.p2Conditions;
    const newHand = rerollHand(room.hands[role], wrestler.position, conditions, HAND_SIZE, s.wrestlingStyle);
    room.hands[role] = newHand;
    const rng = role === 'p1' ? room.challengeRngP1 : room.challengeRngP2;
    room.preGeneratedChallenges[role] = this._preGenerate(newHand, rng);

    const myWs = role === 'p1' ? room.host.ws : room.guest.ws;
    const otherWs = role === 'p1' ? room.guest.ws : room.host.ws;
    send(myWs, { type: 'reroll_granted', rerollsLeft: room.rerollsLeft[role] });
    if (otherWs) send(otherWs, { type: 'opponent_rerolled', role, rerollsLeft: room.rerollsLeft[role] });

    // Push a state_update so the rerolling client sees the new hand +
    // preGen challenges (without bumping roundSeq away from the active
    // round — both pickers are still expected to use roundSeq=N).
    // We send a targeted state_update to the rerolling player only.
    this._sendStateUpdateTo(room, myWs, role);
  }

  // ── Challenge input ──────────────────────────────────────────────────

  _handleChallengeInput(room, role, ws, msg) {
    const challenge = room.challenges[role];
    if (!challenge || challenge.state !== 'active') {
      return; // silently drop stale input
    }
    // Server routes by (uid, roomCode); ignore client-supplied challengeId
    // for routing — only used for cross-check logging if mismatched.
    if (typeof msg.challengeId === 'string' && msg.challengeId !== challenge.id) {
      // Mismatched id but valid current challenge — accept the input
      // but log for telemetry. (Client-side stale challenge bug, not a
      // cheat that affects outcome.)
      // [metrics: challenge_id_mismatch++]
    }
    const accepted = recordChallengeInput(challenge, { eventType: msg.eventType, payload: msg.payload });
    // Only a frame the engine actually accepted counts as intent — a
    // rate-limited / pre-arrival / wrong-state input is dropped and is NOT
    // evidence the player engaged with the match.
    if (accepted) room.acceptedIntent[role] = true;
  }

  // Explicit match-accept (Stage 3). The client sends this the moment the
  // player commits to the found match (consumeMatch), BEFORE any gameplay
  // frame. It marks the role as engaged so a later drop is classified as a
  // started-match disconnect, not a no-show.
  _handleMatchAccept(room, role) {
    room.matchAccepted[role] = true;
  }

  // ── Match end / rematch ──────────────────────────────────────────────

  _handleRematch(room, role, ws) {
    if (room.phase !== 'finished') {
      return sendError(ws, 'wrong_phase', 'Match is not finished');
    }
    if (room.rematchVotes[role] === false) {
      return sendError(ws, 'wrong_phase', 'You declined this rematch');
    }
    if (room.rematchVotes[role] === true) {
      return; // already voted yes; idempotent
    }
    room.rematchVotes[role] = true;
    send(ws, { type: 'rematch_pending' });
    const otherRole = role === 'p1' ? 'p2' : 'p1';
    if (room.rematchVotes[otherRole] === true) {
      // Reset for next match.
      this._resetRoomForRematch(room);
      this._startMatch(room);
    } else {
      const otherWs = role === 'p1' ? room.guest?.ws : room.host?.ws;
      if (otherWs) send(otherWs, { type: 'rematch_requested' });
    }
  }

  _handleRematchDecline(room, role, ws) {
    room.rematchVotes[role] = false;
    const otherRole = role === 'p1' ? 'p2' : 'p1';
    const otherWs = role === 'p1' ? room.guest?.ws : room.host?.ws;
    if (room.rematchVotes[otherRole] === true && otherWs) {
      send(otherWs, { type: 'rematch_declined' });
    }
  }

  _resetRoomForRematch(room) {
    destroyRoomTimers(room);
    room.allTimers = new Set();
    room.matchState = null;
    room.roundSeq = 0;
    room.hands = { p1: [], p2: [] };
    room.preGeneratedChallenges = { p1: {}, p2: {} };
    room.pendingPicks = { p1: null, p2: null };
    room.pendingPinPicks = { offense: null, defense: null };
    room.pinBurned = { offense: new Set(), defense: new Set() };
    room.challenges = { p1: null, p2: null };
    room.skillResults = { p1: null, p2: null };
    room.cancelledChallengeNotices = { p1: null, p2: null };
    room.acceptedIntent = { p1: false, p2: false }; // fresh match starts pre-intent
    room.matchAccepted = { p1: false, p2: false };  // and unaccepted (Stage 3)
    room.rerollsLeft = { p1: 2, p2: 2 };
    room.rematchVotes = { p1: null, p2: null };
    room.matchEndedAt = null;
    room.periodChoiceDeadlineTimer = null;
  }

  _handleConfig(room, role, ws, msg) {
    const name = typeof msg.name === 'string' ? msg.name.slice(0, 30) : null;
    if (role === 'p1' && room.host && name) room.host.name = name;
    if (role === 'p2' && room.guest && name) room.guest.name = name;
    if (msg.style && room.phase === 'waiting') {
      const validStyles = ['folkstyle', 'freestyle', 'greco', 'womens_freestyle'];
      if (validStyles.includes(msg.style)) room.style = msg.style;
    }
  }

  // ── Engine throw / void ──────────────────────────────────────────────

  _engineThrow(room, err, inputs) {
    console.error('[ENGINE THROW]', { code: room.code, error: err?.message, inputs });
    incCounter('engine_throws_total', { reason: 'engine_throw' });
    const dump = redactCrashDump({
      error: { message: err?.message, stack: err?.stack },
      matchState: room.matchState,
      inputs,
    });
    // No retry: engine is deterministic; same inputs would throw the
    // same way. Void the room and let users start fresh.
    this._voidRoom(room, 'engine_throw', dump);
  }

  // Stage 4: emit the authoritative result exactly once when a match finishes.
  // The record is built from the engine's matchState (server-owned); a client
  // cannot mutate the outcome. Idempotent within the process via ledgerWritten;
  // the Firestore create (keyed by matchId) guards cross-process replay. The
  // emit is isolated — a ledger failure must never affect gameplay.
  _emitMatchResult(room) {
    if (room.ledgerWritten) return;
    room.ledgerWritten = true;
    let built;
    try {
      built = buildResultRecord(room, Date.now());
    } catch (e) {
      console.error('[result-ledger] build failed (isolated):', e?.message);
      return;
    }
    // onMatchResult settles authoritatively (creates the ledger + updates both
    // online_progress docs) and resolves to { receipts }. Push each player their
    // trusted match_settled receipt over the live socket; offline players pick it
    // up via the Firestore fallback read. Isolated — settlement failure must
    // never affect gameplay. The call itself is synchronous; only receipt
    // delivery awaits the settlement promise.
    let settlement;
    try {
      settlement = this.onMatchResult(built);
    } catch (e) {
      console.error('[result-ledger] settlement failed (isolated):', e?.message);
      return;
    }
    Promise.resolve(settlement)
      .then((res) => {
        const receipts = (res && res.receipts) || [];
        for (const receipt of receipts) this._sendMatchSettled(room, receipt);
      })
      .catch((e) => console.error('[result-ledger] settlement failed (isolated):', e?.message));
  }

  // Deliver a trusted reward receipt to its owner's currently-connected socket.
  // The values are server-computed (onlineRewards) — the client cannot influence
  // them. A disconnected owner (ws === null) gets nothing here and reconciles via
  // the Firestore online_progress fallback on reconnect/reload.
  _sendMatchSettled(room, receipt) {
    if (!receipt || !receipt.uid) return;
    const member = room.host?.uid === receipt.uid ? room.host
      : room.guest?.uid === receipt.uid ? room.guest
        : null;
    if (!member || !member.ws) return;
    send(member.ws, {
      type: 'match_settled',
      matchId: receipt.matchId,
      onlineProgress: receipt.onlineProgress,
      xpEarned: receipt.xpEarned,
      achievementIds: receipt.achievementIds,
    });
  }

  _voidRoom(room, reason, extra = {}) {
    if (room.phase === 'voided') return;
    // Capture the phase BEFORE flipping to 'voided' so telemetry reflects
    // what the match was actually doing (a waiting-room abandon and an
    // in-progress drop must not collapse into the same number).
    const priorPhase = room.phase;
    this._setRoomPhase(room, 'voided');
    destroyRoomTimers(room);
    incCounter('matches_voided_total', { reason, phase: priorPhase });
    logEvent('void', {
      room: room.code, reason,
      roundSeq: room.roundSeq,
      matchPhase: room.matchState?.phase || null,
    });
    // NOTE: we deliberately leave playerRooms entries in place. Clearing
    // them here would sever the only route by which an offline player
    // can be told their match was voided - their ws is null when the
    // void fires (that's why they timed out), so they can't receive the
    // broadcast below. A later auto-reconnect routes through
    // handleReconnect, which checks room.phase === 'voided' and sends
    // match_voided + cleans up the per-user mapping there.
    const payload = { type: 'match_voided', reason, ...extra };
    send(room.host?.ws, payload);
    send(room.guest?.ws, payload);
    for (const s of room.spectators.values()) send(s.ws, payload);
  }

  // ── Disconnect / reconnect ──────────────────────────────────────────

  handleDisconnect(ws) {
    const uid = ws._uid;
    // Exact-socket queue cleanup (2A.12): drop only THIS socket's entry. A
    // superseded socket's late close must not evict the replacement's entry
    // (filtering by uid would).
    this.matchmakingQueue = this.matchmakingQueue.filter(e => e.ws !== ws);
    const code = ws._roomCode;
    if (!code || !uid) return;
    const room = this.rooms.get(code);
    if (!room) return;

    const role = ws._role;
    if (role === 'spectator') {
      // Stale-close guard (mirror the player guard, 2A.11): if a newer socket
      // already replaced this spectator via a same-room reconnect, this close
      // is for a dead socket — count it as stale and skip telemetry/mutation.
      const installed = room.spectators.get(uid)?.ws;
      if (installed && installed !== ws) {
        incCounter('stale_socket_close_total');
        return;
      }
      // Spectator slot stays around (uid-keyed map) so reconnect can find it.
      logEvent('disconnect', { room: code, role, uid: uid?.slice(0, 8), phase: room.phase });
      return;
    }
    if (role !== 'p1' && role !== 'p2') return;

    // Stale-close guard (Codex #5) runs BEFORE any logging/metrics/timers
    // (2A.11): if a newer socket already replaced this one via handleReconnect,
    // this close is for a dead/discarded socket. Don't log a disconnect, null
    // the live ws, cancel the active challenge, broadcast opponent_disconnected,
    // or schedule a grace-period void. Just let the dead socket go.
    const installedWs = role === 'p1' ? room.host?.ws : room.guest?.ws;
    if (installedWs !== ws) {
      console.log(`[DISCONNECT STALE] room=${code} role=${role} uid=${uid} (newer socket already installed)`);
      incCounter('stale_socket_close_total');
      return;
    }

    // Real disconnect — safe to record now (after the stale-close guard).
    logEvent('disconnect', {
      room: code, role, uid: uid?.slice(0, 8),
      phase: room.phase,
      matchPhase: room.matchState?.phase || null,
      roundSeq: room.roundSeq,
    });
    incCounter('disconnect_total', { phase: room.phase });

    // Stage 3.2: do NOT force a MISS on disconnect. Leave the active challenge
    // running so its own deadline resolves it naturally from whatever events
    // arrived before the drop — a player who finished the skill input then
    // dropped keeps their real tier. _onChallengeResolved stashes that genuine
    // tier for reconnect replay when it fires while the owner is still offline.
    if (room.challenges[role]) {
      incCounter('disconnect_during_challenge_total', { phase: room.phase });
    }

    // Clear ws but retain identity for reconnect. Stamp the drop time so a
    // later reconnect can bucket how long the player was gone.
    const member = role === 'p1' ? room.host : room.guest;
    if (member) { member.ws = null; member.disconnectedAt = Date.now(); }
    const otherWs = role === 'p1' ? room.guest?.ws : room.host?.ws;
    if (otherWs) send(otherWs, { type: 'opponent_disconnected', timeoutMs: TIMING.reconnect_grace_ms });

    // Schedule grace-period timer — voids the room if still disconnected.
    room.reconnectTimers[role] = scheduleTimer(
      room, () => this._onReconnectGraceExpired(room, role), TIMING.reconnect_grace_ms,
    );
  }

  // Fired when a disconnected player's reconnect grace elapses. Voids the
  // room (no loss is assigned — our own infra may be the cause) and labels
  // the void by whether the dropper had engaged with the match yet.
  _onReconnectGraceExpired(room, role) {
    const member = role === 'p1' ? room.host : room.guest;
    if (member?.ws) return; // reconnected within grace — nothing to do
    incCounter('reconnect_timeout_total', { phase: room.phase });
    this._voidRoom(room, this._disconnectVoidReason(room, role));
  }

  // Honest disconnect classification (Stage 3). A role counts as ENGAGED if it
  // either explicitly accepted the match (match_accept) or produced a validated
  // gameplay frame. A drop with neither is a true no_show — now distinguishable
  // thanks to the client accept signal (the gap Stage 1 left open).
  _disconnectVoidReason(room, role) {
    const engaged = room.matchAccepted?.[role] || room.acceptedIntent?.[role];
    return engaged ? 'started_match_disconnect' : 'no_show_disconnect';
  }

  // Bucket reconnect latency as a Prometheus-style cumulative histogram:
  // a reconnect of `sec` seconds increments EVERY bucket whose upper bound
  // (le) is >= sec, and always the catch-all `+Inf`. So a 7s reconnect bumps
  // le=15, 30, 45, +Inf. Exposed as reconnect_latency_bucket{le} on /metrics.
  _recordReconnectLatency(ms) {
    const sec = Math.max(0, ms) / 1000;
    for (const b of [1, 5, 15, 30, 45]) {
      if (sec <= b) incCounter('reconnect_latency_bucket', { le: String(b) });
    }
    incCounter('reconnect_latency_bucket', { le: '+Inf' });
  }

  // Pure 3-state session classification for the auth controller (2A.3). No
  // mutation, no emit. 'active' = uid is a player OR spectator in a live room;
  // 'terminal' = their player room is voided (kept only for the late notice);
  // 'none' = not in any room. The controller uses this to emit exactly one
  // auth outcome and to avoid adopting a socket into a terminal match.
  inspectSession(uid) {
    const code = this.playerRooms.get(uid);
    if (code) {
      const room = this.rooms.get(code);
      if (room) {
        if (room.phase === 'voided') return { status: 'terminal', roomCode: code, reason: 'room_already_voided' };
        return { status: 'active', roomCode: code, kind: 'player' };
      }
    }
    for (const room of this.rooms.values()) {
      if (room.spectators.has(uid)) {
        if (room.phase === 'voided') return { status: 'terminal', roomCode: room.code, reason: 'room_already_voided' };
        return { status: 'active', roomCode: room.code, kind: 'spectator' };
      }
    }
    return { status: 'none' };
  }

  /**
   * Reconnect a player or spectator. Replays current state.
   * @returns {boolean} true if the uid was found in an existing room
   */
  handleReconnect(ws, uid) {
    const code = this.playerRooms.get(uid);
    if (!code) {
      // Maybe a spectator
      for (const room of this.rooms.values()) {
        if (room.spectators.has(uid)) {
          if (room.phase === 'voided') {
            // Terminal spectator: the match was voided and the room is retained
            // only for this notice. Tell them, drop the mapping, and do NOT
            // adopt the socket or replay state.
            send(ws, { type: 'match_voided', reason: 'room_already_voided' });
            room.spectators.delete(uid);
            return false;
          }
          ws._roomCode = room.code;
          ws._role = 'spectator';
          room.spectators.get(uid).ws = ws;
          send(ws, { type: 'reconnected', roomCode: room.code });
          if (room.matchState) this._sendStateUpdateTo(room, ws, 'spectator', uid);
          return true;
        }
      }
      return false;
    }
    const room = this.rooms.get(code);
    if (!room) return false;
    // Voided-room bail: the offline player just got online; their match
    // was already voided (engine throw or grace-timeout). Send the
    // terminal notification so the client's reconnect loop stops
    // (NetworkClient._stopReconnecting() is gated on match_voided /
    // room_expired) and clear the per-user mapping. The room itself
    // stays in this.rooms until cleanupIdleRooms reaps it - any further
    // game messages still hit the room.phase === 'voided' rejection.
    if (room.phase === 'voided') {
      send(ws, { type: 'match_voided', reason: 'room_already_voided' });
      this.playerRooms.delete(uid);
      return false;
    }
    let role = null;
    if (room.host?.uid === uid) { role = 'p1'; room.host.ws = ws; }
    else if (room.guest?.uid === uid) { role = 'p2'; room.guest.ws = ws; }
    else return false;
    ws._roomCode = code;
    ws._role = role;
    if (room.reconnectTimers[role]) {
      clearScheduled(room, room.reconnectTimers[role]);
      room.reconnectTimers[role] = null;
    }
    send(ws, { type: 'reconnected', roomCode: code });
    if (room.matchState) this._sendStateUpdateTo(room, ws, role, uid);
    // Replay any active challenge so the client re-renders mini-game UI.
    const ch = room.challenges[role];
    if (ch) {
      replayChallengeForReconnect(ch, (m) => send(ws, m));
    } else if (room.cancelledChallengeNotices[role]) {
      // The prior disconnect cancelled this player's active challenge to
      // MISS. Replay a synthetic resolution even if the opponent already
      // advanced the round while this player was offline; the client uses
      // pickLocked to decide whether to keep the current picker disabled or
      // just show context for the score change it is seeing on reconnect.
      const notice = room.cancelledChallengeNotices[role];
      const pickLocked = room.roundSeq === notice.roundSeq && room.pendingPicks[role] !== null;
      send(ws, {
        type: 'challenge_resolved',
        challengeId: 'synthetic-post-reconnect',
        tier: notice.tier || 'MISS',
        cancelled: true,
        roundSeq: notice.roundSeq,
        pickLocked,
      });
      room.cancelledChallengeNotices[role] = null;
    }
    // Notify opponent.
    const otherWs = role === 'p1' ? room.guest?.ws : room.host?.ws;
    if (otherWs) send(otherWs, { type: 'opponent_reconnected' });

    // Telemetry: a real player reconnect succeeded. Bucket how long they were
    // gone (disconnectedAt was stamped when their socket dropped).
    const member = role === 'p1' ? room.host : room.guest;
    if (member?.disconnectedAt != null) {
      this._recordReconnectLatency(Date.now() - member.disconnectedAt);
      member.disconnectedAt = null;
    }
    // Legacy one-shot resume eligibility (2A.10): a still-connected old client
    // may re-issue find_match right after reconnect. Allow exactly one such
    // frame, briefly, to replay game_start instead of being rejected by the
    // membership guard. PLAYERS only — the spectator + voided paths returned
    // earlier, so they never reach here.
    ws._legacyResumeEligible = { roomCode: code, expiresAt: Date.now() + 5000 };
    incCounter('reconnect_success_total');
    return true;
  }

  // ── Per-connection RTT tracking ──────────────────────────────────────

  attachRttEstimator(roomCode, uid) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    if (!room.rttEstimators.has(uid)) {
      room.rttEstimators.set(uid, new RttEstimator());
    }
  }

  recordRttSample(roomCode, uid, rttMs) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    const est = room.rttEstimators.get(uid);
    if (est) est.update(rttMs);
  }

  // ── Idle room cleanup ───────────────────────────────────────────────

  cleanupIdleRooms() {
    const now = Date.now();
    // Voided rooms are deliberately retained so a late reconnect within the
    // client's retry window still receives `match_voided`; sweep them only
    // after that window + a margin.
    const voidSweepMs = Math.max(
      TIMING.client_reconnect_window_ms, TIMING.reconnect_grace_ms,
    ) + TIMING.room_sweep_margin_ms;

    for (const [code, room] of this.rooms) {
      const bothDisconnected = !room.host?.ws && !room.guest?.ws;
      let expire = false;
      let notifyIdle = false;

      if (room.phase === 'voided') {
        expire = room.terminalAt != null && (now - room.terminalAt) > voidSweepMs;
      } else if (room.phase === 'finished') {
        // A player may sit on the result screen before requesting a rematch:
        // retain a *connected* finished room until normal idle timeout. Only
        // sweep early once BOTH players have disconnected.
        if (bothDisconnected && room.terminalAt != null) {
          expire = (now - room.terminalAt) > TIMING.room_sweep_margin_ms;
        } else if (now - room.lastActivity > TIMING.room_idle_timeout_ms) {
          expire = true;
          notifyIdle = true;
        }
      } else if (now - room.lastActivity > TIMING.room_idle_timeout_ms) {
        // waiting | playing
        expire = true;
        notifyIdle = true;
      }

      if (!expire) continue;
      if (notifyIdle) {
        send(room.host?.ws, { type: 'room_expired', message: 'Room idle timeout' });
        send(room.guest?.ws, { type: 'room_expired', message: 'Room idle timeout' });
        for (const s of room.spectators.values()) {
          send(s.ws, { type: 'room_expired', message: 'Room idle timeout' });
        }
      }
      this.destroyRoom(code);
    }
  }

  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    destroyRoomTimers(room);
    // Conditional: only clear a uid→room mapping that still points at THIS
    // room. A uid that has since remapped to a newer room must keep it.
    if (room.host?.uid && this.playerRooms.get(room.host.uid) === code) {
      this.playerRooms.delete(room.host.uid);
    }
    if (room.guest?.uid && this.playerRooms.get(room.guest.uid) === code) {
      this.playerRooms.delete(room.guest.uid);
    }
    this.rooms.delete(code);
    this._refreshRoomGauges();
  }

  // ── Spectator broadcast helper (kept for compat with index.mjs) ─────

  broadcastToSpectators(room, msg) {
    for (const s of room.spectators.values()) send(s.ws, msg);
  }
}
