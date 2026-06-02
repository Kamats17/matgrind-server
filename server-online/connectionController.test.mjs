// ConnectionController tests (Stage 2A Batch 6 + correction 1). Drives the
// controller with fakes — never imports the auto-listening index.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionController } from './connectionController.mjs';
import { ConnectionAdmission } from './connectionAdmission.mjs';
import { RateLimiter } from './rateLimiter.mjs';
import { RoomManager } from './roomManager.mjs';
import { RATE_LIMITS, TIMING } from './config.mjs';
import { resetMetrics, getCounter, incCounter, logEvent } from './metrics.mjs';

function admissionCfg(over = {}) {
  return {
    max_pending_per_ip: 30, max_pending_total: 200,
    max_attempts_per_min_per_ip: 6000, max_attempt_burst_per_ip: 1000,
    max_auth_sessions_per_ip: 100, trusted_proxy: false, ...over,
  };
}

let uidSeed = 0;
function fakeWs(uid) {
  return {
    _uid: uid || `u${uidSeed++}`,
    readyState: 1, sent: [], _closed: false,
    send(p) { if (this.readyState === 1) this.sent.push(JSON.parse(p)); },
    close() { this.readyState = 3; this._closed = true; },
    has(type) { return this.sent.some(m => m.type === type); },
    last(type) { const a = this.sent.filter(m => m.type === type); return a[a.length - 1]; },
  };
}
function req(headers = {}, remote = '9.9.9.9') { return { headers, socket: { remoteAddress: remote } }; }

function makeCtl(over = {}) {
  const rooms = over.rooms || new RoomManager();
  const admission = over.admission || new ConnectionAdmission({ config: admissionCfg(over.admissionCfg), incCounter });
  const rateLimiter = over.rateLimiter || new RateLimiter();
  const ctl = new ConnectionController({
    rooms, admission, rateLimiter,
    verifyToken: over.verifyToken || (async (t) => (typeof t === 'string' && t.startsWith('ok:')) ? t.slice(3) : null),
    config: { RATE_LIMITS, TIMING },
    metrics: { incCounter, logEvent },
    send: (ws, m) => { if (ws.readyState === 1 && ws.send) ws.send(JSON.stringify(m)); },
    now: () => 1000,
    timers: over.timers || { set: () => ({}), clear: () => {} },
    onPong: over.onPong,
    firstPing: over.firstPing,
    authTimeoutMs: over.authTimeoutMs ?? 10000,
  });
  return { ctl, rooms, admission, rateLimiter };
}

function playingRoom(rooms, hostUid = 'uidA', guestUid = 'uidB') {
  const host = fakeWs(hostUid); host._authenticated = true;
  const guest = fakeWs(guestUid); guest._authenticated = true;
  const code = rooms.createRoom(host, 'A', 'folkstyle');
  rooms.joinRoom(guest, code, 'B');
  return { host, guest, code };
}

// ── Admission ──────────────────────────────────────────────────────────────

test('onConnect admits a socket, assigns a pending lease, sets pending state', () => {
  const { ctl } = makeCtl();
  const ws = fakeWs();
  assert.equal(ctl.onConnect(ws, req()), true);
  assert.ok(ws._pendingLease, 'pending lease assigned');
  assert.equal(ws._authState, 'pending');
  assert.equal(ws._ip, '9.9.9.9');
});

test('onConnect rejects + closes when the IP pending cap is exhausted', () => {
  const { ctl } = makeCtl({ admissionCfg: { max_pending_per_ip: 2 } });
  for (let i = 0; i < 2; i++) assert.equal(ctl.onConnect(fakeWs(), req()), true);
  const ws = fakeWs();
  assert.equal(ctl.onConnect(ws, req()), false);
  assert.equal(ws._closed, true);
});

// ── Routing ──────────────────────────────────────────────────────────────

test('onMessage drops frames from a superseded socket', () => {
  const { ctl } = makeCtl();
  const ws = fakeWs(); ws._authenticated = true; ws._superseded = true;
  ctl.onMessage(ws, { type: 'create_room', name: 'x' });
  assert.equal(ws.sent.length, 0);
});

test('onMessage rejects non-auth frames before authentication', () => {
  const { ctl } = makeCtl();
  const ws = fakeWs(); ws._authenticated = false;
  ctl.onMessage(ws, { type: 'find_match' });
  assert.ok(ws.has('error') && ws.last('error').code === 'not_authenticated');
});

