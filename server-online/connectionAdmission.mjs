// Connection admission control (Stage 2A). Extracted from index.mjs so the
// caps + IP logic can be unit-tested in isolation.
//
// Three independent guards, fair to whole teams behind one shared IP:
//   1. Attempt throttle  — per-IP rate/burst on connection attempts. Buckets
//                          carry an idle timestamp so they can be swept.
//   2. Pending caps       — per-IP + global cap on PRE-AUTH sockets. Each
//                          admit returns a one-shot LEASE; release is keyed on
//                          that lease so a duplicate cleanup can never decrement
//                          a different socket's slot.
//   3. Authed sessions    — per-IP cap on DISTINCT authenticated uids. A
//                          same-IP reconnect reuses its slot (succeeds even at
//                          cap); a move to a DIFFERENT IP obeys the destination
//                          cap. reserveSession returns priorIp so an aborted
//                          auth transaction can be rolled back exactly.
//
// Nothing here mutates room or socket state. Inject `incCounter` for telemetry
// and testability.

import { TokenBucket } from './rateLimiter.mjs';

export class ConnectionAdmission {
  constructor({ config, incCounter = () => {} } = {}) {
    if (!config) throw new Error('ConnectionAdmission requires a config');
    this.cfg = config;
    this.incCounter = incCounter;
    this.pendingByIp = new Map();   // ip  -> count of pre-auth sockets
    this.pendingTotal = 0;
    this.attemptByIp = new Map();   // ip  -> TokenBucket (attempt throttle)
    this.attemptSeenAt = new Map(); // ip  -> last attempt timestamp (for sweep)
    this.activeLeases = new Map();  // lease(object identity) -> ip (owns truth)
    this.sessionsByIp = new Map();  // ip  -> Set<uid> (authed)
    this.ipByUid = new Map();       // uid -> ip (current reservation)
  }

  // 2A.1 Trustworthy client IP. Precedence: X-Real-IP first (proxy-set, not
  // client-forgeable in our deployment), then a trusted X-Forwarded-For first
  // hop ONLY behind a known proxy, then the raw socket address.
  extractIp(req) {
    const h = (req && req.headers) || {};
    if (h['x-real-ip']) return String(h['x-real-ip']).trim();
    if (this.cfg.trusted_proxy && h['x-forwarded-for']) {
      return String(h['x-forwarded-for']).split(',')[0].trim();
    }
    return (req && req.socket && req.socket.remoteAddress) || null;
  }

  _reject(reason) {
    this.incCounter('connections_rejected_total', { reason });
    return { ok: false, reason };
  }

  // Emit a near-limit signal (≥90% of a cap) so caps can be tuned from
  // evidence before they start bouncing real teams.
  _nearLimit(value, cap, label) {
    if (cap > 0 && value >= Math.ceil(cap * 0.9)) {
      this.incCounter('admission_near_limit_total', { cap: label });
    }
  }

  // Pre-auth admission. Cheapest DoS guard (attempt throttle) first so a flood
  // never counts toward pending. On success returns a one-shot lease; pass it
  // to releasePending exactly once on auth-success OR close-before-auth (a
  // duplicate is a safe no-op).
  admitPending(ip, now = Date.now()) {
    let bucket = this.attemptByIp.get(ip);
    if (!bucket) {
      bucket = new TokenBucket(
        this.cfg.max_attempts_per_min_per_ip / 60,
        this.cfg.max_attempt_burst_per_ip,
      );
      this.attemptByIp.set(ip, bucket);
    }
    this.attemptSeenAt.set(ip, now);
    if (!bucket.consume(now)) return this._reject('attempt_throttle');

    if (this.pendingTotal >= this.cfg.max_pending_total) return this._reject('pending_total');
    const perIp = this.pendingByIp.get(ip) || 0;
    if (perIp >= this.cfg.max_pending_per_ip) return this._reject('pending_ip_limit');

    const nextPerIp = perIp + 1;
    this.pendingByIp.set(ip, nextPerIp);
    this.pendingTotal += 1;
    this._nearLimit(nextPerIp, this.cfg.max_pending_per_ip, 'pending_ip');
    this._nearLimit(this.pendingTotal, this.cfg.max_pending_total, 'pending_total');
    // The lease is an opaque handle whose authority lives ONLY in
    // activeLeases (identity-keyed). Caller-visible fields are ignored on
    // release, so a forged/foreign/mutated token cannot free a slot.
    const lease = {};
    this.activeLeases.set(lease, ip);
    return { ok: true, lease };
  }

