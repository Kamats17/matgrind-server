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
  cancelChallenge,
  replayChallengeForReconnect,
  setChallengeRttCorrection,
} from './challengeEngine.mjs';
import { RttEstimator } from './rttEstimator.mjs';
import { scheduleTimer, clearScheduled, destroyRoomTimers } from './timers.mjs';
import { TIMING, HAND_SIZE } from './config.mjs';
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
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
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
  constructor() {
    this.rooms = new Map();        // code → room
    this.playerRooms = new Map();  // uid → code
    this.matchmakingQueue = [];    // [{ ws, uid, name, style, joinedAt }]
  }

  activeCount() {
    return this.rooms.size;
  }

  // ── Room lifecycle ────────────────────────────────────────────────────

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
    setGauge('rooms_active', this.rooms.size);
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

  findMatch(ws, playerName, style) {
    // Drop any existing entry for this player + filter dead sockets first.
    this.matchmakingQueue = this.matchmakingQueue.filter(
      e => e.uid !== ws._uid && e.ws.readyState === 1,
    );
    const requestedStyle = style || 'folkstyle';
    const matchIndex = this.matchmakingQueue.findIndex(
      e => e.style === requestedStyle && e.ws.readyState === 1,
    );
    if (matchIndex >= 0) {
      const opponent = this.matchmakingQueue.splice(matchIndex, 1)[0];
      const code = this.createRoom(opponent.ws, opponent.name, opponent.style);
      const result = this.joinRoom(ws, code, playerName || 'Player');
      if (result.error) sendError(ws, 'matchmaking_failed', result.error);
    } else {
      this.matchmakingQueue.push({
        ws, uid: ws._uid,
        name: playerName || 'Player',
        style: requestedStyle,
        joinedAt: Date.now(),
      });
      send(ws, { type: 'matchmaking_queued', position: this.matchmakingQueue.length });
    }
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
    room.phase = 'playing';
    room.seed = rngU32();
    room.engineRng = makeRng(room.seed);
    room.challengeRngP1 = makeRng(rngU32());   // independent, prevents RNG-state-reverse attacks
    room.challengeRngP2 = makeRng(rngU32());
    const initialInitiative = room.engineRng() < 0.5 ? 'p1' : 'p2';
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
      room.phase = 'finished';
      room.matchEndedAt = Date.now();
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
    if (room.pinBurned[side].has(msg.cardId)) {
      return sendError(ws, 'pin_card_burned', `Card ${msg.cardId} was used in a prior stage`);
    }

    room.pinBurned[side].add(msg.cardId);
    room.pendingPinPicks[side] = msg.cardId;
    send(ws, { type: 'pick_acknowledged', roundSeq: room.roundSeq });

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
        room.phase = 'finished';
        room.matchEndedAt = Date.now();
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
    recordChallengeInput(challenge, { eventType: msg.eventType, payload: msg.payload });
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

  _voidRoom(room, reason, extra = {}) {
    if (room.phase === 'voided') return;
    room.phase = 'voided';
    destroyRoomTimers(room);
    incCounter('matches_voided_total', { reason });
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
    if (uid) this.matchmakingQueue = this.matchmakingQueue.filter(e => e.uid !== uid);
    const code = ws._roomCode;
    if (!code || !uid) return;
    const room = this.rooms.get(code);
    if (!room) return;

    const role = ws._role;
    logEvent('disconnect', {
      room: code, role, uid: uid?.slice(0, 8),
      phase: room.phase,
      matchPhase: room.matchState?.phase || null,
      roundSeq: room.roundSeq,
    });
    if (role === 'spectator') {
      // Spectator slot stays around (uid-keyed map) so reconnect can find it.
      return;
    }
    if (role !== 'p1' && role !== 'p2') return;

    // Stale-close guard (Codex #5): if a newer socket already replaced
    // this one via handleReconnect, the close event we're processing is
    // for a dead/discarded socket. Don't null the live ws, don't cancel
    // the active challenge, don't broadcast opponent_disconnected, don't
    // schedule a grace-period void. Just let the dead socket go.
    const installedWs = role === 'p1' ? room.host?.ws : room.guest?.ws;
    if (installedWs !== ws) {
      console.log(`[DISCONNECT STALE] room=${code} role=${role} uid=${uid} (newer socket already installed)`);
      return;
    }

    // Cancel any active challenge for this role (forces MISS so the
    // round can resolve once the opponent settles). Keep matchState as-is.
    if (room.challenges[role]) {
      room.cancelledChallengeNotices[role] = {
        roundSeq: room.roundSeq,
        tier: 'MISS',
      };
      cancelChallenge(room.challenges[role]);
      // _onChallengeResolved will fire and set skillResults[role] = MISS.
    }

    // Clear ws but retain identity for reconnect.
    if (role === 'p1' && room.host) room.host.ws = null;
    if (role === 'p2' && room.guest) room.guest.ws = null;
    const otherWs = role === 'p1' ? room.guest?.ws : room.host?.ws;
    if (otherWs) send(otherWs, { type: 'opponent_disconnected', timeoutMs: TIMING.reconnect_grace_ms });

    // Schedule grace-period timer — voids the room if still disconnected.
    room.reconnectTimers[role] = scheduleTimer(room, () => {
      const member = role === 'p1' ? room.host : room.guest;
      if (!member?.ws) {
        this._voidRoom(room, 'opponent_disconnect_timeout');
      }
    }, TIMING.reconnect_grace_ms);
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
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > TIMING.room_idle_timeout_ms) {
        destroyRoomTimers(room);
        send(room.host?.ws, { type: 'room_expired', message: 'Room idle timeout' });
        send(room.guest?.ws, { type: 'room_expired', message: 'Room idle timeout' });
        for (const s of room.spectators.values()) {
          send(s.ws, { type: 'room_expired', message: 'Room idle timeout' });
        }
        if (room.host?.uid) this.playerRooms.delete(room.host.uid);
        if (room.guest?.uid) this.playerRooms.delete(room.guest.uid);
        this.rooms.delete(code);
      }
    }
  }

  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    destroyRoomTimers(room);
    if (room.host?.uid) this.playerRooms.delete(room.host.uid);
    if (room.guest?.uid) this.playerRooms.delete(room.guest.uid);
    this.rooms.delete(code);
    setGauge('rooms_active', this.rooms.size);
  }

  // ── Spectator broadcast helper (kept for compat with index.mjs) ─────

  broadcastToSpectators(room, msg) {
    for (const s of room.spectators.values()) send(s.ws, msg);
  }
}
