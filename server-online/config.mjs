// Tunable constants for the authoritative online server. Read from
// environment variables at boot so production tuning doesn't require a
// code change. Defaults match the per-mechanic logic in
// src/lib/cardArchetypeMechanics.js.

function envInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Strict positive-integer parse: anything that is not a finite integer > 0
// falls back. Used for admission/limiter caps where a 0 or garbage value
// would silently disable a DoS guard.
export function envPosInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return (Number.isInteger(n) && n > 0) ? n : fallback;
}

// Strict boolean parse: only the exact string 'true' is true. Avoids a
// stray 'false'/'0'/'yes' accidentally enabling proxy trust.
export function envBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === 'true';
}

// Anti-cheat floors. Inputs faster than these = bot.
export const HUMAN_LIMITS = {
  press_min_offset_ms:    envInt('MM_PRESS_MIN_OFFSET_MS',    50),
  charge_min_held_ms:     envInt('MM_CHARGE_MIN_HELD_MS',     100),
  trace_min_swipe_gap_ms: envInt('MM_TRACE_MIN_SWIPE_GAP_MS', 80),
  burst_max_taps_per_sec: envInt('MM_BURST_MAX_TAPS_PER_SEC', 25),
  reaction_min_ms:        envInt('MM_REACTION_MIN_MS',        150),
};

// Rate limits per uid.
export const RATE_LIMITS = {
  // General game messages
  msgs_per_sec: envInt('MM_MSGS_PER_SEC', 10),
  msgs_burst:   envInt('MM_MSGS_BURST',   30),
  // Challenge inputs (Burst legitimately needs ~10/sec; cap at 25 catches bots)
  challenge_inputs_per_sec: envInt('MM_CHALLENGE_INPUTS_PER_SEC', 25),
  challenge_inputs_burst:   envInt('MM_CHALLENGE_INPUTS_BURST',   50),
  // Per-uid create_room — now an enforced guard (2A.7), so parse strictly:
  // a 0 / negative / garbage override must not silently disable the quota.
  create_room_per_min: envPosInt('MM_CREATE_ROOM_PER_MIN', 10),
};

// Connection admission (Stage 2A). Sized for several teams + spectators on a
// single shared school-WiFi IP, tuned later from near-limit metrics. Pending
// caps count PRE-AUTH sockets only; authed sessions are tracked separately by
// uid so a reconnect transfers (never consumes) a slot.
export const ADMISSION = {
  max_pending_per_ip:          envPosInt('MM_MAX_PENDING_PER_IP',          30),
  max_pending_total:           envPosInt('MM_MAX_PENDING_TOTAL',           200),
  max_attempts_per_min_per_ip: envPosInt('MM_MAX_ATTEMPTS_PER_MIN_PER_IP', 60),
  max_attempt_burst_per_ip:    envPosInt('MM_MAX_ATTEMPT_BURST_PER_IP',    60),
  max_auth_sessions_per_ip:    envPosInt('MM_MAX_AUTH_SESSIONS_PER_IP',    100),
  trusted_proxy:               envBool('MM_TRUSTED_PROXY',                 false),
};

// Timing
export const TIMING = {
  ping_interval_ms:           envInt('MM_PING_INTERVAL_MS',           20_000),
  reconnect_grace_ms:         envInt('MM_RECONNECT_GRACE_MS',         45_000),
  client_reconnect_window_ms: envInt('MM_CLIENT_RECONNECT_WINDOW_MS', 90_000),
  room_idle_timeout_ms:       envInt('MM_ROOM_IDLE_TIMEOUT_MS',       10 * 60 * 1000),
  room_sweep_margin_ms:       envInt('MM_ROOM_SWEEP_MARGIN_MS',       60_000),
  // RateLimiter bucket eviction (Stage 2A.8): drop a per-uid bucket after it
  // sits idle this long; the sweeper runs on this interval.
  rate_bucket_idle_ttl_ms:    envPosInt('MM_RATE_BUCKET_IDLE_TTL_MS',  600_000),
  rate_bucket_sweep_ms:       envPosInt('MM_RATE_BUCKET_SWEEP_MS',     60_000),
  period_choice_deadline_ms:  envInt('MM_PERIOD_CHOICE_DEADLINE_MS',  30_000),
  // AFK card-pick deadline: auto-pick a MISS so an online round can't stall on a
  // missing card_pick. Kept conservatively below the client's 25s watchdog.
  card_pick_deadline_ms:      envInt('MM_CARD_PICK_DEADLINE_MS',      20_000),
  high_rtt_warning_threshold: envInt('MM_HIGH_RTT_WARN_MS',           350),
  // Per-mechanic deadlines (challenge timeout)
  charge_deadline_ms:   envInt('MM_CHARGE_DEADLINE_MS',   4500),
  reaction_grace_ms:    envInt('MM_REACTION_GRACE_MS',    2500),    // added to realPromptDelayMs
  trace_deadline_ms:    envInt('MM_TRACE_DEADLINE_MS',    5500),
  burst_grace_ms:       envInt('MM_BURST_GRACE_MS',       1000),    // added to windowMs
};

// Hand size. The engine accepts a per-call `size` arg; we use this constant
// to stay consistent across all hand-deal call sites server-side.
export const HAND_SIZE = envInt('MM_HAND_SIZE', 6);