  // Release a pending slot. Authority is identity-based: only a lease this
  // instance issued AND has not yet consumed does anything. Forged tokens,
  // tokens from another ConnectionAdmission, and re-submitted (already
  // consumed) tokens are all no-ops. Consumed exactly once.
  releasePending(lease) {
    if (!lease) return;
    const ip = this.activeLeases.get(lease);
    if (ip === undefined) return;       // forged / foreign / already consumed
    this.activeLeases.delete(lease);    // consume — second release is a no-op
    const perIp = this.pendingByIp.get(ip) || 0;
    if (perIp <= 1) this.pendingByIp.delete(ip);
    else this.pendingByIp.set(ip, perIp - 1);
    if (this.pendingTotal > 0) this.pendingTotal -= 1;
  }

  // Evict attempt buckets idle longer than idleMs. Returns number removed.
  // Wired into the same periodic interval as RateLimiter.sweep (Batch 6).
  sweepAttempts(idleMs, now = Date.now()) {
    let removed = 0;
    for (const [ip, ts] of this.attemptSeenAt) {
      if (now - ts > idleMs) {
        this.attemptByIp.delete(ip);
        this.attemptSeenAt.delete(ip);
        removed++;
      }
    }
    return removed;
  }

  // 2A.5 Reserve (or move) an authed session.
  //  - Same IP as the uid's current reservation → reuse it, succeed even at
  //    cap (the uid is already counted; a reconnect must not be bounced).
  //  - Brand-new uid OR a move to a DIFFERENT IP → the DESTINATION IP cap
  //    applies. If full, reject and leave the prior reservation untouched.
  // Returns { ok, transferred, priorIp } so the caller can roll back exactly.
  reserveSession(uid, ip) {
    const priorIp = this.ipByUid.get(uid);
    if (priorIp === ip) return { ok: true, transferred: true, priorIp };

    const set = this.sessionsByIp.get(ip);
    const size = set ? set.size : 0;
    if (size >= this.cfg.max_auth_sessions_per_ip) {
      return this._reject('auth_sessions_ip_limit'); // prior reservation intact
    }
    this._moveSession(uid, ip);
    this._nearLimit(this.sessionsByIp.get(ip).size, this.cfg.max_auth_sessions_per_ip, 'auth_sessions_ip');
    return { ok: true, transferred: priorIp !== undefined, priorIp };
  }

  // Undo a reserveSession the caller decided to abandon (Batch 6 auth
  // rollback). priorIp is the value reserveSession returned: undefined means
  // the uid was brand-new (remove it); otherwise restore it to where it was.
  rollbackReservation(uid, priorIp) {
    if (priorIp === undefined || priorIp === null) this.releaseSession(uid);
    else this._moveSession(uid, priorIp);
  }

  _moveSession(uid, ip) {
    const cur = this.ipByUid.get(uid);
    if (cur !== undefined && cur !== ip) {
      const oldSet = this.sessionsByIp.get(cur);
      if (oldSet) { oldSet.delete(uid); if (oldSet.size === 0) this.sessionsByIp.delete(cur); }
    }
    let set = this.sessionsByIp.get(ip);
    if (!set) { set = new Set(); this.sessionsByIp.set(ip, set); }
    set.add(uid);
    this.ipByUid.set(uid, ip);
  }

  // Release on last-socket-close for a uid.
  releaseSession(uid) {
    const ip = this.ipByUid.get(uid);
    if (ip === undefined) return;
    const set = this.sessionsByIp.get(ip);
    if (set) { set.delete(uid); if (set.size === 0) this.sessionsByIp.delete(ip); }
    this.ipByUid.delete(uid);
  }
}
