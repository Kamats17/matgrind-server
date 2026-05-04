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
  // Per-IP create_room
  create_room_per_min: envInt('MM_CREATE_ROOM_PER_MIN', 10),
};

// Timing
export const TIMING = {
  ping_interval_ms:           envInt('MM_PING_INTERVAL_MS',           20_000),
  reconnect_grace_ms:         envInt('MM_RECONNECT_GRACE_MS',         45_000),
  room_idle_timeout_ms:       envInt('MM_ROOM_IDLE_TIMEOUT_MS',       10 * 60 * 1000),
  period_choice_deadline_ms:  envInt('MM_PERIOD_CHOICE_DEADLINE_MS',  30_000),
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
