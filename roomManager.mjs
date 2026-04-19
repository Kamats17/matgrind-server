// Room management for online multiplayer
// Each room holds two players and a match state

const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes idle
const RECONNECT_TIMEOUT_MS = 45 * 1000; // 45 seconds to reconnect

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

export class RoomManager {
  constructor() {
    this.rooms = new Map();       // code → room
    this.playerRooms = new Map(); // uid → code
    this.matchmakingQueue = [];   // array of { ws, uid, name, style, joinedAt }
  }

  activeCount() {
    return this.rooms.size;
  }

  createRoom(ws, playerName, style) {
    // Generate unique code
    let code;
    do { code = generateCode(); } while (this.rooms.has(code));

    const room = {
      code,
      style: style || 'folkstyle',
      phase: 'waiting', // waiting | playing | finished
      host: { ws, uid: ws._uid, name: playerName || 'Player 1' },
      guest: null,
      spectators: [],   // array of { ws, uid }
      cardPicks: { p1: null, p2: null },
      // Per-archetype micro-mechanic skill tier per side. Currently
      // client-trusted (matches the protocol note in networkClient.js); a
      // future authoritative server pass should re-validate using raw input
      // timestamps before forwarding.
      cardSkills: { p1: null, p2: null },
      pinPicks: { offense: null, defense: null },
      pinAttacker: null,
      lastActivity: Date.now(),
      reconnectTimers: {},
    };

    this.rooms.set(code, room);
    this.playerRooms.set(ws._uid, code);
    ws._roomCode = code;
    ws._role = 'p1';
    return code;
  }

  joinRoom(ws, code, playerName) {
    code = (code || '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.guest) return { error: 'Room is full' };
    if (room.host.uid === ws._uid) return { error: 'Cannot join your own room' };

    room.guest = { ws, uid: ws._uid, name: playerName || 'Player 2' };
    room.phase = 'playing';
    room.lastActivity = Date.now();
    this.playerRooms.set(ws._uid, code);
    ws._roomCode = code;
    ws._role = 'p2';

    // Notify both players
    send(room.host.ws, {
      type: 'opponent_joined',
      opponent: room.guest.name,
      player: 'p1',
    });
    send(room.guest.ws, {
      type: 'opponent_joined',
      opponent: room.host.name,
      player: 'p2',
    });

    // Both run the engine locally — server relays picks.
    // CRITICAL: provide a shared initial initiative so both clients start from
    // identical state. Without this, each client rolls its own Math.random()
    // and diverges from round 1 onward (a move played on one client produces a
    // different outcome on the other — the match appears "stuck" because the
    // two players see contradictory board state).
    const initialInitiative = Math.random() < 0.5 ? 'p1' : 'p2';
    room.initialInitiative = initialInitiative;

    send(room.host.ws, {
      type: 'game_start',
      player: 'p1',
      p1Name: room.host.name,
      p2Name: room.guest.name,
      style: room.style,
      initialInitiative,
    });
    send(room.guest.ws, {
      type: 'game_start',
      player: 'p2',
      p1Name: room.host.name,
      p2Name: room.guest.name,
      style: room.style,
      initialInitiative,
    });

    // Notify spectators
    this.broadcastToSpectators(room, {
      type: 'game_start',
      player: 'spectator',
      p1Name: room.host.name,
      p2Name: room.guest.name,
      style: room.style,
      initialInitiative,
    });

    return { ok: true };
  }

  spectateRoom(ws, code) {
    code = (code || '').toUpperCase().trim();
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };

    room.spectators.push({ ws, uid: ws._uid });
    ws._roomCode = code;
    ws._role = 'spectator';

    send(ws, {
      type: 'spectate_joined',
      p1Name: room.host?.name || 'Player 1',
      p2Name: room.guest?.name || 'Player 2',
      style: room.style,
      phase: room.phase,
    });

    return { ok: true };
  }

  // ── Matchmaking Queue ──────────────────────────────────────────────────

