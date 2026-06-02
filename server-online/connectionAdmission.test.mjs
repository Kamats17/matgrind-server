import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionAdmission } from './connectionAdmission.mjs';

function mk(overrides = {}, incCounter) {
  const config = {
    max_pending_per_ip: 3,
    max_pending_total: 5,
    max_attempts_per_min_per_ip: 6000,
    max_attempt_burst_per_ip: 100,
    max_auth_sessions_per_ip: 2,
    trusted_proxy: false,
    ...overrides,
  };
  return new ConnectionAdmission({ config, incCounter });
}

// ── 2A.1 Trustworthy IP precedence ─────────────────────────────────────────

test('extractIp (untrusted) ignores X-Forwarded-For and uses X-Real-IP', () => {
  const a = mk({ trusted_proxy: false });
  assert.equal(a.extractIp({
    headers: { 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' },
    socket: { remoteAddress: '3.3.3.3' },
  }), '2.2.2.2');
});

test('extractIp (untrusted) falls back to socket.remoteAddress', () => {
  const a = mk({ trusted_proxy: false });
  assert.equal(a.extractIp({ headers: { 'x-forwarded-for': '1.1.1.1' }, socket: { remoteAddress: '3.3.3.3' } }), '3.3.3.3');
});

test('extractIp (trusted_proxy) uses the first X-Forwarded-For hop when no X-Real-IP', () => {
  const a = mk({ trusted_proxy: true });
  assert.equal(a.extractIp({ headers: { 'x-forwarded-for': '1.1.1.1, 9.9.9.9' }, socket: { remoteAddress: '3.3.3.3' } }), '1.1.1.1');
});

test('extractIp prefers X-Real-IP even when trusted_proxy and XFF are both present', () => {
  const a = mk({ trusted_proxy: true });
  assert.equal(a.extractIp({
    headers: { 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '1.1.1.1' },
    socket: { remoteAddress: '3.3.3.3' },
  }), '2.2.2.2', 'X-Real-IP is first precedence regardless of proxy trust');
});

// ── 2A.4 Pending caps + lease-scoped idempotent release ────────────────────

test('admitPending enforces the per-IP pending cap and frees on lease release', () => {
  const a = mk();
  const leases = [];
  for (let i = 0; i < 3; i++) {
    const r = a.admitPending('ip');
    assert.equal(r.ok, true, `pending ${i}`);
    leases.push(r.lease);
  }
  assert.deepEqual(a.admitPending('ip'), { ok: false, reason: 'pending_ip_limit' });
  a.releasePending(leases[0]);
  assert.equal(a.admitPending('ip').ok, true, 'a freed slot is reusable');
});

test('admitPending enforces the total pending cap across IPs', () => {
  const a = mk(); // total 5, per-ip 3
  for (let i = 0; i < 3; i++) a.admitPending('ipA');
  for (let i = 0; i < 2; i++) a.admitPending('ipB'); // total now 5
  assert.deepEqual(a.admitPending('ipC'), { ok: false, reason: 'pending_total' });
});

test('admitPending throttles attempt bursts per IP', () => {
  const a = mk({ max_attempt_burst_per_ip: 4, max_pending_per_ip: 100, max_pending_total: 1000 });
  for (let i = 0; i < 4; i++) assert.equal(a.admitPending('ip').ok, true, `attempt ${i}`);
  assert.deepEqual(a.admitPending('ip'), { ok: false, reason: 'attempt_throttle' });
});

test('duplicate releasePending of one lease frees exactly one slot', () => {
  const a = mk(); // per-ip 3
  const l1 = a.admitPending('ip').lease;
  a.admitPending('ip');
  a.admitPending('ip'); // ip now full (3)
  a.releasePending(l1);
  a.releasePending(l1); // duplicate must be a no-op
  assert.equal(a.admitPending('ip').ok, true, 'one slot freed');
  assert.deepEqual(a.admitPending('ip'), { ok: false, reason: 'pending_ip_limit' }, 'no second slot leaked');
});

test('releasing one socket lease never frees another socket on the same IP', () => {
  const a = mk(); // per-ip 3
  const l1 = a.admitPending('ip').lease;
  a.admitPending('ip').lease; // l2 holds its own slot
  a.releasePending(l1);
  a.releasePending(l1); // dup
  assert.equal(a.admitPending('ip').ok, true);  // -> 2 used
  assert.equal(a.admitPending('ip').ok, true);  // -> 3 used (full)
  assert.deepEqual(a.admitPending('ip'), { ok: false, reason: 'pending_ip_limit' }, 'l2 slot still counted');
});

test('releasePending ignores a forged lease object', () => {
  const a = mk(); // per-ip 3
  for (let i = 0; i < 3; i++) a.admitPending('ip'); // full
  a.releasePending({ ip: 'ip', released: false }); // forged, never issued
  assert.deepEqual(a.admitPending('ip'), { ok: false, reason: 'pending_ip_limit' }, 'forged release frees nothing');
});

test('releasePending ignores a lease issued by another instance', () => {
  const a = mk();
  const b = mk();
  for (let i = 0; i < 3; i++) a.admitPending('ip'); // a full
  const foreign = b.admitPending('ip').lease;
  a.releasePending(foreign);
  assert.deepEqual(a.admitPending('ip'), { ok: false, reason: 'pending_ip_limit' }, 'foreign lease frees nothing in a');
});

test('mutating a returned lease cannot enable a second release', () => {
  const a = mk(); // per-ip 3
  const l1 = a.admitPending('ip').lease;
  a.admitPending('ip');
  a.admitPending('ip'); // full (3)
  a.releasePending(l1);  // frees one
  l1.released = false;   // attempt to re-arm a caller-visible field
  a.releasePending(l1);  // already consumed → no-op
  assert.equal(a.admitPending('ip').ok, true, 'exactly one slot freed');
  assert.deepEqual(a.admitPending('ip'), { ok: false, reason: 'pending_ip_limit' }, 're-arm did not leak a slot');
});

// ── 2A.4 Attempt-bucket eviction ───────────────────────────────────────────

test('admitPending refills the attempt bucket using the INJECTED clock', () => {
  // 1 token/sec, burst 2, generous pending caps so only the attempt throttle bites.
  // The TokenBucket anchors its first refill at real Date.now(), so base the
  // injected timeline there; the 2s gap dwarfs any sub-ms construction jitter.
  const a = mk({ max_attempt_burst_per_ip: 2, max_attempts_per_min_per_ip: 60, max_pending_per_ip: 100, max_pending_total: 1000 });
  const t0 = Date.now();
  assert.equal(a.admitPending('ip', t0).ok, true);
  assert.equal(a.admitPending('ip', t0).ok, true);
  assert.deepEqual(a.admitPending('ip', t0), { ok: false, reason: 'attempt_throttle' }, 'burst exhausted');
  // 2s later 2 tokens refill — ONLY if admitPending forwards `now` to consume.
  // (If consume ignored it and used Date.now(), barely any time has passed and
  // this call would still throttle.)
  assert.equal(a.admitPending('ip', t0 + 2000).ok, true, 'refilled by the injected clock, not Date.now()');
});

test('sweepAttempts evicts idle attempt buckets', () => {
  const a = mk({ max_pending_per_ip: 100, max_pending_total: 1000 });
  const t0 = 1_000_000;
  a.admitPending('ipA', t0);
  a.admitPending('ipB', t0 + 50_000);
  const removed = a.sweepAttempts(30_000, t0 + 60_000); // ipA idle 60s, ipB idle 10s
  assert.equal(removed, 1);
  assert.equal(a.attemptByIp.has('ipA'), false);
  assert.equal(a.attemptByIp.has('ipB'), true);
});

// ── 2A.5 Authed-IP sessions: cross-IP semantics + rollback ─────────────────

test('reserveSession enforces distinct-uid-per-IP cap and frees on release', () => {
  const a = mk(); // cap 2
  assert.equal(a.reserveSession('uidA', 'ip').ok, true);
  assert.equal(a.reserveSession('uidB', 'ip').ok, true);
  assert.deepEqual(a.reserveSession('uidC', 'ip'), { ok: false, reason: 'auth_sessions_ip_limit' });
  a.releaseSession('uidA');
  assert.equal(a.reserveSession('uidC', 'ip').ok, true, 'released slot reusable');
});

test('same uid reconnecting on the SAME IP succeeds even at cap', () => {
  const a = mk(); // cap 2
  a.reserveSession('uidA', 'ip');
  a.reserveSession('uidB', 'ip'); // ip at cap
  assert.equal(a.reserveSession('uidB', 'ip').ok, true, 'same-IP reconnect reuses its slot');
});

test('same uid moving to a DIFFERENT full IP is rejected; old reservation intact', () => {
  const a = mk(); // cap 2
  a.reserveSession('uidX', 'ip1');
  a.reserveSession('uidC', 'ip2');
  a.reserveSession('uidD', 'ip2'); // ip2 full
  const r = a.reserveSession('uidX', 'ip2');
  assert.deepEqual(r, { ok: false, reason: 'auth_sessions_ip_limit' });
  assert.equal(a.ipByUid.get('uidX'), 'ip1', 'old reservation unchanged');
  assert.equal(a.sessionsByIp.get('ip2').size, 2, 'destination IP not grown');
});

test('same uid moving to a DIFFERENT IP with room transfers off the old IP', () => {
  const a = mk(); // cap 2
  a.reserveSession('uidX', 'ip1');
  a.reserveSession('uidC', 'ip2'); // ip2 size 1
  const r = a.reserveSession('uidX', 'ip2');
  assert.equal(r.ok, true);
  assert.equal(r.priorIp, 'ip1');
  assert.equal(a.sessionsByIp.has('ip1'), false, 'old IP emptied');
  assert.equal(a.ipByUid.get('uidX'), 'ip2');
});

test('rollbackReservation restores the prior reservation after a move', () => {
  const a = mk();
  a.reserveSession('uidX', 'ip1');
  const r2 = a.reserveSession('uidX', 'ip2');
  a.rollbackReservation('uidX', r2.priorIp); // priorIp === 'ip1'
  assert.equal(a.ipByUid.get('uidX'), 'ip1', 'restored to ip1');
  assert.equal(a.sessionsByIp.has('ip2'), false);
});

test('rollbackReservation removes a brand-new reservation', () => {
  const a = mk();
  const r = a.reserveSession('uidNew', 'ip'); // priorIp === undefined
  a.rollbackReservation('uidNew', r.priorIp);
  assert.equal(a.ipByUid.has('uidNew'), false);
});

// ── Telemetry ───────────────────────────────────────────────────────────────

test('a rejected admission emits connections_rejected_total{reason}', () => {
  const calls = [];
  const a = mk({}, (name, labels) => calls.push({ name, labels }));
  for (let i = 0; i < 3; i++) a.admitPending('ip');
  a.admitPending('ip'); // rejected: pending_ip_limit
  assert.ok(calls.find(c => c.name === 'connections_rejected_total' && c.labels?.reason === 'pending_ip_limit'));
});

test('near-limit metrics fire for pending_ip, pending_total, and auth_sessions_ip', () => {
  // pending_ip: cap 10 → threshold ceil(9)
  let calls = [];
  let a = mk({ max_pending_per_ip: 10, max_pending_total: 1000 }, (n, l) => calls.push({ n, l }));
  for (let i = 0; i < 9; i++) a.admitPending('ip');
  assert.ok(calls.some(c => c.n === 'admission_near_limit_total' && c.l?.cap === 'pending_ip'), 'pending_ip');

  // pending_total: cap 10, high per-ip so only total trips
  calls = [];
  a = mk({ max_pending_per_ip: 1000, max_pending_total: 10 }, (n, l) => calls.push({ n, l }));
  for (let i = 0; i < 9; i++) a.admitPending('ip');
  assert.ok(calls.some(c => c.l?.cap === 'pending_total'), 'pending_total');

  // auth_sessions_ip: cap 10
  calls = [];
  a = mk({ max_auth_sessions_per_ip: 10 }, (n, l) => calls.push({ n, l }));
  for (let i = 0; i < 9; i++) a.reserveSession('u' + i, 'ip');
  assert.ok(calls.some(c => c.l?.cap === 'auth_sessions_ip'), 'auth_sessions_ip');
});
