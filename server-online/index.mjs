// MatGrind Online Multiplayer Server (authoritative).
//
// The server owns matchState. Clients send intents. RoomManager.mjs runs the
// engine, broadcasts state_update, drives challenge timing. The connection
// lifecycle + commit-safe auth transaction live in ConnectionController.mjs
// (unit-tested without importing this auto-listening entrypoint).

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { initFirebase, getFirestore, verifyToken } from './auth.mjs';
import { RoomManager } from './roomManager.mjs';
import { PingTracker, RttEstimator } from './rttEstimator.mjs';
import { RateLimiter } from './rateLimiter.mjs';
import { ConnectionAdmission } from './connectionAdmission.mjs';
import { ConnectionController } from './connectionController.mjs';
import { RATE_LIMITS, TIMING, ADMISSION } from './config.mjs';
import { incCounter, setGauge, renderPrometheus, renderJson, recentEvents, logEvent } from './metrics.mjs';
import { routeHttp } from './httpRoutes.mjs';
import { buildSnapshot } from './metricsSnapshot.mjs';
import { settleAuthoritativeMatch } from './onlineRewards.mjs';

const PORT = process.env.PORT || 3033;
const MAX_MESSAGE_SIZE = 4096;
// Ops endpoints (/metrics*, /debug/*) are inaccessible unless this is set.
const METRICS_AUTH_TOKEN = process.env.METRICS_AUTH_TOKEN || '';

const rateLimiter = new RateLimiter();
const admission = new ConnectionAdmission({ config: ADMISSION, incCounter });

initFirebase();
const rooms = new RoomManager({
  roomLimiter: rateLimiter,
  // Stage 4: settle the match authoritatively — one transaction creates the
  // immutable match_results/{matchId} ledger AND updates both players'
  // online_progress docs (idempotent by matchId). Returns the per-player
  // receipts so the room can push each a trusted match_settled message.
  // Isolated — a settlement failure must never affect gameplay. No-ops in dev
  // (getFirestore() is null without a service account).
  onMatchResult: (built) => {
    const db = getFirestore();
    if (!db) return { receipts: [] };
    // Bounded retry so a transient Firestore blip doesn't permanently drop a
    // settlement (the room marks ledgerWritten before calling us and never
    // re-emits). The transaction is idempotent, so re-running is safe.
    return settleAuthoritativeMatch(db, built, {
      attempts: 3,
      sleep: (n) => new Promise((r) => setTimeout(r, 200 * n)),
    })
      .then((res) => {
        if (!res.settled) console.log('[result-ledger] idempotent skip', built.matchId);
        return res;
      })
      .catch((e) => {
        incCounter('settlement_failed_total');
        console.warn('[result-ledger] settlement failed after retries (isolated):', e?.message);
        return { receipts: [] };
      });
  },
});

// Metric provenance — counters are in-memory and reset on every deploy, so
// snapshots/series must be namespaced by release + process start time.
const RELEASE_ID = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RELEASE_ID || 'dev';
const PROCESS_START_MS = Date.now();
setGauge('process_start_time_seconds', Math.floor(PROCESS_START_MS / 1000));
setGauge('release_info', 1, { release_id: RELEASE_ID });

function send(ws, msg) {
  // Non-throwing: a socket can race to CLOSING between the check and ws.send.
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(msg)); } catch { /* socket race during close */ }
  }
}