  findMatch(ws, playerName, style) {
    // Remove any existing entry for this player
    this.matchmakingQueue = this.matchmakingQueue.filter(e => e.uid !== ws._uid);

    // Try to find a compatible opponent already in queue
    const matchIndex = this.matchmakingQueue.findIndex(e => e.style === (style || 'folkstyle'));
    if (matchIndex >= 0) {
      const opponent = this.matchmakingQueue.splice(matchIndex, 1)[0];
      // Create a room and auto-join both
      const code = this.createRoom(opponent.ws, opponent.name, opponent.style || 'folkstyle');
      const result = this.joinRoom(ws, code, playerName || 'Player');
      if (result.error) {
        send(ws, { type: 'error', message: result.error });
      }
      // Both will receive game_start from joinRoom
    } else {
      // No match found — add to queue
      this.matchmakingQueue.push({
        ws,
        uid: ws._uid,
        name: playerName || 'Player',
        style: style || 'folkstyle',
        joinedAt: Date.now(),
      });
      send(ws, { type: 'matchmaking_queued', position: this.matchmakingQueue.length });
    }
  }

  cancelMatchmaking(ws) {
    this.matchmakingQueue = this.matchmakingQueue.filter(e => e.uid !== ws._uid);
    send(ws, { type: 'matchmaking_cancelled' });
  }

  cleanupMatchmakingQueue() {
    const now = Date.now();
    const TIMEOUT = 120000; // 2 minutes
    this.matchmakingQueue = this.matchmakingQueue.filter(e => {
      if (now - e.joinedAt > TIMEOUT) {
        send(e.ws, { type: 'matchmaking_timeout', message: 'No opponent found. Try again.' });
        return false;
      }
      if (e.ws.readyState !== 1) return false; // dead connection
      return true;
    });
  }

  broadcastToSpectators(room, msg) {
    for (const s of room.spectators) {
      send(s.ws, msg);
    }
  }

