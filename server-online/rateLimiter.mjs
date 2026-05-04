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

  /**
   * Returns true and decrements a token if available; false otherwise.
   */
  consume() {
    const now = Date.now();
    const elapsed = (now - this.lastRefillAt) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.refillPerSec);
      this.lastRefillAt = now;
    }
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
  }

  /**
   * @param {string} key - typically `${category}:${uid}`
   * @param {number} refillPerSec
   * @param {number} burst
   * @returns {boolean} allowed
   */
  consume(key, refillPerSec, burst) {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(refillPerSec, burst);
      this.buckets.set(key, bucket);
    }
    return bucket.consume();
  }

  /**
   * Drop the bucket for a uid (e.g., on disconnect). Optional — buckets
   * naturally idle out, but explicit cleanup keeps memory tight.
   */
  reset(keyPrefix) {
    for (const k of this.buckets.keys()) {
      if (k.startsWith(keyPrefix)) this.buckets.delete(k);
    }
  }
}