// ── Correction 1: consume-first ordering vs rate-limit ─────────────────────

test('a rate-limited non-find first frame STILL consumes legacy eligibility', () => {
  resetMetrics();
  const { ctl, rooms, rateLimiter } = makeCtl();
  const { host, code } = playingRoom(rooms);
  host._legacyResumeEligible = { roomCode: code, expiresAt: 9e15 };
  for (let i = 0; i < RATE_LIMITS.msgs_burst; i++) rateLimiter.consume(`msg:${host._uid}`, RATE_LIMITS.msgs_per_sec, RATE_LIMITS.msgs_burst);
  host.sent.length = 0;
  ctl.onMessage(host, { type: 'card_pick', roundSeq: 1, cardId: 'x' });
  assert.ok(host.has('error') && host.last('error').code === 'rate_limited', 'frame was rate-limited');
  assert.equal(host._legacyResumeEligible, null, 'eligibility consumed BEFORE the rate-limit early return');
});

test('an unknown first frame consumes eligibility then routes to unknown_message_type', () => {
  resetMetrics();
  const { ctl, rooms } = makeCtl();
  const { host, code } = playingRoom(rooms);
  host._legacyResumeEligible = { roomCode: code, expiresAt: 9e15 };
  host.sent.length = 0;
  ctl.onMessage(host, { type: 'totally_unknown' });
  assert.equal(host._legacyResumeEligible, null, 'unknown first frame clears eligibility');
  assert.ok(host.has('error') && host.last('error').code === 'unknown_message_type');
});

test('a valid eligible find_match resumes even when the message bucket is exhausted', () => {
  resetMetrics();
  const { ctl, rooms, rateLimiter } = makeCtl();
  const { host, code } = playingRoom(rooms);
  host._legacyResumeEligible = { roomCode: code, expiresAt: 9e15 };
  for (let i = 0; i < RATE_LIMITS.msgs_burst; i++) rateLimiter.consume(`msg:${host._uid}`, RATE_LIMITS.msgs_per_sec, RATE_LIMITS.msgs_burst);
  host.sent.length = 0;
  ctl.onMessage(host, { type: 'find_match', name: 'A', style: 'folkstyle' });
  assert.ok(host.has('game_start'), 'resumed despite an exhausted message bucket');
  assert.equal(getCounter('legacy_find_match_resume_total'), 1);
});

test('a second find_match cannot replay (one-shot)', () => {
  resetMetrics();
  const { ctl, rooms } = makeCtl();
  const { host, code } = playingRoom(rooms);
  host._legacyResumeEligible = { roomCode: code, expiresAt: 9e15 };
  ctl.onMessage(host, { type: 'find_match' });   // resumes
  host.sent.length = 0;
  ctl.onMessage(host, { type: 'find_match' });   // no eligibility → membership reject
  assert.ok(host.has('error') && host.last('error').code === 'already_in_room');
  assert.equal(getCounter('legacy_find_match_resume_total'), 1);
});

// ── Auth transaction: one outcome ──────────────────────────────────────────

test('auth (none): a fresh uid gets exactly auth_success and releases pending', async () => {
  resetMetrics();
  const { ctl } = makeCtl();
  const ws = fakeWs(); ctl.onConnect(ws, req());
  await ctl.handleAuth(ws, 'ok:uidA');
  assert.ok(ws.has('auth_success'));
  assert.equal(ws.last('auth_success').uid, 'uidA');
  assert.equal(ws.has('reconnected'), false);
  assert.equal(ws.has('match_voided'), false);
  assert.equal(ws._pendingLease, null, 'pending lease released on auth');
});

test('auth (active): a reconnecting player gets reconnected and NO auth_success', async () => {
  resetMetrics();
  const { ctl, rooms } = makeCtl();
  const { host, code } = playingRoom(rooms);
  rooms.handleDisconnect(host);
  const ws = fakeWs('uidA'); ctl.onConnect(ws, req());
  await ctl.handleAuth(ws, 'ok:uidA');
  assert.ok(ws.has('reconnected'), 'reconnected emitted');
  assert.equal(ws.has('auth_success'), false, 'auth_success suppressed for an active reconnect');
  assert.equal(ws._roomCode, code, 'socket adopted into the room');
});