  handleGameMessage(ws, msg) {
    const code = ws._roomCode;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    room.lastActivity = Date.now();

    // Use the server-assigned role, NOT anything from the message
    const role = ws._role;
    if (role === 'spectator') return; // spectators can't send game messages
    if (role !== 'p1' && role !== 'p2') return; // invalid role
    const otherWs = role === 'p1' ? room.guest?.ws : room.host?.ws;

    switch (msg.type) {
      case 'card_pick': {
        // Validate cardId is a non-empty string (game engine validates the actual ID client-side)
        if (!msg.cardId || typeof msg.cardId !== 'string' || msg.cardId.length > 64) {
          console.log(`[RX card_pick REJECTED] room=${code} role=${role} invalidCardId=${JSON.stringify(msg.cardId)}`);
          return;
        }
        if (room.cardPicks[role]) {
          console.log(`[RX card_pick DUPLICATE] room=${code} role=${role} cardId=${msg.cardId} — ignoring (already has ${room.cardPicks[role]})`);
          return; // already picked
        }
        console.log(`[RX card_pick] room=${code} role=${role} cardId=${msg.cardId} gate=p1:${!!room.cardPicks.p1 || role==='p1'}/p2:${!!room.cardPicks.p2 || role==='p2'}`);
        room.cardPicks[role] = msg.cardId;
        // Online rooms never accept a client-supplied skillResult. The
        // client skips the skill challenge entirely in network mode (see
        // commit 1050a79), so a payload here is either stale or tampered
        // — refuse it per the server-authoritative-multiplayer-validation
        // skill (Level 1: Refuse).
        if (msg.skillResult !== undefined) {
          console.warn(
            `[SECURITY] room=${code} role=${role} sent skillResult in online mode — ignoring`,
          );
        }
        room.cardSkills[role] = null;
        send(ws, { type: 'pick_acknowledged' });

        // When both picks are in, broadcast to both so they resolve locally
        if (room.cardPicks.p1 && room.cardPicks.p2) {
          const picks = {
            p1CardId: room.cardPicks.p1,
            p2CardId: room.cardPicks.p2,
            p1SkillResult: room.cardSkills.p1,
            p2SkillResult: room.cardSkills.p2,
          };
          console.log(`[TX round_picks] room=${code} p1=${picks.p1CardId} p2=${picks.p2CardId} hostConnected=${!!room.host?.ws} guestConnected=${!!room.guest?.ws}`);
          send(room.host?.ws, { type: 'round_picks', ...picks });
          send(room.guest?.ws, { type: 'round_picks', ...picks });
          this.broadcastToSpectators(room, { type: 'round_picks', ...picks });
          room.cardPicks = { p1: null, p2: null };
          room.cardSkills = { p1: null, p2: null };
        }
        break;
      }

      case 'pin_attempt_start': {
        // Client hint: one of the two clients has resolved `round_picks`
        // locally and its engine reports the match entered phase='pin_attempt'
        // with a known attacker. We store this so we can validate subsequent
        // `pin_pick` messages against the correct side. If the two clients
        // disagree (first-write-wins), the server keeps the first claim.
        if (msg.attacker !== 'p1' && msg.attacker !== 'p2') return;
        if (!room.pinAttacker) {
          room.pinAttacker = msg.attacker;
          console.log(`[PIN START] room=${code} attacker=${msg.attacker} (claimed by ${role})`);
        }
        break;
      }

      case 'pin_pick': {
        const side = msg.role;
        if (side !== 'offense' && side !== 'defense') return;
        if (!msg.cardId || typeof msg.cardId !== 'string' || msg.cardId.length > 64) return;
        if (room.pinPicks[side]) return;

        // Validate the sender is actually on the claimed side. Requires
        // `room.pinAttacker` to be set via `pin_attempt_start`. If the hint
        // never arrived (older clients, or client crash before emit), we
        // fall through with no validation — relay-only behavior — so we
        // don't hard-break legacy clients.
        if (room.pinAttacker) {
          const attackerRole = room.pinAttacker;
          const defenderRole = attackerRole === 'p1' ? 'p2' : 'p1';
          const claimMatches =
            (side === 'offense' && role === attackerRole) ||
            (side === 'defense' && role === defenderRole);
          if (!claimMatches) {
            console.warn(`[SECURITY] room=${code} sender=${role} sent pin_pick role=${side} but attacker=${attackerRole} — dropping`);
            return;
          }
        }

        room.pinPicks[side] = msg.cardId;
        send(ws, { type: 'pick_acknowledged' });

        if (room.pinPicks.offense && room.pinPicks.defense) {
          const picks = { offenseCardId: room.pinPicks.offense, defenseCardId: room.pinPicks.defense };
          send(room.host?.ws, { type: 'pin_picks', ...picks });
          send(room.guest?.ws, { type: 'pin_picks', ...picks });
          this.broadcastToSpectators(room, { type: 'pin_picks', ...picks });
          room.pinPicks = { offense: null, defense: null };
          // Clear the attacker latch so the next pin attempt (rare but
          // possible within a single match) starts fresh.
          room.pinAttacker = null;
        }
        break;
      }

      case 'period_choice': {
        // Validate choice is a valid period selection
        const validChoices = ['top', 'bottom', 'neutral', 'defer'];
        if (!validChoices.includes(msg.choice)) return;
        // Relay period choice to both players
        send(room.host?.ws, { type: 'period_choice_made', player: role, choice: msg.choice });
        send(room.guest?.ws, { type: 'period_choice_made', player: role, choice: msg.choice });
        this.broadcastToSpectators(room, { type: 'period_choice_made', player: role, choice: msg.choice });
        break;
      }

      case 'config': {
        // Players can only update their OWN name, and style only if room is still waiting
        const name = typeof msg.name === 'string' ? msg.name.slice(0, 30) : null;
        if (role === 'p1' && room.host && name) room.host.name = name;
        if (role === 'p2' && room.guest && name) room.guest.name = name;
        if (msg.style && room.phase === 'waiting') {
          const validStyles = ['folkstyle', 'freestyle', 'greco'];
          if (validStyles.includes(msg.style)) room.style = msg.style;
        }
        break;
      }

      case 'rematch': {
        // Relay rematch request
        if (otherWs) send(otherWs, { type: 'rematch_requested' });
        break;
      }
    }
  }

