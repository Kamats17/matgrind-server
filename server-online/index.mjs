// MatGrind Online Multiplayer Server (authoritative).
//
// The server owns matchState. Clients send intents. RoomManager.mjs runs
// the engine, broadcasts state_update, drives challenge timing.

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { initFirebase } from './auth.mjs';
import { RoomManager } from './roomManager.mjs';
import { PingTracker, RttEstimator } from './rttEstimator.mjs';
import { RateLimiter } from './rateLimiter.mjs';
import { RATE_LIMITS, TIMING } from './config.mjs';
import { incCounter, renderPrometheus, renderJson } from './metrics.mjs';

const PORT = process.env.PORT || 3033;
const MAX_MESSAGE_SIZE = 4096;
const MAX_CONNECTIONS_PER_IP = 5;

const connectionsByIP = new Map();
const rateLimiter = new RateLimiter();

initFirebase();
const rooms = new RoomManager();

// HTTP server for health + queue size + metrics endpoint.
const httpServer = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.activeCount() }));
    return;
  }
  if (req.url === '/queue-size') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ size: rooms.getQueueSize() }));
    return;
  }
  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
    res.end(renderPrometheus());
    return;
  }
  if (req.url === '/metrics.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(renderJson()));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  const currentConns = connectionsByIP.get(ip) || 0;
  if (currentConns >= MAX_CONNECTIONS_PER_IP) {
    incCounter('connections_rejected_total', { reason: 'ip_limit' });
    ws.close(1008, 'Too many connections');
    return;
  }
  connectionsByIP.set(ip, currentConns + 1);
  incCounter('connections_total');

  ws._authenticated = false;
  ws._uid = null;
  ws._roomCode = null;
  ws._ip = ip;
  ws._isAlive = true;
  ws._pingTracker = new PingTracker();
  ws._rttEstimator = new RttEstimator();
  ws.on('pong', () => { ws._isAlive = true; });

  const authTimeout = setTimeout(() => {
    if (!ws._authenticated) {
      send(ws, { type: 'error', code: 'auth_timeout', message: 'Auth timeout' });
      ws.close();
    }
  }, 10000);

  ws.on('message', (raw) => {
    if (raw.length > MAX_MESSAGE_SIZE) {
      ws.close(1009, 'Message too large');
      return;
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Auth must be first message (no rate-limit; auth is one-shot)
    if (msg.type === 'auth') {
      clearTimeout(authTimeout);
      handleAuth(ws, msg.token);
      return;
    }

    if (!ws._authenticated) {
      send(ws, { type: 'error', code: 'not_authenticated', message: 'Not authenticated' });
      return;
    }

    // Pong handling for RTT measurement (and liveness). Bypasses rate limit.
    if (msg.type === 'pong') {
      ws._isAlive = true;
      if (Number.isInteger(msg.serverPingId)) {
        const rttMs = ws._pingTracker.resolvePong(msg.serverPingId);
        if (rttMs !== null) {
          ws._rttEstimator.update(rttMs);
          if (ws._roomCode) rooms.recordRttSample(ws._roomCode, ws._uid, rttMs);
        }
      }
      return;
    }

    // Rate limiting
    const isChallengeInput = msg.type === 'challenge_input';
    const limitKey = isChallengeInput ? `cha:${ws._uid}` : `msg:${ws._uid}`;
    const refill = isChallengeInput ? RATE_LIMITS.challenge_inputs_per_sec : RATE_LIMITS.msgs_per_sec;
    const burst  = isChallengeInput ? RATE_LIMITS.challenge_inputs_burst   : RATE_LIMITS.msgs_burst;
    if (!rateLimiter.consume(limitKey, refill, burst)) {
      send(ws, { type: 'error', code: 'rate_limited', message: 'Rate limit exceeded' });
      return;
    }

    switch (msg.type) {
      case 'create_room':       return handleCreateRoom(ws, msg);
      case 'join_room':         return handleJoinRoom(ws, msg);
      case 'spectate_room':     return handleSpectateRoom(ws, msg);
      case 'find_match':        return rooms.findMatch(ws, msg.name, msg.style);
      case 'cancel_matchmaking': return rooms.cancelMatchmaking(ws);
      case 'card_pick':
      case 'pin_pick':
      case 'period_choice':
      case 'request_reroll':
      case 'challenge_input':
      case 'rematch':
      case 'rematch_decline':
      case 'config':
        return rooms.handleGameMessage(ws, msg);
      default:
        send(ws, { type: 'error', code: 'unknown_message_type', message: `Unknown type: ${msg.type}` });
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS CLOSE] uid=${ws._uid} role=${ws._role} room=${ws._roomCode} code=${code} reason=${reason?.toString() || 'none'}`);
    clearTimeout(authTimeout);
    rooms.handleDisconnect(ws);
    rateLimiter.reset(`msg:${ws._uid}`);
    rateLimiter.reset(`cha:${ws._uid}`);
    const count = connectionsByIP.get(ws._ip) || 1;
    if (count <= 1) connectionsByIP.delete(ws._ip);
    else connectionsByIP.set(ws._ip, count - 1);
  });

  ws.on('error', () => { clearTimeout(authTimeout); });
});

// Heartbeat + RTT ping. Every 25s: protocol-level WS ping for raw
// liveness, plus an app-level ping carrying a serverPingId so we can
// measure RTT on pong.
const HEARTBEAT_INTERVAL_MS = 25000;
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws._authenticated) return;
    if (ws._isAlive === false) {
      console.log(`[HEARTBEAT] terminating unresponsive ws uid=${ws._uid}`);
      try { ws.terminate(); } catch { /* ignore */ }
      return;
    }
    ws._isAlive = false;
    try { ws.ping(); } catch { /* socket may be closing */ }
    // App-level RTT ping
    const id = ws._pingTracker.startPing();
    send(ws, { type: 'ping', serverPingId: id });
  });
}, HEARTBEAT_INTERVAL_MS);

// Idle room sweep
setInterval(() => {
  rooms.cleanupIdleRooms();
  rooms.cleanupMatchmakingQueue();
}, 60000);

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleAuth(ws, token) {
  console.log('[Auth] received', {
    typeofToken: typeof token,
    length: typeof token === 'string' ? token.length : null,
    prefix: typeof token === 'string' ? token.slice(0, 10) : null,
  });
  const { verifyToken } = await import('./auth.mjs');
  const uid = await verifyToken(token);
  if (!uid) {
    incCounter('auth_failures_total');
    send(ws, { type: 'auth_error', message: 'Invalid token' });
    ws.close();
    return;
  }
  incCounter('auth_success_total');
  ws._authenticated = true;
  ws._uid = uid;
  ws._isAlive = true;
  send(ws, { type: 'auth_success', uid });

  // Reconnect path: if this uid is already in a room, replay state.
  const reconnected = rooms.handleReconnect(ws, uid);
  if (reconnected) {
    rooms.attachRttEstimator(ws._roomCode, uid);
  }

  // Fire first ping immediately so RTT is measured before any challenge.
  const id = ws._pingTracker.startPing();
  send(ws, { type: 'ping', serverPingId: id });
}

function handleCreateRoom(ws, msg) {
  const code = rooms.createRoom(ws, msg.name, msg.style);
  rooms.attachRttEstimator(code, ws._uid);
  send(ws, { type: 'room_created', code });
}

function handleJoinRoom(ws, msg) {
  const result = rooms.joinRoom(ws, msg.code, msg.name);
  if (result.error) {
    send(ws, { type: 'error', code: 'join_failed', message: result.error });
    return;
  }
  rooms.attachRttEstimator(ws._roomCode, ws._uid);
}

function handleSpectateRoom(ws, msg) {
  const result = rooms.spectateRoom(ws, msg.code);
  if (result.error) send(ws, { type: 'error', code: 'spectate_failed', message: result.error });
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[MatGrind Server] Listening on port ${PORT}`);
  console.log(`[MatGrind Server] Health: http://localhost:${PORT}/health`);
});
