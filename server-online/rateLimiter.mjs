// Simple token bucket per uid. Refill rate and burst capacity are
// independent so we can allow legitimate brief bursts (e.g., Burst
// minigame ~10 taps/sec) while still rejecting sustained autoclicker
// floods. Returns true if the message is allowed, false if rate-limited.

export class TokenBucket {
  /**
   * @param {number} refillPerSec - tokens added per second
   * @param {number} burst - max tokens (capacity)
   */
  constructor(refillPerSec, burst) {
    this.refillPerSec = refillPerSec;
    this.burst = burst;
    this.tokens = burst;
    this.lastRefillAt = Date.now();
  }

  /** Advance the token count for elapsed time. Idempotent for a given `now`. */
  _refill(now = Date.now()) {
    const elapsed = (now - this.lastRefillAt) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.refillPerSec);
      this.lastRefillAt = now;
    }
  }

  /**
   * Returns true and decrements a token if available; false otherwise.
   */
  consume(now = Date.now()) {
    this._refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

/**
 * Map uid -> bucket. One bucket per uid per category (msgs vs challenge_input).
 */
export class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.lastUsed = new Map();   // key -> last consume timestamp (ms)
  }

  /**
   * @param {string} key - typically `${category}:${uid}`
   * @param {number} refillPerSec
   * @param {number} burst
   * @param {number} [now] - injectable clock for deterministic eviction tests
   * @returns {boolean} allowed
   */
  consume(key, refillPerSec, burst, now = Date.now()) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(refillPerSec, burst);
      this.buckets.set(key, bucket);
    }
    this.lastUsed.set(key, now);
    return bucket.consume(now);
  }

  _bucket(key, refillPerSec, burst, now) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(refillPerSec, burst);
      this.buckets.set(key, bucket);
    }
    this.lastUsed.set(key, now);
    bucket._refill(now);
    return bucket;
  }

  /**
   * Non-destructive peek: refill, then report whether a token is available
   * WITHOUT consuming one. Used for two-phase (preflight + commit) charging.
   */
  canConsume(key, refillPerSec, burst, now = Date.now()) {
    return this._bucket(key, refillPerSec, burst, now).tokens >= 1;
  }

  /**
   * Atomic all-or-nothing charge across multiple keys (Stage 2A.7 matchmaking
   * charges both uids). Charges every key only if EVERY key has a token; if
   * any is short, nothing is consumed — an innocent uid is never charged for a
   * peer's failure. Keys are de-duplicated so a repeated key is charged once.
   */
  tryConsumeMany(keys, refillPerSec, burst, now = Date.now()) {
    const uniq = [...new Set(keys)];
    const buckets = uniq.map(k => this._bucket(k, refillPerSec, burst, now));
    if (!buckets.every(b => b.tokens >= 1)) return false;
    for (const b of buckets) b.tokens -= 1;
    return true;
  }

  /**
   * Drop the bucket for one EXACT key (Stage 2A.8). Never a prefix match: a
   * `startsWith` reset could wipe a different uid that happens to share a
   * prefix (`msg:uid-a` vs `msg:uid-ab`). Callers pass the full key,
   * e.g. `msg:${uid}` / `cha:${uid}`.
   */
  reset(key) {
    this.buckets.delete(key);
    this.lastUsed.delete(key);
  }

  /**
   * Evict buckets idle longer than `idleMs`. Run periodically so abandoned
   * per-uid buckets don't accumulate. `room:` budgets are swept here too —
   * they are intentionally never reset on disconnect, only aged out.
   * @returns {number} buckets removed
   */
  sweep(idleMs, now = Date.now()) {
    let removed = 0;
    for (const [key, ts] of this.lastUsed) {
      if (now - ts > idleMs) {
        this.buckets.delete(key);
        this.lastUsed.delete(key);
        removed++;
      }
    }
    return removed;
  }
}
