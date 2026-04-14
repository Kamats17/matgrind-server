// MatGrind Online Multiplayer Server
// Deploy: Railway, Render, or any Node.js host
// Env: FIREBASE_SERVICE_ACCOUNT (JSON string), PORT (default 3033)

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { initFirebase } from './auth.mjs';
import { RoomManager } from './roomManager.mjs';

const PORT = process.env.PORT || 3033;

// Initialize Firebase Admin for token verification
initFirebase();

const rooms = new RoomManager();

// HTTP server for health checks
const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      rooms: rooms.activeCount(),
      uptime: process.uptime(),
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  ws._authenticated = false;
  ws._uid = null;
  ws._roomCode = null;

  // Require auth within 10 seconds
  const authTimeout = setTimeout(() => {
    if (!ws._authenticated) {
      send(ws, { type: 'error', message: 'Auth timeout' });
      ws.close();
    }
  }, 10000);

  ws.on('message', (raw) => {
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
        ws._lastPong = Date.now();
        break;
    }
  });

  ws.on('close', () => {
    clearTimeout(authTimeout);
    rooms.handleDisconnect(ws);
  });

  ws.on('error', () => {
    clearTimeout(authTimeout);
  });
});

// Heartbeat: ping every 20s, disconnect if no pong within 45s
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws._authenticated) return;
    if (ws._lastPong && Date.now() - ws._lastPong > 45000) {
      ws.terminate();
      return;
    }
    send(ws, { type: 'ping' });
  });
}, 20000);

// Room cleanup: expire idle rooms every 60s, clean matchmaking queue
setInterval(() => {
  rooms.cleanup();
  rooms.cleanupMatchmakingQueue();
}, 60000);

// ── Handlers ─────────────────────────────────────────────────────────────

async function handleAuth(ws, token) {
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
