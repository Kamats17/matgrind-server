// Tiny helper for the path-trace round-result toast. Lives in its own
// module so tests can assert that the displayed bonus number reflects
// `lastResult.pXSkillBonusApplied` (which incorporates spam-factor
// reduction) rather than the raw `SKILL_TIERS.GOOD.bonus` constant.
//
// Spam ladder: a 4th consecutive transition halves the bonus; a 5th
// zeros it. If the toast hardcoded SKILL_TIERS.GOOD.bonus it would
// display "+6" while the engine actually applied "+3" or "+0" - the
// regression this helper exists to prevent.

export function formatPathTraceLabel(tier, bonusApplied) {
  if (tier !== 'PERFECT' && tier !== 'GOOD') return null;
  const n = Math.round(Number(bonusApplied) || 0);
  return `Trace +${n}`;
}