// Single connection/auth controller (Stage 2A Batch 6). RTT ping/pong stay in
// this file (heartbeat owns the ws.ping cadence) and are injected as hooks.
const controller = new ConnectionController({
  rooms, admission, rateLimiter, verifyToken,
  config: { RATE_LIMITS, TIMING },
  metrics: { incCounter, logEvent },
  send,
  // Per-connection auth-deadline timers (no room to attach to). index.mjs is
  // exempt from the room-timer lint; the controller stays bare-timer-free.
  timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h) },
  onPong: (ws, msg) => {
    ws._isAlive = true;
    if (Number.isInteger(msg.serverPingId)) {
      const rttMs = ws._pingTracker.resolvePong(msg.serverPingId);
      if (rttMs !== null) {
        ws._rttEstimator.update(rttMs);
        if (ws._roomCode) rooms.recordRttSample(ws._roomCode, ws._uid, rttMs);
      }
    }
  },
  firstPing: (ws) => {
    ws._isAlive = true;
    const id = ws._pingTracker.startPing();
    send(ws, { type: 'ping', serverPingId: id });
  },
});

// HTTP server. Routing + access control live in httpRoutes.mjs (tested).
// /health + /queue-size are public; ops endpoints fail closed without a token.
const httpServer = createServer((req, res) => {
  const r = routeHttp(req, {
    activeCount: () => rooms.activeCount(),
    queueSize: () => rooms.getQueueSize(),
    metricsToken: METRICS_AUTH_TOKEN,
    renderPrometheus,
    renderJson,
    recentEvents,
  });
  const headers = { 'Access-Control-Allow-Origin': '*' };
  if (r.cors) {
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  }
  if (r.contentType) headers['Content-Type'] = r.contentType;
  res.writeHead(r.status, headers);
  res.end(r.body || '');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Admission (IP extraction + pending/attempt caps + pending lease). Rejected
  // sockets are already closed + counted by the controller.
  if (!controller.onConnect(ws, req)) return;

  ws._isAlive = true;
  ws._pingTracker = new PingTracker();
  ws._rttEstimator = new RttEstimator();
  ws.on('pong', () => { ws._isAlive = true; });

  ws.on('message', (raw) => {
    if (raw.length > MAX_MESSAGE_SIZE) {
      ws.close(1009, 'Message too large');
      return;
    }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    controller.onMessage(ws, msg);
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS CLOSE] uid=${ws._uid} role=${ws._role} room=${ws._roomCode} code=${code} reason=${reason?.toString() || 'none'}`);
    logEvent('ws_close', {
      uid: ws._uid?.slice(0, 8) || null,
      role: ws._role || null,
      room: ws._roomCode || null,
      code,
      reason: reason?.toString() || null,
      authed: !!ws._authenticated,
    });
    controller.onClose(ws);
  });

  ws.on('error', () => { controller._clearAuthTimer(ws); });
});

// Heartbeat + RTT ping. Every 25s: protocol-level WS ping for raw liveness,
// plus an app-level ping carrying a serverPingId so we can measure RTT on pong.
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
    const id = ws._pingTracker.startPing();
    send(ws, { type: 'ping', serverPingId: id });
  });
}, HEARTBEAT_INTERVAL_MS);

// Idle room sweep + rate-bucket/attempt/room-budget eviction (2A.8), on the
// configured cadence (MM_RATE_BUCKET_SWEEP_MS).
setInterval(() => {
  rooms.cleanupIdleRooms();
  rooms.cleanupMatchmakingQueue();
  controller.sweep();
}, TIMING.rate_bucket_sweep_ms);

// Durable metrics snapshot → Firestore every 5 minutes. Isolated: a write
// failure must never affect gameplay. No-ops in dev (no Firestore handle).
const METRICS_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
setInterval(async () => {
  const db = getFirestore();
  if (!db) return;
  try {
    const snap = buildSnapshot({
      json: renderJson(),
      releaseId: RELEASE_ID,
      processStartTimeMs: PROCESS_START_MS,
      nowMs: Date.now(),
    });
    await db.collection(snap.collection).doc(snap.docId).set(snap.data);
  } catch (e) {
    console.warn('[metrics-snapshot] write failed (isolated):', e?.message);
  }
}, METRICS_SNAPSHOT_INTERVAL_MS);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[MatGrind Server] Listening on port ${PORT}`);
  console.log(`[MatGrind Server] Health: http://localhost:${PORT}/health`);
});
