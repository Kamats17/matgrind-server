// src/lib/matchTips.js
//
// Short, punchy tips shown on loading screens and between screens.
// Rotates at ~4s intervals; each tip is under ~80 chars so it fits a single
// line on iPhone SE portrait. Keep them action-oriented: "do X", "try Y".
//
// The set blends gameplay strategy, meta hints (Game Center, achievements,
// daily goals), and flavor - a fresh tip is picked each time.

/** @type {string[]} Single source of truth. Edit here to add/remove tips. */
export const TIPS = [
  // ── Game Center + achievement discovery ────────────────────────────────
  'Tap 🎮 Game Center on the Main Menu to see leaderboards and achievements.',
  'Every win posts to Game Center - 27 achievements to unlock.',
  'Win 5 online matches to earn the Road Warrior achievement.',
  'Practice with 3 different teammates to earn Training Partner.',
  'Enter 3 tournaments to earn Bracket Regular.',
  'Win a full tournament bracket to earn Tournament Champion.',

  // ── Folkstyle strategy ─────────────────────────────────────────────────
  'A folkstyle takedown is worth 3 - the highest single-move reward.',
  'Riding time ≥ 1 minute gives you an automatic point at match end.',
  'Near falls from neutral are rare - take the TD first, back-points second.',
  'Shoot on a fatigued opponent: low endurance = low sprawl.',
  'Turk and tilt from top to rack up back-points without risking reversal.',

  // ── Freestyle / Greco ─────────────────────────────────────────────────
  'In freestyle, trailing 0-0 at period end gives your opponent the point.',
  'A clean 4-point throw ends half of freestyle matches before the whistle.',
  'Greco is all upper body - no leg attacks, but big throws everywhere.',
  'Push-outs in freestyle: step on the line, give up a point.',

  // ── Women's freestyle ─────────────────────────────────────────────────
  'Gut wrench then leg lace - the women\'s par terre signature combo.',
  'Women\'s wrestling is the fastest-growing US scholastic sport.',
  'Bridge and turn from bottom flips an exposure attempt into a reversal.',
  'Belly down denies back points but gives up the position - pure defense.',
  'Russian tie sets up the ankle pick - women\'s mode rewards the chain.',

  // ── Card mechanics ─────────────────────────────────────────────────────
  'Defensive cards beat the move they counter, but lose to everything else.',
  'Stamina-heavy cards whiff when your wrestler is gassed - watch the bar.',
  'Card hand refreshes each period; plan your finisher for the last round.',
  'High-technique wrestlers see better cards on average.',

  // ── Profile / progression ──────────────────────────────────────────────
  'Level up to spend stat points on strength, speed, tech, endurance, grit.',
  'Daily goals refresh every 24 hours - open them for bonus XP.',
  'Win streaks stack - 5 in a row lights the Hot Streak.',
  'Win by pin = big XP bonus. Grind pins, grind levels.',
  'Stats cap at 85 - force tradeoffs: you can\'t max everything.',

  // ── Online + tournament ────────────────────────────────────────────────
  'Tournaments give the biggest XP payouts - worth the grind.',
  'Bracket seeding is mostly random; anyone can run the table.',
  'Shake a friend\'s hand after a tough match - sportsmanship counts.',
  'Practice matches don\'t affect your streak - safe place to try new cards.',

  // ── Meta / replay / tutorials ──────────────────────────────────────────
  'Every match is saved to Replay - watch your best wins again.',
  'Tutorial lives in the Main Menu. Takes 3 minutes, saves hours of confusion.',
  'Share match results from the result screen - native iOS share sheet.',
  'Open the Main Menu badge to see your pending daily challenge.',
];

/**
 * Return a random tip from the library. Uses Math.random; deterministic
 * versions can pass a seed if needed later.
 */
export function randomTip() {
  if (TIPS.length === 0) return '';
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}

/**
 * Pick a tip whose index differs from the previous one, so back-to-back
 * loads don't show the same string. Returns { tip, index }.
 *
 * @param {number|null} prevIndex - index of the previously shown tip (or null)
 */
export function nextTip(prevIndex = null) {
  if (TIPS.length <= 1) return { tip: TIPS[0] || '', index: 0 };
  let idx = Math.floor(Math.random() * TIPS.length);
  if (prevIndex !== null && idx === prevIndex) {
    idx = (idx + 1) % TIPS.length;
  }
  return { tip: TIPS[idx], index: idx };
}
