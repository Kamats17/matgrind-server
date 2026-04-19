// MatGrind Online Multiplayer Server
// Deploy: Railway, Render, or any Node.js host
// Env: FIREBASE_SERVICE_ACCOUNT (JSON string), PORT (default 3033)

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { initFirebase } from './auth.mjs';
import { RoomManager } from './roomManager.mjs';

const PORT = process.env.PORT || 3033;
const MAX_MESSAGE_SIZE = 4096; // 4KB — game messages are tiny JSON
const RATE_LIMIT_WINDOW = 1000; // 1 second
const RATE_LIMIT_MAX = 15; // messages per window
const MAX_CONNECTIONS_PER_IP = 5;

const connectionsByIP = new Map(); // ip → count

// Initialize Firebase Admin for token verification
initFirebase();

const rooms = new RoomManager();

// HTTP server for health checks
const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Per-IP connection limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
  const currentConns = connectionsByIP.get(ip) || 0;
  if (currentConns >= MAX_CONNECTIONS_PER_IP) {
    ws.close(1008, 'Too many connections');
    return;
  }
  connectionsByIP.set(ip, currentConns + 1);

  ws._authenticated = false;
  ws._uid = null;
  ws._roomCode = null;
  ws._ip = ip;
  ws._msgCount = 0;
  ws._msgWindowStart = Date.now();
  // Liveness flag for the protocol-level heartbeat. Flipped back to true
  // whenever we receive a WebSocket PONG frame (browsers auto-reply to PINGs
  // at the protocol layer — more reliable than app-level JSON pings, which
  // pass through the onmessage handler and are subject to rate limiting and
  // client-side silent-drop when the socket is briefly not OPEN).
  ws._isAlive = true;
  ws.on('pong', () => { ws._isAlive = true; });

  // Require auth within 10 seconds
  const authTimeout = setTimeout(() => {
    if (!ws._authenticated) {
      send(ws, { type: 'error', message: 'Auth timeout' });
      ws.close();
    }
  }, 10000);

  ws.on('message', (raw) => {
    // Message size limit
    if (raw.length > MAX_MESSAGE_SIZE) {
      ws.close(1009, 'Message too large');
      return;
    }

    // Rate limiting
    const now = Date.now();
    if (now - ws._msgWindowStart > RATE_LIMIT_WINDOW) {
      ws._msgCount = 1;
      ws._msgWindowStart = now;
    } else {
      ws._msgCount++;
      if (ws._msgCount > RATE_LIMIT_MAX) {
        send(ws, { type: 'error', message: 'Rate limit exceeded' });
        return;
      }
    }

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Auth must be first message
    if (msg.type === 'auth') {
      clearTimeout(authTimeout);
      handleAuth(ws, msg.token);
      return;
    }

    if (!ws._authenticated) {
      send(ws, { type: 'error', message: 'Not authenticated' });
      return;
    }

    switch (msg.type) {
      case 'create_room':
        handleCreateRoom(ws, msg);
        break;
      case 'join_room':
        handleJoinRoom(ws, msg);
        break;
      case 'spectate_room':
        handleSpectateRoom(ws, msg);
        break;
      case 'find_match':
        rooms.findMatch(ws, msg.name, msg.style);
        break;
      case 'cancel_matchmaking':
        rooms.cancelMatchmaking(ws);
        break;
      case 'card_pick':
      case 'period_choice':
      case 'pin_pick':
      case 'config':
      case 'rematch':
        rooms.handleGameMessage(ws, msg);
        break;
      case 'pong':
        // App-level pong: mark alive (belt-and-suspenders next to the
        // WebSocket protocol-level pong handler set up on connection).
        ws._isAlive = true;
        ws._lastPong = Date.now();
        break;
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS CLOSE] uid=${ws._uid} role=${ws._role} room=${ws._roomCode} code=${code} reason=${reason?.toString() || 'none'}`);
    clearTimeout(authTimeout);
    rooms.handleDisconnect(ws);
    // Decrement IP connection count
    const count = connectionsByIP.get(ws._ip) || 1;
    if (count <= 1) connectionsByIP.delete(ws._ip);
    else connectionsByIP.set(ws._ip, count - 1);
  });

  ws.on('error', () => {
    clearTimeout(authTimeout);
  });
});

// Heartbeat: WebSocket protocol-level PING every 25s. If a client hasn't
// replied with a PONG control frame by the time the next tick runs
// (~25s later), terminate. Protocol-level pings bypass the app message
// handler — rate limits, app-level silent drops, and React/JS tab throttling
// can't starve the heartbeat. This prevents false-positive "opponent
// disconnected" UIs on healthy connections.
// Also keeps the legacy app-level {type:'ping'} send for backward compat
// with older clients, but we no longer rely on its pong arrival for liveness.
const HEARTBEAT_INTERVAL_MS = 25000;
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws._authenticated) return;
    if (ws._isAlive === false) {
      console.log(`[HEARTBEAT] terminating unresponsive ws uid=${ws._uid} role=${ws._role} room=${ws._roomCode}`);
      try { ws.terminate(); } catch { /* ignore */ }
      return;
    }
    ws._isAlive = false;
    try { ws.ping(); } catch { /* best effort — socket may be closing */ }
    // Legacy app-level ping — kept so older clients without protocol-pong
    // support still see server liveness. Server no longer uses app-level
    // pong for liveness detection.
    send(ws, { type: 'ping' });
  });
}, HEARTBEAT_INTERVAL_MS);

// Room cleanup: expire idle rooms every 60s, clean matchmaking queue
setInterval(() => {
  rooms.cleanup();
  rooms.cleanupMatchmakingQueue();
}, 60000);

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleAuth(ws, token) {
  // Diagnostic — Codex-suggested log to confirm clients are sending a real
  // Firebase ID token (eyJ... ~1kB JWT) and not a stale string, an access
  // token, or a "Bearer ..." wrapped value. First 10 chars only.
  console.log('[Auth] received', {
    typeofToken: typeof token,
    length: typeof token === 'string' ? token.length : null,
    prefix: typeof token === 'string' ? token.slice(0, 10) : null,
  });
  const { verifyToken } = await import('./auth.mjs');
  const uid = await verifyToken(token);
  if (!uid) {
    send(ws, { type: 'auth_error', message: 'Invalid token' });
    ws.close();
    return;
  }
  ws._authenticated = true;
  ws._uid = uid;
  ws._lastPong = Date.now();
  ws._isAlive = true;
  send(ws, { type: 'auth_success', uid });

  // Check if this user was in a room and reconnect
  const reconnected = rooms.tryReconnect(ws, uid);
  if (reconnected) {
    send(ws, { type: 'reconnected', roomCode: reconnected });
  }
}

function handleCreateRoom(ws, msg) {
  const code = rooms.createRoom(ws, msg.name, msg.style);
  send(ws, { type: 'room_created', code });
}

function handleJoinRoom(ws, msg) {
  const result = rooms.joinRoom(ws, msg.code, msg.name);
  if (result.error) {
    send(ws, { type: 'error', message: result.error });
    return;
  }
  // Both players notified via room manager
}

function handleSpectateRoom(ws, msg) {
  const result = rooms.spectateRoom(ws, msg.code);
  if (result.error) {
    send(ws, { type: 'error', message: result.error });
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[MatGrind Server] Listening on port ${PORT}`);
  console.log(`[MatGrind Server] Health: http://localhost:${PORT}/health`);
});
