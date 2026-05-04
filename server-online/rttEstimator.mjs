// Per-connection RTT smoothing using TCP-style EWMA. Server emits ping
// periodically and measures pong receive time vs send time. The smoothed
// estimate is used by challengeEngine for full-RTT compensation in
// reaction-mechanic tier math.
//
// No artificial cap on smoothedMs - capping would punish legitimate
// high-RTT (cellular) users with false MISSes. Bots can't deflate RTT
// below the network floor; inflating RTT only hurts the bot via the
// sub-human reaction-time floor in computeChallengeTier.

export class RttEstimator {
  constructor(initialMs = 100) {
    this.smoothedMs = initialMs;
    this.samples = 0;
    this.lastSampleAt = null;
  }

  /**
   * Feed a fresh round-trip measurement (ms). First sample replaces the
   * initial estimate; subsequent samples are smoothed via TCP-alpha (1/8)
   * EWMA so brief jitter spikes don't whipsaw the estimate.
   */
  update(rttMs) {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    if (this.samples === 0) {
      this.smoothedMs = rttMs;
    } else {
      this.smoothedMs += 0.125 * (rttMs - this.smoothedMs);
    }
    this.samples += 1;
    this.lastSampleAt = Date.now();
  }
}

/**
 * Maintain pending pings keyed by id so we can match a `pong` to its
 * outbound `ping` for the round-trip measurement. Ping IDs auto-increment
 * per connection.
 */
export class PingTracker {
  constructor() {
    this.nextId = 1;
    this.pending = new Map(); // id -> sentAt
  }

  startPing() {
    const id = this.nextId++;
    this.pending.set(id, Date.now());
    // Cap pending entries so a malicious client that never sends pong
    // can't grow the map without bound.
    if (this.pending.size > 8) {
      const oldest = this.pending.keys().next().value;
      this.pending.delete(oldest);
    }
    return id;
  }

  /**
   * Resolve a pong reply. Returns the measured RTT (ms) or null if the
   * id is unknown or already resolved.
   */
  resolvePong(id) {
    const sentAt = this.pending.get(id);
    if (sentAt === undefined) return null;
    this.pending.delete(id);
    return Date.now() - sentAt;
  }
}