test('auth (terminal): a voided-room reconnect gets match_voided, closes, adopts nothing', async () => {
  resetMetrics();
  const { ctl, rooms, admission } = makeCtl();
  const { code } = playingRoom(rooms);
  rooms._voidRoom(rooms.rooms.get(code), 'test');
  const ws = fakeWs('uidA'); ctl.onConnect(ws, req());
  await ctl.handleAuth(ws, 'ok:uidA');
  assert.ok(ws.has('match_voided'));
  assert.equal(ws.has('auth_success'), false);
  assert.equal(ws._closed, true, 'terminal socket closed');
  assert.equal(ctl.socketByUid.has('uidA'), false, 'no authoritative socket registered');
  assert.equal(admission.ipByUid.has('uidA'), false, 'no session reserved for a terminal reconnect');
});

test('a duplicate auth frame is rejected without re-running the transaction', async () => {
  resetMetrics();
  const { ctl } = makeCtl();
  const ws = fakeWs(); ctl.onConnect(ws, req());
  await ctl.handleAuth(ws, 'ok:uidA');
  ws.sent.length = 0;
  await ctl.handleAuth(ws, 'ok:uidA');
  assert.ok(ws.has('auth_error') && ws.last('auth_error').message === 'Already authenticating');
});

test('the auth deadline is cleared ONLY after verifyToken resolves', async () => {
  let clearedDuringVerify = null, cleared = false;
  const timers = { set: () => ({}), clear: () => { cleared = true; } };
  const verifyToken = async () => { clearedDuringVerify = cleared; return 'uidA'; };
  const { ctl } = makeCtl({ timers, verifyToken });
  const ws = fakeWs(); ctl.onConnect(ws, req());
  await ctl.handleAuth(ws, 'whatever');
  assert.equal(clearedDuringVerify, false, 'deadline still armed during verify');
  assert.equal(cleared, true, 'deadline cleared after verify');
});

// ── Sessions: supersede + rollback + cleanup ───────────────────────────────

test('rollback: a reconnect from a FULL new IP leaves the old session working', async () => {
  resetMetrics();
  const admission = new ConnectionAdmission({ config: admissionCfg({ max_auth_sessions_per_ip: 1 }), incCounter });
  const { ctl } = makeCtl({ admission });
  const a = fakeWs('uidA'); ctl.onConnect(a, req({}, 'ipA')); await ctl.handleAuth(a, 'ok:uidA');
  const b = fakeWs('uidB'); ctl.onConnect(b, req({}, 'ipB')); await ctl.handleAuth(b, 'ok:uidB');
  const a2 = fakeWs('uidA'); ctl.onConnect(a2, req({}, 'ipB')); await ctl.handleAuth(a2, 'ok:uidA');
  assert.ok(a2.has('auth_error'), 'new-IP-full reconnect rejected');
  assert.equal(a2._closed, true);
  assert.equal(ctl.socketByUid.get('uidA'), a, 'old session still authoritative (rollback)');
  assert.equal(admission.ipByUid.get('uidA'), 'ipA', 'uidA reservation untouched on ipA');
});

test('a second auth for the same uid supersedes the old socket', async () => {
  resetMetrics();
  const { ctl } = makeCtl();
  const a = fakeWs('uidA'); ctl.onConnect(a, req()); await ctl.handleAuth(a, 'ok:uidA');
  const a2 = fakeWs('uidA'); ctl.onConnect(a2, req());
  a.sent.length = 0;
  await ctl.handleAuth(a2, 'ok:uidA');
  assert.equal(a._superseded, true, 'old socket marked superseded');
  assert.ok(a.has('auth_error') && a.last('auth_error').code === 'session_superseded');
  assert.equal(a._closed, true, 'old socket closed');
  assert.equal(ctl.socketByUid.get('uidA'), a2, 'new socket authoritative');
});

test('a superseded socket close does not delete the replacement or release its session', async () => {
  resetMetrics();
  const { ctl, admission } = makeCtl();
  const a = fakeWs('uidA'); ctl.onConnect(a, req()); await ctl.handleAuth(a, 'ok:uidA');
  const a2 = fakeWs('uidA'); ctl.onConnect(a2, req()); await ctl.handleAuth(a2, 'ok:uidA');
  ctl.onClose(a); // stale close of the superseded socket
  assert.equal(ctl.socketByUid.get('uidA'), a2, 'replacement still authoritative');
  assert.equal(admission.ipByUid.has('uidA'), true, 'replacement session not released by a stale close');
});

