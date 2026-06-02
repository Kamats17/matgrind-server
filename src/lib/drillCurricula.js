// src/lib/drillCurricula.js
//
// Per-mechanic curriculum: a 3-5 step guided practice path for the four
// in-match micro-mechanics (Charge, Reaction, Trace, Burst). Each step is a
// (title, hint, tuning override, pass condition) tuple. The shared
// DrillCurriculum component reads these, mounts the matching mechanic with
// the override merged onto the production tuning, and advances when the
// player's resolution tier appears in `passOn`.
//
// Design rules baked into each curriculum:
//   * Step 1 always uses the easiest possible tuning (slow/wide/forgiving)
//     so the player can't fail it on their first read of the mechanic.
//   * Steps gradually approach real-match tuning. The final step uses the
//     production constants verbatim - graduating means the player can hit
//     the same windows they'll see in a live match.
//   * `requireStreak` lets a step demand consecutive successes before it
//     marks itself complete (e.g. 3 PERFECTs in a row at match speed).
//   * `passOn` accepts an array of acceptable tiers - early steps usually
//     pass on GOOD too so the player feels momentum; late steps only pass
//     on PERFECT.
//
// Persistence: the user's furthest-reached step per mechanic lives in
// localStorage under `drill:learn:<mechanic>:step` (see DRILL_LEARN_KEYS
// in TrainingHub).

export const DRILL_LEARN_KEYS = {
  charge:   'drill:learn:charge:step',
  reaction: 'drill:learn:reaction:step',
  trace:    'drill:learn:trace:step',
  burst:    'drill:learn:burst:step',
};

// Curricula keyed by mechanic id. Tuning overrides are MERGED on top of the
// production MECHANIC_TUNING entry - only specify the fields you want to
// change. An empty `{}` means "use real-match tuning."
export const CURRICULA = {
  charge: [
    {
      title: 'Hold and watch it fill',
      hint: 'Press and hold the bar - it fills slowly. Release any time.',
      tuning: { fillDurationMs: 1600, perfectZone: [0.40, 1.00], goodZone: [0.20, 1.00] },
      passOn: ['PERFECT', 'GOOD'],
    },
    {
      title: 'Land in the green zone',
      hint: 'Now release while the bar is inside the green band.',
      tuning: { fillDurationMs: 1300, perfectZone: [0.55, 0.95], goodZone: [0.40, 1.00] },
      passOn: ['PERFECT', 'GOOD'],
    },
    {
      title: 'Tighter window',
      hint: 'Same idea - but the green band is smaller. Time the release.',
      tuning: { fillDurationMs: 1000, perfectZone: [0.65, 0.92], goodZone: [0.50, 0.98] },
      passOn: ['PERFECT'],
    },
    {
      title: 'Match speed - three perfect releases',
      hint: 'Real match tuning. Land three perfects in a row to graduate.',
      tuning: {},
      passOn: ['PERFECT'],
      requireStreak: 3,
    },
  ],

  reaction: [
    {
      title: 'Tap when it turns green',
      hint: 'Wait for the button to flash green, then tap. No rush.',
      tuning: { perfectWindowMs: 600, goodWindowMs: 900, timeoutMs: 1800 },
      passOn: ['PERFECT', 'GOOD'],
    },
    {
      title: 'Faster',
      hint: 'Same drill - but only fast taps count as PERFECT.',
      tuning: { perfectWindowMs: 400, goodWindowMs: 650, timeoutMs: 1500 },
      passOn: ['PERFECT', 'GOOD'],
    },
    {
      title: 'Match speed',
      hint: 'Real reaction window. Aim for PERFECT.',
      tuning: {},
      passOn: ['PERFECT'],
    },
    {
      title: 'Three perfects in a row',
      hint: 'Lock it in. Three PERFECTs back-to-back to graduate.',
      tuning: {},
      passOn: ['PERFECT'],
      requireStreak: 3,
    },
  ],

  trace: [
    {
      title: 'One arrow',
      hint: 'Swipe in the direction the arrow points. Just one arrow this time.',
      tuning: { arrowCount: 1, perfectWindowMs: 1500, goodWindowMs: 2200, timeoutMs: 3000 },
      passOn: ['PERFECT', 'GOOD'],
    },
    {
      title: 'Two arrows, slow',
      hint: 'Now two arrows, in order. Take your time.',
      tuning: { arrowCount: 2, perfectWindowMs: 1500, goodWindowMs: 2200, timeoutMs: 3000 },
      passOn: ['PERFECT', 'GOOD'],
    },
    {
      title: 'Two arrows, faster',
      hint: 'Same drill - but you need to be quicker for PERFECT.',
      tuning: { arrowCount: 2, perfectWindowMs: 1100, goodWindowMs: 1500, timeoutMs: 2000 },
      passOn: ['PERFECT'],
    },
    {
      title: 'Match speed',
      hint: 'Real trace tuning. Three perfects in a row to graduate.',
      tuning: {},
      passOn: ['PERFECT'],
      requireStreak: 3,
    },
  ],

  burst: [
    {
      title: 'Tap a few times',
      hint: 'Just tap the button a few times to start the timer.',
      tuning: { windowMs: 1000, perfectTaps: 3, goodTaps: 2 },
      passOn: ['PERFECT', 'GOOD'],
    },
    {
      title: 'Faster mashing',
      hint: 'Bump the count up - mash faster within the window.',
      tuning: { windowMs: 800, perfectTaps: 5, goodTaps: 3 },
      passOn: ['PERFECT', 'GOOD'],
    },
    {
      title: 'Match speed',
      hint: 'Real escape tuning: 6+ taps in 700ms for PERFECT.',
      tuning: {},
      passOn: ['PERFECT'],
    },
    {
      title: 'Three perfects in a row',
      hint: 'Sustain it. Three PERFECTs back-to-back to graduate.',
      tuning: {},
      passOn: ['PERFECT'],
      requireStreak: 3,
    },
  ],
};

// Convenience: total step count per mechanic, used for the "x/y complete"
// readout on TrainingHub.
export function totalSteps(mechanic) {
  return CURRICULA[mechanic]?.length ?? 0;
}

// Read the user's furthest-reached step (0..totalSteps). Returns 0 if no
// progress yet or the value can't be parsed.
export function loadProgress(mechanic) {
  const key = DRILL_LEARN_KEYS[mechanic];
  if (!key) return 0;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(n, totalSteps(mechanic))) : 0;
  } catch {
    return 0;
  }
}

// Persist progress, but never go backwards - completing step 2 then later
// reaching step 1 again shouldn't wipe progress on step 2.
export function saveProgress(mechanic, step) {
  const key = DRILL_LEARN_KEYS[mechanic];
  if (!key) return;
  try {
    const current = loadProgress(mechanic);
    const next = Math.max(current, step);
    localStorage.setItem(key, String(next));
  } catch { /* silent - quota errors etc. */ }
}

// Reset progress for one mechanic (e.g. "Restart curriculum" button).
export function resetProgress(mechanic) {
  const key = DRILL_LEARN_KEYS[mechanic];
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* silent */ }
}