  handleDisconnect(ws) {
    const uid = ws._uid;
    // Remove from matchmaking queue on disconnect
    if (uid) this.matchmakingQueue = this.matchmakingQueue.filter(e => e.uid !== uid);

    const code = ws._roomCode;
    if (!code || !uid) {
      console.log(`[DISCONNECT] uid=${uid} — not in a room, nothing to do`);
      return;
    }

    const room = this.rooms.get(code);
    if (!room) {
      console.log(`[DISCONNECT] uid=${uid} room=${code} not found`);
      return;
    }
    console.log(`[DISCONNECT] uid=${uid} role=${ws._role} room=${code} — starting 45s reconnect window`);

    // Spectator disconnect — just remove from list
    if (ws._role === 'spectator') {
      room.spectators = room.spectators.filter(s => s.uid !== uid);
      return;
    }

    const isHost = room.host?.uid === uid;
    const slot = isHost ? 'host' : 'guest';
    const otherSlot = isHost ? 'guest' : 'host';
    const other = room[otherSlot];

    // Start reconnection timer
    room.reconnectTimers[uid] = setTimeout(() => {
      // Player didn't reconnect — void the match
      if (other?.ws) {
        send(other.ws, { type: 'match_voided', reason: 'Opponent disconnected' });
      }
      this.destroyRoom(code);
    }, RECONNECT_TIMEOUT_MS);

    // Notify other player
    if (other?.ws) {
      send(other.ws, { type: 'opponent_disconnected', timeout: RECONNECT_TIMEOUT_MS / 1000 });
    }

    // Clear the WebSocket reference but keep the room alive
    if (room[slot]) room[slot].ws = null;
  }

  tryReconnect(ws, uid) {
    const code = this.playerRooms.get(uid);
    if (!code) {
      console.log(`[RECONNECT] uid=${uid} — no room mapping, cannot reconnect`);
      return null;
    }

    const room = this.rooms.get(code);
    if (!room) {
      console.log(`[RECONNECT] uid=${uid} room=${code} destroyed, cannot reconnect`);
      return null;
    }
    console.log(`[RECONNECT] uid=${uid} room=${code} succeeded`);

    // Clear reconnection timer
    if (room.reconnectTimers[uid]) {
      clearTimeout(room.reconnectTimers[uid]);
      delete room.reconnectTimers[uid];
    }

    // Restore WebSocket
    const isHost = room.host?.uid === uid;
    if (isHost) {
      room.host.ws = ws;
      ws._role = 'p1';
    } else if (room.guest?.uid === uid) {
      room.guest.ws = ws;
      ws._role = 'p2';
    } else {
      return null;
    }

    ws._roomCode = code;
    room.lastActivity = Date.now();

    // Notify other player
    const otherSlot = isHost ? 'guest' : 'host';
    if (room[otherSlot]?.ws) {
      send(room[otherSlot].ws, { type: 'opponent_reconnected' });
    }

    return code;
  }

  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;

    // Clear all timers
    Object.values(room.reconnectTimers).forEach(t => clearTimeout(t));

    // Clean up player mappings
    if (room.host?.uid) this.playerRooms.delete(room.host.uid);
    if (room.guest?.uid) this.playerRooms.delete(room.guest.uid);

    this.rooms.delete(code);
  }

  cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > ROOM_EXPIRY_MS) {
        // Notify remaining players
        [room.host, room.guest].forEach(p => {
          if (p?.ws) send(p.ws, { type: 'room_expired', message: 'Room expired due to inactivity' });
        });
        this.destroyRoom(code);
      }
    }
  }
}