test('an authoritative socket close releases its session and resets its buckets', async () => {
  resetMetrics();
  const { ctl, admission, rateLimiter } = makeCtl();
  const a = fakeWs('uidA'); ctl.onConnect(a, req()); await ctl.handleAuth(a, 'ok:uidA');
  rateLimiter.consume('msg:uidA', 10, 5);
  ctl.onClose(a);
  assert.equal(ctl.socketByUid.has('uidA'), false);
  assert.equal(admission.ipByUid.has('uidA'), false, 'session released');
  assert.equal(rateLimiter.buckets.has('msg:uidA'), false, 'msg bucket reset on last close');
});

test('8 distinct uids on one IP all authenticate (no false IP cap)', async () => {
  resetMetrics();
  const { ctl } = makeCtl();
  const wss = [];
  for (let i = 0; i < 8; i++) {
    const ws = fakeWs(`uid${i}`); ctl.onConnect(ws, req({}, 'school'));
    await ctl.handleAuth(ws, `ok:uid${i}`);
    wss.push(ws);
  }
  for (let i = 0; i < 8; i++) assert.ok(wss[i].has('auth_success'), `uid${i} authed`);
  assert.equal(ctl.socketByUid.size, 8);
});

// ── Malformed message hardening (correction 1) ─────────────────────────────

test('authenticated malformed frames never throw and are dropped', () => {
  const { ctl } = makeCtl();
  const ws = fakeWs(); ws._authenticated = true;
  for (const bad of [null, undefined, [], 5, 'str', true, {}, { type: 5 }, { type: null }]) {
    assert.doesNotThrow(() => ctl.onMessage(ws, bad), `threw on ${JSON.stringify(bad)}`);
  }
  assert.equal(ws.sent.length, 0, 'malformed frames produce no response (bounded work)');
});

test('a malformed first non-pong frame consumes legacy eligibility (no later reuse)', () => {
  resetMetrics();
  const { ctl, rooms } = makeCtl();
  const { host, code } = playingRoom(rooms);
  host._legacyResumeEligible = { roomCode: code, expiresAt: 9e15 };
  ctl.onMessage(host, null);
  assert.equal(host._legacyResumeEligible, null, 'malformed frame consumed eligibility');
  host.sent.length = 0;
  ctl.onMessage(host, { type: 'find_match' });
  assert.equal(host.has('game_start'), false, 'no replay after a malformed first frame');
  assert.ok(host.has('error') && host.last('error').code === 'already_in_room');
});

// ── Terminal spectator (correction 2) ──────────────────────────────────────

test('auth (terminal spectator): voided-room spectator gets match_voided, closes, no reserve/adopt', async () => {
  resetMetrics();
  const { ctl, rooms, admission } = makeCtl();
  const { code } = playingRoom(rooms);
  const spec = fakeWs('uidS'); spec._authenticated = true;
  rooms.spectateRoom(spec, code);
  rooms._voidRoom(rooms.rooms.get(code), 'test');
  const ws = fakeWs('uidS'); ctl.onConnect(ws, req());
  await ctl.handleAuth(ws, 'ok:uidS');
  assert.ok(ws.has('match_voided'));
  assert.equal(ws.has('reconnected'), false);
  assert.equal(ws.has('auth_success'), false);
  assert.equal(ws._closed, true);
  assert.equal(ctl.socketByUid.has('uidS'), false, 'terminal spectator not registered');
  assert.equal(admission.ipByUid.has('uidS'), false, 'no session reserved for a terminal spectator');
});

// ── Pending-lease release on every terminal pre-auth path (correction 3) ───

test('invalid token releases the pending lease immediately (before close)', async () => {
  resetMetrics();
  const { ctl, admission } = makeCtl();
  const ws = fakeWs(); ctl.onConnect(ws, req());
  await ctl.handleAuth(ws, 'bad-token');
  assert.equal(admission.pendingByIp.get('9.9.9.9'), undefined, 'pending released on invalid token');
  assert.equal(ws._authState, 'released');
  assert.ok(ws.has('auth_error'));
});

test('session-cap rejection releases the pending lease immediately', async () => {
  resetMetrics();
  const admission = new ConnectionAdmission({ config: admissionCfg({ max_auth_sessions_per_ip: 1 }), incCounter });
  const { ctl } = makeCtl({ admission });
  const a = fakeWs('uidA'); ctl.onConnect(a, req()); await ctl.handleAuth(a, 'ok:uidA');
  const b = fakeWs('uidB'); ctl.onConnect(b, req());
  await ctl.handleAuth(b, 'ok:uidB'); // ip full → reserveSession reject
  assert.equal(admission.pendingByIp.get('9.9.9.9'), undefined, 'pending released on session-cap reject');
  assert.equal(b._authState, 'released');
});

test('the auth-timeout deadline releases the pending lease immediately', () => {
  resetMetrics();
  let timerFn;
  const timers = { set: (fn) => { timerFn = fn; return {}; }, clear: () => {} };
  const { ctl, admission } = makeCtl({ timers });
  const ws = fakeWs(); ctl.onConnect(ws, req());
  timerFn(); // simulate the deadline firing before auth
  assert.equal(admission.pendingByIp.get('9.9.9.9'), undefined, 'pending released on auth timeout');
  assert.equal(ws._authState, 'released');
  assert.ok(ws.has('error') && ws.last('error').code === 'auth_timeout');
});

// ── Commit boundary: post-success hooks are isolated (correction 4) ────────

test('a throwing firstPing does NOT roll back a committed auth', async () => {
  resetMetrics();
  const { ctl, admission } = makeCtl({ firstPing: () => { throw new Error('ping boom'); } });
  const ws = fakeWs(); ctl.onConnect(ws, req());
  await ctl.handleAuth(ws, 'ok:uidA');
  assert.ok(ws.has('auth_success'), 'exactly one success outcome stands');
  assert.equal(ws.has('auth_error'), false, 'no second/contradictory outcome');
  assert.equal(ctl.socketByUid.get('uidA'), ws, 'socket authority retained');
  assert.equal(admission.ipByUid.get('uidA'), '9.9.9.9', 'reservation retained');
});

test('a synchronous old-socket close() failure does not roll back the committed replacement', async () => {
  resetMetrics();
  const { ctl, admission } = makeCtl();
  const a = fakeWs('uidA'); ctl.onConnect(a, req()); await ctl.handleAuth(a, 'ok:uidA');
  a.close = () => { a.readyState = 3; throw new Error('close boom'); }; // old socket's close throws
  const a2 = fakeWs('uidA'); ctl.onConnect(a2, req());
  await ctl.handleAuth(a2, 'ok:uidA');
  assert.equal(a2._authenticated, true, 'replacement stays authenticated');
  assert.equal(ctl.socketByUid.get('uidA'), a2, 'authority points to the replacement');
  assert.equal(admission.ipByUid.get('uidA'), '9.9.9.9', 'reservation remains committed');
  assert.ok(a2.has('auth_success'), 'replacement got its single success outcome');
  assert.equal(a2.has('auth_error'), false, 'no contradictory auth_error to the replacement');
});

test('a failed pre-commit replacement does not destroy the established old socket', async () => {
  resetMetrics();
  const { ctl, rooms } = makeCtl();
  const a = fakeWs('uidA'); ctl.onConnect(a, req()); await ctl.handleAuth(a, 'ok:uidA');
  assert.equal(ctl.socketByUid.get('uidA'), a);
  const a2 = fakeWs('uidA'); ctl.onConnect(a2, req());
  const realHR = rooms.handleReconnect.bind(rooms);
  rooms.handleReconnect = () => { throw new Error('mid-commit boom'); };
  await ctl.handleAuth(a2, 'ok:uidA');
  rooms.handleReconnect = realHR;
  assert.ok(!a._superseded, 'old socket NOT superseded by a failed replacement');
  assert.equal(a._closed, false, 'old socket not closed');
  assert.equal(ctl.socketByUid.get('uidA'), a, 'old socket retains authority');
  assert.ok(a2.has('auth_error'), 'failed new socket got auth_error');
});

// ── Sweep ──────────────────────────────────────────────────────────────────

test('sweep evicts idle buckets across limiter, attempts, and room budgets', () => {
  const { ctl, rooms, admission, rateLimiter } = makeCtl();
  rateLimiter.consume('msg:old', 10, 5, 0);
  admission.admitPending('ipold', 0);
  rooms.roomLimiter.consume('room:old', 1, 10, 0);
  ctl.sweep(TIMING.rate_bucket_idle_ttl_ms + 1);
  assert.equal(rateLimiter.buckets.has('msg:old'), false, 'limiter swept');
  assert.equal(admission.attemptByIp.has('ipold'), false, 'attempt buckets swept');
  assert.equal(rooms.roomLimiter.buckets.has('room:old'), false, 'room budgets swept');
});
